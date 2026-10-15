use anyhow::{Context, Result};
use grain_diagnostics::Diagnostics;
use grain_github::PrRef;
use grain_store::{Home, read_json, write_atomic};

const NEEDS_CLONE: &str =
    "Errors come from your own clone of this repository, with its packages installed. Choose where it is.";

/// Type errors and lint findings for the PR's head, written to `diagnostics.json`. Runs after
/// enrichment, when Grain's checkout holds the whole repository. Skipped when already done for this head.
pub(crate) fn run(home: &Home, pr: &PrRef) -> Result<()> {
    let out_dir = home.review_dir(pr);
    let pr_json = read_json(&out_dir.join("pr.json")).context("PR not prepared")?;
    let head = pr_json["headSha"].as_str().unwrap_or_default().to_string();
    let merge_base = pr_json["mergeBase"].as_str().unwrap_or_default().to_string();
    let target = out_dir.join("diagnostics.json");
    if read_json(&target).is_some_and(|d| d["head"] == head.as_str()) {
        return Ok(());
    }
    // Type-checking a partial checkout would report every file it can't see.
    if !pr.is_local() && read_json(&out_dir.join("review.json")).is_none_or(|r| r["complete"] != true) {
        return Ok(());
    }
    let (clone, worktree) = if pr.is_local() {
        let repo = super::local::repo_path(home, pr)?;
        (Some(repo.clone()), repo)
    } else {
        (home.repo_choice(&pr.full_repo()).flatten(), home.worktree_dir(pr))
    };
    let unavailable =
        |why: String| Diagnostics { head: head.clone(), unavailable: Some(why), ..Diagnostics::default() };
    let report = match clone {
        None => unavailable(NEEDS_CLONE.into()),
        Some(clone) if !grain_diagnostics::has_packages(&clone) => unavailable(format!(
            "Your clone at {} has no installed packages. Install them there, then check again.",
            clone.display()
        )),
        Some(clone) => {
            if !pr.is_local() {
                grain_diagnostics::link_packages(&clone, &worktree)?;
            }
            let files = grain_git::changed_paths(&super::prepare::git_dir(home, pr)?, &merge_base, &head)?;
            let tsc = files
                .iter()
                .any(|f| grain_diagnostics::is_script(f))
                .then(|| grain_lsp::typescript::ensure(&home.cache_dir()))
                .transpose()
                .unwrap_or_else(|e| {
                    tracing::warn!(error = %format!("{e:#}"), "TypeScript unavailable for type errors");
                    None
                });
            grain_diagnostics::run(&clone, &worktree, tsc.as_deref(), &files, &head)
        }
    };
    // A newer push may have been prepared meanwhile; only keep results for the current head.
    let current = read_json(&out_dir.join("pr.json")).and_then(|v| v["headSha"].as_str().map(str::to_string));
    if current.as_deref() == Some(head.as_str()) {
        write_atomic(&target, serde_json::to_string(&report)?.as_bytes())?;
    }
    Ok(())
}
