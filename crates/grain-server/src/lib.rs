//! Grain's local server: HTTP API for the UI, PR preparation and summary jobs.

mod contract;
mod error;
mod jobs;
mod routes;
mod state;

use std::net::SocketAddr;
use std::path::PathBuf;

use anyhow::Result;
use grain_github::PrRef;
use grain_store::Home;
use tower_http::services::{ServeDir, ServeFile};

pub struct Options {
    pub port: u16,
    /// Built UI to serve (`ui/dist`).
    pub ui_dir: PathBuf,
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
    let ui = ServeDir::new(&opts.ui_dir).fallback(ServeFile::new(opts.ui_dir.join("index.html")));
    let router = routes::router(app).fallback_service(ui);
    let listener = tokio::net::TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], opts.port))).await?;
    on_ready(&format!("http://localhost:{}", opts.port));
    axum::serve(listener, router).await?;
    Ok(())
}
