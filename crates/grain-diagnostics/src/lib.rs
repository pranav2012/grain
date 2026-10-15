//! Type errors and lint findings for a pull request, like an editor would show them.
//!
//! Everything runs from the reviewer's own clone: its installed packages are linked into
//! Grain's checkout of the PR, TypeScript 7 (Grain's verified download) type-checks the PR's
//! code, and the clone's linter runs with the clone's config file. The PR's own config files
//! never run, so reviewing someone else's branch executes none of its code.

mod configs;
mod eslint;
mod oxlint;
mod packages;
mod process;
mod typescript;

use std::path::Path;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub use packages::{has_packages, link_packages};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum Severity {
    Error,
    Warning,
}

/// One problem at a place in a changed file (new side, 1-based lines and columns).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Diagnostic {
    pub file: String,
    pub line: usize,
    pub end_line: usize,
    pub column: usize,
    /// Characters the problem spans on its first line, when known.
    pub length: Option<usize>,
    pub severity: Severity,
    pub message: String,
    /// `TypeScript`, `ESLint`, `oxlint`, or `CI · <check name>`.
    pub source: String,
    /// `TS2345`, a rule id like `no-unused-vars`, or none.
    pub code: Option<String>,
    pub url: Option<String>,
}

/// How one tool run went, so the reviewer knows what was and wasn't checked.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ToolRun {
    pub name: String,
    pub ok: bool,
    pub note: Option<String>,
    pub ms: u64,
}

/// Everything found for one head commit, limited to the PR's changed files.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Diagnostics {
    pub head: String,
    /// The reviewer's clone whose packages and lint config were used.
    pub clone: String,
    pub items: Vec<Diagnostic>,
    pub tools: Vec<ToolRun>,
    /// Why nothing was checked, e.g. no local clone with installed packages.
    pub unavailable: Option<String>,
}

const SCRIPT_EXTENSIONS: [&str; 8] = ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"];

pub fn is_script(path: &str) -> bool {
    path.rsplit_once('.').is_some_and(|(_, ext)| SCRIPT_EXTENSIONS.contains(&ext))
}

/// Runs every available checker on `files` (paths relative to `worktree`). `worktree` must
/// already see the clone's packages (see [`link_packages`]); `tsc` is TypeScript 7 when available.
pub fn run(clone: &Path, worktree: &Path, tsc: Option<&Path>, files: &[String], head: &str) -> Diagnostics {
    let scripts: Vec<String> = files.iter().filter(|f| is_script(f) && worktree.join(f).is_file()).cloned().collect();
    let mut out = Diagnostics { head: head.to_string(), clone: clone.display().to_string(), ..Diagnostics::default() };
    if scripts.is_empty() {
        return out;
    }
    let deps_changed = files.iter().any(|f| {
        let name = f.rsplit('/').next().unwrap_or(f);
        matches!(name, "package.json" | "yarn.lock" | "package-lock.json" | "pnpm-lock.yaml" | "bun.lock" | "bun.lockb")
    });
    let mut record = |name: &str, started: Instant, result: anyhow::Result<Option<Vec<Diagnostic>>>| {
        let ms = started.elapsed().as_millis() as u64;
        match result {
            Ok(Some(items)) => {
                let note = (deps_changed && name == "TypeScript").then(|| {
                    "This PR changes dependencies; your clone's installed packages may not match them.".to_string()
                });
                out.items.extend(items);
                out.tools.push(ToolRun { name: name.into(), ok: true, note, ms });
            }
            Ok(None) => {}
            Err(e) => {
                tracing::warn!(tool = name, error = %format!("{e:#}"), "diagnostics tool failed");
                out.tools.push(ToolRun { name: name.into(), ok: false, note: Some(format!("{e:#}")), ms });
            }
        }
    };
    if let Some(tsc) = tsc {
        let t = Instant::now();
        record("TypeScript", t, typescript::check(tsc, worktree, &scripts).map(Some));
    }
    let t = Instant::now();
    record("ESLint", t, eslint::check(clone, worktree, &scripts));
    let t = Instant::now();
    record("oxlint", t, oxlint::check(clone, worktree, &scripts));
    out.items.sort_by(|a, b| (&a.file, a.line, a.column, &a.source).cmp(&(&b.file, b.line, b.column, &b.source)));
    out.items.dedup();
    out
}
