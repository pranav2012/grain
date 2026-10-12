use std::path::Path;
use std::time::Duration;

use grain_github::PrRef;
use grain_store::{Home, list_review_files, read_json, write_atomic};
use serde::Serialize;

/// Checkouts not opened for this long are removed (reopening recreates them).
pub(crate) const IDLE: Duration = Duration::from_hours(14 * 24);

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupReport {
    /// All checkouts removed, for any reason.
    pub checkouts_removed: usize,
    pub closed_prs: usize,
    pub idle_checkouts: usize,
    pub clones_removed: usize,
    pub bytes_freed: u64,
}

/// `<reviews>/<owner>/<repo>/<number>/pr.json` → the PR it belongs to.
fn pr_from(pr_json: &Path) -> Option<PrRef> {
    let number = pr_json.parent()?;
    let repo = number.parent()?;
    let owner = repo.parent()?;
    Some(PrRef {
        owner: owner.file_name()?.to_str()?.into(),
        repo: repo.file_name()?.to_str()?.into(),
        number: number.file_name()?.to_str()?.parse().ok()?,
    })
}

/// Removes a PR's checkout, fetched ref and diff; keeps its small review files.
fn release_checkout(home: &Home, pr: &PrRef, report: &mut CleanupReport) {
    let worktree = home.worktree_dir(pr);
    let dir = home.review_dir(pr);
    let before = grain_store::disk_usage(&worktree) + grain_store::disk_usage(&dir.join("diff.patch"));
    let clone = home.clone_dir(pr);
    if grain_git::is_repo(&clone) {
        let _ = grain_git::remove_worktree(&clone, &worktree);
        grain_git::delete_ref(&clone, &format!("refs/grain/pr/{}", pr.number));
    } else if worktree.exists() {
        let _ = std::fs::remove_dir_all(&worktree);
    }
    let _ = std::fs::remove_file(dir.join("diff.patch"));
    let _ = std::fs::remove_file(dir.join("analysis.txt"));
    if before > 0 {
        report.checkouts_removed += 1;
        report.bytes_freed += before;
    }
}

/// Cleans up merged or closed PRs, checkouts idle for 14 days, and Grain clones nothing uses.
/// With `everything`, removes every checkout and clone. Review notes live in the browser and
/// are never touched. PRs in `skip` (being prepared right now) are left alone.
pub(crate) fn run(home: &Home, everything: bool, skip: &dyn Fn(&PrRef) -> bool) -> CleanupReport {
    let mut report = CleanupReport::default();
    for pr_json in list_review_files(&home.reviews_root(), "pr.json") {
        let Some(pr) = pr_from(&pr_json) else { continue };
        // Local reviews have no checkout or clone of their own.
        if pr.is_local() || skip(&pr) || read_json(&pr_json).is_some_and(|v| v["closed"] == true) {
            continue;
        }
        let idle = home.review_idle_secs(&pr).or_else(|| {
            let modified = pr_json.metadata().and_then(|m| m.modified()).ok()?;
            Some(modified.elapsed().ok()?.as_secs())
        });
        if everything {
            release_checkout(home, &pr, &mut report);
            continue;
        }
        match grain_github::pr_is_open(&pr) {
            Ok(false) => {
                release_checkout(home, &pr, &mut report);
                report.closed_prs += 1;
                if let Some(mut v) = read_json(&pr_json) {
                    v["closed"] = true.into();
                    let _ = write_atomic(&pr_json, v.to_string().as_bytes());
                }
            }
            Ok(true) if idle.is_some_and(|s| s > IDLE.as_secs()) && home.worktree_dir(&pr).exists() => {
                release_checkout(home, &pr, &mut report);
                report.idle_checkouts += 1;
            }
            _ => {}
        }
    }
    report.clones_removed += remove_unused_clones(home, everything, &mut report.bytes_freed);
    report
}

/// Removes Grain-owned clones with no checkouts left. Borrowed objects stay in the reviewer's repo.
fn remove_unused_clones(home: &Home, everything: bool, freed: &mut u64) -> usize {
    let dirs = |p: &Path| std::fs::read_dir(p).into_iter().flatten().flatten().map(|e| e.path()).collect::<Vec<_>>();
    let mut removed = 0;
    for owner in dirs(&home.repos_root()) {
        for clone in dirs(&owner) {
            // A clone being created (or just prepared) has no checkout yet; never take it away.
            let recent = clone
                .metadata()
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.elapsed().ok())
                .is_some_and(|age| age < Duration::from_hours(1));
            if everything || (!recent && grain_git::worktree_count(&clone) == 0) {
                *freed += grain_store::disk_usage(&clone);
                if std::fs::remove_dir_all(&clone).is_ok() {
                    removed += 1;
                }
            }
        }
    }
    removed
}
