//! `grain`: local-first semantic code review.

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

    /// Pull request to open: a GitHub link, owner/repo#123 or owner/repo/123.
    pr: Option<String>,

    /// Port for the local server.
    #[arg(long, env = "GRAIN_PORT", default_value_t = 7420)]
    port: u16,

    /// Don't open the browser.
    #[arg(long)]
    no_open: bool,
}

#[derive(Subcommand)]
enum Command {
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
    },
}

#[tokio::main]
#[allow(clippy::print_stdout, reason = "the CLI's output")]
async fn main() -> Result<()> {
    tracing_subscriber::fmt().with_env_filter(std::env::var("GRAIN_LOG").unwrap_or_else(|_| "info".into())).init();
    let cli = Cli::parse();
    match cli.command {
        Some(Command::Analyze { repo, base, head, json, fast }) => {
            let depth = if fast { grain_engine::Depth::Fast } else { grain_engine::Depth::Complete };
            let analysis = grain_engine::analyze_with(&repo, &base, &head, depth)?;
            let out = if json { serde_json::to_string_pretty(&analysis.review)? } else { analysis.summary };
            println!("{out}");
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
        Some(s) => {
            Some(PrRef::parse(s).ok_or_else(|| anyhow::anyhow!("'{s}' is not a pull request link or owner/repo#123"))?)
        }
        None => None,
    };
    let path = open_pr.as_ref().map(|p| format!("/?pr={}/{}", p.full_repo(), p.number)).unwrap_or_default();
    // GRAIN_UI_DIR serves a UI folder from disk instead of the embedded one (UI development).
    let ui_dir = std::env::var_os("GRAIN_UI_DIR").map(PathBuf::from);
    let opts = grain_server::Options { port: cli.port, ui_dir, open_pr };
    grain_server::serve(opts, |base| {
        let url = format!("{base}{path}");
        println!("Grain is running at {url}");
        if !cli.no_open {
            let _ = open::that_detached(&url);
        }
    })
    .await
}
