use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use crate::contract::LocalCandidate;

/// Folders people usually keep code in; searched two levels deep for suggestions only.
const ROOTS: [&str; 14] = [
    "code",
    "projects",
    "work",
    "workspace",
    "dev",
    "src",
    "Developer",
    "repos",
    "git",
    "github",
    "Documents/GitHub",
    "Documents/code",
    "Sites",
    ".t3/projects",
];

fn subdirs(p: &Path) -> Vec<PathBuf> {
    std::fs::read_dir(p).into_iter().flatten().flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect()
}

/// Calls `visit` for every folder in the usual code folders (two levels deep) and directly in
/// the home folder.
fn walk(mut visit: impl FnMut(&Path)) {
    let Some(home) = dirs::home_dir() else { return };
    // Hidden folders in home are tool data (~/.cargo, ~/.oh-my-zsh), not projects.
    for dir in subdirs(&home).iter().filter(|d| !d.file_name().is_some_and(|n| n.to_string_lossy().starts_with('.'))) {
        visit(dir);
    }
    for root in ROOTS.iter().map(|r| home.join(r)).filter(|p| p.is_dir()) {
        for level1 in subdirs(&root) {
            visit(&level1);
            for level2 in subdirs(&level1) {
                visit(&level2);
            }
        }
    }
}

/// Existing clones of `owner/repo` on this machine, matched by their GitHub remote.
pub(crate) fn candidates(owner: &str, repo: &str) -> Vec<String> {
    let mut out = Vec::new();
    walk(|dir| {
        if dir.file_name().is_some_and(|n| n.to_string_lossy().eq_ignore_ascii_case(repo))
            && grain_git::has_github_remote(dir, owner, repo)
        {
            out.push(dir.display().to_string());
        }
    });
    out.sort();
    out.dedup();
    out
}

/// Every git repository in the usual code folders, most recently active first. Reads only a
/// few files per folder (no git commands), so it stays fast with hundreds of repositories.
pub(crate) fn all_repos() -> Vec<LocalCandidate> {
    let mut out = Vec::new();
    walk(|dir| {
        let dot_git = dir.join(".git");
        // Linked worktrees have a `.git` file pointing at their real git folder.
        let git_dir = match std::fs::read_to_string(&dot_git) {
            Ok(link) => match link.trim().strip_prefix("gitdir: ") {
                Some(p) => dir.join(p),
                None => return,
            },
            Err(_) if dot_git.is_dir() => dot_git,
            Err(_) => return,
        };
        let head = std::fs::read_to_string(git_dir.join("HEAD")).unwrap_or_default();
        let active_at = ["index", "HEAD"]
            .iter()
            .filter_map(|f| git_dir.join(f).metadata().and_then(|m| m.modified()).ok())
            .max()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map_or(0, |d| d.as_secs());
        out.push(LocalCandidate {
            path: dir.display().to_string(),
            name: dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
            branch: head.trim().strip_prefix("ref: refs/heads/").map(str::to_string),
            active_at,
        });
    });
    out.sort_by(|a, b| b.active_at.cmp(&a.active_at).then_with(|| a.path.cmp(&b.path)));
    out.dedup_by(|a, b| a.path == b.path);
    out.truncate(60);
    out
}
