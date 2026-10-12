//! Grain's local server: HTTP API for the UI, PR preparation and summary jobs.

mod contract;
mod error;
mod jobs;
mod routes;
mod state;
mod ui;

use std::net::SocketAddr;
use std::path::PathBuf;

use anyhow::Result;
use grain_github::PrRef;
use grain_store::Home;
use tower_http::services::{ServeDir, ServeFile};

pub struct Options {
    pub port: u16,
    /// Serve the UI from this folder instead of the embedded copy (UI development).
    pub ui_dir: Option<PathBuf>,
    /// Start preparing this PR right away.
    pub open_pr: Option<PrRef>,
}

/// Binds to localhost and serves until the process exits. `on_ready` receives the base URL.
pub async fn serve(opts: Options, on_ready: impl FnOnce(&str)) -> Result<()> {
    let app = state::App::new(Home::locate());
    // Warm GitHub lookups so the switcher's lists and repo search are instant.
    tokio::task::spawn_blocking(|| {
        let _ = grain_github::repos(None);
    });
    if let Some(pr) = &opts.open_pr {
        app.open(pr.clone());
    }
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
