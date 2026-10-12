use axum::Json;
use axum::extract::{Path, Query, State};
use grain_agent::Agent;
use grain_github::{PrSummary, RepoSummary};
use serde::Deserialize;

use crate::contract::{Inbox, Me};
use crate::error::{ApiResult, blocking};
use crate::state::Shared;

pub(super) async fn me(State(app): State<Shared>) -> ApiResult<Json<Me>> {
    blocking(move || {
        let agents_installed =
            [Agent::Claude, Agent::Codex, Agent::Opencode].into_iter().filter(|a| a.installed()).collect();
        Ok(Json(Me { login: app.viewer(), agents_installed }))
    })
    .await
}

pub(super) async fn inbox() -> ApiResult<Json<Inbox>> {
    blocking(|| {
        Ok(Json(Inbox { review_requests: grain_github::review_requests()?, mine: grain_github::my_open_prs()? }))
    })
    .await
}

#[derive(Deserialize)]
pub(super) struct RepoQuery {
    q: Option<String>,
}

pub(super) async fn repos(Query(q): Query<RepoQuery>) -> ApiResult<Json<Vec<RepoSummary>>> {
    blocking(move || Ok(Json(grain_github::repos(q.q.as_deref())?))).await
}

pub(super) async fn repo_pulls(Path((owner, repo)): Path<(String, String)>) -> ApiResult<Json<Vec<PrSummary>>> {
    blocking(move || Ok(Json(grain_github::repo_open_prs(&format!("{owner}/{repo}"))?))).await
}
