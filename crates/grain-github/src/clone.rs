use std::path::Path;
use std::process::Command;

use anyhow::{Context, Result, bail};

/// Read-only partial clone (no blobs, no checkout) through the user's `gh` login. With
/// `reference`, objects are read from that existing clone (git alternates) instead of being
/// downloaded again; the referenced repository is never modified.
pub fn clone_partial(full_repo: &str, dest: &Path, reference: Option<&Path>) -> Result<()> {
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut cmd = Command::new("gh");
    cmd.args(["repo", "clone", full_repo]).arg(dest).args(["--", "--filter=blob:none", "--no-checkout", "-q"]);
    if let Some(r) = reference {
        cmd.arg("--reference-if-able").arg(r);
    }
    let status = cmd.status().context("run gh repo clone")?;
    if !status.success() {
        bail!("Could not clone {full_repo}. Check that your gh login can read it.");
    }
    Ok(())
}
