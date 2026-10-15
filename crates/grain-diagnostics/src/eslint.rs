use std::path::Path;
use std::process::Command;
use std::time::Duration;

use anyhow::{Context, Result, bail};

use crate::Diagnostic;

const RUNNER: &str = include_str!("eslint-runner.cjs");
const CONFIGS: [&str; 6] = [
    "eslint.config.js",
    "eslint.config.mjs",
    "eslint.config.cjs",
    "eslint.config.ts",
    "eslint.config.mts",
    "eslint.config.cts",
];

/// Lints `files` with the clone's ESLint and the nearest flat config above each file; `None` when the clone has no ESLint config.
pub(crate) fn check(clone: &Path, worktree: &Path, files: &[String]) -> Result<Option<Vec<Diagnostic>>> {
    let groups = crate::configs::groups(clone, files, &CONFIGS);
    if groups.is_empty() {
        return Ok(None);
    }
    let runner = std::env::temp_dir().join(format!("grain-eslint-runner-{}.cjs", std::process::id()));
    std::fs::write(&runner, RUNNER).context("write the ESLint runner")?;
    let result = groups.iter().try_fold(Vec::new(), |mut all, (dir, config, files)| {
        all.extend(lint(&runner, clone, worktree, dir, config, files)?);
        Ok(all)
    });
    let _ = std::fs::remove_file(&runner);
    result.map(Some)
}

fn lint(
    runner: &Path,
    clone: &Path,
    worktree: &Path,
    dir: &str,
    config: &Path,
    files: &[String],
) -> Result<Vec<Diagnostic>> {
    let (from, at) = (clone.join(dir), worktree.join(dir));
    let mut cmd = Command::new("node");
    cmd.current_dir(&at).arg(runner).arg(&from).arg(&at).arg(config);
    cmd.args(files.iter().map(|f| crate::configs::strip(dir, f)));
    let run = crate::process::run(cmd, Duration::from_secs(300))?;
    if !run.success {
        bail!("ESLint failed: {}", run.stderr.trim().lines().last().unwrap_or("no output"));
    }
    let mut items: Vec<Diagnostic> = serde_json::from_str(&run.stdout).context("read ESLint's output")?;
    for d in &mut items {
        d.file = crate::configs::join(dir, &d.file);
    }
    Ok(items)
}
