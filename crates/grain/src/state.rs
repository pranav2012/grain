use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{Arc, Mutex};

use grain_github::PrRef;
use serde::Serialize;

use crate::home::{read_json, write_atomic, Home, Settings};
use crate::prepare;

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Stage {
    Preparing,
    Ready,
    Failed,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub stage: Stage,
    pub message: String,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summarizer {
    #[serde(skip)]
    queue: VecDeque<String>,
    pub running: bool,
    pub pending: usize,
    pub fresh_requests: usize,
    /// Why summaries stopped for this review (usage limit, policy, cap); nothing more is sent.
    pub stopped: Option<String>,
    #[serde(skip)]
    seen: HashSet<String>,
}

pub struct App {
    pub home: Home,
    pub settings: Mutex<Settings>,
    pub viewer: Mutex<Option<String>>,
    pub jobs: Mutex<HashMap<PrRef, Job>>,
    pub summarizers: Mutex<HashMap<PrRef, Summarizer>>,
}

pub type Shared = Arc<App>;

impl App {
    pub fn new(home: Home) -> Shared {
        let settings = home.load_settings();
        Arc::new(App {
            home,
            settings: Mutex::new(settings),
            viewer: Mutex::new(None),
            jobs: Mutex::new(HashMap::new()),
            summarizers: Mutex::new(HashMap::new()),
        })
    }

    pub fn viewer(&self) -> String {
        if let Some(v) = self.viewer.lock().unwrap().clone() {
            return v;
        }
        let v = grain_github::viewer().unwrap_or_default();
        *self.viewer.lock().unwrap() = Some(v.clone());
        v
    }

    /// Starts (or re-checks) preparation of a PR in the background.
    pub fn open(self: &Shared, pr: PrRef) {
        {
            let mut jobs = self.jobs.lock().unwrap();
            if jobs.get(&pr).is_some_and(|j| j.stage == Stage::Preparing) {
                return;
            }
            jobs.insert(pr.clone(), Job { stage: Stage::Preparing, message: "Starting".into() });
        }
        let app = self.clone();
        tokio::task::spawn_blocking(move || {
            let viewer = app.viewer();
            let settings = app.settings.lock().unwrap().clone();
            let report = |m: &str| {
                if let Some(j) = app.jobs.lock().unwrap().get_mut(&pr) {
                    j.message = m.to_string();
                }
            };
            let result = prepare::prepare(&app.home, &pr, &viewer, &settings, &report);
            let job = match result {
                Ok(()) => Job { stage: Stage::Ready, message: "Ready".into() },
                Err(e) => Job { stage: Stage::Failed, message: format!("{e:#}") },
            };
            app.jobs.lock().unwrap().insert(pr, job);
        });
    }

    /// Queues blocks (by content key) for summaries; one request at a time per review.
    pub fn request_summaries(self: &Shared, pr: PrRef, keys: Vec<String>) {
        let Some(agent) = self.settings.lock().unwrap().agent else { return };
        let mut sums = self.summarizers.lock().unwrap();
        let s = sums.entry(pr.clone()).or_default();
        if s.stopped.is_some() {
            return;
        }
        let have = read_json(&self.home.review_dir(&pr).join("summaries.json")).unwrap_or_default();
        for k in keys {
            if have.get(&k).is_none() && s.seen.insert(k.clone()) {
                s.queue.push_back(k);
            }
        }
        s.pending = s.queue.len();
        if s.running || s.queue.is_empty() {
            return;
        }
        s.running = true;
        drop(sums);
        let app = self.clone();
        tokio::task::spawn_blocking(move || app.summarize_loop(pr, agent));
    }

    fn summarize_loop(&self, pr: PrRef, agent: grain_agent::Agent) {
        loop {
            let (model, cap) = {
                let s = self.settings.lock().unwrap();
                (s.model.clone(), s.max_summaries_per_review)
            };
            let key = {
                let mut sums = self.summarizers.lock().unwrap();
                let s = sums.get_mut(&pr).unwrap();
                if s.fresh_requests >= cap {
                    s.stopped = Some(format!("Reached the limit of {cap} summaries for this review. Change it in settings."));
                    s.queue.clear();
                }
                s.pending = s.queue.len();
                match s.queue.pop_front() {
                    Some(k) if s.stopped.is_none() => k,
                    _ => {
                        s.running = false;
                        s.pending = 0;
                        return;
                    }
                }
            };
            let dir = self.home.review_dir(&pr);
            let Some(files) = read_json(&dir.join("review.json")).and_then(|r| {
                r["blocks"].as_array()?.iter().find(|b| b["key"] == key.as_str()).map(|b| {
                    b["files"].as_array().into_iter().flatten().filter_map(|f| f.as_str().map(str::to_string)).collect::<Vec<_>>()
                })
            }) else {
                continue;
            };
            let Ok(diff) = prepare::block_diff(&self.home, &pr, &files) else { continue };
            let outcome = grain_agent::summarize(agent, model.as_deref(), &diff, &self.home.cache_dir());
            let mut sums = self.summarizers.lock().unwrap();
            let s = sums.get_mut(&pr).unwrap();
            match outcome {
                grain_agent::Outcome::Done { summary, cached } => {
                    if !cached {
                        s.fresh_requests += 1;
                    }
                    let path = dir.join("summaries.json");
                    let mut all = read_json(&path).unwrap_or_else(|| serde_json::json!({}));
                    all[&key] = summary;
                    write_atomic(&path, all.to_string().as_bytes()).ok();
                }
                grain_agent::Outcome::Refused { reason } => s.stopped = Some(reason),
                grain_agent::Outcome::Limited { .. } => {
                    s.stopped = Some(format!("{} reported a usage limit. Summaries are paused; nothing will be retried.", agent.id()))
                }
                grain_agent::Outcome::Failed { detail } => eprintln!("summary failed for {key}: {detail}"),
            }
        }
    }
}
