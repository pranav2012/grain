//! Running the server in the background, so `grain` opens the browser and gives the terminal back.

use std::fs::OpenOptions;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use anyhow::{Context, Result, bail};

use crate::doctor;

/// Logs are kept to about this size; the previous log is kept as `grain.log.1`.
const LOG_LIMIT: u64 = 5 * 1024 * 1024;

pub(crate) fn log_path() -> PathBuf {
    grain_store::Home::locate().root.join("logs").join("grain.log")
}

/// Starts `grain serve` detached from this terminal, logging to [`log_path`], and waits until it answers.
pub(crate) fn start(port: u16) -> Result<()> {
    let log = log_path();
    std::fs::create_dir_all(log.parent().context("log folder")?)?;
    if log.metadata().is_ok_and(|m| m.len() > LOG_LIMIT) {
        let _ = std::fs::rename(&log, log.with_extension("log.1"));
    }
    let out = OpenOptions::new().create(true).append(true).open(&log)?;
    let mut cmd = Command::new(std::env::current_exe()?);
    cmd.args(["serve", "--port", &port.to_string()]).stdin(Stdio::null()).stdout(out.try_clone()?).stderr(out);
    detach(&mut cmd);
    let mut child = cmd.spawn().context("start Grain in the background")?;
    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(20) {
        if doctor::grain_is_listening(port) {
            return Ok(());
        }
        if let Some(status) = child.try_wait()? {
            bail!("Grain stopped while starting ({status}). Last log lines:\n{}", tail(&log, 15));
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    bail!("Grain didn't start within 20 seconds. Last log lines:\n{}", tail(&log, 15))
}

/// A new process group, so Ctrl+C or closing the terminal doesn't stop the server.
#[cfg(unix)]
fn detach(cmd: &mut Command) {
    use std::os::unix::process::CommandExt;
    cmd.process_group(0);
}

#[cfg(windows)]
fn detach(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    const DETACHED_PROCESS: u32 = 0x0000_0008;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    cmd.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
}

/// The last `n` lines of a file (reads at most its last 64 KB).
pub(crate) fn tail(path: &PathBuf, n: usize) -> String {
    let Ok(mut f) = std::fs::File::open(path) else { return String::new() };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    let _ = f.seek(SeekFrom::Start(len.saturating_sub(64 * 1024)));
    let mut s = String::new();
    let _ = f.read_to_string(&mut s);
    let lines: Vec<&str> = s.lines().collect();
    lines[lines.len().saturating_sub(n)..].join("\n")
}

/// Prints the log; with `follow`, keeps printing new lines until interrupted.
#[allow(clippy::print_stdout, reason = "the CLI's output")]
pub(crate) fn print_logs(follow: bool) -> Result<()> {
    let path = log_path();
    println!("{}", tail(&path, 200));
    if !follow {
        return Ok(());
    }
    let mut pos = path.metadata().map(|m| m.len()).unwrap_or(0);
    loop {
        std::thread::sleep(Duration::from_millis(500));
        let len = path.metadata().map(|m| m.len()).unwrap_or(0);
        if len < pos {
            pos = 0;
        }
        if len > pos {
            let mut f = std::fs::File::open(&path)?;
            f.seek(SeekFrom::Start(pos))?;
            let mut s = String::new();
            f.read_to_string(&mut s)?;
            print!("{s}");
            pos = len;
        }
    }
}
