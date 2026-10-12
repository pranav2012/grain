//! Git operations Grain needs, through the git CLI. The CLI (unlike libgit2) fetches missing
//! objects from partial clones on demand, which Grain relies on.

use std::io::Write as _;
use std::path::Path;
use std::process::{Command, Stdio};

use anyhow::{Result, bail};

/// Runs `git -C dir <args>` with stable, unquoted paths and returns stdout.
pub fn run(dir: &Path, args: &[&str]) -> Result<String> {
    let out = Command::new("git").arg("-C").arg(dir).args(["-c", "core.quotepath=off"]).args(args).output()?;
    if !out.status.success() {
        bail!("git {}: {}", args.first().unwrap_or(&""), String::from_utf8_lossy(&out.stderr).trim());
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Like [`run`], with `input` written to the command's stdin.
pub fn run_with_input(dir: &Path, args: &[&str], input: &str) -> Result<String> {
    let mut child = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(["-c", "core.quotepath=off"])
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(input.as_bytes())?;
    }
    let out = child.wait_with_output()?;
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

/// Paths that exist at `head` and differ from `base` (renames reported as delete + add).
pub fn changed_paths(clone: &Path, base: &str, head: &str) -> Result<Vec<String>> {
    let out = run(clone, &["diff", "--name-only", "--no-renames", "--diff-filter=d", base, head])?;
    Ok(out.lines().filter(|l| !l.is_empty()).map(str::to_string).collect())
}

/// An exact-path pattern for `git sparse-checkout --no-cone` (gitignore syntax).
fn sparse_pattern(path: &str) -> String {
    let mut out = String::from("/");
    for ch in path.chars() {
        if matches!(ch, '\\' | '*' | '?' | '[') {
            out.push('\\');
        }
        out.push(ch);
    }
    if out.ends_with(' ') {
        out.insert(out.len() - 1, '\\');
    }
    out
}

/// Checks out only `paths` at `sha` (detached) in a private worktree, creating it on first use.
/// Fast even in huge repositories; [`expand_worktree`] fills in everything else later.
pub fn checkout_sparse(clone: &Path, worktree: &Path, sha: &str, paths: &[String]) -> Result<()> {
    if !worktree.exists() {
        if let Some(parent) = worktree.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let Some(path) = worktree.to_str() else { bail!("worktree path is not valid UTF-8") };
        run(clone, &["worktree", "add", "-q", "--no-checkout", "--detach", path, sha])?;
    }
    let patterns: String = paths.iter().map(|p| sparse_pattern(p) + "\n").collect();
    run_with_input(worktree, &["sparse-checkout", "set", "--no-cone", "--stdin"], &patterns)?;
    run(worktree, &["checkout", "-q", "--detach", "--force", sha])?;
    Ok(())
}

/// Turns a sparse worktree into a full checkout of its current commit.
pub fn expand_worktree(worktree: &Path) -> Result<()> {
    run(worktree, &["sparse-checkout", "disable"]).map(|_| ())
}

/// Removes a worktree and its administrative files, even if it has local changes.
pub fn remove_worktree(clone: &Path, worktree: &Path) -> Result<()> {
    if let Some(path) = worktree.to_str() {
        let _ = run(clone, &["worktree", "remove", "--force", path]);
    }
    if worktree.exists() {
        std::fs::remove_dir_all(worktree)?;
    }
    run(clone, &["worktree", "prune"]).map(|_| ())
}

/// Full unified diff `base..head`, optionally limited to `paths`. Also downloads both sides of
/// every changed file in one batch, which the engine (libgit2) cannot do itself.
pub fn diff(clone: &Path, base: &str, head: &str, paths: &[String]) -> Result<String> {
    let mut args = vec!["diff", "-M", "--no-color", "--no-ext-diff", base, head, "--"];
    args.extend(paths.iter().map(String::as_str));
    run(clone, &args)
}

#[cfg(test)]
mod tests {
    use super::sparse_pattern;

    #[test]
    fn sparse_patterns_match_exact_paths() {
        assert_eq!(sparse_pattern("src/app.ts"), "/src/app.ts");
        assert_eq!(sparse_pattern("src/[id]/page.tsx"), "/src/\\[id]/page.tsx");
        assert_eq!(sparse_pattern("a*b?.md"), "/a\\*b\\?.md");
        assert_eq!(sparse_pattern("!important.txt"), "/!important.txt");
    }
}
