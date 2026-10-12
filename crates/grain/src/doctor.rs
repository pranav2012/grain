//! `grain doctor`: checks everything Grain needs and says exactly how to fix what's missing.

use std::fmt::Write as _;
use std::io::IsTerminal;
use std::net::{SocketAddr, TcpListener};
use std::process::Command;

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Status {
    Ok,
    /// Required and missing: Grain can't run.
    Missing,
    /// Optional and missing, or works with a caveat.
    Warn,
}

#[derive(Debug, Serialize)]
pub(crate) struct Check {
    pub(crate) name: &'static str,
    pub(crate) required: bool,
    pub(crate) status: Status,
    pub(crate) detail: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) fix: Option<String>,
}

#[derive(Clone, Copy)]
enum Os {
    Mac,
    Linux,
    Windows,
}

impl Os {
    fn current() -> Os {
        match std::env::consts::OS {
            "macos" => Os::Mac,
            "windows" => Os::Windows,
            _ => Os::Linux,
        }
    }
}

/// First line of `<bin> --version`, or `None` when the program isn't installed.
fn version(bin: &str) -> Option<String> {
    let out = Command::new(grain_agent::resolve_program(bin)).arg("--version").output().ok()?;
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).lines().next().unwrap_or_default().trim().to_string())
}

fn ok(name: &'static str, required: bool, detail: impl Into<String>) -> Check {
    Check { name, required, status: Status::Ok, detail: detail.into(), fix: None }
}

/// A required item that works with a caveat: shown under Required, but doesn't block.
fn caveat(name: &'static str, detail: impl Into<String>, fix: impl Into<String>) -> Check {
    Check { name, required: true, status: Status::Warn, detail: detail.into(), fix: Some(fix.into()) }
}

fn problem(name: &'static str, required: bool, detail: impl Into<String>, fix: impl Into<String>) -> Check {
    let status = if required { Status::Missing } else { Status::Warn };
    Check { name, required, status, detail: detail.into(), fix: Some(fix.into()) }
}

fn install_git(os: Os) -> &'static str {
    match os {
        Os::Mac => "xcode-select --install   (or: brew install git)",
        Os::Linux => "sudo apt install git   (other distros: https://git-scm.com/download/linux)",
        Os::Windows => "winget install --id Git.Git",
    }
}

fn install_gh(os: Os) -> &'static str {
    match os {
        Os::Mac => "brew install gh, then: gh auth login",
        Os::Linux => "see https://github.com/cli/cli/blob/trunk/docs/install_linux.md, then: gh auth login",
        Os::Windows => "winget install --id GitHub.cli, then: gh auth login",
    }
}

fn check_git(os: Os) -> Check {
    let Some(v) = version("git") else {
        return problem("git", true, "Not installed. Grain uses git to fetch and diff pull requests.", install_git(os));
    };
    // Partial clones and `git worktree add --detach` need git 2.25 or newer.
    let num: Vec<u32> = v
        .split_whitespace()
        .find(|w| w.starts_with(char::is_numeric))
        .unwrap_or("0")
        .split('.')
        .filter_map(|p| p.parse().ok())
        .collect();
    if (num.first().copied().unwrap_or(0), num.get(1).copied().unwrap_or(0)) < (2, 25) {
        return problem("git", true, format!("{v} is too old; Grain needs git 2.25 or newer."), install_git(os));
    }
    ok("git", true, v)
}

fn check_gh(os: Os) -> Vec<Check> {
    let Some(v) = version("gh") else {
        return vec![problem(
            "GitHub CLI",
            true,
            "Not installed. Grain uses your gh login to read pull requests.",
            install_gh(os),
        )];
    };
    let mut out = vec![ok("GitHub CLI", true, v.replace(" (", " ").split(' ').take(3).collect::<Vec<_>>().join(" "))];
    let status = Command::new("gh").args(["auth", "status", "--active"]).output();
    match status {
        Ok(s) if s.status.success() => {
            let text = format!("{}{}", String::from_utf8_lossy(&s.stdout), String::from_utf8_lossy(&s.stderr));
            let account = text
                .split("account ")
                .nth(1)
                .and_then(|r| r.split_whitespace().next())
                .unwrap_or("signed in")
                .to_string();
            if text.contains("Token scopes") && !text.contains("'repo'") {
                out.push(caveat(
                    "GitHub sign-in",
                    format!("Signed in as {account}, but without the repo scope: private repositories won't open."),
                    "gh auth refresh -s repo",
                ));
            } else {
                out.push(ok("GitHub sign-in", true, format!("Signed in as {account}")));
            }
        }
        _ => out.push(problem("GitHub sign-in", true, "gh is not signed in.", "gh auth login")),
    }
    out
}

fn check_network() -> Check {
    match Command::new("gh").args(["api", "rate_limit", "--jq", ".rate.remaining"]).output() {
        Ok(o) if o.status.success() => ok(
            "GitHub reachable",
            true,
            format!("{} API requests left this hour", String::from_utf8_lossy(&o.stdout).trim()),
        ),
        _ => problem(
            "GitHub reachable",
            true,
            "Couldn't reach the GitHub API.",
            "Check your network or proxy, then run: gh api rate_limit",
        ),
    }
}

fn check_home() -> Check {
    let home = grain_store::Home::locate();
    let probe = home.root.join(".write-test");
    match std::fs::write(&probe, b"ok") {
        Ok(()) => {
            let _ = std::fs::remove_file(&probe);
            let mb = grain_store::disk_usage(&home.root) as f64 / 1_048_576.0;
            ok(
                "Data folder",
                true,
                format!("{} is writable ({mb:.0} MB used; `grain clean` frees checkouts)", home.root.display()),
            )
        }
        Err(e) => problem(
            "Data folder",
            true,
            format!("Can't write to {}: {e}", home.root.display()),
            "Fix the folder's permissions, or set GRAIN_HOME to a writable folder",
        ),
    }
}

/// True when the process listening on `port` answers like a Grain server.
pub(crate) fn grain_is_listening(port: u16) -> bool {
    use std::io::{Read, Write};
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let Ok(mut stream) = std::net::TcpStream::connect_timeout(&addr, std::time::Duration::from_millis(500)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(std::time::Duration::from_millis(800)));
    let _ = stream.write_all(b"GET /api/settings HTTP/1.0\r\nHost: localhost\r\n\r\n");
    let mut body = String::new();
    let _ = stream.read_to_string(&mut body);
    body.contains("maxSummariesPerReview")
}

fn check_port(port: u16) -> Check {
    if TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], port))).is_ok() {
        return ok("Port", true, format!("{port} is free"));
    }
    if grain_is_listening(port) {
        return ok("Port", true, format!("Grain is already running at http://localhost:{port}"));
    }
    problem("Port", true, format!("{port} is used by another program."), format!("grain --port {}", port + 1))
}

fn check_agents() -> Vec<Check> {
    let installs: [(&'static str, &str, &str); 3] = [
        ("Claude Code", "claude", "npm install -g @anthropic-ai/claude-code, then run: claude"),
        ("Codex", "codex", "npm install -g @openai/codex, then run: codex login"),
        ("OpenCode", "opencode", "see https://opencode.ai/docs, then run: opencode auth login"),
    ];
    installs
        .into_iter()
        .map(|(name, bin, fix)| match version(bin) {
            Some(v) => ok(name, false, v),
            None => problem(name, false, "Not installed (optional, for AI summaries)", fix),
        })
        .collect()
}

/// Everything needed to start the app; fast and offline.
pub(crate) fn preflight() -> Vec<Check> {
    let os = Os::current();
    let mut checks = vec![check_git(os)];
    checks.extend(check_gh(os));
    checks.push(check_home());
    checks
}

/// The full report: preflight plus network, port and optional agents.
pub(crate) fn full(port: u16) -> Vec<Check> {
    let mut checks = preflight();
    if checks.iter().all(|c| c.status != Status::Missing) {
        checks.push(check_network());
    }
    checks.push(check_port(port));
    checks.extend(check_agents());
    checks
}

pub(crate) fn has_blockers(checks: &[Check]) -> bool {
    checks.iter().any(|c| c.status == Status::Missing)
}

/// Human-readable report; colours only when writing to a terminal.
pub(crate) fn render(checks: &[Check]) -> String {
    let color = std::io::stdout().is_terminal() && std::env::var_os("NO_COLOR").is_none();
    let paint = |code: &str, s: &str| if color { format!("\x1b[{code}m{s}\x1b[0m") } else { s.to_string() };
    let width = checks.iter().map(|c| c.name.len()).max().unwrap_or(0);
    let mut out = String::new();
    for (title, required) in [("Required", true), ("Optional: AI summaries", false)] {
        if !checks.iter().any(|c| c.required == required) {
            continue;
        }
        let _ = writeln!(out, "\n{}", paint("1", title));
        for c in checks.iter().filter(|c| c.required == required) {
            let mark = match c.status {
                Status::Ok => paint("32", "✓"),
                Status::Missing => paint("31", "✗"),
                Status::Warn => paint("33", "–"),
            };
            let _ = writeln!(out, "  {mark} {:<width$}  {}", c.name, c.detail);
            if let Some(fix) = &c.fix {
                let _ = writeln!(out, "    {:<width$}  {} {fix}", "", paint("2", "Fix:"));
            }
        }
    }
    let blockers = checks.iter().filter(|c| c.status == Status::Missing).count();
    out.push('\n');
    out.push_str(&if blockers == 0 {
        paint("32", "Everything Grain needs is ready.")
    } else {
        paint(
            "31",
            &format!("{blockers} {} to fix before Grain can run.", if blockers == 1 { "thing" } else { "things" }),
        )
    });
    out.push('\n');
    out
}
