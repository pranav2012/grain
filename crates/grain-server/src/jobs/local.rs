//! Self-review of local work: the current branch since it left the base branch, plus staged,
//! unstaged and untracked changes. The reviewer's repository is only read: Grain records the
//! working tree as an unreferenced commit through its own index (like `git stash create`).

use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use grain_engine::Depth;
use grain_github::{Author, PrDetails, PrRef};
use grain_store::{Home, Settings, read_json, write_atomic};
use serde_json::json;
use sha2::{Digest, Sha256};

use super::prepare::{Next, write_pr_json};

/// One review per repository folder and branch.
fn id_for(top: &Path, branch: Option<&str>) -> String {
    let name: String = top
        .file_name()
        .map(|n| {
            n.to_string_lossy().chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '-' }).collect()
        })
        .unwrap_or_else(|| "repo".into());
    let digest = Sha256::digest(format!("{}\0{}", top.display(), branch.unwrap_or("")));
    format!("{name}-{:02x}{:02x}{:02x}{:02x}", digest[0], digest[1], digest[2], digest[3])
}

/// Remembers which folder and branch a local review is for, and returns its id.
pub(crate) fn register(home: &Home, path: &Path) -> Result<PrRef> {
    let top =
        grain_git::toplevel(path).with_context(|| format!("{} is not inside a git repository", path.display()))?;
    let branch = grain_git::current_branch(&top);
    let pr = PrRef::local(&id_for(&top, branch.as_deref()));
    let dir = home.review_dir(&pr);
    std::fs::create_dir_all(&dir)?;
    let source = json!({ "path": top, "branch": branch });
    write_atomic(&dir.join("local.json"), source.to_string().as_bytes())?;
    Ok(pr)
}

/// The reviewer's repository a local review reads from.
pub(crate) fn repo_path(home: &Home, pr: &PrRef) -> Result<PathBuf> {
    let source = read_json(&home.review_dir(pr).join("local.json"))
        .context("Grain doesn't know this folder yet. Run `grain .` in the repository again.")?;
    Ok(PathBuf::from(source["path"].as_str().unwrap_or_default()))
}

fn snapshot(home: &Home, pr: &PrRef, repo: &Path, index: &str) -> Result<String> {
    grain_git::snapshot_worktree(repo, &home.review_dir(pr).join(index))
}

/// The snapshot the working tree would give right now; differs from the open review's head
/// once files changed. Uses its own index so it never races with [`prepare`].
pub(crate) fn current_head(home: &Home, pr: &PrRef) -> Result<String> {
    snapshot(home, pr, &repo_path(home, pr)?, "status-index")
}

/// Stage 1 for local work: snapshot the working tree, then group it (re-uses the stored review
/// when nothing changed).
pub(crate) fn prepare(
    home: &Home,
    pr: &PrRef,
    viewer: &str,
    settings: &Settings,
    report: &dyn Fn(&str),
) -> Result<Next> {
    let out_dir = home.review_dir(pr);
    let source = read_json(&out_dir.join("local.json")).unwrap_or_default();
    let repo = repo_path(home, pr)?;
    if !repo.is_dir() {
        bail!("{} no longer exists.", repo.display());
    }
    let branch = source["branch"].as_str().map(str::to_string);
    let now_on = grain_git::current_branch(&repo);
    if branch != now_on {
        bail!(
            "This review is for {}, but {} is now on {}. Run `grain .` there to review it.",
            branch.as_deref().unwrap_or("a detached HEAD"),
            repo.display(),
            now_on.as_deref().unwrap_or("a detached HEAD")
        );
    }

    report("Recording your local changes");
    let head = snapshot(home, pr, &repo, "index")?;
    let base_ref = grain_git::default_base(&repo);
    let merge_base = match &base_ref {
        Some(b) => grain_git::merge_base(&repo, b, &head)?,
        None => grain_git::run(&repo, &["rev-parse", "HEAD"])?.trim().to_string(),
    };
    let (changed_files, additions, deletions) = grain_git::shortstat(&repo, &merge_base, &head);
    let details = PrDetails {
        number: 0,
        title: match &branch {
            Some(b) => format!("Local changes on {b}"),
            None => "Local changes".into(),
        },
        url: String::new(),
        author: Author { login: viewer.into() },
        head_ref_name: branch.clone().unwrap_or_else(|| "HEAD".into()),
        base_ref_name: base_ref.clone().unwrap_or_else(|| "HEAD".into()),
        additions,
        deletions,
        changed_files,
        base_sha: merge_base.clone(),
        head_sha: head.clone(),
        state: "local".into(),
    };
    let local = json!({ "path": repo, "branch": branch, "base": base_ref });

    let prev = read_json(&out_dir.join("pr.json"));
    let same_format =
        prev.as_ref().and_then(|v| v["reviewFormat"].as_u64()) == Some(u64::from(grain_engine::REVIEW_FORMAT));
    if same_format
        && prev.as_ref().and_then(|v| v["headSha"].as_str()) == Some(head.as_str())
        && let Some(review) = read_json(&out_dir.join("review.json"))
    {
        write_pr_json(&out_dir, &details, viewer, settings, Some(&merge_base), Some(&local))?;
        return Ok(if review["complete"] == true { Next::Done } else { Next::Enrich });
    }

    let patch = grain_git::diff(&repo, &merge_base, &head, &[])?;
    if patch.trim().is_empty() {
        bail!(
            "Nothing to review: {} has no commits since {} and no uncommitted changes.",
            branch.as_deref().unwrap_or("HEAD"),
            base_ref.as_deref().unwrap_or("its base")
        );
    }
    report("Grouping your changes into chapters and blocks");
    let analysis = grain_engine::analyze_with(&repo, &merge_base, &head, Depth::Fast)?;
    write_atomic(&out_dir.join("diff.patch"), patch.as_bytes())?;
    write_atomic(&out_dir.join("review.json"), serde_json::to_string(&analysis.review)?.as_bytes())?;
    write_atomic(&out_dir.join("analysis.txt"), analysis.summary.as_bytes())?;
    write_pr_json(&out_dir, &details, viewer, settings, Some(&merge_base), Some(&local))?;
    Ok(Next::Enrich)
}

#[cfg(test)]
mod tests {
    use super::id_for;
    use std::path::Path;

    #[test]
    fn ids_are_per_folder_and_branch() {
        let a = id_for(Path::new("/w/my app"), Some("main"));
        assert!(a.starts_with("my-app-"));
        assert_eq!(a, id_for(Path::new("/w/my app"), Some("main")));
        assert_ne!(a, id_for(Path::new("/w/my app"), Some("feature")));
        assert_ne!(a, id_for(Path::new("/x/my app"), Some("main")));
    }
}
