use std::path::Path;
use std::process::Command;

use anyhow::{bail, Context, Result};
use grain_github::PrRef;

use crate::home::{read_json, write_atomic, Home, Settings};

fn git(dir: &Path, args: &[&str]) -> Result<String> {
    let out = Command::new("git").arg("-C").arg(dir).args(["-c", "core.quotepath=off"]).args(args).output()?;
    if !out.status.success() {
        bail!("git {}: {}", args.first().unwrap_or(&""), String::from_utf8_lossy(&out.stderr).trim());
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Fetches the PR, checks out its head in a private worktree and runs the engine.
/// Re-opening an unchanged PR returns the stored review without re-analysis.
pub fn prepare(home: &Home, pr: &PrRef, viewer: &str, settings: &Settings, report: &dyn Fn(&str)) -> Result<()> {
    report("Looking up the pull request");
    let details = grain_github::pr_details(pr)?;
    let out_dir = home.review_dir(pr);
    let prev_head = read_json(&out_dir.join("pr.json")).and_then(|v| v["headSha"].as_str().map(str::to_string));
    if prev_head.as_deref() == Some(details.head_sha.as_str()) && out_dir.join("review.json").exists() {
        write_pr_json(&out_dir, &details, viewer, settings, None)?;
        return Ok(());
    }

    let clone = home.clone_dir(pr);
    if !clone.join(".git").exists() && !clone.join("HEAD").exists() {
        report(&format!("Cloning {} (first time only, read-only)", pr.full_repo()));
        std::fs::create_dir_all(clone.parent().unwrap())?;
        let status = Command::new("gh")
            .args(["repo", "clone", &pr.full_repo()])
            .arg(&clone)
            .args(["--", "--filter=blob:none", "--no-checkout", "-q"])
            .status()
            .context("run gh repo clone")?;
        if !status.success() {
            bail!("Could not clone {}. Check that your gh login can read it.", pr.full_repo());
        }
    }

    report("Fetching the PR's commits");
    let pr_ref = format!("+refs/pull/{}/head:refs/grain/pr/{}", pr.number, pr.number);
    git(&clone, &["fetch", "-q", "origin", &details.base_sha, &pr_ref])?;
    let merge_base = git(&clone, &["merge-base", &details.base_sha, &details.head_sha])?.trim().to_string();

    report("Checking out the PR's files");
    let wt = home.worktree_dir(pr);
    if wt.exists() {
        git(&wt, &["checkout", "-q", "--detach", "--force", &details.head_sha])?;
    } else {
        std::fs::create_dir_all(wt.parent().unwrap())?;
        git(&clone, &["worktree", "add", "-q", "--detach", wt.to_str().unwrap(), &details.head_sha])?;
    }

    // The git CLI fetches both sides of every changed file in one batch; the engine reads
    // objects via libgit2, which cannot fetch missing objects from a partial clone itself.
    report("Downloading the changed files");
    let patch = git(&clone, &["diff", "-M", "--no-color", "--no-ext-diff", &merge_base, &details.head_sha])?;

    report("Grouping the changes into chapters and blocks");
    let analysis = grain_engine::analyze(&wt, &merge_base, &details.head_sha)?;

    std::fs::create_dir_all(&out_dir)?;
    write_atomic(&out_dir.join("review.json"), serde_json::to_string(&analysis.review)?.as_bytes())?;
    write_atomic(&out_dir.join("diff.patch"), patch.as_bytes())?;
    write_atomic(&out_dir.join("analysis.txt"), analysis.summary.as_bytes())?;
    write_pr_json(&out_dir, &details, viewer, settings, Some(&merge_base))?;
    Ok(())
}

fn write_pr_json(out_dir: &Path, d: &grain_github::PrDetails, viewer: &str, settings: &Settings, merge_base: Option<&str>) -> Result<()> {
    let mut v = serde_json::to_value(d)?;
    v["viewer"] = viewer.into();
    v["agent"] = settings.agent.map(|a| a.id()).into();
    let mb = merge_base
        .map(str::to_string)
        .or_else(|| read_json(&out_dir.join("pr.json")).and_then(|p| p["mergeBase"].as_str().map(str::to_string)));
    v["mergeBase"] = mb.into();
    write_atomic(&out_dir.join("pr.json"), serde_json::to_string(&v)?.as_bytes())?;
    Ok(())
}

/// The diff of one block's files, as sent to the agent.
pub fn block_diff(home: &Home, pr: &PrRef, files: &[String]) -> Result<String> {
    let pr_json = read_json(&home.review_dir(pr).join("pr.json")).context("PR not prepared")?;
    let (mb, head) = (pr_json["mergeBase"].as_str().unwrap_or_default(), pr_json["headSha"].as_str().unwrap_or_default());
    let mut args = vec!["diff", "-M", "--no-color", "--no-ext-diff", mb, head, "--"];
    args.extend(files.iter().map(String::as_str));
    git(&home.clone_dir(pr), &args)
}
