use std::collections::HashMap;
use std::sync::{Arc, Mutex, PoisonError};

use grain_github::PrRef;
use grain_store::{Home, Settings};

use crate::contract::{Job, Stage};
use crate::jobs::{prepare, summarize::Summarizer};

/// State shared by all requests and background jobs.
pub(crate) struct App {
    pub(crate) home: Home,
    pub(crate) settings: Mutex<Settings>,
    viewer: Mutex<Option<String>>,
    pub(crate) jobs: Mutex<HashMap<PrRef, Job>>,
    pub(crate) summarizers: Mutex<HashMap<PrRef, Summarizer>>,
}

pub(crate) type Shared = Arc<App>;

impl App {
    pub(crate) fn new(home: Home) -> Shared {
        let settings = home.load_settings();
        Arc::new(App {
            home,
            settings: Mutex::new(settings),
            viewer: Mutex::new(None),
            jobs: Mutex::new(HashMap::new()),
            summarizers: Mutex::new(HashMap::new()),
        })
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

    /// Starts (or re-checks) preparation of a PR in the background.
    pub(crate) fn open(self: &Shared, pr: PrRef) {
        {
            let mut jobs = self.jobs.lock().unwrap_or_else(PoisonError::into_inner);
            if jobs.get(&pr).is_some_and(|j| j.stage == Stage::Preparing) {
                return;
            }
            jobs.insert(pr.clone(), Job { stage: Stage::Preparing, message: "Starting".into() });
        }
        let app = self.clone();
        tokio::task::spawn_blocking(move || {
            let report = |m: &str| {
                if let Some(j) = app.jobs.lock().unwrap_or_else(PoisonError::into_inner).get_mut(&pr) {
                    m.clone_into(&mut j.message);
                }
            };
            let job = match prepare::prepare(&app.home, &pr, &app.viewer(), &app.settings(), &report) {
                Ok(()) => Job { stage: Stage::Ready, message: "Ready".into() },
                Err(e) => Job { stage: Stage::Failed, message: format!("{e:#}") },
            };
            app.jobs.lock().unwrap_or_else(PoisonError::into_inner).insert(pr, job);
        });
    }
}
