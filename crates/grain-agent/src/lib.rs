//! Block summaries from the reviewer's own agent CLI (Claude Code, Codex, OpenCode).
//! Policy and rationale: docs/COMPLIANCE.md.

mod cli;

use std::path::Path;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Agent {
    Claude,
    Codex,
    Opencode,
}

impl Agent {
    pub fn parse(s: &str) -> Option<Agent> {
        match s {
            "claude" => Some(Agent::Claude),
            "codex" => Some(Agent::Codex),
            "opencode" => Some(Agent::Opencode),
            _ => None,
        }
    }

    pub fn id(self) -> &'static str {
        match self {
            Agent::Claude => "claude",
            Agent::Codex => "codex",
            Agent::Opencode => "opencode",
        }
    }

    fn binary(self) -> &'static str {
        self.id()
    }

    /// Whether the agent's CLI is installed and on PATH.
    pub fn installed(self) -> bool {
        std::process::Command::new(self.binary())
            .arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum Outcome {
    Done { summary: serde_json::Value, cached: bool },
    /// Not allowed by provider terms in this environment; never retried.
    Refused { reason: String },
    /// The provider's usage or rate limit was hit; the caller must stop asking.
    Limited { detail: String },
    Failed { detail: String },
}

const PROMPT: &str = "You are helping a human review one block of a pull request.\n\
Answer only from the diff below; do not use tools.\n\
title: <= 8 words, what this block does. intent: 1-2 sentences on the behavior change.\n\
risk: low|medium|high. risk_reasons: concrete, specific to this diff. reviewer_questions: 2-4 sharp questions.\n\nDIFF:\n";

const SCHEMA: &str = r#"{"type":"object","additionalProperties":false,
"required":["title","intent","risk","risk_reasons","reviewer_questions"],
"properties":{"title":{"type":"string"},"intent":{"type":"string"},
"risk":{"type":"string","enum":["low","medium","high"]},
"risk_reasons":{"type":"array","items":{"type":"string"}},
"reviewer_questions":{"type":"array","items":{"type":"string"}}}}"#;

/// Extracts the first top-level JSON object from free text (tolerates stray prose or fences).
pub(crate) fn extract_json(text: &str) -> Option<serde_json::Value> {
    let (start, end) = (text.find('{')?, text.rfind('}')?);
    serde_json::from_str(&text[start..=end]).ok()
}

fn env_set(keys: &[&str]) -> bool {
    keys.iter().any(|k| std::env::var(k).map(|v| !v.is_empty()).unwrap_or(false))
}

fn is_ci() -> bool {
    env_set(&["CI", "GITHUB_ACTIONS", "GITLAB_CI", "BUILDKITE", "CIRCLECI", "JENKINS_URL", "TF_BUILD"])
}

fn has_api_key(agent: Agent) -> bool {
    match agent {
        Agent::Claude => env_set(&["ANTHROPIC_API_KEY"]),
        Agent::Codex => env_set(&["CODEX_API_KEY", "OPENAI_API_KEY"]),
        Agent::Opencode => false,
    }
}

/// Provider-terms guardrails; returns why a request must not run.
pub fn policy_check(agent: Agent, model: Option<&str>) -> Option<String> {
    if is_ci() && !has_api_key(agent) {
        return Some("CI detected: subscriptions are for individual use only. Set an API key for automation.".into());
    }
    if agent == Agent::Opencode && cli::opencode_has_anthropic_oauth() && model.map_or(true, |m| m.starts_with("anthropic/")) {
        return Some(
            "OpenCode has a Claude subscription login, which Anthropic does not allow in third-party tools. \
             Choose a non-Anthropic model in OpenCode, or use Claude Code directly."
                .into(),
        );
    }
    None
}

fn looks_limited(s: &str) -> bool {
    let s = s.to_lowercase();
    ["rate limit", "rate_limit", "usage limit", "limit reached", "quota", " 429", "overloaded"].iter().any(|p| s.contains(p))
}

/// Summarizes one block diff. Identical requests are answered from `cache_dir` and never re-sent.
pub fn summarize(agent: Agent, model: Option<&str>, diff: &str, cache_dir: &Path) -> Outcome {
    if let Some(reason) = policy_check(agent, model) {
        return Outcome::Refused { reason };
    }
    let prompt = format!("{PROMPT}{diff}");
    let key = format!("{:x}", Sha256::digest(format!("{}|cli|{model:?}|{SCHEMA}|{prompt}", agent.id())));
    let cache_file = cache_dir.join(format!("{key}.json"));
    if let Ok(hit) = std::fs::read_to_string(&cache_file) {
        if let Ok(summary) = serde_json::from_str(&hit) {
            return Outcome::Done { summary, cached: true };
        }
    }
    let res = match agent {
        Agent::Claude => cli::claude(&prompt, SCHEMA, model),
        Agent::Codex => cli::codex(&prompt, SCHEMA, model),
        Agent::Opencode => cli::opencode(&format!("{prompt}\n\nReply with ONLY JSON matching: {SCHEMA}"), model),
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
            if looks_limited(&raw) {
                Outcome::Limited { detail }
            } else {
                Outcome::Failed { detail }
            }
        }
        Err(e) => Outcome::Failed { detail: e.to_string() },
    }
}
