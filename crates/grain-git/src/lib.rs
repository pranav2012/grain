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

/// Like [`run`], with extra environment variables (e.g. a private `GIT_INDEX_FILE`).
pub fn run_env(dir: &Path, envs: &[(&str, &str)], args: &[&str]) -> Result<String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(dir).args(["-c", "core.quotepath=off"]).args(args);
    for (k, v) in envs {
        cmd.env(k, v);
    }
    let out = cmd.output()?;
    if !out.status.success() {
        bail!("git {}: {}", args.first().unwrap_or(&""), String::from_utf8_lossy(&out.stderr).trim());
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Top-level folder of the repository containing `path`.
pub fn toplevel(path: &Path) -> Result<std::path::PathBuf> {
    Ok(std::path::PathBuf::from(run(path, &["rev-parse", "--show-toplevel"])?.trim()))
}

/// Current branch name, or `None` on a detached HEAD.
pub fn current_branch(repo: &Path) -> Option<String> {
    let b = run(repo, &["rev-parse", "--abbrev-ref", "HEAD"]).ok()?.trim().to_string();
    (b != "HEAD" && !b.is_empty()).then_some(b)
}

/// The branch this work will merge into: the remote's default branch, else main or master.
pub fn default_base(repo: &Path) -> Option<String> {
    if let Ok(head) = run(repo, &["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]) {
        return Some(head.trim().to_string());
    }
    ["origin/main", "origin/master", "main", "master"]
        .into_iter()
        .find(|r| run(repo, &["rev-parse", "--verify", "--quiet", r]).is_ok())
        .map(str::to_string)
}

/// Records the working tree (tracked changes plus untracked files, honoring .gitignore) as a
/// commit on top of HEAD, using a private index so the repository's own index, branches and
/// files are untouched (like `git stash create`). Fixed dates make it deterministic: the same
/// files always give the same commit.
pub fn snapshot_worktree(repo: &Path, private_index: &Path) -> Result<String> {
    let Some(index) = private_index.to_str() else { bail!("index path is not valid UTF-8") };
    let env = [
        ("GIT_INDEX_FILE", index),
        ("GIT_AUTHOR_NAME", "Grain"),
        ("GIT_AUTHOR_EMAIL", "grain@localhost"),
        ("GIT_COMMITTER_NAME", "Grain"),
        ("GIT_COMMITTER_EMAIL", "grain@localhost"),
        ("GIT_AUTHOR_DATE", "1970-01-01T00:00:00Z"),
        ("GIT_COMMITTER_DATE", "1970-01-01T00:00:00Z"),
    ];
    if !private_index.exists() {
        if let Some(parent) = private_index.parent() {
            std::fs::create_dir_all(parent)?;
        }
        run_env(repo, &env, &["read-tree", "HEAD"])?;
    }
    run_env(repo, &env, &["add", "-A"])?;
    let tree = run_env(repo, &env, &["write-tree"])?.trim().to_string();
    let head = run(repo, &["rev-parse", "HEAD"])?.trim().to_string();
    Ok(run_env(repo, &env, &["commit-tree", &tree, "-p", &head, "-m", "Grain snapshot of local changes"])?
        .trim()
        .to_string())
}

/// Lines added and removed between two commits.
pub fn shortstat(repo: &Path, base: &str, head: &str) -> (u64, u64, u64) {
    let out = run(repo, &["diff", "--shortstat", base, head]).unwrap_or_default();
    let num = |word: &str| {
        out.split(',')
            .find(|p| p.contains(word))
            .and_then(|p| p.split_whitespace().next())
            .and_then(|n| n.parse().ok())
            .unwrap_or(0)
    };
    (num("file"), num("insertion"), num("deletion"))
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

/// True when `dir` is a git repository with a remote pointing at `github.com/<owner>/<repo>`.
pub fn has_github_remote(dir: &Path, owner: &str, repo: &str) -> bool {
    let Ok(remotes) = run(dir, &["remote", "-v"]) else { return false };
    let want = format!("{owner}/{repo}").to_lowercase();
    remotes.lines().any(|l| {
        let url = l.split_whitespace().nth(1).unwrap_or_default().to_lowercase();
        let path =
            url.split_once("github.com").map(|(_, rest)| rest.trim_start_matches([':', '/'])).unwrap_or_default();
        path.trim_end_matches('/').trim_end_matches(".git") == want
    })
}

/// Deletes a ref if it exists.
pub fn delete_ref(clone: &Path, name: &str) {
    let _ = run(clone, &["update-ref", "-d", name]);
}

/// Worktrees registered in `clone`, excluding the clone itself.
pub fn worktree_count(clone: &Path) -> usize {
    run(clone, &["worktree", "list", "--porcelain"])
        .map(|o| o.lines().filter(|l| l.starts_with("worktree ")).count().saturating_sub(1))
        .unwrap_or(0)
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
    use super::{run, snapshot_worktree, sparse_pattern};

    #[test]
    fn sparse_patterns_match_exact_paths() {
        assert_eq!(sparse_pattern("src/app.ts"), "/src/app.ts");
        assert_eq!(sparse_pattern("src/[id]/page.tsx"), "/src/\\[id]/page.tsx");
        assert_eq!(sparse_pattern("a*b?.md"), "/a\\*b\\?.md");
        assert_eq!(sparse_pattern("!important.txt"), "/!important.txt");
    }

    #[test]
    fn snapshot_records_local_changes_without_touching_the_repo() -> anyhow::Result<()> {
        let tmp = tempfile::tempdir()?;
        let repo = tmp.path().join("r");
        std::fs::create_dir(&repo)?;
        let git = |args: &[&str]| run(&repo, args);
        git(&["init", "-q"])?;
        std::fs::write(repo.join("a.txt"), "a\n")?;
        std::fs::write(repo.join(".gitignore"), "*.log\n")?;
        git(&["add", "."])?;
        git(&["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init"])?;
        std::fs::write(repo.join("a.txt"), "a\nb\n")?;
        std::fs::write(repo.join("new.txt"), "new\n")?;
        std::fs::write(repo.join("debug.log"), "noise\n")?;
        let status_before = git(&["status", "--porcelain"])?;

        let index = tmp.path().join("index");
        let snap = snapshot_worktree(&repo, &index)?;
        let files = git(&["diff", "--name-only", "HEAD", &snap])?;
        assert_eq!(files.lines().collect::<Vec<_>>(), ["a.txt", "new.txt"]);
        assert_eq!(git(&["status", "--porcelain"])?, status_before);
        assert_eq!(snapshot_worktree(&repo, &index)?, snap, "same files give the same snapshot");
        Ok(())
    }
}
