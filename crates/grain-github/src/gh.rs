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

/// Runs `gh` with `input` on stdin (e.g. `gh api ... --input -`) and parses its JSON output.
pub(crate) fn gh_with_input(args: &[&str], input: &str) -> Result<Value> {
    use std::io::Write as _;
    use std::process::Stdio;
    let mut child = Command::new("gh")
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .context("`gh` is not installed. Install it from https://cli.github.com")?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(input.as_bytes())?;
    }
    let out = child.wait_with_output()?;
    if !out.status.success() {
        let body = String::from_utf8_lossy(&out.stdout);
        let message = serde_json::from_str::<Value>(&body)
            .ok()
            .and_then(|v| {
                let errors: Vec<String> = v["errors"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|e| e.as_str().map(str::to_string))
                    .collect();
                v["message"]
                    .as_str()
                    .map(|m| if errors.is_empty() { m.to_string() } else { format!("{m}: {}", errors.join("; ")) })
            })
            .unwrap_or_else(|| String::from_utf8_lossy(&out.stderr).trim().to_string());
        bail!("GitHub rejected the request: {message}");
    }
    Ok(serde_json::from_slice(&out.stdout)?)
}
