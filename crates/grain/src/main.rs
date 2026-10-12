//! `grain`: local-first semantic code review.

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
    /// Print the engine's grouping for a git range in a checkout of `head`.
    Analyze {
        repo: PathBuf,
        base: String,
        head: String,
        /// Print the full review as JSON.
        #[arg(long)]
        json: bool,
    },
}

/// The built UI: `GRAIN_UI_DIR`, or `ui/dist` in the source tree during development.
fn ui_dir() -> PathBuf {
    std::env::var_os("GRAIN_UI_DIR")
        .map_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../ui/dist"), PathBuf::from)
}

#[tokio::main]
#[allow(clippy::print_stdout, reason = "the CLI's output")]
async fn main() -> Result<()> {
    tracing_subscriber::fmt().with_env_filter(std::env::var("GRAIN_LOG").unwrap_or_else(|_| "info".into())).init();
    let cli = Cli::parse();
    if let Some(Command::Analyze { repo, base, head, json }) = cli.command {
        let analysis = grain_engine::analyze(&repo, &base, &head)?;
        let out = if json { serde_json::to_string_pretty(&analysis.review)? } else { analysis.summary };
        println!("{out}");
        return Ok(());
    }

    let open_pr = match cli.pr.as_deref() {
        Some(s) => {
            Some(PrRef::parse(s).ok_or_else(|| anyhow::anyhow!("'{s}' is not a pull request link or owner/repo#123"))?)
        }
        None => None,
    };
    let path = open_pr.as_ref().map(|p| format!("/?pr={}/{}", p.full_repo(), p.number)).unwrap_or_default();
    let opts = grain_server::Options { port: cli.port, ui_dir: ui_dir(), open_pr };
    grain_server::serve(opts, |base| {
        let url = format!("{base}{path}");
        println!("Grain is running at {url}");
        if !cli.no_open {
            let _ = std::process::Command::new("open").arg(&url).spawn();
        }
    })
    .await
}
