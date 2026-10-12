use std::path::Path;

use anyhow::{Context, Result};
use grain_github::{PrDetails, PrRef};
use grain_store::{Home, Settings, read_json, write_atomic};

/// Fetches the PR, checks out its head in a private worktree and runs the engine.
/// Re-opening an unchanged PR keeps the stored review and only refreshes `pr.json`.
pub(crate) fn prepare(home: &Home, pr: &PrRef, viewer: &str, settings: &Settings, report: &dyn Fn(&str)) -> Result<()> {
    report("Looking up the pull request");
    let details = grain_github::pr_details(pr)?;
    let out_dir = home.review_dir(pr);
    let prev = read_json(&out_dir.join("pr.json"));
    let prev_head = prev.as_ref().and_then(|v| v["headSha"].as_str().map(str::to_string));
    let same_format =
        prev.as_ref().and_then(|v| v["reviewFormat"].as_u64()) == Some(u64::from(grain_engine::REVIEW_FORMAT));
    if same_format && prev_head.as_deref() == Some(details.head_sha.as_str()) && out_dir.join("review.json").exists() {
        return write_pr_json(&out_dir, &details, viewer, settings, None);
    }

    let clone = home.clone_dir(pr);
    if !grain_git::is_repo(&clone) {
        report(&format!("Cloning {} (first time only, read-only)", pr.full_repo()));
        grain_github::clone_partial(&pr.full_repo(), &clone)?;
    }

    report("Fetching the PR's commits");
    grain_git::fetch_pr(&clone, &details.base_sha, pr.number)?;
    let merge_base = grain_git::merge_base(&clone, &details.base_sha, &details.head_sha)?;

    report("Checking out the PR's files");
    let worktree = home.worktree_dir(pr);
    grain_git::checkout_worktree(&clone, &worktree, &details.head_sha)?;

    // Must run before analysis: it downloads both sides of every changed file.
    report("Downloading the changed files");
    let patch = grain_git::diff(&clone, &merge_base, &details.head_sha, &[])?;

    report("Grouping the changes into chapters and blocks");
    let analysis = grain_engine::analyze(&worktree, &merge_base, &details.head_sha)?;

    std::fs::create_dir_all(&out_dir)?;
    write_atomic(&out_dir.join("review.json"), serde_json::to_string(&analysis.review)?.as_bytes())?;
    write_atomic(&out_dir.join("diff.patch"), patch.as_bytes())?;
    write_atomic(&out_dir.join("analysis.txt"), analysis.summary.as_bytes())?;
    write_pr_json(&out_dir, &details, viewer, settings, Some(&merge_base))
}

fn write_pr_json(
    out_dir: &Path,
    d: &PrDetails,
    viewer: &str,
    settings: &Settings,
    merge_base: Option<&str>,
) -> Result<()> {
    let mut v = serde_json::to_value(d)?;
    v["viewer"] = viewer.into();
    v["agent"] = settings.agent.map(grain_agent::Agent::id).into();
    let merge_base = merge_base
        .map(str::to_string)
        .or_else(|| read_json(&out_dir.join("pr.json")).and_then(|p| p["mergeBase"].as_str().map(str::to_string)));
    v["mergeBase"] = merge_base.into();
    v["reviewFormat"] = grain_engine::REVIEW_FORMAT.into();
    write_atomic(&out_dir.join("pr.json"), serde_json::to_string(&v)?.as_bytes())?;
    Ok(())
}

/// The diff of one block's files, as sent to the agent.
pub(crate) fn block_diff(home: &Home, pr: &PrRef, files: &[String]) -> Result<String> {
    let pr_json = read_json(&home.review_dir(pr).join("pr.json")).context("PR not prepared")?;
    let merge_base = pr_json["mergeBase"].as_str().unwrap_or_default();
    let head = pr_json["headSha"].as_str().unwrap_or_default();
    grain_git::diff(&home.clone_dir(pr), merge_base, head, files)
}
