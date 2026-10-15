//! Go to definition and find references from the review's checkout.

use std::path::{Path as FsPath, PathBuf};
use std::process::Command;
use std::sync::{Arc, PoisonError};

use anyhow::Context as _;
use axum::Json;
use axum::extract::{Path, State};
use grain_github::PrRef;
use grain_lsp::{Lookup, TsUsage};
use grain_store::read_json;

use crate::contract::{
    NavLocation, NavigateRequest, NavigateResponse, OutsideUse, OutsideUsesRequest, OutsideUsesResponse,
};
use crate::error::{ApiResult, blocking};
use crate::state::{App, Shared};

const MAX_RESULTS: usize = 40;
const TS: [&str; 8] = ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"];

pub(super) async fn navigate(
    State(app): State<Shared>,
    Path((owner, repo, number)): Path<(String, String, u64)>,
    Json(body): Json<NavigateRequest>,
) -> ApiResult<Json<NavigateResponse>> {
    let pr = PrRef { owner, repo, number };
    blocking(move || {
        let root = checkout(&app, &pr)?;
        let review = read_json(&app.home.review_dir(&pr).join("review.json")).context("PR not prepared")?;
        let lookup = if body.references { Lookup::References } else { Lookup::Definition };
        let ext = body.file.rsplit_once('.').map_or("", |x| x.1);
        let precise = TS
            .contains(&ext)
            .then(|| navigator(&app, &pr, &root))
            .flatten()
            .and_then(|nav| nav.locate(lookup, &body.file, body.line.saturating_sub(1), body.character));
        let (found, precise) = match precise {
            Some(found) => (found.into_iter().map(|l| (l.file, l.line + 1)).collect(), true),
            None => (by_name(&root, &body.name, body.references), false),
        };
        let truncated = found.len() > MAX_RESULTS;
        let results =
            found.into_iter().take(MAX_RESULTS).map(|(file, line)| locate(&root, &review, file, line)).collect();
        Ok(Json(NavigateResponse { precise, results, truncated }))
    })
    .await
}

/// Every place outside the PR that uses the names `file` changes: each changed name's declaration is
/// found in the file, then its references are looked up (TypeScript precisely, others by name).
pub(super) async fn outside_uses(
    State(app): State<Shared>,
    Path((owner, repo, number)): Path<(String, String, u64)>,
    Json(body): Json<OutsideUsesRequest>,
) -> ApiResult<Json<OutsideUsesResponse>> {
    let pr = PrRef { owner, repo, number };
    blocking(move || {
        let root = checkout(&app, &pr)?;
        let review = read_json(&app.home.review_dir(&pr).join("review.json")).context("PR not prepared")?;
        let blocks = review["blocks"].as_array().cloned().unwrap_or_default();
        let pr_files: std::collections::HashSet<String> = blocks
            .iter()
            .flat_map(|b| b["files"].as_array().cloned().unwrap_or_default())
            .filter_map(|f| f.as_str().map(str::to_string))
            .collect();
        let mut names: Vec<String> = blocks
            .iter()
            .flat_map(|b| b["changes"].as_array().cloned().unwrap_or_default())
            .filter(|c| c["file"] == body.file.as_str() && c["change"] != "deleted")
            .filter_map(|c| c["name"].as_str().map(str::to_string))
            .filter(|n| !n.is_empty() && n.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '$'))
            .collect();
        names.sort();
        names.dedup();
        let text = std::fs::read_to_string(root.join(&body.file)).unwrap_or_default();
        let ext = body.file.rsplit_once('.').map_or("", |x| x.1);
        let nav = TS.contains(&ext).then(|| navigator(&app, &pr, &root)).flatten();
        let mut precise = nav.is_some();
        let mut uses = Vec::new();
        for name in names {
            let declared = text
                .lines()
                .enumerate()
                .find_map(|(i, l)| if defines(l, &name) { l.find(&name).map(|c| (i, c)) } else { None });
            let precise_found = nav.as_ref().zip(declared).and_then(|(nav, (line, col))| {
                nav.locate(
                    Lookup::References,
                    &body.file,
                    u32::try_from(line).unwrap_or(0),
                    u32::try_from(col).unwrap_or(0),
                )
            });
            let found: Vec<(String, u32)> = if let Some(found) = precise_found {
                found.into_iter().map(|l| (l.file, l.line + 1)).collect()
            } else {
                precise = false;
                by_name(&root, &name, true)
            };
            let mut locations: Vec<NavLocation> = found
                .into_iter()
                .filter(|(f, _)| !pr_files.contains(f))
                .take(MAX_RESULTS)
                .map(|(f, l)| locate(&root, &review, f, l))
                .collect();
            locations.sort_by(|a, b| a.file.cmp(&b.file).then(a.line.cmp(&b.line)));
            if !locations.is_empty() {
                uses.push(OutsideUse { name, locations });
            }
        }
        Ok(Json(OutsideUsesResponse { precise, uses }))
    })
    .await
}

/// The checkout the review reads: the user's folder for local reviews, else Grain's worktree.
fn checkout(app: &App, pr: &PrRef) -> anyhow::Result<PathBuf> {
    if pr.is_local() { crate::jobs::local::repo_path(&app.home, pr) } else { Ok(app.home.worktree_dir(pr)) }
}

/// The review's TypeScript server, started on first use and kept for the session.
fn navigator(app: &App, pr: &PrRef, root: &FsPath) -> Option<Arc<TsUsage>> {
    if let Some(n) = app.navigators.lock().unwrap_or_else(PoisonError::into_inner).get(pr) {
        return Some(n.clone());
    }
    let started =
        grain_lsp::typescript::ensure(&app.home.cache_dir()).and_then(|tsc| TsUsage::start_interactive(&tsc, root));
    match started {
        Ok(nav) => {
            let nav = Arc::new(nav);
            app.navigators.lock().unwrap_or_else(PoisonError::into_inner).insert(pr.clone(), nav.clone());
            Some(nav)
        }
        Err(e) => {
            tracing::warn!(error = %format!("{e:#}"), "TypeScript navigation unavailable; searching by name");
            None
        }
    }
}

/// Whole-word matches of `name` in tracked files; for definitions, only lines that look like one.
fn by_name(root: &FsPath, name: &str, references: bool) -> Vec<(String, u32)> {
    if name.is_empty() || !name.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '$') {
        return vec![];
    }
    let Ok(out) =
        Command::new("git").args(["grep", "-n", "-w", "-I", "--no-color", "-e", name]).current_dir(root).output()
    else {
        return vec![];
    };
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter_map(|l| {
            let mut parts = l.splitn(3, ':');
            let (file, line, text) = (parts.next()?, parts.next()?.parse().ok()?, parts.next()?);
            (references || defines(text, name)).then(|| (file.to_string(), line))
        })
        .filter(|(f, _)| !f.split('/').any(|s| s == "node_modules"))
        .collect()
}

/// Adds the surrounding lines and the change in this review that holds the line, if any.
fn locate(root: &FsPath, review: &serde_json::Value, file: String, line: u32) -> NavLocation {
    let text = std::fs::read_to_string(root.join(&file)).unwrap_or_default();
    let lines: Vec<&str> = text.lines().collect();
    let start = line.saturating_sub(2).max(1);
    let end = (line + 4).min(u32::try_from(lines.len()).unwrap_or(u32::MAX));
    let snippet =
        (start..=end).filter_map(|n| lines.get(n as usize - 1).map(|s| s.chars().take(200).collect())).collect();
    let block = review["blocks"].as_array().into_iter().flatten().find_map(|b| {
        let has_file = b["files"].as_array()?.iter().any(|f| f.as_str() == Some(file.as_str()));
        let in_slice = b["slice"]["newLines"].as_array().is_none_or(|ranges| {
            ranges.iter().any(|r| {
                r[0].as_u64().is_some_and(|s| s <= u64::from(line))
                    && r[1].as_u64().is_some_and(|e| u64::from(line) <= e)
            })
        });
        (has_file && in_slice).then(|| b["id"].as_u64().and_then(|id| usize::try_from(id).ok())).flatten()
    });
    NavLocation { file, line, snippet, snippet_start: start, block }
}

/// Whether a line looks like it declares `name` (`fn name`, `const name =`, `name: (…) =>`…).
fn defines(text: &str, name: &str) -> bool {
    const KEYWORDS: [&str; 16] = [
        "fn",
        "function",
        "def",
        "class",
        "struct",
        "enum",
        "trait",
        "interface",
        "type",
        "const",
        "let",
        "var",
        "val",
        "func",
        "impl",
        "mod",
    ];
    let words: Vec<&str> =
        text.split(|c: char| !c.is_alphanumeric() && c != '_' && c != '$').filter(|w| !w.is_empty()).collect();
    words.windows(2).any(|w| KEYWORDS.contains(&w[0]) && w[1] == name)
        || text.trim_start().starts_with(&format!("{name}:"))
}

#[cfg(test)]
mod tests {
    use super::defines;

    #[test]
    fn spots_definitions_by_name() {
        assert!(defines("export async function fetchVoucher(id: string) {", "fetchVoucher"));
        assert!(defines("pub(crate) fn build_story(", "build_story"));
        assert!(defines("export const useVoucherData = (id) => {", "useVoucherData"));
        assert!(defines("  fetchVoucher: async () => {}", "fetchVoucher"));
        assert!(!defines("  const v = fetchVoucher(id)", "fetchVoucher"));
    }
}
