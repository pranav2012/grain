use std::path::Path;
use std::process::Command;

use anyhow::{Context, Result, bail};

/// Read-only partial clone (no blobs, no checkout) through the user's `gh` login.
pub fn clone_partial(full_repo: &str, dest: &Path) -> Result<()> {
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let status = Command::new("gh")
        .args(["repo", "clone", full_repo])
        .arg(dest)
        .args(["--", "--filter=blob:none", "--no-checkout", "-q"])
        .status()
        .context("run gh repo clone")?;
    if !status.success() {
        bail!("Could not clone {full_repo}. Check that your gh login can read it.");
    }
    Ok(())
}
