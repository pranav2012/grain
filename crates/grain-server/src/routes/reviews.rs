use axum::Json;
use axum::extract::{Path, State};
use axum::http::{StatusCode, header};
use axum::response::IntoResponse;
use grain_github::PrRef;
use grain_store::read_json;

use crate::contract::{
    AskRequest, AskResponse, DiffRequest, Job, LocalCandidate, LocalOpenRequest, OpenRequest, OpenResponse,
    PickFolderRequest, PickFolderResponse, RecentReview, Stage, Status, SubmitRequest, SubmitResponse,
    SummarizeRequest, ThreadReplyRequest, ThreadResolved,
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
    let path = crate::local_repos::expand_home(body.path.trim());
    if !path.is_dir() {
        return Err(ApiError::bad_request(format!("{} is not a folder on this computer.", path.display())));
    }
    let home = app.home.clone();
    let pr = blocking(move || crate::jobs::local::register(&home, &path)).await?;
    app.open(pr.clone(), true, false);
    Ok(Json(OpenResponse { id: format!("{}/{}", pr.full_repo(), pr.number) }))
}

/// Git repositories in the work folders and usual code folders, most recently active first.
pub(super) async fn local_candidates(State(app): State<Shared>) -> ApiResult<Json<Vec<LocalCandidate>>> {
    let work_folders = app.settings().work_folders;
    blocking(move || Ok(Json(crate::local_repos::all_repos(&work_folders)))).await
}

/// Opens the system's folder picker on this computer and returns what the reviewer chose.
pub(super) async fn pick_folder(Json(body): Json<PickFolderRequest>) -> ApiResult<Json<PickFolderResponse>> {
    blocking(move || Ok(Json(PickFolderResponse { path: crate::folder_picker::pick(&body.prompt)? }))).await
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
        diagnosing: app.diagnosing.lock().unwrap_or_else(std::sync::PoisonError::into_inner).contains(&pr),
        spend: app.home.spend(Some(&format!("{}/{}", pr.full_repo(), pr.number))),
        reviewing: app.second_opinions.lock().unwrap_or_else(std::sync::PoisonError::into_inner).contains(&pr),
    })
}

/// Checks the PR for errors again, e.g. after the reviewer picked their clone.
pub(super) async fn rediagnose(State(app): State<Shared>, Path(p): Path<(String, String, u64)>) -> StatusCode {
    let pr = pr_of(p);
    let _ = std::fs::remove_file(app.home.review_dir(&pr).join("diagnostics.json"));
    app.diagnose(&pr, false);
    StatusCode::ACCEPTED
}

/// Reviews the PR with the reviewer's agent again (e.g. after a failure or a new skill).
pub(super) async fn rereview(State(app): State<Shared>, Path(p): Path<(String, String, u64)>) -> StatusCode {
    let pr = pr_of(p);
    let _ = std::fs::remove_file(app.home.review_dir(&pr).join("ai-review.json"));
    app.second_opinion(&pr);
    StatusCode::ACCEPTED
}

/// Reviews, comments, CI checks and merge state from GitHub, for the PR's current head.
pub(super) async fn pr_status(
    State(app): State<Shared>,
    Path(p): Path<(String, String, u64)>,
) -> ApiResult<Json<grain_github::PrStatus>> {
    let pr = pr_of(p);
    if pr.is_local() {
        return Err(ApiError::bad_request("Local changes have no pull request on GitHub."));
    }
    let head = read_json(&app.home.review_dir(&pr).join("pr.json"))
        .and_then(|v| v["headSha"].as_str().map(str::to_string))
        .ok_or_else(|| ApiError::bad_request("PR not prepared"))?;
    blocking(move || Ok(Json(grain_github::pr_status(&pr, &head)?))).await
}

pub(super) async fn file(
    State(app): State<Shared>,
    Path((owner, repo, number, name)): Path<(String, String, u64, String)>,
) -> ApiResult<impl IntoResponse> {
    if !matches!(
        name.as_str(),
        "review.json"
            | "pr.json"
            | "summaries.json"
            | "diff.patch"
            | "owners.json"
            | "diagnostics.json"
            | "ai-review.json"
    ) {
        return Err(ApiError::not_found("unknown file"));
    }
    let path = app.home.review_dir(&pr_of((owner, repo, number))).join(&name);
    let is_json = std::path::Path::new(&name).extension().is_some_and(|e| e.eq_ignore_ascii_case("json"));
    let content_type = if is_json { "application/json" } else { "text/plain; charset=utf-8" };
    let bytes = match tokio::fs::read(&path).await {
        Ok(bytes) => bytes,
        Err(_) if name == "summaries.json" => b"{}".to_vec(),
        Err(_) if name == "owners.json" => br#"{"source":null,"files":{},"mine":[]}"#.to_vec(),
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

/// Asks the reviewer's agent about one change. Runs the agent's CLI, so it can take a while.
pub(super) async fn ask(
    State(app): State<Shared>,
    Path(p): Path<(String, String, u64)>,
    Json(body): Json<AskRequest>,
) -> ApiResult<Json<AskResponse>> {
    if body.question.trim().is_empty() {
        return Err(ApiError::bad_request("Write a question first."));
    }
    let pr = pr_of(p);
    let settings = app.settings();
    let agent = settings.agent.ok_or_else(|| ApiError::bad_request("Choose an AI agent in settings first."))?;
    blocking(move || {
        let review = read_json(&app.home.review_dir(&pr).join("review.json"))
            .ok_or_else(|| anyhow::anyhow!("PR not prepared"))?;
        let files: Vec<String> = review["blocks"]
            .as_array()
            .and_then(|bs| bs.iter().find(|b| b["key"] == body.key.as_str()))
            .and_then(|b| b["files"].as_array())
            .map(|fs| fs.iter().filter_map(|f| f.as_str().map(str::to_string)).collect())
            .ok_or_else(|| anyhow::anyhow!("That change is no longer in this review."))?;
        if let Some(why) = app.home.over_budget() {
            anyhow::bail!(why);
        }
        let mut context = crate::jobs::prepare::block_diff(&app.home, &pr, &files)?;
        context.truncate(context.floor_char_boundary(60_000));
        if let Some(code) = body.code.filter(|c| !c.trim().is_empty()) {
            context = format!("SELECTED LINES:\n{code}\n\nFULL CHANGE:\n{context}");
        }
        match grain_agent::answer(
            agent,
            settings.model.as_deref(),
            &context,
            body.question.trim(),
            &app.home.cache_dir(),
        ) {
            grain_agent::Outcome::Done { summary, usage, .. } => {
                if let Some(u) = usage {
                    app.home.record_usage(&format!("{}/{}", pr.full_repo(), pr.number), "ask", agent, &u);
                }
                Ok(Json(AskResponse { answer: summary["answer"].as_str().unwrap_or_default().to_string() }))
            }
            grain_agent::Outcome::Refused { reason } => Err(anyhow::anyhow!(reason)),
            grain_agent::Outcome::Limited { .. } => {
                Err(anyhow::anyhow!("Your agent reported a usage limit. Try again later."))
            }
            grain_agent::Outcome::Failed { detail } => {
                tracing::warn!(%detail, "ask failed");
                Err(anyhow::anyhow!("The agent didn't answer: {}", failure_reason(&detail)))
            }
        }
    })
    .await
}

/// The line of an agent's output that best says why it failed: the last error, else the last line.
fn failure_reason(detail: &str) -> &str {
    let lines: Vec<&str> = detail.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    lines
        .iter()
        .rev()
        .find(|l| l.to_lowercase().contains("error"))
        .or(lines.last())
        .copied()
        .unwrap_or("it ended without a reply. Try again.")
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

#[cfg(test)]
mod tests {
    use super::failure_reason;

    #[test]
    fn failure_reason_prefers_the_error_line() {
        assert_eq!(
            failure_reason("\nReading prompt\nERROR: stream disconnected\ntokens used\n"),
            "ERROR: stream disconnected"
        );
        assert_eq!(failure_reason("banner\nsomething odd\n"), "something odd");
        assert_eq!(failure_reason("\n  \n"), "it ended without a reply. Try again.");
    }
}
