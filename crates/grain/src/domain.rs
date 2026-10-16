//! `http://grain.localhost` without a port. Port 80 needs root, so `grain domain` installs (once,
//! with sudo) a system service that listens on 127.0.0.1:80 and runs `grain forward` as the
//! reviewer. It hands each connection to Grain's own port, which still starts Grain on demand.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use anyhow::{Context, Result, bail};

/// A forwarder with no connections for this long exits; the OS starts it again on the next one.
const IDLE_EXIT: Duration = Duration::from_mins(10);

#[cfg(target_os = "macos")]
const LABEL: &str = "io.github.pranav2012.grain.domain";

#[cfg(target_os = "macos")]
fn unit_file() -> PathBuf {
    PathBuf::from(format!("/Library/LaunchDaemons/{LABEL}.plist"))
}

#[cfg(target_os = "linux")]
fn unit_file() -> PathBuf {
    PathBuf::from("/etc/systemd/system/grain-domain.socket")
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn unit_file() -> PathBuf {
    PathBuf::new()
}

/// The Grain port the port-80 forwarder sends to, when it's installed.
pub(crate) fn target() -> Option<u16> {
    #[cfg(target_os = "linux")]
    let file = unit_file().with_extension("service");
    #[cfg(not(target_os = "linux"))]
    let file = unit_file();
    let text = std::fs::read_to_string(file).ok()?;
    let (_, rest) = text.split_once("--to")?;
    rest.trim_start_matches(|c: char| !c.is_ascii_digit()).split(|c: char| !c.is_ascii_digit()).next()?.parse().ok()
}

/// Where Grain is reached in the browser: without a port once `grain domain` points port 80 at it.
pub(crate) fn url(port: u16) -> String {
    if target() == Some(port) { "http://grain.localhost".into() } else { grain_server::url(port) }
}

fn user() -> Result<String> {
    let out = Command::new("id").arg("-un").output().context("run id")?;
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

#[cfg(target_os = "macos")]
fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

/// Runs a shell script as root, asking for the password in this terminal.
fn sudo(script: &str) -> Result<()> {
    let status = Command::new("sudo").args(["/bin/sh", "-c", script]).status().context("run sudo")?;
    if !status.success() {
        bail!("the system change didn't go through");
    }
    Ok(())
}

/// Single-quotes a value for `/bin/sh`.
fn sh(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

/// The program listening on port 80, from `lsof`; it only sees the reviewer's own programs, as
/// other users' need root to list.
fn program_on_port_80() -> Option<String> {
    let out = Command::new("lsof").args(["-nP", "-iTCP:80", "-sTCP:LISTEN", "-Fpc"]).output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let pid = text.lines().find_map(|l| l.strip_prefix('p'))?;
    let name = text.lines().find_map(|l| l.strip_prefix('c'))?;
    Some(format!("{name} (pid {pid})"))
}

/// Who else is on port 80, if anyone. Grain's forwarder listens on IPv4 only, so once it's installed
/// only IPv6 is checked: browsers try `[::1]` first for `grain.localhost`, so a program there would win.
fn other_on_port_80() -> Option<String> {
    let v4 = std::net::SocketAddr::from(([127, 0, 0, 1], 80));
    let v6 = std::net::SocketAddr::from((std::net::Ipv6Addr::LOCALHOST, 80));
    let addrs: &[std::net::SocketAddr] = if target().is_some() { &[v6] } else { &[v4, v6] };
    addrs
        .iter()
        .any(|a| std::net::TcpStream::connect_timeout(a, Duration::from_millis(300)).is_ok())
        .then(|| program_on_port_80().unwrap_or_else(|| "another program".into()))
}

/// Installs (or points at a new port) the port-80 forwarder for `exe`.
pub(crate) fn install(exe: &Path, port: u16, log: &Path) -> Result<()> {
    if let Some(other) = other_on_port_80() {
        bail!(
            "{other} is already using port 80 on this computer, so grain.localhost can't drop the port. Stop it or move it to another port, then run `grain domain` again (`sudo lsof -iTCP:80 -sTCP:LISTEN` lists every program there)"
        );
    }
    let staged = std::env::temp_dir().join("grain-domain.unit");
    write_units(&staged, exe, port, log)?;
    sudo(&install_script(&staged))
}

#[cfg(target_os = "macos")]
fn write_units(staged: &Path, exe: &Path, port: u16, log: &Path) -> Result<()> {
    let plist = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>{LABEL}</string>
  <key>UserName</key><string>{user}</string>
  <key>ProgramArguments</key>
  <array><string>{exe}</string><string>forward</string><string>--to</string><string>{port}</string></array>
  <key>inetdCompatibility</key><dict><key>Wait</key><true/></dict>
  <key>Sockets</key>
  <dict><key>Listeners</key><dict>
    <key>SockNodeName</key><string>127.0.0.1</string>
    <key>SockServiceName</key><string>80</string>
    <key>SockFamily</key><string>IPv4</string>
  </dict></dict>
  <key>StandardErrorPath</key><string>{log}</string>
</dict>
</plist>
"#,
        user = xml_escape(&user()?),
        exe = xml_escape(&exe.display().to_string()),
        log = xml_escape(&log.display().to_string()),
    );
    std::fs::write(staged, plist)?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn install_script(staged: &Path) -> String {
    let file = unit_file().display().to_string();
    format!(
        "launchctl bootout system/{LABEL} 2>/dev/null; install -m 644 -o root -g wheel {staged} {file} && launchctl bootstrap system {file}",
        staged = sh(&staged.display().to_string()),
        file = sh(&file),
    )
}

#[cfg(target_os = "linux")]
fn write_units(staged: &Path, exe: &Path, port: u16, log: &Path) -> Result<()> {
    let socket = "[Unit]\nDescription=Grain at http://grain.localhost\n\n[Socket]\nListenStream=127.0.0.1:80\nAccept=no\n\n[Install]\nWantedBy=sockets.target\n";
    let service = format!(
        "[Unit]\nDescription=Grain at http://grain.localhost\n\n[Service]\nUser={}\nExecStart=\"{}\" forward --to {port}\nStandardInput=socket\nStandardError=append:{}\n",
        user()?,
        exe.display(),
        log.display()
    );
    std::fs::write(staged, socket)?;
    std::fs::write(staged.with_extension("service"), service)?;
    Ok(())
}

#[cfg(target_os = "linux")]
fn install_script(staged: &Path) -> String {
    let file = unit_file().display().to_string();
    let service = unit_file().with_extension("service").display().to_string();
    format!(
        "install -m 644 {s} {file} && install -m 644 {ss} {service} && systemctl daemon-reload && systemctl enable grain-domain.socket && systemctl restart grain-domain.socket",
        s = sh(&staged.display().to_string()),
        ss = sh(&staged.with_extension("service").display().to_string()),
        file = sh(&file),
        service = sh(&service),
    )
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn write_units(_staged: &Path, _exe: &Path, _port: u16, _log: &Path) -> Result<()> {
    bail!("http://grain.localhost without a port isn't supported on this system")
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn install_script(_staged: &Path) -> String {
    String::new()
}

/// Removes the port-80 forwarder.
pub(crate) fn remove() -> Result<()> {
    if target().is_none() {
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    let script =
        format!("launchctl bootout system/{LABEL} 2>/dev/null; rm -f {}", sh(&unit_file().display().to_string()));
    #[cfg(target_os = "linux")]
    let script = format!(
        "systemctl disable --now grain-domain.socket grain-domain.service 2>/dev/null; rm -f {} {}; systemctl daemon-reload",
        sh(&unit_file().display().to_string()),
        sh(&unit_file().with_extension("service").display().to_string())
    );
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    let script = String::new();
    sudo(&script)
}

/// The installed forwarder runs this binary; false when it's gone (e.g. moved or uninstalled).
pub(crate) fn forwarder_exe_exists() -> bool {
    #[cfg(target_os = "linux")]
    let file = unit_file().with_extension("service");
    #[cfg(not(target_os = "linux"))]
    let file = unit_file();
    let Ok(text) = std::fs::read_to_string(file) else { return true };
    let exe = text
        .split_once("<array><string>")
        .and_then(|(_, r)| r.split_once("</string>"))
        .map(|(e, _)| e.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">"))
        .or_else(|| text.split_once("ExecStart=\"").and_then(|(_, r)| r.split_once('"')).map(|(e, _)| e.to_string()));
    exe.is_none_or(|e| Path::new(&e).exists())
}

/// `grain forward`: accepts connections on the socket the OS passes in and pipes each to Grain's port.
pub(crate) async fn forward(to: u16) -> Result<()> {
    let listener = tokio::net::TcpListener::from_std({
        let l = crate::service::inherited_listener()?;
        l.set_nonblocking(true)?;
        l
    })?;
    let open = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    loop {
        let accepted = tokio::time::timeout(IDLE_EXIT, listener.accept()).await;
        let Ok(accepted) = accepted else {
            if open.load(std::sync::atomic::Ordering::Relaxed) == 0 {
                return Ok(());
            }
            continue;
        };
        let (mut inbound, _) = accepted?;
        let open = open.clone();
        tokio::spawn(async move {
            open.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            if let Ok(mut outbound) = tokio::net::TcpStream::connect(("127.0.0.1", to)).await {
                let _ = tokio::io::copy_bidirectional(&mut inbound, &mut outbound).await;
            }
            open.fetch_sub(1, std::sync::atomic::Ordering::Relaxed);
        });
    }
}

#[cfg(test)]
mod tests {
    use super::sh;

    #[test]
    fn quotes_for_the_shell() {
        assert_eq!(sh("/a b/it's"), r"'/a b/it'\''s'");
    }
}
