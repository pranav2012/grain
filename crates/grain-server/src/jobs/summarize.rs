use std::collections::{HashSet, VecDeque};

use grain_agent::{Agent, Outcome};
use grain_github::PrRef;
use grain_store::{read_json, write_atomic};

use super::prepare::block_diff;
use crate::contract::SummarizerStatus;
use crate::state::App;

/// Summary keys for chapter intros are the chapter's key with this prefix; other keys are block keys.
const CHAPTER_PREFIX: &str = "chapter:";
/// Chapters can hold thousands of changed lines; the agent gets the first part.
const MAX_CHAPTER_DIFF: usize = 120_000;

/// Files to diff for a summary key: a block's files, or every file in a chapter's blocks.
fn files_for(review: &serde_json::Value, key: &str) -> Option<Vec<String>> {
    let blocks = review["blocks"].as_array()?;
    let files_of = |b: &serde_json::Value| -> Vec<String> {
        b["files"].as_array().into_iter().flatten().filter_map(|f| f.as_str().map(str::to_string)).collect()
    };
    let Some(chapter_key) = key.strip_prefix(CHAPTER_PREFIX) else {
        return blocks.iter().find(|b| b["key"] == key).map(files_of);
    };
    let chapter = review["story"]["chapters"].as_array()?.iter().find(|c| c["key"] == chapter_key)?;
    let ids: Vec<u64> = chapter["sections"]
        .as_array()?
        .iter()
        .flat_map(|s| s["blocks"].as_array().into_iter().flatten())
        .filter_map(serde_json::Value::as_u64)
        .collect();
    let mut files: Vec<String> =
        blocks.iter().filter(|b| b["id"].as_u64().is_some_and(|id| ids.contains(&id))).flat_map(files_of).collect();
    files.sort();
    files.dedup();
    Some(files)
}

/// Per-review queue: blocks and layers near the reader, summarized one request at a time.
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
            if let Some(why) = self.home.over_budget() {
                if let Some(s) = self.summarizers.lock().unwrap_or_else(std::sync::PoisonError::into_inner).get_mut(pr)
                {
                    s.status.stopped = Some(why);
                    s.queue.clear();
                }
                return;
            }
            let model = self.settings.lock().unwrap_or_else(std::sync::PoisonError::into_inner).model.clone();
            let chapter = key.strip_prefix(CHAPTER_PREFIX);
            let Some(files) = read_json(&dir.join("review.json")).and_then(|r| files_for(&r, &key)) else { continue };
            let Ok(mut diff) = block_diff(&self.home, pr, &files) else { continue };
            let outcome = if chapter.is_some() {
                if diff.len() > MAX_CHAPTER_DIFF {
                    diff.truncate(diff.floor_char_boundary(MAX_CHAPTER_DIFF));
                    diff.push_str("\n[diff truncated]\n");
                }
                grain_agent::summarize_layer(agent, model.as_deref(), &diff, &self.home.cache_dir())
            } else {
                grain_agent::summarize(agent, model.as_deref(), &diff, &self.home.cache_dir())
            };
            let mut sums = self.summarizers.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
            let Some(s) = sums.get_mut(pr) else { return };
            match outcome {
                Outcome::Done { summary, cached, usage } => {
                    if !cached {
                        s.status.fresh_requests += 1;
                    }
                    if let Some(u) = usage {
                        let kind = if chapter.is_some() { "chapter" } else { "summary" };
                        self.home.record_usage(&format!("{}/{}", pr.full_repo(), pr.number), kind, agent, &u);
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

#[cfg(test)]
mod tests {
    use super::files_for;

    #[test]
    fn finds_files_for_blocks_and_layers() {
        let review = serde_json::json!({
            "blocks": [
                {"id": 1, "key": "a", "files": ["x.ts", "y.ts"]},
                {"id": 2, "key": "b", "files": ["y.ts", "z.ts"]},
                {"id": 3, "key": "c", "files": ["w.ts"]},
            ],
            "story": {"chapters": [{"key": "L1", "sections": [{"blocks": [1]}, {"blocks": [2]}]}]},
        });
        assert_eq!(files_for(&review, "c"), Some(vec!["w.ts".to_string()]));
        assert_eq!(files_for(&review, "chapter:L1"), Some(vec!["x.ts".into(), "y.ts".into(), "z.ts".into()]));
        assert_eq!(files_for(&review, "chapter:missing"), None);
    }
}
