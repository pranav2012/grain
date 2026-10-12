//! Block and layer summaries from the reviewer's own agent CLI (Claude Code, Codex, OpenCode).
//! Policy and rationale: docs/COMPLIANCE.md.

mod agent;
mod policy;
mod prompt;
mod transport;

use std::path::Path;

use serde::Serialize;
use sha2::{Digest, Sha256};

pub use agent::Agent;

/// Finds a program on PATH, including Windows `.cmd`/`.exe` shims that npm installs.
pub fn resolve_program(name: &str) -> std::path::PathBuf {
    which::which(name).unwrap_or_else(|_| std::path::PathBuf::from(name))
}
pub use policy::policy_check;
use prompt::{LAYER_PROMPT, LAYER_SCHEMA, PROMPT, SCHEMA};
pub use prompt::{LayerSummary, Summary};
use transport::cli;

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum Outcome {
    Done {
        summary: serde_json::Value,
        cached: bool,
    },
    /// Not allowed by provider terms in this environment; never retried.
    Refused {
        reason: String,
    },
    /// The provider's usage or rate limit was hit; the caller must stop asking.
    Limited {
        detail: String,
    },
    Failed {
        detail: String,
    },
}

fn looks_limited(s: &str) -> bool {
    let s = s.to_lowercase();
    ["rate limit", "rate_limit", "usage limit", "limit reached", "quota", " 429", "overloaded"]
        .iter()
        .any(|p| s.contains(p))
}

/// Summarizes one block diff. Identical requests are answered from `cache_dir` and never re-sent.
pub fn summarize(agent: Agent, model: Option<&str>, diff: &str, cache_dir: &Path) -> Outcome {
    ask(agent, model, PROMPT, SCHEMA, diff, cache_dir)
}

/// Summarizes one layer (a few related blocks) from their combined diff; cached like [`summarize`].
pub fn summarize_layer(agent: Agent, model: Option<&str>, diff: &str, cache_dir: &Path) -> Outcome {
    ask(agent, model, LAYER_PROMPT, LAYER_SCHEMA, diff, cache_dir)
}

fn ask(agent: Agent, model: Option<&str>, head: &str, schema: &str, diff: &str, cache_dir: &Path) -> Outcome {
    if let Some(reason) = policy_check(agent, model) {
        return Outcome::Refused { reason };
    }
    let prompt = format!("{head}{diff}");
    let key = format!("{:x}", Sha256::digest(format!("{}|cli|{model:?}|{schema}|{prompt}", agent.id())));
    let cache_file = cache_dir.join(format!("{key}.json"));
    if let Ok(hit) = std::fs::read_to_string(&cache_file)
        && let Ok(summary) = serde_json::from_str(&hit)
    {
        return Outcome::Done { summary, cached: true };
    }
    let res = match agent {
        Agent::Claude => cli::claude(&prompt, schema, model),
        Agent::Codex => cli::codex(&prompt, schema, model),
        Agent::Opencode => cli::opencode(&format!("{prompt}\n\nReply with ONLY JSON matching: {schema}"), model),
    };
    match res {
        Ok((Some(summary), _)) => {
            std::fs::create_dir_all(cache_dir).ok();
            std::fs::write(&cache_file, summary.to_string()).ok();
            Outcome::Done { summary, cached: false }
        }
        Ok((None, out)) => {
            let raw = format!("{}\n{}", out.stdout, out.stderr);
            let detail: String = raw.chars().take(500).collect();
            if looks_limited(&raw) { Outcome::Limited { detail } } else { Outcome::Failed { detail } }
        }
        Err(e) => Outcome::Failed { detail: e.to_string() },
    }
}
