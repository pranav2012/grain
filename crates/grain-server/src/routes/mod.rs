//! HTTP routes. Bodies are typed in `crate::contract`.

mod github;
mod reviews;
mod settings;

use axum::Router;
use axum::routing::{get, post};

use crate::state::Shared;

pub(crate) fn router(app: Shared) -> Router {
    Router::new()
        .route("/api/me", get(github::me))
        .route("/api/inbox", get(github::inbox))
        .route("/api/repos", get(github::repos))
        .route("/api/repos/{owner}/{repo}/pulls", get(github::repo_pulls))
        .route("/api/repos/{owner}/{repo}/local", get(github::local_repo).put(github::set_local_repo))
        .route("/api/open", post(reviews::open))
        .route("/api/reviews", get(reviews::recent))
        .route("/api/reviews/{owner}/{repo}/{number}/status", get(reviews::status))
        .route("/api/reviews/{owner}/{repo}/{number}/files/{file}", get(reviews::file))
        .route("/api/reviews/{owner}/{repo}/{number}/summarize", post(reviews::summarize))
        .route("/api/reviews/{owner}/{repo}/{number}/diff", post(reviews::diff))
        .route("/api/settings", get(settings::get).put(settings::put))
        .with_state(app)
}
