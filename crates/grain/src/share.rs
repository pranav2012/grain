//! `grain share`: open Grain from the reviewer's other devices (a phone, a tablet, another
//! computer) through Tailscale. `tailscale serve` gives this computer an address that only devices
//! on the tailnet can reach and tells Grain who each request is from; Grain lets in only the login
//! that ran `grain share` (see grain-server's access check). Never Funnel: nothing is public.
//!
//! An existing Tailscale setup is left as it is: Grain takes a port nothing else is served on,
//! removes only its own handler when it stops, and never changes Tailscale's settings. Missing
//! pieces (installing Tailscale, signing in, connecting) are only done after the reviewer says yes.

use std::io::{BufRead, IsTerminal, Write};
use std::path::PathBuf;
use std::process::{Command, Output, Stdio};
use std::time::{Duration, Instant};

use anyhow::{Context, Result, bail};
use grain_store::{Home, Share};
use serde_json::Value;

/// Ports tried in order for Grain's address; the first one nothing is served on wins.
const HTTPS_PORTS: [u16; 4] = [443, 8443, 9443, 10000];
const HTTP_PORTS: [u16; 4] = [80, 8080, 8081, 10080];

const MAC_APP: &str = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";

/// The `tailscale` command: on the PATH, or inside the macOS app.
fn find_tailscale() -> Option<PathBuf> {
    let on_path = std::env::var_os("PATH")
        .into_iter()
        .flat_map(|p| std::env::split_paths(&p).collect::<Vec<_>>())
        .map(|dir| dir.join("tailscale"))
        .find(|p| p.is_file());
    on_path.or_else(|| PathBuf::from(MAC_APP).is_file().then(|| PathBuf::from(MAC_APP)))
}

/// Asks a yes/no question in the terminal; no terminal means no.
#[allow(clippy::print_stdout, reason = "the CLI's output")]
fn confirm(question: &str) -> bool {
    if !std::io::stdin().is_terminal() {
        return false;
    }
    print!("{question} [y/N] ");
    let _ = std::io::stdout().flush();
    let mut answer = String::new();
    std::io::stdin().lock().read_line(&mut answer).is_ok() && answer.trim().to_ascii_lowercase().starts_with('y')
}

/// Runs a command with the terminal attached, for installers and sign-in that print links or ask for a password.
fn interactive(program: &str, args: &[&str]) -> Result<()> {
    let status = Command::new(program).args(args).status().with_context(|| format!("run {program}"))?;
    if !status.success() {
        bail!("`{program} {}` didn't finish", args.join(" "));
    }
    Ok(())
}

fn on_path(program: &str) -> bool {
    Command::new(program).arg("--version").stdout(Stdio::null()).stderr(Stdio::null()).status().is_ok()
}

struct Tailscale(PathBuf);

impl Tailscale {
    fn output(&self, args: &[&str]) -> Result<Output> {
        Command::new(&self.0).args(args).output().context("run tailscale")
    }

    fn json(&self, args: &[&str]) -> Result<Value> {
        let out = self.output(args)?;
        // `status --json` exits non-zero while signed out but still prints the state.
        serde_json::from_slice(&out.stdout).map_err(|_| {
            anyhow::anyhow!("tailscale {}: {}", args.join(" "), String::from_utf8_lossy(&out.stderr).trim())
        })
    }

    /// Runs `tailscale serve …`; on Linux, offers once to let this user manage Tailscale if it's root-only.
    fn serve(&self, args: &[&str]) -> Result<()> {
        let mut full = vec!["serve"];
        full.extend_from_slice(args);
        let out = self.output(&full)?;
        if out.status.success() {
            return Ok(());
        }
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        if cfg!(target_os = "linux") && err.to_ascii_lowercase().contains("access denied") && self.allow_operator()? {
            let again = self.output(&full)?;
            if again.status.success() {
                return Ok(());
            }
            bail!("tailscale serve failed: {}", String::from_utf8_lossy(&again.stderr).trim());
        }
        bail!("tailscale serve failed: {err}")
    }

    /// `sudo tailscale set --operator=$USER`: lets this user run `tailscale serve`; networking is unchanged.
    #[allow(clippy::print_stdout, reason = "the CLI's output")]
    fn allow_operator(&self) -> Result<bool> {
        println!("On Linux, Tailscale only lets root share ports until you allow your user once.");
        if !confirm("Allow your user to manage Tailscale? (asks for your password; networking stays the same)") {
            bail!("Run `sudo tailscale set --operator=$USER`, then `grain share` again");
        }
        let user = std::env::var("USER").context("find your user name")?;
        let exe = self.0.display().to_string();
        interactive("sudo", &[&exe, "set", &format!("--operator={user}")])?;
        Ok(true)
    }

    /// Tailscale's state, starting its background service or app if it isn't running.
    #[allow(clippy::print_stdout, reason = "the CLI's output")]
    fn status(&self) -> Result<Value> {
        if let Ok(s) = self.json(&["status", "--json"]) {
            return Ok(s);
        }
        if cfg!(target_os = "macos") {
            println!("Opening the Tailscale app…");
            let _ = Command::new("open").args(["-a", "Tailscale"]).status();
        } else if cfg!(target_os = "linux") {
            if !confirm("Tailscale's background service isn't running. Start it? (asks for your password)") {
                bail!("Start it with `sudo systemctl enable --now tailscaled`, then run `grain share` again");
            }
            interactive("sudo", &["systemctl", "enable", "--now", "tailscaled"])?;
        }
        wait_for(Duration::from_secs(30), || self.json(&["status", "--json"]).ok()).context(
            "Tailscale isn't responding. Open the Tailscale app (or start tailscaled), then run `grain share` again",
        )
    }

    /// Waits until Tailscale is connected, signing in or reconnecting only after the reviewer agrees.
    #[allow(clippy::print_stdout, reason = "the CLI's output")]
    fn connected(&self) -> Result<Value> {
        let status = self.status()?;
        match status["BackendState"].as_str().unwrap_or_default() {
            "Running" => return Ok(status),
            "NeedsLogin" | "NoState" => {
                if !confirm("Tailscale is signed out on this computer. Sign in now? (opens your browser)") {
                    bail!("Sign in to Tailscale, then run `grain share` again");
                }
                if self.signed_in_with(&["login"]).is_err() && cfg!(target_os = "linux") && self.allow_operator()? {
                    self.signed_in_with(&["login"])?;
                }
            }
            "Stopped" => {
                if !confirm("Tailscale is turned off on this computer. Turn it on with its current settings?") {
                    bail!("Turn Tailscale on, then run `grain share` again");
                }
                // With no flags, `up` reconnects with the saved settings; if it refuses, nothing changed.
                if self.signed_in_with(&["up"]).is_err() {
                    bail!(
                        "Couldn't turn Tailscale on from here. Turn it on in the Tailscale app, then run `grain share` again"
                    );
                }
            }
            "NeedsMachineAuth" => bail!(
                "An admin of your tailnet has to approve this computer at https://login.tailscale.com/admin/machines"
            ),
            _ => {}
        }
        println!("Waiting for Tailscale to connect (finish any steps in the Tailscale window or your browser)…");
        wait_for(Duration::from_mins(3), || {
            self.json(&["status", "--json"]).ok().filter(|s| s["BackendState"] == "Running")
        })
        .context("Tailscale didn't connect. Check the Tailscale app, then run `grain share` again")
    }

    fn signed_in_with(&self, args: &[&str]) -> Result<()> {
        interactive(&self.0.display().to_string(), args)
    }

    /// Shields Up blocks every incoming connection, including the reviewer's own devices.
    fn shields_up(&self) -> bool {
        self.json(&["debug", "prefs"]).is_ok_and(|p| p["ShieldsUp"] == true)
    }
}

fn wait_for<T>(limit: Duration, mut check: impl FnMut() -> Option<T>) -> Option<T> {
    let start = Instant::now();
    while start.elapsed() < limit {
        if let Some(v) = check() {
            return Some(v);
        }
        std::thread::sleep(Duration::from_secs(1));
    }
    None
}

/// Finds Tailscale, offering to install it when it's missing.
#[allow(clippy::print_stdout, reason = "the CLI's output")]
fn tailscale() -> Result<Tailscale> {
    if let Some(p) = find_tailscale() {
        return Ok(Tailscale(p));
    }
    println!("grain share uses Tailscale, a free private network between your own devices.");
    if !confirm("Tailscale isn't installed. Install it now?") {
        bail!("Install Tailscale from https://tailscale.com/download, then run `grain share` again");
    }
    if cfg!(target_os = "macos") && on_path("brew") {
        interactive("brew", &["install", "--cask", "tailscale-app"])?;
        let _ = Command::new("open").args(["-a", "Tailscale"]).status();
        println!("In the Tailscale window, allow the VPN configuration and sign in.");
    } else if cfg!(target_os = "linux") && on_path("curl") {
        interactive("sh", &["-c", "curl -fsSL https://tailscale.com/install.sh | sh"])?;
    } else {
        let _ = open::that_detached("https://tailscale.com/download");
        bail!("Install Tailscale from the page that just opened, sign in, then run `grain share` again");
    }
    wait_for(Duration::from_secs(60), find_tailscale)
        .map(Tailscale)
        .context("Tailscale was installed but its command isn't available yet. Open the Tailscale app once, then run `grain share` again")
}

/// This computer's tailnet name and login, and whether the tailnet issues HTTPS certificates for it.
fn identity(status: &Value) -> Result<(String, String, bool)> {
    let host = status["Self"]["DNSName"].as_str().unwrap_or_default().trim_end_matches('.').to_string();
    // Tailscale relays by name, so devices must be able to look the name up.
    if host.is_empty() || status["CurrentTailnet"]["MagicDNSEnabled"] == false {
        bail!(
            "MagicDNS is off on your tailnet, so your other devices can't find this computer by name. Turn it on at https://login.tailscale.com/admin/dns, then run `grain share` again"
        );
    }
    let user = status["Self"]["UserID"].to_string();
    let login = status["User"][&user]["LoginName"].as_str().unwrap_or_default().to_string();
    if login.is_empty() {
        bail!("This computer is signed in with a tag, not a person's login, so Grain can't tell whom to let in");
    }
    let https = status["CertDomains"].as_array().is_some_and(|d| d.iter().any(|d| d == host.as_str()));
    Ok((host, login, https))
}

fn target(port: u16) -> String {
    format!("http://127.0.0.1:{port}")
}

fn listener(share: &Share) -> String {
    format!("--{}={}", if share.https { "https" } else { "http" }, share.port)
}

/// The proxy target of the root of `host:port`, and whether anything else is served on that port.
fn served(config: &Value, host: &str, port: u16) -> (Option<String>, bool) {
    let web = &config["Web"][format!("{host}:{port}")]["Handlers"];
    let root = web["/"]["Proxy"].as_str().map(|t| t.trim_end_matches('/').to_string());
    let others = web.as_object().is_some_and(|h| h.keys().any(|k| k != "/"))
        || config["Web"]
            .as_object()
            .is_some_and(|w| w.keys().any(|k| k.ends_with(&format!(":{port}")) && k != &format!("{host}:{port}")))
        || config["TCP"][port.to_string()]["TCPForward"].is_string();
    (root, others)
}

/// The first port with nothing served on it, or Grain's own from before.
fn free_port(config: &Value, host: &str, https: bool, grain: &str) -> Option<u16> {
    let ports = if https { HTTPS_PORTS } else { HTTP_PORTS };
    let busy = |p: u16| config["TCP"][p.to_string()].is_object();
    ports
        .into_iter()
        .find(|&p| matches!(served(config, host, p), (Some(t), false) if t == grain))
        .or_else(|| ports.into_iter().find(|&p| !busy(p)))
}

/// Shares Grain on the tailnet and returns how; replaces an earlier `grain share`.
#[allow(clippy::print_stdout, reason = "the CLI's output")]
pub(crate) fn start(home: &Home, port: u16) -> Result<Share> {
    let ts = tailscale()?;
    let status = ts.connected()?;
    let (host, login, https) = identity(&status)?;
    let grain = target(port);
    let config = ts.json(&["serve", "status", "--json"])?;
    if let Some(old) = home.load_share() {
        let (root, _) = served(&config, &old.host, old.port);
        if root.as_deref() == Some(grain.as_str()) && (old.host != host || old.https != https) {
            let _ = ts.serve(&[&listener(&old), "--set-path=/", "off"]);
        }
    }
    let Some(tail_port) = free_port(&config, &host, https, &grain) else {
        bail!(
            "Every port Grain can use on your tailnet is already serving something else; free one with `tailscale serve status`"
        )
    };
    let share = Share { host, login, https, port: tail_port };
    // Saved first, so Grain lets the owner in the moment Tailscale starts relaying.
    home.save_share(&share).context("save the sharing settings")?;
    if let Err(e) = ts.serve(&["--bg", &listener(&share), &grain]) {
        let _ = home.clear_share();
        return Err(e);
    }
    let after = ts.json(&["serve", "status", "--json"]).unwrap_or_default();
    if after["AllowFunnel"][format!("{}:{}", share.host, share.port)] == true {
        let _ = ts.serve(&[&listener(&share), "--set-path=/", "off"]);
        let _ = home.clear_share();
        bail!("Tailscale Funnel is on for that port, which would make Grain public; stopped sharing");
    }
    if ts.shields_up() {
        println!(
            "Note: Shields Up is on in Tailscale here, so your other devices can't connect until you turn it off in the Tailscale menu."
        );
    }
    Ok(share)
}

/// Stops sharing; Tailscale keeps everything that isn't Grain's.
pub(crate) fn stop(home: &Home, port: u16) -> Result<Option<Share>> {
    let Some(share) = home.load_share() else { return Ok(None) };
    if let Some(ts) = find_tailscale().map(Tailscale) {
        let config = ts.json(&["serve", "status", "--json"])?;
        if served(&config, &share.host, share.port).0.as_deref() == Some(target(port).as_str()) {
            ts.serve(&[&listener(&share), "--set-path=/", "off"])?;
        }
    }
    home.clear_share()?;
    Ok(Some(share))
}

/// The saved share, if Tailscale is still relaying it to Grain's port.
pub(crate) fn active(home: &Home, port: u16) -> Option<Share> {
    let share = home.load_share()?;
    let config = Tailscale(find_tailscale()?).json(&["serve", "status", "--json"]).ok()?;
    (served(&config, &share.host, share.port).0.as_deref() == Some(target(port).as_str())).then_some(share)
}

/// A QR code of `url` drawn with block characters, to scan with a phone.
pub(crate) fn qr(url: &str) -> Option<String> {
    let code = qrcode::QrCode::new(url).ok()?;
    Some(
        code.render::<qrcode::render::unicode::Dense1x2>()
            .dark_color(qrcode::render::unicode::Dense1x2::Light)
            .light_color(qrcode::render::unicode::Dense1x2::Dark)
            .build(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const HOST: &str = "mac.tail1.ts.net";

    #[test]
    fn takes_443_when_nothing_is_served() {
        assert_eq!(free_port(&json!({}), HOST, true, "http://127.0.0.1:7420"), Some(443));
    }

    #[test]
    fn leaves_ports_others_use_alone() {
        let config = json!({
            "TCP": { "443": { "HTTPS": true }, "8443": { "TCPForward": "127.0.0.1:22" } },
            "Web": { "mac.tail1.ts.net:443": { "Handlers": { "/": { "Proxy": "http://127.0.0.1:3000" } } } }
        });
        assert_eq!(free_port(&config, HOST, true, "http://127.0.0.1:7420"), Some(9443));
    }

    #[test]
    fn keeps_its_own_port() {
        let config = json!({
            "TCP": { "443": { "HTTPS": true }, "8443": { "HTTPS": true } },
            "Web": {
                "mac.tail1.ts.net:443": { "Handlers": { "/": { "Proxy": "http://127.0.0.1:3000" } } },
                "mac.tail1.ts.net:8443": { "Handlers": { "/": { "Proxy": "http://127.0.0.1:7420" } } }
            }
        });
        assert_eq!(free_port(&config, HOST, true, "http://127.0.0.1:7420"), Some(8443));
    }

    #[test]
    fn a_port_shared_with_other_paths_is_not_grains() {
        let config = json!({
            "TCP": { "443": { "HTTPS": true } },
            "Web": { "mac.tail1.ts.net:443": { "Handlers": {
                "/": { "Proxy": "http://127.0.0.1:7420" },
                "/theirs": { "Proxy": "http://127.0.0.1:3000" }
            } } }
        });
        assert_eq!(free_port(&config, HOST, true, "http://127.0.0.1:7420"), Some(8443));
    }

    fn status(magic_dns: bool, certs: &[&str], login: &str) -> Value {
        json!({
            "BackendState": "Running",
            "CurrentTailnet": { "MagicDNSEnabled": magic_dns },
            "Self": { "DNSName": "mac.tail1.ts.net.", "UserID": 42 },
            "User": { "42": { "LoginName": login } },
            "CertDomains": certs,
        })
    }

    #[test]
    fn reads_name_login_and_https() {
        let (host, login, https) =
            identity(&status(true, &["mac.tail1.ts.net"], "me@example.com")).expect("a full status");
        assert_eq!((host.as_str(), login.as_str(), https), ("mac.tail1.ts.net", "me@example.com", true));
        assert!(!identity(&status(true, &[], "me@example.com")).expect("a full status").2);
    }

    #[test]
    fn needs_magic_dns_and_a_person() {
        assert!(identity(&status(false, &[], "me@example.com")).is_err());
        assert!(identity(&status(true, &[], "")).is_err());
    }

    #[test]
    fn plain_http_uses_http_ports() {
        assert_eq!(free_port(&json!({ "TCP": { "80": {} } }), HOST, false, "x"), Some(8080));
    }
}
