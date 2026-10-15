use std::io::Read;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use anyhow::{Context, Result, bail};

/// Output of a finished command.
pub(crate) struct Output {
    pub(crate) stdout: String,
    pub(crate) stderr: String,
    pub(crate) success: bool,
}

/// Runs `cmd`, killing it after `limit`. Output is read on threads so a chatty tool can't block on a full pipe.
pub(crate) fn run(mut cmd: Command, limit: Duration) -> Result<Output> {
    let name = cmd.get_program().to_string_lossy().into_owned();
    let mut child = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null())
        .spawn()
        .with_context(|| format!("run {name}"))?;
    let read = |mut r: Box<dyn Read + Send>| {
        std::thread::spawn(move || {
            let mut s = String::new();
            let _ = r.read_to_string(&mut s);
            s
        })
    };
    let out = read(Box::new(child.stdout.take().context("no stdout")?));
    let err = read(Box::new(child.stderr.take().context("no stderr")?));
    let started = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break status;
        }
        if started.elapsed() > limit {
            let _ = child.kill();
            let _ = child.wait();
            bail!("{name} took longer than {} seconds and was stopped", limit.as_secs());
        }
        std::thread::sleep(Duration::from_millis(50));
    };
    Ok(Output {
        stdout: out.join().unwrap_or_default(),
        stderr: err.join().unwrap_or_default(),
        success: status.success(),
    })
}
