//! Starting Grain on demand: the OS (launchd on macOS, systemd on Linux) listens on Grain's port
//! and starts `grain serve --activated` when a page connects, handing it the listening socket. A
//! stopped Grain costs nothing, and opening or refreshing a Grain tab brings it back.

use std::fmt::Write as _;
use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{Context, Result, bail};

/// One registration per port, so a second Grain on another port doesn't replace the first.
fn label(port: u16) -> String {
    format!("io.github.pranav2012.grain.{port}")
}

/// Environment the started server needs: the reviewer's PATH (git, gh, node, agent CLIs) and data folder.
fn environment() -> Vec<(String, String)> {
    ["PATH", "GRAIN_HOME", "GRAIN_LOG"]
        .iter()
        .filter_map(|k| std::env::var(k).ok().map(|v| ((*k).to_string(), v)))
        .collect()
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

/// Takes the socket the OS passes as standard input (launchd `inetdCompatibility`, systemd `StandardInput=socket`).
#[cfg(unix)]
pub(crate) fn inherited_listener() -> Result<std::net::TcpListener> {
    use std::os::fd::AsFd;
    let fd = std::io::stdin().as_fd().try_clone_to_owned().context("no socket on standard input")?;
    let listener = std::net::TcpListener::from(fd);
    listener.local_addr().context("standard input isn't a listening socket")?;
    Ok(listener)
}

#[cfg(not(unix))]
pub(crate) fn inherited_listener() -> Result<std::net::TcpListener> {
    bail!("starting on demand isn't supported on this system")
}

/// What's registered for a port, if anything.
pub(crate) fn installed(port: u16) -> Option<PathBuf> {
    let f = unit_file(port)?;
    f.is_file().then_some(f)
}

#[cfg(target_os = "macos")]
fn unit_file(port: u16) -> Option<PathBuf> {
    Some(dirs::home_dir()?.join("Library/LaunchAgents").join(format!("{}.plist", label(port))))
}

#[cfg(target_os = "linux")]
fn unit_file(port: u16) -> Option<PathBuf> {
    Some(dirs::config_dir()?.join("systemd/user").join(format!("grain-{port}.socket")))
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn unit_file(_port: u16) -> Option<PathBuf> {
    None
}

fn run(cmd: &mut Command) -> Result<()> {
    let out = cmd.output().with_context(|| format!("run {}", cmd.get_program().display()))?;
    if !out.status.success() {
        bail!("{}", String::from_utf8_lossy(&out.stderr).trim());
    }
    Ok(())
}

/// Registers (or refreshes) on-demand start for `exe` on `port`. Returns false when nothing changed.
#[cfg(target_os = "macos")]
pub(crate) fn install(exe: &Path, port: u16, log: &Path) -> Result<bool> {
    let file = unit_file(port).context("no home folder")?;
    let env = environment().iter().fold(String::new(), |mut out, (k, v)| {
        let _ = write!(out, "\n    <key>{k}</key><string>{}</string>", xml_escape(v));
        out
    });
    let log = xml_escape(&log.display().to_string());
    let plist = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>{label}</string>
  <key>ProgramArguments</key>
  <array><string>{exe}</string><string>serve</string><string>--activated</string><string>--port</string><string>{port}</string></array>
  <key>inetdCompatibility</key><dict><key>Wait</key><true/></dict>
  <key>Sockets</key>
  <dict><key>Listeners</key><dict>
    <key>SockNodeName</key><string>127.0.0.1</string>
    <key>SockServiceName</key><string>{port}</string>
    <key>SockFamily</key><string>IPv4</string>
  </dict></dict>
  <key>EnvironmentVariables</key>
  <dict>{env}
  </dict>
  <key>StandardErrorPath</key><string>{log}</string>
</dict>
</plist>
"#,
        label = label(port),
        exe = xml_escape(&exe.display().to_string()),
    );
    if std::fs::read_to_string(&file).is_ok_and(|old| old == plist) {
        return Ok(false);
    }
    std::fs::create_dir_all(file.parent().context("LaunchAgents folder")?)?;
    let domain = format!("gui/{}", uid()?);
    let _ = Command::new("launchctl").args(["bootout", &format!("{domain}/{}", label(port))]).output();
    std::fs::write(&file, plist)?;
    run(Command::new("launchctl").args(["bootstrap", &domain]).arg(&file))?;
    Ok(true)
}

/// Whether the OS has Grain running right now (asking doesn't start it, unlike connecting).
#[cfg(target_os = "macos")]
pub(crate) fn is_running(port: u16) -> bool {
    let Ok(uid) = uid() else { return false };
    Command::new("launchctl")
        .args(["print", &format!("gui/{uid}/{}", label(port))])
        .output()
        .is_ok_and(|o| String::from_utf8_lossy(&o.stdout).lines().any(|l| l.trim() == "state = running"))
}

#[cfg(target_os = "linux")]
pub(crate) fn is_running(port: u16) -> bool {
    Command::new("systemctl")
        .args(["--user", "is-active", "--quiet", &format!("grain-{port}.service")])
        .status()
        .is_ok_and(|s| s.success())
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub(crate) fn is_running(_port: u16) -> bool {
    false
}

#[cfg(target_os = "macos")]
fn uid() -> Result<String> {
    let out = Command::new("id").arg("-u").output()?;
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

#[cfg(target_os = "macos")]
pub(crate) fn uninstall(port: u16) -> Result<()> {
    let file = unit_file(port).context("no home folder")?;
    let _ = Command::new("launchctl").args(["bootout", &format!("gui/{}/{}", uid()?, label(port))]).output();
    if file.exists() {
        std::fs::remove_file(file)?;
    }
    Ok(())
}

#[cfg(target_os = "linux")]
pub(crate) fn install(exe: &Path, port: u16, log: &Path) -> Result<bool> {
    let socket_file = unit_file(port).context("no config folder")?;
    let service_file = socket_file.with_extension("service");
    let env = environment().iter().fold(String::new(), |mut out, (k, v)| {
        let _ = writeln!(out, "Environment=\"{k}={}\"", v.replace('"', "\\\""));
        out
    });
    let socket = format!(
        "[Unit]\nDescription=Grain on port {port}\n\n[Socket]\nListenStream=127.0.0.1:{port}\nAccept=no\n\n[Install]\nWantedBy=sockets.target\n"
    );
    let service = format!(
        "[Unit]\nDescription=Grain code review\n\n[Service]\nExecStart=\"{}\" serve --activated --port {port}\nStandardInput=socket\nStandardOutput=append:{}\nStandardError=append:{}\n{env}",
        exe.display(),
        log.display(),
        log.display()
    );
    if std::fs::read_to_string(&socket_file).is_ok_and(|s| s == socket)
        && std::fs::read_to_string(&service_file).is_ok_and(|s| s == service)
    {
        return Ok(false);
    }
    std::fs::create_dir_all(socket_file.parent().context("systemd user folder")?)?;
    std::fs::write(&socket_file, socket)?;
    std::fs::write(&service_file, service)?;
    let name = format!("grain-{port}.socket");
    run(Command::new("systemctl").args(["--user", "daemon-reload"]))?;
    run(Command::new("systemctl").args(["--user", "enable", "--now", &name]))?;
    let _ = Command::new("systemctl").args(["--user", "restart", &name]).output();
    Ok(true)
}

#[cfg(target_os = "linux")]
pub(crate) fn uninstall(port: u16) -> Result<()> {
    let socket_file = unit_file(port).context("no config folder")?;
    let _ = Command::new("systemctl").args(["--user", "disable", "--now", &format!("grain-{port}.socket")]).output();
    let _ = std::fs::remove_file(socket_file.with_extension("service"));
    if socket_file.exists() {
        std::fs::remove_file(&socket_file)?;
    }
    let _ = Command::new("systemctl").args(["--user", "daemon-reload"]).output();
    Ok(())
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub(crate) fn install(_exe: &Path, _port: u16, _log: &Path) -> Result<bool> {
    bail!("starting on demand isn't supported on this system")
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub(crate) fn uninstall(_port: u16) -> Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_are_per_port() {
        assert_ne!(label(7420), label(7421));
        assert_eq!(xml_escape("a&b<c>"), "a&amp;b&lt;c&gt;");
    }
}
