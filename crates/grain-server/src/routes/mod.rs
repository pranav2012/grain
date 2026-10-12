//! HTTP routes. Bodies are typed in `crate::contract`.

mod github;
mod reviews;
mod settings;

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{get, post, put};
use axum::{Json, Router};

use crate::state::Shared;

/// Which build is running, so a newer `grain` can replace an outdated server.
async fn version(State(app): State<Shared>) -> Json<serde_json::Value> {
    Json(serde_json::json!({ "build": app.build }))
}

/// Exits the server right after answering; only for the `grain` CLI replacing an older build.
/// Web pages can't send the custom header without a CORS preflight, which this server never grants.
async fn shutdown(headers: HeaderMap) -> StatusCode {
    if headers.get("x-grain-cli").is_none() {
        return StatusCode::FORBIDDEN;
    }
    tracing::info!("a newer grain is taking over this port; exiting");
    std::thread::spawn(|| {
        std::thread::sleep(std::time::Duration::from_millis(200));
        std::process::exit(0);
    });
    StatusCode::ACCEPTED
}

pub(crate) fn router(app: Shared) -> Router {
    Router::new()
        .route("/api/me", get(github::me))
        .route("/api/inbox", get(github::inbox))
        .route("/api/repos", get(github::repos))
        .route("/api/repos/{owner}/{repo}/pulls", get(github::repo_pulls))
        .route("/api/repos/{owner}/{repo}/local", get(github::local_repo).put(github::set_local_repo))
        .route("/api/open", post(reviews::open))
        .route("/api/local", get(reviews::local_candidates).post(reviews::open_local))
        .route("/api/reviews", get(reviews::recent))
        .route("/api/reviews/{owner}/{repo}/{number}/status", get(reviews::status))
        .route("/api/reviews/{owner}/{repo}/{number}/files/{file}", get(reviews::file))
        .route("/api/reviews/{owner}/{repo}/{number}/summarize", post(reviews::summarize))
        .route("/api/reviews/{owner}/{repo}/{number}/diff", post(reviews::diff))
        .route("/api/reviews/{owner}/{repo}/{number}/conversation", get(reviews::conversation))
        .route("/api/reviews/{owner}/{repo}/{number}/submit", post(reviews::submit))
        .route("/api/reviews/{owner}/{repo}/{number}/threads/{thread}/replies", post(reviews::reply_to_thread))
        .route("/api/reviews/{owner}/{repo}/{number}/threads/{thread}/resolved", put(reviews::resolve_thread))
        .route("/api/reviews/{owner}/{repo}/{number}/progress", get(reviews::get_progress).put(reviews::put_progress))
        .route("/api/settings", get(settings::get).put(settings::put))
        .route("/api/version", get(version))
        .route("/api/shutdown", post(shutdown))
        .with_state(app)
}
