//! Which changed files the reviewer owns, from CODEOWNERS at the PR's base (as GitHub enforces it),
//! and who last changed each file on the base branch.

use std::collections::BTreeMap;
use std::path::Path;

use anyhow::Result;
use grain_github::{CODEOWNERS_PATHS, CodeOwners, is_owner};
use grain_store::{read_json, write_atomic};
use serde_json::json;

/// The last commit on `base` touching `path`: who, when (Unix seconds), which commit and its subject.
fn last_change(git_dir: &Path, base: &str, path: &str) -> Option<serde_json::Value> {
    let out = grain_git::run(git_dir, &["log", "-1", "--format=%H%x1f%an%x1f%at%x1f%s", base, "--", path]).ok()?;
    let mut parts = out.trim().splitn(4, '\x1f');
    let (sha, author, at, subject) = (parts.next()?, parts.next()?, parts.next()?, parts.next().unwrap_or(""));
    (!sha.is_empty())
        .then(|| json!({ "sha": sha, "author": author, "at": at.parse::<u64>().unwrap_or(0), "subject": subject }))
}

/// Writes `owners.json`: owners per changed file, the files the viewer owns, which CODEOWNERS file
/// was used (`null` when the repository has none), and the last change to each file before the PR.
pub(crate) fn write(out_dir: &Path, git_dir: &Path, base: &str, login: &str, teams: &[String]) -> Result<()> {
    let found = CODEOWNERS_PATHS
        .iter()
        .find_map(|p| grain_git::run(git_dir, &["show", &format!("{base}:{p}")]).ok().map(|text| (*p, text)));
    let review = read_json(&out_dir.join("review.json")).unwrap_or_default();
    let mut files: Vec<&str> = review["blocks"]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|b| b["files"].as_array().into_iter().flatten().filter_map(|f| f.as_str()))
        .collect();
    files.sort_unstable();
    files.dedup();
    let last: BTreeMap<&str, serde_json::Value> =
        files.iter().filter_map(|f| Some((*f, last_change(git_dir, base, f)?))).collect();
    let mut owners: BTreeMap<&str, Vec<String>> = BTreeMap::new();
    let mut mine: Vec<&str> = Vec::new();
    if let Some((_, text)) = &found {
        let codeowners = CodeOwners::parse(text);
        for f in files {
            let o = codeowners.owners(f);
            if o.is_empty() {
                continue;
            }
            if is_owner(o, login, teams) {
                mine.push(f);
            }
            owners.insert(f, o.to_vec());
        }
    }
    let v = json!({ "source": found.map(|(p, _)| p), "files": owners, "mine": mine, "lastChange": last });
    write_atomic(&out_dir.join("owners.json"), v.to_string().as_bytes())?;
    Ok(())
}
