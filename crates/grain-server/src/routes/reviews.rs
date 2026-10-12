use axum::Json;
use axum::extract::{Path, State};
use axum::http::{StatusCode, header};
use axum::response::IntoResponse;
use grain_github::PrRef;
use grain_store::read_json;

use crate::contract::{
    DiffRequest, Job, LocalCandidate, LocalOpenRequest, OpenRequest, OpenResponse, RecentReview, Stage, Status,
    SubmitRequest, SubmitResponse, SummarizeRequest, ThreadReplyRequest, ThreadResolved,
};
use crate::error::{ApiError, ApiResult, blocking};
use crate::state::Shared;

fn pr_of((owner, repo, number): (String, String, u64)) -> PrRef {
    PrRef { owner, repo, number }
}

pub(super) async fn open(State(app): State<Shared>, Json(body): Json<OpenRequest>) -> ApiResult<Json<OpenResponse>> {
    let pr = PrRef::parse(&body.pr).ok_or_else(|| {
        ApiError::bad_request("That doesn't look like a pull request. Paste a GitHub PR link or owner/repo#123.")
    })?;
    app.open(pr.clone(), true, body.refresh);
    Ok(Json(OpenResponse { id: format!("{}/{}", pr.full_repo(), pr.number) }))
}

/// Starts a self-review of the local work in a folder.
pub(super) async fn open_local(
    State(app): State<Shared>,
    Json(body): Json<LocalOpenRequest>,
) -> ApiResult<Json<OpenResponse>> {
    let path = match body.path.trim().strip_prefix("~/") {
        Some(rest) => dirs::home_dir().unwrap_or_default().join(rest),
        None => std::path::PathBuf::from(body.path.trim()),
    };
    if !path.is_dir() {
        return Err(ApiError::bad_request(format!("{} is not a folder on this computer.", path.display())));
    }
    let home = app.home.clone();
    let pr = blocking(move || crate::jobs::local::register(&home, &path)).await?;
    app.open(pr.clone(), true, false);
    Ok(Json(OpenResponse { id: format!("{}/{}", pr.full_repo(), pr.number) }))
}

/// Git repositories in the usual code folders, most recently active first.
pub(super) async fn local_candidates() -> ApiResult<Json<Vec<LocalCandidate>>> {
    blocking(|| Ok(Json(crate::local_repos::all_repos()))).await
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
                    local_path: pr["local"]["path"].as_str().map(str::to_string),
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
    // Local reviews report what the working tree is now, so edits since opening show up.
    let head_sha = if pr.is_local() && !app.is_busy(&pr) {
        let app = app.clone();
        let pr = pr.clone();
        tokio::task::spawn_blocking(move || app.local_head(&pr)).await.ok().flatten()
    } else {
        None
    }
    .or_else(|| {
        read_json(&app.home.review_dir(&pr).join("pr.json")).and_then(|v| v["headSha"].as_str().map(str::to_string))
    });
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
    let pr = pr_of(p);
    let text = blocking(move || {
        if let Some(since) = body.since.filter(|s| s.chars().all(|c| c.is_ascii_hexdigit()) && !s.is_empty()) {
            // Only what changed since an earlier review: diff between the two heads.
            let pr_json = read_json(&app.home.review_dir(&pr).join("pr.json"))
                .ok_or_else(|| anyhow::anyhow!("PR not prepared"))?;
            let head = pr_json["headSha"].as_str().unwrap_or_default().to_string();
            return grain_git::diff(&crate::jobs::prepare::git_dir(&app.home, &pr)?, &since, &head, &body.files);
        }
        Ok(app.patches.get(&app.home.review_dir(&pr).join("diff.patch"))?.sections(&body.files))
    })
    .await?;
    Ok(([(header::CONTENT_TYPE, "text/plain; charset=utf-8"), (header::CACHE_CONTROL, "no-store")], text))
}

/// Existing GitHub review threads and submitted reviews for this PR.
pub(super) async fn conversation(Path(p): Path<(String, String, u64)>) -> ApiResult<Json<grain_github::Conversation>> {
    let pr = pr_of(p);
    if pr.is_local() {
        return Ok(Json(grain_github::Conversation::default()));
    }
    blocking(move || Ok(Json(grain_github::conversation(&pr)?))).await
}

/// Replies to a GitHub review thread right away.
pub(super) async fn reply_to_thread(
    Path((_, _, _, thread)): Path<(String, String, u64, String)>,
    Json(body): Json<ThreadReplyRequest>,
) -> ApiResult<Json<grain_github::ThreadComment>> {
    if body.body.trim().is_empty() {
        return Err(ApiError::bad_request("Write a reply first."));
    }
    blocking(move || Ok(Json(grain_github::reply_to_thread(&thread, body.body.trim())?))).await
}

/// Resolves or unresolves a GitHub review thread right away.
pub(super) async fn resolve_thread(
    Path((_, _, _, thread)): Path<(String, String, u64, String)>,
    Json(body): Json<ThreadResolved>,
) -> ApiResult<Json<ThreadResolved>> {
    blocking(move || Ok(Json(ThreadResolved { resolved: grain_github::set_thread_resolved(&thread, body.resolved)? })))
        .await
}

/// Posts one GitHub review. Line comments outside the diff can't be anchored on GitHub, so they
/// are moved into the review text instead of failing the whole review.
pub(super) async fn submit(
    State(app): State<Shared>,
    Path(p): Path<(String, String, u64)>,
    Json(req): Json<SubmitRequest>,
) -> ApiResult<Json<SubmitResponse>> {
    let pr = pr_of(p);
    if pr.is_local() {
        return Err(ApiError::bad_request("Local changes aren't on GitHub yet. Push them and open the pull request."));
    }
    let patch = app.home.review_dir(&pr).join("diff.patch");
    blocking(move || {
        let index = app.patches.get(&patch)?;
        let mut comments = Vec::new();
        let mut outside = Vec::new();
        for c in req.comments {
            let left = c.side == "LEFT";
            let start = c.start_line.unwrap_or(c.line).min(c.line);
            if index.in_hunk(&c.path, left, start, c.line) {
                let multi = start != c.line;
                comments.push(grain_github::PayloadComment {
                    path: c.path,
                    line: c.line,
                    side: c.side.clone(),
                    start_line: multi.then_some(start),
                    start_side: multi.then_some(c.side),
                    body: c.body,
                });
            } else {
                let lines = if start == c.line { c.line.to_string() } else { format!("{start}-{}", c.line) };
                outside.push(format!("- `{}:{lines}`: {}", c.path, c.body));
            }
        }
        let mut body = req.body.trim().to_string();
        if !outside.is_empty() {
            if !body.is_empty() {
                body.push_str("\n\n");
            }
            body.push_str("**Comments on lines outside the diff**\n");
            body.push_str(&outside.join("\n"));
        }
        let payload = grain_github::ReviewPayload { commit_id: req.commit_id, event: req.event, body, comments };
        let url = if req.dry_run { None } else { Some(grain_github::submit_review(&pr, &payload)?) };
        Ok(Json(SubmitResponse { url, payload, moved_to_body: outside.len() }))
    })
    .await
}

/// Saved review progress (verdicts, notes) for this PR; `null` when nothing was saved yet.
pub(super) async fn get_progress(
    State(app): State<Shared>,
    Path(p): Path<(String, String, u64)>,
) -> Json<serde_json::Value> {
    Json(read_json(&app.home.review_dir(&pr_of(p)).join("progress.json")).unwrap_or(serde_json::Value::Null))
}

/// Replaces saved review progress. The UI owns its shape; the server only keeps it safe on disk.
pub(super) async fn put_progress(
    State(app): State<Shared>,
    Path(p): Path<(String, String, u64)>,
    Json(progress): Json<serde_json::Value>,
) -> ApiResult<StatusCode> {
    let dir = app.home.review_dir(&pr_of(p));
    blocking(move || {
        std::fs::create_dir_all(&dir)?;
        grain_store::write_atomic(&dir.join("progress.json"), serde_json::to_string(&progress)?.as_bytes())?;
        Ok(StatusCode::NO_CONTENT)
    })
    .await
}
