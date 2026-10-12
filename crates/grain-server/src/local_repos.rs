use std::path::{Path, PathBuf};

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

/// Existing clones of `owner/repo` on this machine, matched by their GitHub remote.
pub(crate) fn candidates(owner: &str, repo: &str) -> Vec<String> {
    let Some(home) = dirs::home_dir() else { return Vec::new() };
    let mut out = Vec::new();
    let mut check = |dir: &Path| {
        if dir.file_name().is_some_and(|n| n.to_string_lossy().eq_ignore_ascii_case(repo))
            && grain_git::has_github_remote(dir, owner, repo)
        {
            out.push(dir.display().to_string());
        }
    };
    let subdirs = |p: &Path| -> Vec<PathBuf> {
        std::fs::read_dir(p).into_iter().flatten().flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect()
    };
    // Repos kept directly in the home folder (~/my-repo).
    check(&home.join(repo));
    for root in ROOTS.iter().map(|r| home.join(r)).filter(|p| p.is_dir()) {
        for level1 in subdirs(&root) {
            check(&level1);
            for level2 in subdirs(&level1) {
                check(&level2);
            }
        }
    }
    out.sort();
    out.dedup();
    out
}
