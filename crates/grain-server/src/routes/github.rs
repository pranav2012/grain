use axum::Json;
use axum::extract::{Path, Query, State};
use grain_agent::Agent;
use grain_github::{PrSummary, RepoSummary};
use serde::Deserialize;

use crate::contract::{Inbox, LocalRepo, LocalRepoRequest, Me};
use crate::error::{ApiError, ApiResult, blocking};
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

/// The saved answer for where this repository lives, plus clones found on this machine.
pub(super) async fn local_repo(
    State(app): State<Shared>,
    Path((owner, repo)): Path<(String, String)>,
) -> ApiResult<Json<LocalRepo>> {
    blocking(move || {
        let choice = app.home.repo_choice(&format!("{owner}/{repo}"));
        Ok(Json(LocalRepo {
            asked: choice.is_some(),
            path: choice.flatten().map(|p| p.display().to_string()),
            candidates: crate::local_repos::candidates(&app.settings().work_folders, &owner, &repo),
        }))
    })
    .await
}

/// Saves where this repository lives: an existing clone (validated) or `null` to download.
pub(super) async fn set_local_repo(
    State(app): State<Shared>,
    Path((owner, repo)): Path<(String, String)>,
    Json(body): Json<LocalRepoRequest>,
) -> ApiResult<Json<LocalRepo>> {
    let full = format!("{owner}/{repo}");
    let path = match body.path.as_deref().map(str::trim).filter(|p| !p.is_empty()) {
        None => None,
        Some(p) => {
            let expanded = crate::local_repos::expand_home(p);
            if !grain_git::has_github_remote(&expanded, &owner, &repo) {
                return Err(ApiError::bad_request(format!(
                    "{} isn't a clone of {full}. Pick the folder whose git remote points at github.com/{full}.",
                    expanded.display()
                )));
            }
            Some(expanded)
        }
    };
    app.home.set_repo_choice(&full, path.clone()).map_err(|e| ApiError::internal(&e))?;
    Ok(Json(LocalRepo { asked: true, path: path.map(|p| p.display().to_string()), candidates: Vec::new() }))
}
