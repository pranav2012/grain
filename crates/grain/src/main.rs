//! `grain`: local-first semantic code review.

mod daemon;
mod doctor;
mod domain;
mod service;
mod share;

use std::path::PathBuf;

use anyhow::Result;
use clap::{Parser, Subcommand};
use grain_github::PrRef;

#[derive(Parser)]
#[command(name = "grain", version, about = "Review pull requests as small, connected blocks")]
struct Cli {
    #[command(subcommand)]
    command: Option<Command>,

    /// What to review: a GitHub PR link, owner/repo#123, owner/repo/123, or a folder (`.`) to
    /// self-review your branch and uncommitted changes.
    pr: Option<String>,

    /// Port for the local server.
    #[arg(long, env = "GRAIN_PORT", default_value_t = 7420, global = true)]
    port: u16,

    /// Don't open the browser.
    #[arg(long)]
    no_open: bool,
}

#[derive(Subcommand)]
enum ServiceAction {
    /// Register with the OS (macOS launchd, Linux systemd) so opening a Grain tab starts Grain.
    Install,
    /// Stop starting on demand.
    Uninstall,
}

#[derive(Subcommand)]
enum Command {
    /// Run the server in this terminal, logging here (`grain` runs it in the background).
    Serve {
        /// Started on demand by the OS, which passes the listening socket as standard input.
        #[arg(long, hide = true)]
        activated: bool,
    },
    /// Start Grain on demand: the OS listens on the port and starts Grain when a page opens.
    Service {
        #[command(subcommand)]
        action: ServiceAction,
    },
    /// Open Grain at grain.localhost, without a port (asks for your password once).
    Domain {
        /// Go back to grain.localhost with Grain's port.
        #[arg(long)]
        remove: bool,
    },
    /// Open Grain from your phone, tablet or other computers through Tailscale (only your login gets in).
    Share {
        /// Stop sharing.
        #[arg(long)]
        stop: bool,
    },
    /// Hands connections on the port-80 socket the OS passes in to Grain's port (`grain domain`).
    #[command(hide = true)]
    Forward {
        #[arg(long)]
        to: u16,
    },
    /// Stop the Grain running in the background.
    Stop,
    /// Show the background server's log.
    Logs {
        /// Keep showing new lines.
        #[arg(long, short)]
        follow: bool,
    },
    /// Whether Grain is running, and where.
    Status,
    /// Remove checkouts of merged or closed PRs and of PRs not opened for 14 days.
    Clean {
        /// Remove every checkout and every Grain clone (review notes and settings are kept).
        #[arg(long)]
        all: bool,
    },
    /// Check that everything Grain needs is installed and signed in.
    Doctor {
        /// Print the checks as JSON.
        #[arg(long)]
        json: bool,
    },
    /// Print the engine's grouping for a git range in a checkout of `head`.
    Analyze {
        repo: PathBuf,
        base: String,
        head: String,
        /// Print the full review as JSON.
        #[arg(long)]
        json: bool,
        /// Only read the changed files (skips whole-repo facts).
        #[arg(long)]
        fast: bool,
        /// Use TypeScript 7 for TS/JS outside usage (downloaded once if missing).
        #[arg(long, conflicts_with = "fast")]
        typescript: bool,
    },
}

/// Identifies this exact binary: the version plus when the executable was built.
fn build_id() -> String {
    let built = std::env::current_exe()
        .and_then(|p| p.metadata())
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_secs());
    format!("{}+{built}", env!("CARGO_PKG_VERSION"))
}

#[tokio::main]
#[allow(clippy::print_stdout, reason = "the CLI's output")]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Some(Command::Serve { activated }) => return serve(cli.port, activated).await,
        Some(Command::Forward { to }) => return domain::forward(to).await,
        Some(Command::Domain { remove }) => {
            if remove {
                domain::remove()?;
                println!("Removed. Grain is at {} again.", domain::url(cli.port));
            } else {
                println!("Grain will answer at http://grain.localhost (port 80 on this computer only).");
                println!("This needs your password once to add a small system service that runs as you.");
                domain::install(&std::env::current_exe()?, cli.port, &daemon::log_path())?;
                println!("Done: http://grain.localhost opens Grain. Undo with `grain domain --remove`.");
            }
            return Ok(());
        }
        Some(Command::Share { stop }) => {
            let home = grain_store::Home::locate();
            if stop {
                match share::stop(&home, cli.port)? {
                    Some(s) => println!("Stopped sharing {}.", s.url()),
                    None => println!("Grain isn't shared."),
                }
                return Ok(());
            }
            ensure_running(cli.port, &build_id())?;
            let s = share::start(&home, cli.port)?;
            let url = s.url();
            println!("Grain is shared at {url}\n");
            if let Some(code) = share::qr(&url) {
                println!("{code}");
            }
            println!(
                "On your phone or tablet: install Tailscale, sign in as {}, then scan the code or open the link.",
                s.login
            );
            println!("Only that login gets in; anyone else on your tailnet gets a 403.");
            if !s.https {
                println!(
                    "This is http: Tailscale still encrypts the traffic between your devices. For https, turn on HTTPS Certificates at https://login.tailscale.com/admin/dns and run `grain share` again."
                );
            }
            println!("Stop with `grain share --stop`.");
            return Ok(());
        }
        Some(Command::Service { action }) => {
            match action {
                ServiceAction::Install => {
                    service::install(&std::env::current_exe()?, cli.port, &daemon::log_path())?;
                    println!("Grain now starts by itself when you open {}.", domain::url(cli.port));
                }
                ServiceAction::Uninstall => {
                    service::uninstall(cli.port)?;
                    println!("Removed. Run `grain` to start Grain from now on.");
                }
            }
            return Ok(());
        }
        Some(Command::Stop) => {
            let asleep = service::installed(cli.port).is_some() && !service::is_running(cli.port);
            if asleep || !doctor::grain_is_listening(cli.port) {
                println!("Grain isn't running on port {}.", cli.port);
            } else if if service::installed(cli.port).is_some() {
                stop_activated(cli.port)
            } else {
                doctor::replace_running(cli.port)
            } {
                println!("Stopped Grain. Your review progress is saved.");
            } else {
                println!("Grain on port {} didn't stop. See `grain logs`.", cli.port);
                std::process::exit(1);
            }
            return Ok(());
        }
        Some(Command::Logs { follow }) => return daemon::print_logs(follow),
        Some(Command::Status) => {
            let asleep = service::installed(cli.port).is_some() && !service::is_running(cli.port);
            match if asleep { None } else { doctor::running_build(cli.port) } {
                Some(build) => println!("Grain {build} is running at {}", domain::url(cli.port)),
                None if !asleep && doctor::grain_is_listening(cli.port) => {
                    println!("An older Grain is running at {}", domain::url(cli.port));
                }
                None if asleep => println!("Grain is stopped; it starts when you open {}", domain::url(cli.port)),
                None => println!("Grain isn't running. Start it with `grain`."),
            }
            println!("Log: {}", daemon::log_path().display());
            match service::installed(cli.port) {
                Some(f) => println!("Starts on demand ({}); undo with `grain service uninstall`.", f.display()),
                None => println!("Doesn't start on demand; `grain service install` turns that on."),
            }
            if let Some(s) = share::active(&grain_store::Home::locate(), cli.port) {
                println!("Shared at {} with {}; stop with `grain share --stop`.", s.url(), s.login);
            }
            return Ok(());
        }
        Some(Command::Analyze { repo, base, head, json, fast, typescript }) => {
            let depth = if fast { grain_engine::Depth::Fast } else { grain_engine::Depth::Complete };
            let usage = if typescript {
                let tsc = grain_lsp::typescript::ensure(&grain_store::Home::locate().cache_dir())?;
                Some(grain_lsp::TsUsage::start(&tsc, &repo)?)
            } else {
                None
            };
            let usage = usage.as_ref().map(|u| u as &dyn grain_engine::UsageProvider);
            let analysis = grain_engine::analyze_with_usage(&repo, &base, &head, depth, usage)?;
            let out = if json { serde_json::to_string_pretty(&analysis.review)? } else { analysis.summary };
            println!("{out}");
            return Ok(());
        }
        Some(Command::Clean { all }) => {
            let r = grain_server::clean(all);
            println!(
                "Removed {} checkouts ({} merged or closed, {} unused for 14 days) and {} unused clones; freed {:.1} MB.",
                r.checkouts_removed,
                r.closed_prs,
                r.idle_checkouts,
                r.clones_removed,
                r.bytes_freed as f64 / 1_048_576.0
            );
            return Ok(());
        }
        Some(Command::Doctor { json }) => {
            let checks = doctor::full(cli.port);
            if json {
                println!("{}", serde_json::to_string_pretty(&checks)?);
            } else {
                print!("{}", doctor::render(&checks));
            }
            std::process::exit(i32::from(doctor::has_blockers(&checks)));
        }
        None => {}
    }

    let checks = doctor::preflight();
    if doctor::has_blockers(&checks) {
        print!("{}", doctor::render(&checks));
        println!("Run `grain doctor` again after fixing these.");
        std::process::exit(1);
    }

    let open_pr = match cli.pr.as_deref() {
        Some(s) if std::path::Path::new(s).is_dir() => Some(grain_server::register_local(std::path::Path::new(s))?),
        Some(s) => Some(
            PrRef::parse(s)
                .ok_or_else(|| anyhow::anyhow!("'{s}' is not a pull request link, owner/repo#123 or a folder"))?,
        ),
        None => None,
    };
    let path = open_pr.as_ref().map(|p| format!("/?pr={}/{}", p.full_repo(), p.number)).unwrap_or_default();
    let url = format!("{}{path}", domain::url(cli.port));
    ensure_running(cli.port, &build_id())?;
    println!("Grain is running at {url}  (it stops by itself when unused; `grain stop`, `grain logs`)");
    if !cli.no_open {
        let _ = open::that_detached(&url);
    }
    Ok(())
}

/// Makes sure this build of Grain is the one running, starting it or replacing an older build.
#[allow(clippy::print_stdout, reason = "the CLI's output")]
fn ensure_running(port: u16, build: &str) -> Result<()> {
    if on_demand(port, build)? {
        return Ok(());
    }
    // Grain is already running: keep it if it's this same build; replace an older build so its
    // outdated server never serves this build's UI.
    let running = doctor::grain_is_listening(port);
    if running && doctor::running_build(port).as_deref() != Some(build) {
        println!("Replacing the older Grain running on port {port}…");
        if !doctor::replace_running(port) {
            println!(
                "An older Grain is still running on port {port} and can't be stopped from here. Stop it (Ctrl+C in its terminal), then run grain again."
            );
            std::process::exit(1);
        }
    }
    if !running || doctor::running_build(port).as_deref() != Some(build) {
        daemon::start(port)?;
    }
    Ok(())
}

/// Stops a Grain the OS started; the port stays with the OS, so this waits for the process to exit.
fn stop_activated(port: u16) -> bool {
    doctor::ask_to_stop(port)
        && (0..60).any(|_| {
            std::thread::sleep(std::time::Duration::from_millis(100));
            !service::is_running(port)
        })
}

/// Makes sure the OS starts this build of Grain on demand, then wakes it. False when on-demand start
/// isn't set up and can't or shouldn't be (Windows, or `GRAIN_NO_SERVICE`), so the caller starts Grain itself.
#[allow(clippy::print_stdout, reason = "the CLI's output")]
fn on_demand(port: u16, build: &str) -> Result<bool> {
    let first_time = service::installed(port).is_none();
    // Once the OS holds the port, Grain must go through it; GRAIN_NO_SERVICE only prevents setting it up.
    if first_time
        && (std::env::var_os("GRAIN_NO_SERVICE").is_some() || !cfg!(any(target_os = "macos", target_os = "linux")))
    {
        return Ok(false);
    }
    // A Grain started directly (not by the OS) holds the port; stop it so the OS can listen there.
    if !service::is_loaded(port) && doctor::grain_is_listening(port) && !doctor::replace_running(port) {
        return Ok(false);
    }
    let exe = std::env::current_exe()?;
    if let Err(e) = service::install(&exe, port, &daemon::log_path()) {
        println!("Couldn't set up on-demand start ({e:#}); starting Grain directly.");
        return Ok(false);
    }
    if first_time {
        println!("Grain now starts by itself when you open it (undo with `grain service uninstall`).");
    }
    // Connecting starts it; an older build still running is asked to stop so the next connection starts this one.
    let started = std::time::Instant::now();
    let mut asked = false;
    while started.elapsed() < std::time::Duration::from_secs(20) {
        match doctor::running_build(port) {
            Some(b) if b == build => return Ok(true),
            Some(_) if !asked => {
                doctor::ask_to_stop(port);
                asked = true;
            }
            _ => {}
        }
        std::thread::sleep(std::time::Duration::from_millis(150));
    }
    anyhow::bail!("Grain didn't start within 20 seconds. Last log lines:\n{}", daemon::tail(&daemon::log_path(), 15))
}

/// Runs the server in this process until it's asked to stop.
#[allow(clippy::print_stdout, reason = "the CLI's output")]
async fn serve(port: u16, activated: bool) -> Result<()> {
    use std::io::IsTerminal;
    // When the OS starts Grain, standard output may be the socket itself: log to standard error only.
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_ansi(std::io::stderr().is_terminal())
        .with_env_filter(std::env::var("GRAIN_LOG").unwrap_or_else(|_| "info".into()))
        .init();
    let listener = if activated { Some(service::inherited_listener()?) } else { None };
    // GRAIN_UI_DIR serves a UI folder from disk instead of the embedded one (UI development).
    let ui_dir = std::env::var_os("GRAIN_UI_DIR").map(PathBuf::from);
    let opts = grain_server::Options { port, ui_dir, build: build_id(), listener };
    grain_server::serve(opts, |base| tracing::info!("Grain is running at {base}")).await
}
