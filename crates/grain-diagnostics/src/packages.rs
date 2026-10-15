use std::path::{Path, PathBuf};

use anyhow::{Result, bail};

/// `node_modules` folders of a project (the root one and those of workspace packages), relative
/// to `root`. Skips hidden folders and anything inside another `node_modules`.
fn package_dirs(root: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut stack = vec![(PathBuf::new(), 0)];
    while let Some((rel, depth)) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(root.join(&rel)) else { continue };
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                continue;
            }
            // `node_modules` may itself be a link; other folders are only entered when real.
            if name == "node_modules" && e.path().is_dir() {
                out.push(rel.join(name));
            } else if depth < 3 && e.file_type().is_ok_and(|t| t.is_dir()) && name != "node_modules" {
                stack.push((rel.join(name), depth + 1));
            }
        }
    }
    out.sort();
    out
}

/// True when the project has installed packages at its root or in a workspace package.
pub fn has_packages(root: &Path) -> bool {
    !package_dirs(root).is_empty()
}

/// Makes `worktree` use `clone`'s installed packages by linking each `node_modules` folder into the
/// same place. Existing entries are left alone. Errors when the clone has no installed packages.
pub fn link_packages(clone: &Path, worktree: &Path) -> Result<()> {
    let dirs = package_dirs(clone);
    if dirs.is_empty() {
        bail!("{} has no installed packages (node_modules)", clone.display());
    }
    for rel in dirs {
        let target = worktree.join(&rel);
        let parent_exists = target.parent().is_some_and(Path::is_dir);
        if parent_exists && std::fs::symlink_metadata(&target).is_err() {
            link(&clone.join(&rel), &target)?;
        }
    }
    Ok(())
}

#[cfg(unix)]
fn link(from: &Path, to: &Path) -> Result<()> {
    std::os::unix::fs::symlink(from, to)?;
    Ok(())
}

#[cfg(windows)]
fn link(from: &Path, to: &Path) -> Result<()> {
    std::os::windows::fs::symlink_dir(from, to)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn links_root_and_workspace_packages_only() -> anyhow::Result<()> {
        let clone = tempfile::tempdir()?;
        let work = tempfile::tempdir()?;
        for d in ["node_modules/react", "packages/app/node_modules/x", ".git/node_modules", "packages/lib/src"] {
            std::fs::create_dir_all(clone.path().join(d))?;
        }
        std::fs::create_dir_all(work.path().join("packages/app"))?;
        link_packages(clone.path(), work.path())?;
        assert!(work.path().join("node_modules/react").is_dir());
        assert!(work.path().join("packages/app/node_modules/x").is_dir());
        assert!(!work.path().join(".git").exists());
        assert!(!work.path().join("packages/lib/node_modules").exists());
        Ok(())
    }

    #[test]
    fn needs_installed_packages() -> anyhow::Result<()> {
        let clone = tempfile::tempdir()?;
        let work = tempfile::tempdir()?;
        assert!(link_packages(clone.path(), work.path()).is_err());
        Ok(())
    }
}
