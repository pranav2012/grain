use std::process::Command;

use anyhow::{Context, Result, bail};
use serde_json::Value;

/// Runs `gh` with the user's own login and parses its JSON output.
pub(crate) fn gh(args: &[&str]) -> Result<Value> {
    let out = Command::new("gh")
        .args(args)
        .output()
        .context("`gh` is not installed. Install it from https://cli.github.com")?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        if err.contains("auth login") || err.contains("not logged") {
            bail!("GitHub CLI is not signed in. Run `gh auth login`.");
        }
        bail!("gh {}: {}", args.first().unwrap_or(&""), err.trim());
    }
    Ok(serde_json::from_slice(&out.stdout)?)
}
