//! CLI transport: runs the user's own, unmodified agent CLI with their own login, read-only and tool-less.
//! Grain never reads, copies or stores agent credentials.

use std::io::Write;
use std::process::{Command, Stdio};

pub struct CliOutput {
    pub stdout: String,
    pub stderr: String,
}

static CALLS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

/// A fresh, empty directory per call, so concurrent summaries never share files.
fn scratch_dir() -> std::path::PathBuf {
    let n = CALLS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let d = std::env::temp_dir().join(format!("grain-agent-{}-{n}", std::process::id()));
    std::fs::create_dir_all(&d).ok();
    d
}

/// Runs `cmd` in an empty scratch dir with `input` on stdin, so the agent has no repo to act on.
fn run(mut cmd: Command, input: &str, dir: &std::path::Path) -> std::io::Result<CliOutput> {
    let mut child = cmd
        .current_dir(dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    child.stdin.take().unwrap().write_all(input.as_bytes())?;
    let out = child.wait_with_output()?;
    Ok(CliOutput {
        stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
    })
}

/// `claude -p` with a JSON schema; tools, MCP servers and session persistence are all disabled.
pub fn claude(prompt: &str, schema: &str, model: Option<&str>) -> std::io::Result<(Option<serde_json::Value>, CliOutput)> {
    let mut cmd = Command::new("claude");
    cmd.args(["-p", "--output-format", "json", "--json-schema", schema, "--tools", "", "--strict-mcp-config"])
        .args(["--permission-mode", "dontAsk", "--no-session-persistence"]);
    if let Some(m) = model {
        cmd.args(["--model", m]);
    }
    let out = run(cmd, prompt, &scratch_dir())?;
    let parsed = serde_json::from_str::<serde_json::Value>(&out.stdout)
        .ok()
        .and_then(|v| v.get("structured_output").cloned());
    Ok((parsed, out))
}

/// `codex exec` in a read-only sandbox, ephemeral session, schema-constrained final message.
pub fn codex(prompt: &str, schema: &str, model: Option<&str>) -> std::io::Result<(Option<serde_json::Value>, CliOutput)> {
    let dir = scratch_dir();
    let (schema_path, out_path) = (dir.join("schema.json"), dir.join("last.txt"));
    std::fs::write(&schema_path, schema)?;
    let _ = std::fs::remove_file(&out_path);
    let mut cmd = Command::new("codex");
    cmd.args(["exec", "--ephemeral", "--skip-git-repo-check", "-s", "read-only", "--color", "never"])
        .arg("--output-schema")
        .arg(&schema_path)
        .arg("-o")
        .arg(&out_path);
    if let Some(m) = model {
        cmd.args(["-m", m]);
    }
    let out = run(cmd, prompt, &dir)?;
    let parsed = std::fs::read_to_string(&out_path).ok().and_then(|s| serde_json::from_str(&s).ok());
    Ok((parsed, out))
}

/// `opencode run --format json`; collects text parts from the event stream.
pub fn opencode(prompt: &str, model: Option<&str>) -> std::io::Result<(Option<serde_json::Value>, CliOutput)> {
    let mut cmd = Command::new("opencode");
    cmd.args(["run", "--format", "json"]);
    if let Some(m) = model {
        cmd.args(["-m", m]);
    }
    let out = run(cmd, prompt, &scratch_dir())?;
    let text: String = out
        .stdout
        .lines()
        .filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok())
        .filter_map(|e| e.pointer("/part/text").and_then(|t| t.as_str()).map(str::to_string))
        .collect();
    Ok((crate::extract_json(&text), out))
}

/// True when the user's OpenCode has an Anthropic *subscription* (OAuth) login, which Anthropic
/// does not allow third-party harnesses to use.
pub fn opencode_has_anthropic_oauth() -> bool {
    Command::new("opencode")
        .args(["auth", "list"])
        .output()
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .lines()
                .any(|l| l.to_lowercase().contains("anthropic") && l.to_lowercase().contains("oauth"))
        })
        .unwrap_or(false)
}
