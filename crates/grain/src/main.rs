//! `grain`: local-first semantic code review.
//!
//! grain                       start the app and open it in the browser
//! grain <pr-link|o/r#123>     start the app on a pull request
//! grain analyze <repo> <base> <head>   print the engine's grouping for a git range

mod api;
mod home;
mod prepare;
mod state;

use std::net::SocketAddr;
use std::path::PathBuf;

use anyhow::Result;
use axum::Router;
use tower_http::services::{ServeDir, ServeFile};

const DEFAULT_PORT: u16 = 7420;

/// The built UI: `GRAIN_UI_DIR`, or `ui/dist` next to the source tree during development.
fn ui_dir() -> PathBuf {
    std::env::var_os("GRAIN_UI_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../ui/dist"))
}

#[tokio::main]
async fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) == Some("analyze") {
        let [_, repo, base, head] = args.as_slice() else {
            anyhow::bail!("usage: grain analyze <repo> <base> <head>");
        };
        let a = grain_engine::analyze(std::path::Path::new(repo), base, head)?;
        println!("{}", a.summary);
        return Ok(());
    }

    let port = std::env::var("GRAIN_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(DEFAULT_PORT);
    let no_open = args.iter().any(|a| a == "--no-open");
    let pr = args.iter().find(|a| !a.starts_with("--")).and_then(|a| grain_github::PrRef::parse(a));

    let app = state::App::new(home::Home::locate());
    // Warm GitHub lookups so the switcher's lists and repo search are instant.
    tokio::task::spawn_blocking(|| {
        let _ = grain_github::repos(None);
    });
    if let Some(pr) = &pr {
        app.open(pr.clone());
    }
    let ui = ui_dir();
    let router: Router = api::router(app).fallback_service(ServeDir::new(&ui).fallback(ServeFile::new(ui.join("index.html"))));

    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    let url = match &pr {
        Some(p) => format!("http://localhost:{port}/?pr={}/{}", p.full_repo(), p.number),
        None => format!("http://localhost:{port}/"),
    };
    println!("Grain is running at {url}");
    if !no_open {
        let _ = std::process::Command::new("open").arg(&url).spawn();
    }
    axum::serve(listener, router).await?;
    Ok(())
}
