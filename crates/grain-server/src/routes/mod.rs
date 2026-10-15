//! HTTP routes. Bodies are typed in `crate::contract`.

mod github;
mod navigate;
mod reviews;
mod settings;

use axum::extract::Request;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::middleware::{self, Next};
use axum::response::Response;
use axum::routing::{get, post, put};
use axum::{Json, Router};

use crate::state::Shared;

/// Which build is running, so a newer `grain` can replace an outdated server.
async fn version(State(app): State<Shared>) -> Json<serde_json::Value> {
    Json(serde_json::json!({ "build": app.build }))
}

/// Stops the server gracefully (requests in flight, like progress saves, finish first); only for the
/// `grain` CLI (`grain stop`, or replacing an older build). Web pages can't send the custom header
/// without a CORS preflight, which this server never grants.
async fn shutdown(State(app): State<Shared>, headers: HeaderMap) -> StatusCode {
    if headers.get("x-grain-cli").is_none() {
        return StatusCode::FORBIDDEN;
    }
    tracing::info!("asked to stop by the grain command");
    app.stop.notify_one();
    StatusCode::ACCEPTED
}

/// Open tabs call this every minute, so Grain knows it's in use (any API request counts too).
async fn heartbeat() -> StatusCode {
    StatusCode::NO_CONTENT
}

/// Notes the time of every API request, for stopping after a long idle stretch.
async fn seen(State(app): State<Shared>, request: Request, next: Next) -> Response {
    *app.last_seen.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = std::time::Instant::now();
    next.run(request).await
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
        .route("/api/pick-folder", post(reviews::pick_folder))
        .route("/api/reviews", get(reviews::recent))
        .route("/api/reviews/{owner}/{repo}/{number}/status", get(reviews::status))
        .route("/api/reviews/{owner}/{repo}/{number}/files/{file}", get(reviews::file))
        .route("/api/reviews/{owner}/{repo}/{number}/summarize", post(reviews::summarize))
        .route("/api/reviews/{owner}/{repo}/{number}/ask", post(reviews::ask))
        .route("/api/reviews/{owner}/{repo}/{number}/navigate", post(navigate::navigate))
        .route("/api/reviews/{owner}/{repo}/{number}/diff", post(reviews::diff))
        .route("/api/reviews/{owner}/{repo}/{number}/conversation", get(reviews::conversation))
        .route("/api/reviews/{owner}/{repo}/{number}/diagnostics", post(reviews::rediagnose))
        .route("/api/reviews/{owner}/{repo}/{number}/second-opinion", post(reviews::rereview))
        .route("/api/reviews/{owner}/{repo}/{number}/pr-status", get(reviews::pr_status))
        .route("/api/reviews/{owner}/{repo}/{number}/submit", post(reviews::submit))
        .route("/api/reviews/{owner}/{repo}/{number}/threads/{thread}/replies", post(reviews::reply_to_thread))
        .route("/api/reviews/{owner}/{repo}/{number}/threads/{thread}/resolved", put(reviews::resolve_thread))
        .route("/api/reviews/{owner}/{repo}/{number}/progress", get(reviews::get_progress).put(reviews::put_progress))
        .route("/api/settings", get(settings::get).put(settings::put))
        .route("/api/usage", get(settings::usage))
        .route("/api/models", get(settings::models))
        .route("/api/version", get(version))
        .route("/api/heartbeat", post(heartbeat))
        .route("/api/shutdown", post(shutdown))
        .route_layer(middleware::from_fn_with_state(app.clone(), seen))
        .with_state(app)
}
