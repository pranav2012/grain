//! Git operations Grain needs, through the git CLI. The CLI (unlike libgit2) fetches missing
//! objects from partial clones on demand, which Grain relies on.

use std::path::Path;
use std::process::Command;

use anyhow::{Result, bail};

/// Runs `git -C dir <args>` with stable, unquoted paths and returns stdout.
pub fn run(dir: &Path, args: &[&str]) -> Result<String> {
    let out = Command::new("git").arg("-C").arg(dir).args(["-c", "core.quotepath=off"]).args(args).output()?;
    if !out.status.success() {
        bail!("git {}: {}", args.first().unwrap_or(&""), String::from_utf8_lossy(&out.stderr).trim());
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// True when `dir` already holds a clone (regular or bare).
pub fn is_repo(dir: &Path) -> bool {
    dir.join(".git").exists() || dir.join("HEAD").exists()
}

/// Fetches a base commit and a PR head into `refs/grain/pr/<number>`.
pub fn fetch_pr(clone: &Path, base_sha: &str, pr_number: u64) -> Result<()> {
    let pr_ref = format!("+refs/pull/{pr_number}/head:refs/grain/pr/{pr_number}");
    run(clone, &["fetch", "-q", "origin", base_sha, &pr_ref]).map(|_| ())
}

pub fn merge_base(clone: &Path, a: &str, b: &str) -> Result<String> {
    Ok(run(clone, &["merge-base", a, b])?.trim().to_string())
}

/// Checks out `sha` (detached) in a private worktree, creating it on first use.
pub fn checkout_worktree(clone: &Path, worktree: &Path, sha: &str) -> Result<()> {
    if worktree.exists() {
        run(worktree, &["checkout", "-q", "--detach", "--force", sha])?;
    } else {
        if let Some(parent) = worktree.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let Some(path) = worktree.to_str() else { bail!("worktree path is not valid UTF-8") };
        run(clone, &["worktree", "add", "-q", "--detach", path, sha])?;
    }
    Ok(())
}

/// Full unified diff `base..head`, optionally limited to `paths`. Also downloads both sides of
/// every changed file in one batch, which the engine (libgit2) cannot do itself.
pub fn diff(clone: &Path, base: &str, head: &str, paths: &[String]) -> Result<String> {
    let mut args = vec!["diff", "-M", "--no-color", "--no-ext-diff", base, head, "--"];
    args.extend(paths.iter().map(String::as_str));
    run(clone, &args)
}
