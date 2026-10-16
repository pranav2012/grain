//! Grain's local server: HTTP API for the UI, PR preparation and summary jobs.

mod access;
mod contract;
mod error;
mod folder_picker;
mod jobs;
mod local_repos;
mod patch_index;
pub(crate) mod routes;
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
    /// A socket already listening on `port`, handed over by the OS when it started Grain on demand.
    pub listener: Option<std::net::TcpListener>,
}

/// Where Grain is reached in the browser. `*.localhost` always points at this machine, so the
/// name needs no setup; plain `localhost` works too.
pub fn url(port: u16) -> String {
    format!("http://grain.localhost:{port}")
}

/// Serves on localhost until asked to stop (`grain stop`, Ctrl+C, SIGTERM or idle), then exits the
/// process. `on_ready` receives the base URL.
pub async fn serve(opts: Options, on_ready: impl FnOnce(&str)) -> Result<()> {
    let app = state::App::new(Home::locate(), opts.build.clone());
    // Warm GitHub lookups so the switcher's lists and repo search are instant.
    tokio::task::spawn_blocking(|| {
        let _ = grain_github::repos(None);
    });
    spawn_background(app.clone());
    let router = match &opts.ui_dir {
        Some(dir) => routes::router(app.clone())
            .fallback_service(ServeDir::new(dir).fallback(ServeFile::new(dir.join("index.html")))),
        None => routes::router(app.clone()).fallback(ui::embedded),
    };
    let router = router.layer(axum::middleware::from_fn_with_state(app.clone(), access::guard));
    let listener = match opts.listener {
        Some(l) => {
            l.set_nonblocking(true)?;
            tokio::net::TcpListener::from_std(l)?
        }
        None => tokio::net::TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], opts.port))).await?,
    };
    on_ready(&url(opts.port));
    stop_when_idle(app.clone());
    let stopping = app.clone();
    axum::serve(listener, router).with_graceful_shutdown(stop_requested(stopping)).await?;
    // Background jobs (clones, reviews) are dropped; they run again when the review is opened again.
    std::process::exit(0)
}

/// Minutes without any request (open tabs check in every minute) after which Grain stops, unless
/// background work is running. `GRAIN_IDLE_MINUTES=0` keeps it running.
fn idle_limit() -> Option<std::time::Duration> {
    let minutes = std::env::var("GRAIN_IDLE_MINUTES").ok().and_then(|v| v.parse::<u64>().ok()).unwrap_or(30);
    (minutes > 0).then(|| std::time::Duration::from_mins(minutes))
}

fn stop_when_idle(app: state::Shared) {
    let Some(limit) = idle_limit() else { return };
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_mins(1).min(limit)).await;
            let idle = app.last_seen.lock().unwrap_or_else(std::sync::PoisonError::into_inner).elapsed();
            if idle >= limit && !app.has_work() {
                tracing::info!(minutes = idle.as_secs() / 60, "no open Grain tab for a while; stopping");
                app.stop.notify_one();
                return;
            }
        }
    });
}

/// Resolves when the server should stop. Requests in flight (like progress saves, which take
/// milliseconds) get two seconds to finish before the process exits regardless.
async fn stop_requested(app: state::Shared) {
    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut s) => {
                s.recv().await;
            }
            Err(_) => std::future::pending().await,
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        () = app.stop.notified() => {}
        _ = tokio::signal::ctrl_c() => {}
        () = terminate => {}
    }
    tracing::info!("stopping; finishing requests in flight");
    std::thread::spawn(|| {
        std::thread::sleep(std::time::Duration::from_secs(2));
        std::process::exit(0);
    });
}
