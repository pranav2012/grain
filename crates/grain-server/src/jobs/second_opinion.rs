use std::sync::Mutex;

use anyhow::{Context, Result};
use grain_agent::review::{AiReview, PrContext};
use grain_github::PrRef;
use grain_store::{Home, Settings, read_json, write_atomic};
use sha2::{Digest, Sha256};

/// Reviews use the reviewer's plan heavily; only one runs at a time, across all PRs.
static ONE_AT_A_TIME: Mutex<()> = Mutex::new(());

/// Runs Grain's review skill on the PR's head with the reviewer's agent and writes `ai-review.json`.
/// Skipped without an agent, with the setting off, before the full checkout exists, or when this head
/// was already reviewed with the same agent and skill.
pub(crate) fn run(home: &Home, settings: &Settings, pr: &PrRef) -> Result<()> {
    let Some(agent) = settings.agent.filter(|_| settings.second_opinion) else { return Ok(()) };
    let out_dir = home.review_dir(pr);
    let pr_json = read_json(&out_dir.join("pr.json")).context("PR not prepared")?;
    let head = pr_json["headSha"].as_str().unwrap_or_default().to_string();
    let merge_base = pr_json["mergeBase"].as_str().unwrap_or_default().to_string();
    let skill_hash = format!("{:x}", Sha256::digest(grain_agent::review::BUNDLED_SKILL))[..16].to_string();
    let target = out_dir.join("ai-review.json");
    if read_json(&target).is_some_and(|r| {
        r["head"] == head.as_str() && r["agent"] == agent.id() && r["skillHash"] == skill_hash.as_str()
    }) {
        return Ok(());
    }
    if !pr.is_local() && read_json(&out_dir.join("review.json")).is_none_or(|r| r["complete"] != true) {
        return Ok(());
    }
    let _turn = ONE_AT_A_TIME.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    if let Some(why) = home.over_budget() {
        let review = AiReview { head, agent, skill_hash, findings: Vec::new(), error: Some(why), ms: 0, usage: None };
        write_atomic(&target, serde_json::to_string(&review)?.as_bytes())?;
        return Ok(());
    }
    let checkout = if pr.is_local() { super::local::repo_path(home, pr)? } else { home.worktree_dir(pr) };
    let files = grain_git::changed_paths(&super::prepare::git_dir(home, pr)?, &merge_base, &head)?;
    let prior: Vec<String> = if pr.is_local() {
        Vec::new()
    } else {
        grain_github::conversation(pr)
            .map(|c| {
                c.threads
                    .iter()
                    .filter_map(|t| {
                        let first = t.comments.first()?;
                        let state = if t.resolved { " (resolved)" } else { "" };
                        Some(format!("{}:{}{state}: {}", t.path, t.line.unwrap_or(0), first.body.replace('\n', " ")))
                    })
                    .collect()
            })
            .unwrap_or_default()
    };
    let repo = pr.full_repo();
    let title = pr_json["title"].as_str().unwrap_or_default();
    let context = PrContext {
        repo: &repo,
        number: pr.number,
        title,
        merge_base: &merge_base,
        head: &head,
        files: &files,
        prior_comments: &prior,
    };
    let started = std::time::Instant::now();
    let (result, usage) = grain_agent::review::review(agent, settings.model.as_deref(), &checkout, &context);
    if let Some(u) = &usage {
        home.record_usage(&format!("{repo}/{}", pr.number), "review", agent, u);
    }
    let ms = started.elapsed().as_millis() as u64;
    let (findings, error) = match result {
        Ok(f) => (f, None),
        Err(e) => (Vec::new(), Some(e)),
    };
    let current = read_json(&out_dir.join("pr.json")).and_then(|v| v["headSha"].as_str().map(str::to_string));
    if current.as_deref() == Some(head.as_str()) {
        let review = AiReview { head, agent, skill_hash, findings, error, ms, usage };
        write_atomic(&target, serde_json::to_string(&review)?.as_bytes())?;
    }
    Ok(())
}
