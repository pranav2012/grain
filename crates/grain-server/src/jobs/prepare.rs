use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use grain_engine::Depth;
use grain_github::{PrDetails, PrRef};
use grain_store::{Home, Settings, read_json, write_atomic};

/// What still has to happen after [`prepare`] returns.
pub(crate) enum Next {
    Done,
    /// The reviewer hasn't said whether they have this repository locally yet.
    NeedsRepo,
    /// The review is open with fast facts; run [`enrich`] in the background.
    Enrich,
}

/// True when a review in the current format is stored, so it can be shown right away.
pub(crate) fn has_usable_review(home: &Home, pr: &PrRef) -> bool {
    let dir = home.review_dir(pr);
    dir.join("review.json").exists()
        && dir.join("diff.patch").exists()
        && read_json(&dir.join("pr.json")).and_then(|v| v["reviewFormat"].as_u64())
            == Some(u64::from(grain_engine::REVIEW_FORMAT))
}

/// Stage 1: fetch the PR, check out only its changed files, group them. This is all the
/// first view needs. Re-opening an unchanged PR reuses the stored review.
pub(crate) fn prepare(
    home: &Home,
    pr: &PrRef,
    viewer: &str,
    settings: &Settings,
    report: &dyn Fn(&str),
) -> Result<Next> {
    report("Looking up the pull request");
    let details = grain_github::pr_details(pr)?;
    let out_dir = home.review_dir(pr);
    let prev = read_json(&out_dir.join("pr.json"));
    let prev_head = prev.as_ref().and_then(|v| v["headSha"].as_str().map(str::to_string));
    let same_format =
        prev.as_ref().and_then(|v| v["reviewFormat"].as_u64()) == Some(u64::from(grain_engine::REVIEW_FORMAT));
    // Cleanup removes the checkout and diff of merged or idle PRs; reopening one rebuilds them.
    let files_kept = out_dir.join("diff.patch").exists() && home.worktree_dir(pr).exists();
    if same_format
        && files_kept
        && prev_head.as_deref() == Some(details.head_sha.as_str())
        && let Some(review) = read_json(&out_dir.join("review.json"))
    {
        write_pr_json(&out_dir, &details, viewer, settings, None, None)?;
        return Ok(if review["complete"] == true { Next::Done } else { Next::Enrich });
    }

    let clone = home.clone_dir(pr);
    if !grain_git::is_repo(&clone) {
        let reference = match crate::local_repos::resolve(home, settings, &pr.owner, &pr.repo) {
            None => return Ok(Next::NeedsRepo),
            Some(local) => local.filter(|p| grain_git::has_github_remote(p, &pr.owner, &pr.repo)),
        };
        match &reference {
            Some(p) => report(&format!("Setting up {} from your clone at {}", pr.full_repo(), p.display())),
            None => report(&format!("Downloading {} (first time only, read-only)", pr.full_repo())),
        }
        grain_github::clone_partial(&pr.full_repo(), &clone, reference.as_deref())?;
    }

    report("Fetching the PR's commits");
    grain_git::fetch_pr(&clone, &details.base_sha, pr.number)?;
    let merge_base = grain_git::merge_base(&clone, &details.base_sha, &details.head_sha)?;

    // Must run before analysis: it downloads both sides of every changed file in one batch.
    report("Downloading the changed files");
    let patch = grain_git::diff(&clone, &merge_base, &details.head_sha, &[])?;

    report("Checking out the changed files");
    let paths = grain_git::changed_paths(&clone, &merge_base, &details.head_sha)?;
    grain_git::checkout_sparse(&clone, &home.worktree_dir(pr), &details.head_sha, &paths)?;

    report("Grouping the changes into layers and blocks");
    let analysis = grain_engine::analyze_with(&home.worktree_dir(pr), &merge_base, &details.head_sha, Depth::Fast)?;

    std::fs::create_dir_all(&out_dir)?;
    write_atomic(&out_dir.join("diff.patch"), patch.as_bytes())?;
    write_atomic(&out_dir.join("review.json"), serde_json::to_string(&analysis.review)?.as_bytes())?;
    write_atomic(&out_dir.join("analysis.txt"), analysis.summary.as_bytes())?;
    write_pr_json(&out_dir, &details, viewer, settings, Some(&merge_base), None)?;
    Ok(Next::Enrich)
}

/// The git repository holding a review's commits: Grain's clone, or the reviewer's own
/// repository for local changes.
pub(crate) fn git_dir(home: &Home, pr: &PrRef) -> Result<PathBuf> {
    if pr.is_local() { super::local::repo_path(home, pr) } else { Ok(home.clone_dir(pr)) }
}

/// Stage 2: check out the whole repository and add whole-repo facts (outside usage, dangling
/// removals). Blocks and layers are unchanged; only facts are added. Local reviews read the
/// reviewer's working tree, which is already complete.
pub(crate) fn enrich(home: &Home, pr: &PrRef) -> Result<()> {
    let out_dir = home.review_dir(pr);
    let pr_json = read_json(&out_dir.join("pr.json")).context("PR not prepared")?;
    let head = pr_json["headSha"].as_str().unwrap_or_default().to_string();
    let merge_base = pr_json["mergeBase"].as_str().unwrap_or_default().to_string();
    let worktree = if pr.is_local() {
        super::local::repo_path(home, pr)?
    } else {
        let worktree = home.worktree_dir(pr);
        grain_git::expand_worktree(&worktree)?;
        worktree
    };
    let usage = typescript_usage(home, &out_dir, &worktree);
    let analysis = grain_engine::analyze_with_usage(
        &worktree,
        &merge_base,
        &head,
        Depth::Complete,
        usage.as_ref().map(|u| u as &dyn grain_engine::UsageProvider),
    )?;
    // A newer push may have been prepared meanwhile; never overwrite it with older facts.
    let current = read_json(&out_dir.join("pr.json")).and_then(|v| v["headSha"].as_str().map(str::to_string));
    if current.as_deref() == Some(head.as_str()) {
        write_atomic(&out_dir.join("review.json"), serde_json::to_string(&analysis.review)?.as_bytes())?;
        write_atomic(&out_dir.join("analysis.txt"), analysis.summary.as_bytes())?;
    }
    Ok(())
}

/// TypeScript 7's language server for reviews that change TS/JS files (downloaded once when
/// missing). `None` falls back to the entity graph; precise usage is never worth failing over.
fn typescript_usage(home: &Home, out_dir: &Path, worktree: &Path) -> Option<grain_lsp::TsUsage> {
    let review = read_json(&out_dir.join("review.json"))?;
    let has_ts =
        review["blocks"].as_array()?.iter().flat_map(|b| b["files"].as_array().into_iter().flatten()).any(|f| {
            let ext = f.as_str().and_then(|f| f.rsplit_once('.')).map(|(_, e)| e).unwrap_or_default();
            matches!(ext, "ts" | "tsx" | "mts" | "cts" | "js" | "jsx" | "mjs" | "cjs")
        });
    if !has_ts {
        return None;
    }
    let started =
        grain_lsp::typescript::ensure(&home.cache_dir()).and_then(|tsc| grain_lsp::TsUsage::start(&tsc, worktree));
    match started {
        Ok(usage) => Some(usage),
        Err(e) => {
            tracing::warn!(error = %format!("{e:#}"), "TypeScript usage unavailable; using the entity graph");
            None
        }
    }
}

/// Writes `pr.json`: the PR's details plus what the server knows (viewer, agent, merge base,
/// and for local reviews the folder and branch).
pub(crate) fn write_pr_json(
    out_dir: &Path,
    d: &PrDetails,
    viewer: &str,
    settings: &Settings,
    merge_base: Option<&str>,
    local: Option<&serde_json::Value>,
) -> Result<()> {
    let mut v = serde_json::to_value(d)?;
    v["viewer"] = viewer.into();
    v["agent"] = settings.agent.map(grain_agent::Agent::id).into();
    let merge_base = merge_base
        .map(str::to_string)
        .or_else(|| read_json(&out_dir.join("pr.json")).and_then(|p| p["mergeBase"].as_str().map(str::to_string)));
    v["mergeBase"] = merge_base.into();
    v["reviewFormat"] = grain_engine::REVIEW_FORMAT.into();
    if let Some(local) = local {
        v["local"] = local.clone();
    }
    write_atomic(&out_dir.join("pr.json"), serde_json::to_string(&v)?.as_bytes())?;
    Ok(())
}

/// The diff of one block's files, as sent to the agent.
pub(crate) fn block_diff(home: &Home, pr: &PrRef, files: &[String]) -> Result<String> {
    let pr_json = read_json(&home.review_dir(pr).join("pr.json")).context("PR not prepared")?;
    let merge_base = pr_json["mergeBase"].as_str().unwrap_or_default();
    let head = pr_json["headSha"].as_str().unwrap_or_default();
    grain_git::diff(&git_dir(home, pr)?, merge_base, head, files)
}
