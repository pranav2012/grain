use std::collections::{HashSet, VecDeque};

use grain_agent::{Agent, Outcome};
use grain_github::PrRef;
use grain_store::{read_json, write_atomic};

use super::prepare::block_diff;
use crate::contract::SummarizerStatus;
use crate::state::App;

/// Per-review queue: blocks near the reader, summarized one request at a time.
#[derive(Default)]
pub(crate) struct Summarizer {
    queue: VecDeque<String>,
    seen: HashSet<String>,
    pub(crate) status: SummarizerStatus,
}

impl App {
    /// Queues blocks (by content key) for summaries and starts the worker if it is idle.
    pub(crate) fn request_summaries(self: &std::sync::Arc<Self>, pr: PrRef, keys: Vec<String>) {
        let Some(agent) = self.settings.lock().unwrap_or_else(std::sync::PoisonError::into_inner).agent else { return };
        let mut sums = self.summarizers.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        let s = sums.entry(pr.clone()).or_default();
        if s.status.stopped.is_some() {
            return;
        }
        let have = read_json(&self.home.review_dir(&pr).join("summaries.json")).unwrap_or_default();
        for k in keys {
            if have.get(&k).is_none() && s.seen.insert(k.clone()) {
                s.queue.push_back(k);
            }
        }
        s.status.pending = s.queue.len();
        if s.status.running || s.queue.is_empty() {
            return;
        }
        s.status.running = true;
        drop(sums);
        let app = self.clone();
        tokio::task::spawn_blocking(move || {
            let _ = crate::state::guarded("summarizing", || {
                app.summarize_loop(&pr, agent);
                Ok(())
            });
            // Whatever happened, let the next request start a fresh worker.
            if let Some(s) = app.summarizers.lock().unwrap_or_else(std::sync::PoisonError::into_inner).get_mut(&pr) {
                s.status.running = false;
            }
        });
    }

    fn next_key(&self, pr: &PrRef) -> Option<String> {
        let cap = self.settings.lock().unwrap_or_else(std::sync::PoisonError::into_inner).max_summaries_per_review;
        let mut sums = self.summarizers.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        let s = sums.get_mut(pr)?;
        if s.status.fresh_requests >= cap {
            s.status.stopped =
                Some(format!("Reached the limit of {cap} summaries for this review. Change it in settings."));
            s.queue.clear();
        }
        let key = if s.status.stopped.is_none() { s.queue.pop_front() } else { None };
        s.status.pending = s.queue.len();
        if key.is_none() {
            s.status.running = false;
        }
        key
    }

    fn summarize_loop(&self, pr: &PrRef, agent: Agent) {
        let dir = self.home.review_dir(pr);
        while let Some(key) = self.next_key(pr) {
            let model = self.settings.lock().unwrap_or_else(std::sync::PoisonError::into_inner).model.clone();
            let files: Option<Vec<String>> = read_json(&dir.join("review.json")).and_then(|r| {
                let block = r["blocks"].as_array()?.iter().find(|b| b["key"] == key.as_str())?;
                Some(block["files"].as_array()?.iter().filter_map(|f| f.as_str().map(str::to_string)).collect())
            });
            let Some(files) = files else { continue };
            let Ok(diff) = block_diff(&self.home, pr, &files) else { continue };
            let outcome = grain_agent::summarize(agent, model.as_deref(), &diff, &self.home.cache_dir());
            let mut sums = self.summarizers.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
            let Some(s) = sums.get_mut(pr) else { return };
            match outcome {
                Outcome::Done { summary, cached } => {
                    if !cached {
                        s.status.fresh_requests += 1;
                    }
                    let path = dir.join("summaries.json");
                    let mut all = read_json(&path).unwrap_or_else(|| serde_json::json!({}));
                    all[&key] = summary;
                    let _ = write_atomic(&path, all.to_string().as_bytes());
                }
                Outcome::Refused { reason } => s.status.stopped = Some(reason),
                Outcome::Limited { .. } => {
                    s.status.stopped = Some(format!(
                        "{} reported a usage limit. Summaries are paused; nothing will be retried.",
                        agent.id()
                    ));
                }
                Outcome::Failed { detail } => tracing::warn!(%key, %detail, "summary failed"),
            }
        }
    }
}
