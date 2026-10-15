//! `grain`: local-first semantic code review.

mod daemon;
mod doctor;

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
enum Command {
    /// Run the server in this terminal, logging here (`grain` runs it in the background).
    Serve,
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
        Some(Command::Serve) => return serve(cli.port).await,
        Some(Command::Stop) => {
            if !doctor::grain_is_listening(cli.port) {
                println!("Grain isn't running on port {}.", cli.port);
            } else if doctor::replace_running(cli.port) {
                println!("Stopped Grain. Your review progress is saved.");
            } else {
                println!("Grain on port {} didn't stop. See `grain logs`.", cli.port);
                std::process::exit(1);
            }
            return Ok(());
        }
        Some(Command::Logs { follow }) => return daemon::print_logs(follow),
        Some(Command::Status) => {
            match doctor::running_build(cli.port) {
                Some(build) => println!("Grain {build} is running at http://localhost:{}", cli.port),
                None if doctor::grain_is_listening(cli.port) => {
                    println!("An older Grain is running at http://localhost:{}", cli.port);
                }
                None => println!("Grain isn't running. Start it with `grain`."),
            }
            println!("Log: {}", daemon::log_path().display());
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
    // Grain is already running: hand it the review if it's this same build; replace an older
    // build so its outdated server never serves this build's UI.
    let build = build_id();
    if doctor::grain_is_listening(cli.port) {
        if doctor::running_build(cli.port).as_deref() == Some(build.as_str()) {
            let url = format!("http://localhost:{}{path}", cli.port);
            println!("Grain is already running at {url}");
            if !cli.no_open {
                let _ = open::that_detached(&url);
            }
            return Ok(());
        }
        println!("Replacing the older Grain running on port {}…", cli.port);
        if !doctor::replace_running(cli.port) {
            println!(
                "An older Grain is still running on port {} and can't be stopped from here. Stop it (Ctrl+C in its terminal), then run grain again.",
                cli.port
            );
            std::process::exit(1);
        }
    }
    daemon::start(cli.port)?;
    let url = format!("http://localhost:{}{path}", cli.port);
    println!("Grain is running at {url}  (stop it with `grain stop`, logs: `grain logs`)");
    if !cli.no_open {
        let _ = open::that_detached(&url);
    }
    Ok(())
}

/// Runs the server in this process until it's asked to stop.
#[allow(clippy::print_stdout, reason = "the CLI's output")]
async fn serve(port: u16) -> Result<()> {
    use std::io::IsTerminal;
    tracing_subscriber::fmt()
        .with_ansi(std::io::stdout().is_terminal())
        .with_env_filter(std::env::var("GRAIN_LOG").unwrap_or_else(|_| "info".into()))
        .init();
    // GRAIN_UI_DIR serves a UI folder from disk instead of the embedded one (UI development).
    let ui_dir = std::env::var_os("GRAIN_UI_DIR").map(PathBuf::from);
    let opts = grain_server::Options { port, ui_dir, build: build_id() };
    grain_server::serve(opts, |base| println!("Grain is running at {base}")).await
}
