use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant};

use grain_github::PrRef;
use grain_store::{Home, Settings};

use crate::contract::{Job, Stage};
use crate::jobs::{local, prepare, summarize::Summarizer};

/// State shared by all requests and background jobs.
pub(crate) struct App {
    pub(crate) home: Home,
    pub(crate) settings: Mutex<Settings>,
    viewer: Mutex<Option<String>>,
    pub(crate) jobs: Mutex<HashMap<PrRef, Job>>,
    pub(crate) summarizers: Mutex<HashMap<PrRef, Summarizer>>,
    /// PRs with a preparation or enrichment pass running; never two at once per PR.
    busy: Mutex<HashSet<PrRef>>,
    /// PRs whose review is open but whose whole-repo facts are still being computed.
    pub(crate) enriching: Mutex<HashSet<PrRef>>,
    pub(crate) patches: crate::patch_index::PatchCache,
    /// Latest working-tree snapshot per local review, re-taken at most every few seconds.
    local_heads: Mutex<HashMap<PrRef, (Instant, String)>>,
}

pub(crate) type Shared = Arc<App>;

/// Runs a background step, turning a panic into an error so a job can never get stuck.
pub(crate) fn guarded<T>(what: &str, f: impl FnOnce() -> anyhow::Result<T>) -> anyhow::Result<T> {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)).unwrap_or_else(|panic| {
        let reason = panic
            .downcast_ref::<&str>()
            .map(ToString::to_string)
            .or_else(|| panic.downcast_ref::<String>().cloned())
            .unwrap_or_default();
        tracing::error!(%what, %reason, "background step crashed");
        Err(anyhow::anyhow!(
            "Grain hit an internal error while {what} ({reason}). Please report it; reopening may help."
        ))
    })
}

impl App {
    pub(crate) fn new(home: Home) -> Shared {
        let settings = home.load_settings();
        Arc::new(App {
            home,
            settings: Mutex::new(settings),
            viewer: Mutex::new(None),
            jobs: Mutex::new(HashMap::new()),
            summarizers: Mutex::new(HashMap::new()),
            busy: Mutex::new(HashSet::new()),
            enriching: Mutex::new(HashSet::new()),
            patches: crate::patch_index::PatchCache::default(),
            local_heads: Mutex::new(HashMap::new()),
        })
    }

    pub(crate) fn is_busy(&self, pr: &PrRef) -> bool {
        self.busy.lock().unwrap_or_else(PoisonError::into_inner).contains(pr)
    }

    /// What a local review's head would be now, so the UI can offer a refresh after edits.
    /// Blocking; cached briefly because the UI polls status every few seconds.
    pub(crate) fn local_head(&self, pr: &PrRef) -> Option<String> {
        const FRESH: Duration = Duration::from_secs(5);
        if let Some((at, head)) = self.local_heads.lock().unwrap_or_else(PoisonError::into_inner).get(pr)
            && at.elapsed() < FRESH
        {
            return Some(head.clone());
        }
        let head = local::current_head(&self.home, pr).ok()?;
        self.local_heads
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(pr.clone(), (Instant::now(), head.clone()));
        Some(head)
    }

    pub(crate) fn settings(&self) -> Settings {
        self.settings.lock().unwrap_or_else(PoisonError::into_inner).clone()
    }

    /// The signed-in GitHub login, looked up once.
    pub(crate) fn viewer(&self) -> String {
        if let Some(v) = self.viewer.lock().unwrap_or_else(PoisonError::into_inner).clone() {
            return v;
        }
        let v = grain_github::viewer().unwrap_or_default();
        *self.viewer.lock().unwrap_or_else(PoisonError::into_inner) = Some(v.clone());
        v
    }

    /// Starts (or re-checks) preparation of a PR in the background: stage 1 makes the review
    /// openable, stage 2 then adds whole-repo facts while the reviewer reads. A stored review is
    /// offered right away unless `refresh` asks to wait for the re-check.
    pub(crate) fn open(self: &Shared, pr: PrRef, by_reviewer: bool, refresh: bool) {
        if by_reviewer {
            self.home.touch_review(&pr);
        }
        if !self.busy.lock().unwrap_or_else(PoisonError::into_inner).insert(pr.clone()) {
            return;
        }
        // A stored review opens instantly; new commits are checked for in the background.
        let checking = if pr.is_local() { "Checking your local changes" } else { "Checking for new commits" };
        let stage =
            if !refresh && prepare::has_usable_review(&self.home, &pr) { Stage::Ready } else { Stage::Preparing };
        self.jobs
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(pr.clone(), Job { stage, message: checking.into() });
        let app = self.clone();
        tokio::task::spawn_blocking(move || {
            let started = std::time::Instant::now();
            let last = Mutex::new((String::from("start"), std::time::Instant::now()));
            let report = |m: &str| {
                let mut last = last.lock().unwrap_or_else(PoisonError::into_inner);
                tracing::info!(pr = %pr.number, step = %last.0, ms = last.1.elapsed().as_millis(), "prepare step done");
                *last = (m.to_string(), std::time::Instant::now());
                if let Some(j) = app.jobs.lock().unwrap_or_else(PoisonError::into_inner).get_mut(&pr) {
                    m.clone_into(&mut j.message);
                }
            };
            let result = guarded("preparing this pull request", || {
                if pr.is_local() {
                    local::prepare(&app.home, &pr, &app.viewer(), &app.settings(), &report)
                } else {
                    prepare::prepare(&app.home, &pr, &app.viewer(), &app.settings(), &report)
                }
            });
            report("done");
            tracing::info!(pr = %pr.number, total_ms = started.elapsed().as_millis(), "prepared");
            let (job, next) = match result {
                Ok(prepare::Next::NeedsRepo) => (
                    Job {
                        stage: Stage::NeedsRepo,
                        message: format!("Do you already have {} on this computer?", pr.full_repo()),
                    },
                    prepare::Next::Done,
                ),
                Ok(next) => (Job { stage: Stage::Ready, message: "Ready".into() }, next),
                Err(e) => (Job { stage: Stage::Failed, message: format!("{e:#}") }, prepare::Next::Done),
            };
            app.jobs.lock().unwrap_or_else(PoisonError::into_inner).insert(pr.clone(), job);
            if matches!(next, prepare::Next::Enrich) {
                app.enriching.lock().unwrap_or_else(PoisonError::into_inner).insert(pr.clone());
                let t = std::time::Instant::now();
                match guarded("checking how the changes are used", || prepare::enrich(&app.home, &pr)) {
                    Ok(()) => tracing::info!(pr = %pr.number, ms = t.elapsed().as_millis(), "enriched"),
                    Err(e) => tracing::warn!(pr = %pr.number, error = %format!("{e:#}"), "enrichment failed"),
                }
                app.enriching.lock().unwrap_or_else(PoisonError::into_inner).remove(&pr);
            }
            app.busy.lock().unwrap_or_else(PoisonError::into_inner).remove(&pr);
        });
    }
}
