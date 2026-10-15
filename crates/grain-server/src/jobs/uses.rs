use std::collections::BTreeMap;

use anyhow::{Context, Result};
use grain_github::PrRef;
use grain_store::{read_json, write_atomic};

use crate::contract::OutsideUsesFile;
use crate::routes::navigate::{outside_uses_of, pr_files};
use crate::state::App;

fn is_test(path: &str) -> bool {
    path.contains("__tests__/") || path.contains(".test.") || path.contains(".spec.")
}

/// Works out where code outside the PR uses each changed file's names, so the review can show exact
/// lists without the reviewer waiting. Written to `outside-uses.json` once per head.
pub(crate) fn run(app: &App, pr: &PrRef) -> Result<()> {
    let out_dir = app.home.review_dir(pr);
    let head = read_json(&out_dir.join("pr.json")).context("PR not prepared")?["headSha"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    let target = out_dir.join("outside-uses.json");
    if read_json(&target).is_some_and(|v| v["head"] == head.as_str()) {
        return Ok(());
    }
    let review = read_json(&out_dir.join("review.json")).context("PR not prepared")?;
    if !pr.is_local() && review["complete"] != true {
        return Ok(());
    }
    let mut files: Vec<String> = pr_files(&review).into_iter().filter(|f| !is_test(f)).collect();
    files.sort();
    let mut out = OutsideUsesFile { head: head.clone(), files: BTreeMap::default() };
    for file in files {
        match outside_uses_of(app, pr, &review, &file) {
            Ok(found) => {
                out.files.insert(file, found);
            }
            Err(e) => tracing::warn!(%file, error = %format!("{e:#}"), "outside uses failed"),
        }
    }
    let current = read_json(&out_dir.join("pr.json")).and_then(|v| v["headSha"].as_str().map(str::to_string));
    if current.as_deref() == Some(head.as_str()) {
        write_atomic(&target, serde_json::to_string(&out)?.as_bytes())?;
    }
    Ok(())
}
