use axum::Json;
use axum::extract::{Path, State};
use axum::http::{StatusCode, header};
use axum::response::IntoResponse;
use grain_github::PrRef;
use grain_store::read_json;

use crate::contract::{DiffRequest, Job, OpenRequest, OpenResponse, RecentReview, Stage, Status, SummarizeRequest};
use crate::error::{ApiError, ApiResult, blocking};
use crate::state::Shared;

fn pr_of((owner, repo, number): (String, String, u64)) -> PrRef {
    PrRef { owner, repo, number }
}

pub(super) async fn open(State(app): State<Shared>, Json(body): Json<OpenRequest>) -> ApiResult<Json<OpenResponse>> {
    let pr = PrRef::parse(&body.pr).ok_or_else(|| {
        ApiError::bad_request("That doesn't look like a pull request. Paste a GitHub PR link or owner/repo#123.")
    })?;
    app.open(pr.clone());
    Ok(Json(OpenResponse { id: format!("{}/{}", pr.full_repo(), pr.number) }))
}

/// PRs already prepared on this machine, most recent first.
pub(super) async fn recent(State(app): State<Shared>) -> ApiResult<Json<Vec<RecentReview>>> {
    let root = app.home.reviews_root();
    blocking(move || {
        let mut out = Vec::new();
        for pr_json in grain_store::list_review_files(&root, "pr.json") {
            let Some(pr) = read_json(&pr_json) else { continue };
            let modified = pr_json.metadata().and_then(|m| m.modified()).ok();
            let parts: Vec<String> =
                pr_json.iter().rev().skip(2).take(2).map(|p| p.to_string_lossy().into_owned()).collect();
            let [repo, owner] = parts.as_slice() else { continue };
            out.push((
                modified,
                RecentReview {
                    repo: format!("{owner}/{repo}"),
                    number: pr["number"].as_u64().unwrap_or_default(),
                    title: pr["title"].as_str().unwrap_or_default().into(),
                    author: pr["author"]["login"].as_str().unwrap_or_default().into(),
                    url: pr["url"].as_str().unwrap_or_default().into(),
                },
            ));
        }
        out.sort_by_key(|r| std::cmp::Reverse(r.0));
        Ok(Json(out.into_iter().map(|(_, r)| r).collect()))
    })
    .await
}

pub(super) async fn status(State(app): State<Shared>, Path(p): Path<(String, String, u64)>) -> Json<Status> {
    let pr = pr_of(p);
    let prepared = app.home.review_dir(&pr).join("review.json").exists();
    let job =
        app.jobs.lock().unwrap_or_else(std::sync::PoisonError::into_inner).get(&pr).cloned().unwrap_or_else(|| {
            if prepared {
                Job { stage: Stage::Ready, message: "Ready".into() }
            } else {
                Job { stage: Stage::Failed, message: "Not opened yet".into() }
            }
        });
    let summarizer =
        app.summarizers.lock().unwrap_or_else(std::sync::PoisonError::into_inner).get(&pr).map(|s| s.status.clone());
    let settings = app.settings();
    let enriching = app.enriching.lock().unwrap_or_else(std::sync::PoisonError::into_inner).contains(&pr);
    let head_sha =
        read_json(&app.home.review_dir(&pr).join("pr.json")).and_then(|v| v["headSha"].as_str().map(str::to_string));
    Json(Status {
        job,
        summarizer,
        agent: settings.agent,
        auto_summarize: settings.auto_summarize,
        enriching,
        head_sha,
    })
}

pub(super) async fn file(
    State(app): State<Shared>,
    Path((owner, repo, number, name)): Path<(String, String, u64, String)>,
) -> ApiResult<impl IntoResponse> {
    if !matches!(name.as_str(), "review.json" | "pr.json" | "summaries.json" | "diff.patch") {
        return Err(ApiError::not_found("unknown file"));
    }
    let path = app.home.review_dir(&pr_of((owner, repo, number))).join(&name);
    let is_json = std::path::Path::new(&name).extension().is_some_and(|e| e.eq_ignore_ascii_case("json"));
    let content_type = if is_json { "application/json" } else { "text/plain; charset=utf-8" };
    let bytes = match tokio::fs::read(&path).await {
        Ok(bytes) => bytes,
        Err(_) if name == "summaries.json" => b"{}".to_vec(),
        Err(_) => return Err(ApiError::not_found("not prepared")),
    };
    Ok(([(header::CONTENT_TYPE, content_type), (header::CACHE_CONTROL, "no-store")], bytes))
}

pub(super) async fn summarize(
    State(app): State<Shared>,
    Path(p): Path<(String, String, u64)>,
    Json(body): Json<SummarizeRequest>,
) -> StatusCode {
    app.request_summaries(pr_of(p), body.keys);
    StatusCode::ACCEPTED
}

/// The diff sections for a block's files, so the UI never loads a whole huge patch.
pub(super) async fn diff(
    State(app): State<Shared>,
    Path(p): Path<(String, String, u64)>,
    Json(body): Json<DiffRequest>,
) -> ApiResult<impl IntoResponse> {
    let path = app.home.review_dir(&pr_of(p)).join("diff.patch");
    let text = blocking(move || Ok(app.patches.get(&path)?.sections(&body.files))).await?;
    Ok(([(header::CONTENT_TYPE, "text/plain; charset=utf-8"), (header::CACHE_CONTROL, "no-store")], text))
}
