use axum::extract::{Path, Query, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use grain_agent::Agent;
use grain_github::PrRef;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::home::read_json;
use crate::state::{Shared, Stage};

type ApiResult = Result<Response, (StatusCode, Json<Value>)>;

fn fail(status: StatusCode, msg: impl ToString) -> (StatusCode, Json<Value>) {
    (status, Json(json!({ "error": msg.to_string() })))
}

/// Runs a blocking `gh` call off the async runtime.
async fn blocking<T: serde::Serialize + Send + 'static>(f: impl FnOnce() -> anyhow::Result<T> + Send + 'static) -> ApiResult {
    match tokio::task::spawn_blocking(f).await {
        Ok(Ok(v)) => Ok(Json(v).into_response()),
        Ok(Err(e)) => Err(fail(StatusCode::INTERNAL_SERVER_ERROR, format!("{e:#}"))),
        Err(e) => Err(fail(StatusCode::INTERNAL_SERVER_ERROR, e)),
    }
}

pub fn router(app: Shared) -> Router {
    Router::new()
        .route("/api/me", get(me))
        .route("/api/inbox", get(inbox))
        .route("/api/repos", get(repos))
        .route("/api/repos/{owner}/{repo}/pulls", get(repo_pulls))
        .route("/api/open", post(open))
        .route("/api/reviews", get(recent))
        .route("/api/reviews/{owner}/{repo}/{number}/status", get(status))
        .route("/api/reviews/{owner}/{repo}/{number}/files/{file}", get(file))
        .route("/api/reviews/{owner}/{repo}/{number}/summarize", post(summarize))
        .route("/api/settings", get(get_settings).put(put_settings))
        .with_state(app)
}

async fn me(State(app): State<Shared>) -> ApiResult {
    blocking(move || {
        let installed: Vec<&str> = [Agent::Claude, Agent::Codex, Agent::Opencode].into_iter().filter(|a| a.installed()).map(|a| a.id()).collect();
        Ok(json!({ "login": app.viewer(), "agentsInstalled": installed }))
    })
    .await
}

async fn inbox() -> ApiResult {
    blocking(|| Ok(json!({ "reviewRequests": grain_github::review_requests()?, "mine": grain_github::my_open_prs()? }))).await
}

#[derive(Deserialize)]
struct RepoQuery {
    q: Option<String>,
}

async fn repos(Query(q): Query<RepoQuery>) -> ApiResult {
    blocking(move || grain_github::repos(q.q.as_deref())).await
}

async fn repo_pulls(Path((owner, repo)): Path<(String, String)>) -> ApiResult {
    blocking(move || grain_github::repo_open_prs(&format!("{owner}/{repo}"))).await
}

#[derive(Deserialize)]
struct OpenBody {
    pr: String,
}

async fn open(State(app): State<Shared>, Json(body): Json<OpenBody>) -> ApiResult {
    let Some(pr) = PrRef::parse(&body.pr) else {
        return Err(fail(StatusCode::BAD_REQUEST, "That doesn't look like a pull request. Paste a GitHub PR link or owner/repo#123."));
    };
    app.open(pr.clone());
    Ok(Json(json!({ "id": format!("{}/{}", pr.full_repo(), pr.number) })).into_response())
}

/// PRs already prepared on this machine, most recent first.
async fn recent(State(app): State<Shared>) -> ApiResult {
    let root = app.home.root.join("reviews");
    blocking(move || {
        let mut out = Vec::new();
        for owner in std::fs::read_dir(&root).into_iter().flatten().flatten() {
            for repo in std::fs::read_dir(owner.path()).into_iter().flatten().flatten() {
                for num in std::fs::read_dir(repo.path()).into_iter().flatten().flatten() {
                    let pr_json = num.path().join("pr.json");
                    let Some(pr) = read_json(&pr_json) else { continue };
                    let modified = pr_json.metadata().and_then(|m| m.modified()).ok();
                    out.push((
                        modified,
                        json!({
                            "repo": format!("{}/{}", owner.file_name().to_string_lossy(), repo.file_name().to_string_lossy()),
                            "number": pr["number"], "title": pr["title"], "author": pr["author"]["login"], "url": pr["url"],
                        }),
                    ));
                }
            }
        }
        out.sort_by(|a, b| b.0.cmp(&a.0));
        Ok(out.into_iter().map(|(_, v)| v).collect::<Vec<_>>())
    })
    .await
}

fn pr_of(owner: String, repo: String, number: u64) -> PrRef {
    PrRef { owner, repo, number }
}

async fn status(State(app): State<Shared>, Path((owner, repo, number)): Path<(String, String, u64)>) -> ApiResult {
    let pr = pr_of(owner, repo, number);
    let job = app.jobs.lock().unwrap().get(&pr).cloned();
    let prepared = app.home.review_dir(&pr).join("review.json").exists();
    let job = job.unwrap_or_else(|| crate::state::Job {
        stage: if prepared { Stage::Ready } else { Stage::Failed },
        message: if prepared { "Ready".into() } else { "Not opened yet".into() },
    });
    let sums = app.summarizers.lock().unwrap();
    let summarizer = sums.get(&pr).map(|s| serde_json::to_value(s).unwrap()).unwrap_or(json!(null));
    Ok(Json(json!({ "job": job, "summarizer": summarizer, "agent": app.settings.lock().unwrap().agent })).into_response())
}

async fn file(State(app): State<Shared>, Path((owner, repo, number, file)): Path<(String, String, u64, String)>) -> ApiResult {
    let name = match file.as_str() {
        "review.json" | "pr.json" | "summaries.json" | "diff.patch" => file,
        _ => return Err(fail(StatusCode::NOT_FOUND, "unknown file")),
    };
    let path = app.home.review_dir(&pr_of(owner, repo, number)).join(&name);
    match tokio::fs::read(&path).await {
        Ok(bytes) => {
            let ct = if name.ends_with(".json") { "application/json" } else { "text/plain; charset=utf-8" };
            Ok(([(header::CONTENT_TYPE, ct), (header::CACHE_CONTROL, "no-store")], bytes).into_response())
        }
        Err(_) if name == "summaries.json" => Ok(Json(json!({})).into_response()),
        Err(_) => Err(fail(StatusCode::NOT_FOUND, "not prepared")),
    }
}

#[derive(Deserialize)]
struct SummarizeBody {
    keys: Vec<String>,
}

async fn summarize(State(app): State<Shared>, Path((owner, repo, number)): Path<(String, String, u64)>, Json(body): Json<SummarizeBody>) -> ApiResult {
    app.request_summaries(pr_of(owner, repo, number), body.keys);
    Ok(StatusCode::ACCEPTED.into_response())
}

async fn get_settings(State(app): State<Shared>) -> ApiResult {
    Ok(Json(app.settings.lock().unwrap().clone()).into_response())
}

async fn put_settings(State(app): State<Shared>, Json(s): Json<crate::home::Settings>) -> ApiResult {
    app.home.save_settings(&s).map_err(|e| fail(StatusCode::INTERNAL_SERVER_ERROR, e))?;
    *app.settings.lock().unwrap() = s.clone();
    app.summarizers.lock().unwrap().clear();
    Ok(Json(s).into_response())
}
