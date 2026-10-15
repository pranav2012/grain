//! Grain's local server: HTTP API for the UI, PR preparation and summary jobs.

mod contract;
mod error;
mod folder_picker;
mod jobs;
mod local_repos;
mod patch_index;
mod routes;
mod state;
mod ui;

use std::net::SocketAddr;
use std::path::PathBuf;

use anyhow::Result;
use grain_github::PrRef;
use grain_store::Home;
use tower_http::services::{ServeDir, ServeFile};

pub use jobs::cleanup::CleanupReport;

/// Cleans up merged or closed PRs and idle checkouts now (`everything`: all checkouts and clones).
pub fn clean(everything: bool) -> CleanupReport {
    jobs::cleanup::run(&Home::locate(), everything, &|_| false)
}

/// Prepares a self-review of the local work in `path` and returns its review id.
pub fn register_local(path: &std::path::Path) -> Result<PrRef> {
    jobs::local::register(&Home::locate(), path)
}

/// Prefetch every 15 minutes and clean up every hour, starting shortly after launch.
fn spawn_background(app: state::Shared) {
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
        let mut tick: u64 = 0;
        loop {
            let a = app.clone();
            let cleanup = tick.is_multiple_of(4);
            let _ = tokio::task::spawn_blocking(move || {
                if cleanup {
                    let report = jobs::cleanup::run(&a.home, false, &|pr| a.is_busy(pr));
                    tracing::info!(?report, "cleanup");
                }
                jobs::prefetch::run(&a);
            })
            .await;
            tick += 1;
            tokio::time::sleep(std::time::Duration::from_mins(15)).await;
        }
    });
}

pub struct Options {
    pub port: u16,
    /// Serve the UI from this folder instead of the embedded copy (UI development).
    pub ui_dir: Option<PathBuf>,
    /// Identifies this binary (see `/api/version`).
    pub build: String,
}

/// Binds to localhost and serves until the process exits. `on_ready` receives the base URL.
pub async fn serve(opts: Options, on_ready: impl FnOnce(&str)) -> Result<()> {
    let app = state::App::new(Home::locate(), opts.build.clone());
    // Warm GitHub lookups so the switcher's lists and repo search are instant.
    tokio::task::spawn_blocking(|| {
        let _ = grain_github::repos(None);
    });
    spawn_background(app.clone());
    let router = match &opts.ui_dir {
        Some(dir) => {
            routes::router(app).fallback_service(ServeDir::new(dir).fallback(ServeFile::new(dir.join("index.html"))))
        }
        None => routes::router(app).fallback(ui::embedded),
    };
    let listener = tokio::net::TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], opts.port))).await?;
    on_ready(&format!("http://localhost:{}", opts.port));
    axum::serve(listener, router).await?;
    Ok(())
}
