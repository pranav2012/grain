//! Which changed files the reviewer owns, from CODEOWNERS at the PR's base (as GitHub enforces it).

use std::collections::BTreeMap;
use std::path::Path;

use anyhow::Result;
use grain_github::{CODEOWNERS_PATHS, CodeOwners, is_owner};
use grain_store::{read_json, write_atomic};
use serde_json::json;

/// Writes `owners.json`: owners per changed file, the files the viewer owns, and which
/// CODEOWNERS file was used (`null` when the repository has none).
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
    let v = json!({ "source": found.map(|(p, _)| p), "files": owners, "mine": mine });
    write_atomic(&out_dir.join("owners.json"), v.to_string().as_bytes())?;
    Ok(())
}
