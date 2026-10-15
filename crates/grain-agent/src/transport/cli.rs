//! CLI transport: runs the user's own, unmodified agent CLI with their own login: tool-less for summaries
//! and questions, read-only tools in the PR checkout for full reviews.
//! Grain never reads, copies or stores agent credentials.

use std::io::Write;
use std::process::{Command, Stdio};

pub(crate) struct CliOutput {
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
    let mut child = cmd.current_dir(dir).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn()?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(input.as_bytes())?;
    }
    let out = child.wait_with_output()?;
    Ok(CliOutput {
        stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
    })
}

/// `claude -p` with a JSON schema; tools, MCP servers and session persistence are all disabled.
pub(crate) fn claude(
    prompt: &str,
    schema: &str,
    model: Option<&str>,
) -> std::io::Result<(Option<serde_json::Value>, CliOutput)> {
    let mut cmd = Command::new(crate::resolve_program("claude"));
    cmd.args(["-p", "--output-format", "json", "--json-schema", schema, "--tools", "", "--strict-mcp-config"]).args([
        "--permission-mode",
        "dontAsk",
        "--no-session-persistence",
    ]);
    if let Some(m) = model {
        cmd.args(["--model", m]);
    }
    let out = run(cmd, prompt, &scratch_dir())?;
    let parsed =
        serde_json::from_str::<serde_json::Value>(&out.stdout).ok().and_then(|v| v.get("structured_output").cloned());
    Ok((parsed, out))
}

/// `codex exec` in a read-only sandbox, ephemeral session, schema-constrained final message.
pub(crate) fn codex(
    prompt: &str,
    schema: &str,
    model: Option<&str>,
) -> std::io::Result<(Option<serde_json::Value>, CliOutput)> {
    let dir = scratch_dir();
    let (schema_path, out_path) = (dir.join("schema.json"), dir.join("last.txt"));
    std::fs::write(&schema_path, schema)?;
    let _ = std::fs::remove_file(&out_path);
    let mut cmd = Command::new(crate::resolve_program("codex"));
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
pub(crate) fn opencode(prompt: &str, model: Option<&str>) -> std::io::Result<(Option<serde_json::Value>, CliOutput)> {
    let mut cmd = Command::new(crate::resolve_program("opencode"));
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
    Ok((crate::prompt::extract_json(&text), out))
}

/// True when the user's OpenCode has an Anthropic *subscription* (OAuth) login, which Anthropic
/// does not allow third-party harnesses to use.
pub(crate) fn opencode_has_anthropic_oauth() -> bool {
    Command::new(crate::resolve_program("opencode"))
        .args(["auth", "list"])
        .output()
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .lines()
                .any(|l| l.to_lowercase().contains("anthropic") && l.to_lowercase().contains("oauth"))
        })
        .unwrap_or(false)
}

/// Like [`run`] but in `dir` (the PR checkout) and stopped after `limit`; for long, tool-using reviews.
fn run_limited(
    mut cmd: Command,
    input: &str,
    dir: &std::path::Path,
    limit: std::time::Duration,
) -> std::io::Result<CliOutput> {
    use std::io::Read;
    let mut child = cmd.current_dir(dir).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn()?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(input.as_bytes())?;
    }
    let read = |mut r: Box<dyn Read + Send>| {
        std::thread::spawn(move || {
            let mut s = String::new();
            let _ = r.read_to_string(&mut s);
            s
        })
    };
    let out = child.stdout.take().map(|o| read(Box::new(o)));
    let err = child.stderr.take().map(|e| read(Box::new(e)));
    let started = std::time::Instant::now();
    while child.try_wait()?.is_none() {
        if started.elapsed() > limit {
            let _ = child.kill();
            let _ = child.wait();
            return Err(std::io::Error::other(format!(
                "the review took longer than {} minutes and was stopped",
                limit.as_secs() / 60
            )));
        }
        std::thread::sleep(std::time::Duration::from_millis(200));
    }
    Ok(CliOutput {
        stdout: out.and_then(|h| h.join().ok()).unwrap_or_default(),
        stderr: err.and_then(|h| h.join().ok()).unwrap_or_default(),
    })
}

/// Read-only tools for a review: files, search, subagents and git history. Nothing else is allowed.
const CLAUDE_REVIEW_TOOLS: [&str; 8] =
    ["Read", "Grep", "Glob", "Agent", "Bash(git log:*)", "Bash(git show:*)", "Bash(git diff:*)", "Bash(git blame:*)"];

/// `claude -p --restricted` in the PR checkout: the repository's own `.claude` settings (and their hooks)
/// are ignored, file tools stay inside the checkout, and only read-only tools are allowed.
pub(crate) fn claude_review(
    prompt: &str,
    schema: &str,
    model: Option<&str>,
    dir: &std::path::Path,
    limit: std::time::Duration,
) -> std::io::Result<(Option<serde_json::Value>, CliOutput)> {
    let mut cmd = Command::new(crate::resolve_program("claude"));
    cmd.args(["-p", "--restricted", "--output-format", "json", "--json-schema", schema, "--strict-mcp-config"])
        .args(["--tools", "Read,Grep,Glob,Agent,Bash", "--permission-mode", "dontAsk", "--no-session-persistence"])
        .arg("--allowedTools")
        .args(CLAUDE_REVIEW_TOOLS);
    if let Some(m) = model {
        cmd.args(["--model", m]);
    }
    let out = run_limited(cmd, prompt, dir, limit)?;
    let parsed =
        serde_json::from_str::<serde_json::Value>(&out.stdout).ok().and_then(|v| v.get("structured_output").cloned());
    Ok((parsed, out))
}

/// `codex exec` in the PR checkout with its read-only sandbox.
pub(crate) fn codex_review(
    prompt: &str,
    schema: &str,
    model: Option<&str>,
    dir: &std::path::Path,
    limit: std::time::Duration,
) -> std::io::Result<(Option<serde_json::Value>, CliOutput)> {
    let scratch = scratch_dir();
    let (schema_path, out_path) = (scratch.join("schema.json"), scratch.join("last.txt"));
    std::fs::write(&schema_path, schema)?;
    let mut cmd = Command::new(crate::resolve_program("codex"));
    cmd.args(["exec", "--ephemeral", "-s", "read-only", "--color", "never"])
        .arg("--output-schema")
        .arg(&schema_path)
        .arg("-o")
        .arg(&out_path);
    if let Some(m) = model {
        cmd.args(["-m", m]);
    }
    let out = run_limited(cmd, prompt, dir, limit)?;
    let parsed = std::fs::read_to_string(&out_path).ok().and_then(|s| serde_json::from_str(&s).ok());
    Ok((parsed, out))
}

/// `opencode run` in the PR checkout with its built-in read-only `plan` agent.
pub(crate) fn opencode_review(
    prompt: &str,
    model: Option<&str>,
    dir: &std::path::Path,
    limit: std::time::Duration,
) -> std::io::Result<(Option<serde_json::Value>, CliOutput)> {
    let mut cmd = Command::new(crate::resolve_program("opencode"));
    cmd.args(["run", "--format", "json", "--agent", "plan"]);
    if let Some(m) = model {
        cmd.args(["-m", m]);
    }
    let out = run_limited(cmd, prompt, dir, limit)?;
    let text: String = out
        .stdout
        .lines()
        .filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok())
        .filter_map(|e| e.pointer("/part/text").and_then(|t| t.as_str()).map(str::to_string))
        .collect();
    Ok((crate::prompt::extract_json(&text), out))
}
