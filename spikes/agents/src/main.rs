//! Spike C (v2): structured block summaries from the user's own coding agent, within provider terms.
//!
//! Usage: agents-spike <claude|codex|opencode> <block.diff> [--transport cli|acp] [--model M] [--cache-dir D]
//!
//! Exit codes: 0 ok, 2 refused by policy (see docs/COMPLIANCE.md), 3 agent error, 75 rate/usage limit hit.

mod acp;
mod cli;

use std::time::Instant;

use sha2::{Digest, Sha256};

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
pub fn extract_json(text: &str) -> Option<serde_json::Value> {
    let (start, end) = (text.find('{')?, text.rfind('}')?);
    serde_json::from_str(&text[start..=end]).ok()
}

fn env_set(keys: &[&str]) -> bool {
    keys.iter().any(|k| std::env::var(k).map(|v| !v.is_empty()).unwrap_or(false))
}

fn is_ci() -> bool {
    env_set(&["CI", "GITHUB_ACTIONS", "GITLAB_CI", "BUILDKITE", "CIRCLECI", "JENKINS_URL", "TF_BUILD"])
}

fn has_api_key(agent: &str) -> bool {
    match agent {
        "claude" => env_set(&["ANTHROPIC_API_KEY"]),
        "codex" => env_set(&["CODEX_API_KEY", "OPENAI_API_KEY"]),
        _ => false,
    }
}

/// Provider-terms guardrails. Returns a reason when the requested setup must not run.
fn policy_check(agent: &str, transport: &str, model: Option<&str>) -> Option<String> {
    if transport == "acp" && agent != "opencode" && !has_api_key(agent) {
        return Some(format!(
            "ACP for {agent} needs an API key. Subscription logins are only used through your own `{agent}` CLI (--transport cli)."
        ));
    }
    if is_ci() && !has_api_key(agent) {
        return Some("CI detected: subscriptions are for individual use only. Set an API key for automation.".into());
    }
    if agent == "opencode" && cli::opencode_has_anthropic_oauth() && model.map_or(true, |m| m.starts_with("anthropic/")) {
        return Some(
            "OpenCode has a Claude subscription login, which Anthropic does not allow in third-party tools. \
             Pass --model with a non-Anthropic provider (or an Anthropic API-key login)."
                .into(),
        );
    }
    None
}

fn looks_rate_limited(s: &str) -> bool {
    let s = s.to_lowercase();
    ["rate limit", "rate_limit", "usage limit", "limit reached", "quota", " 429", "overloaded"].iter().any(|p| s.contains(p))
}

fn flag(args: &[String], name: &str) -> Option<String> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned()
}

fn emit(v: serde_json::Value, code: i32) -> ! {
    println!("{}", serde_json::to_string_pretty(&v).unwrap());
    std::process::exit(code)
}

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    let (agent, diff_path) = (args[1].as_str(), &args[2]);
    let transport = flag(&args, "--transport").unwrap_or_else(|| "cli".into());
    let model = flag(&args, "--model");
    let cache_dir = flag(&args, "--cache-dir").map(std::path::PathBuf::from);
    let diff = std::fs::read_to_string(diff_path).expect("read diff");
    let prompt = format!("{PROMPT}{diff}");
    let base = serde_json::json!({ "agent": agent, "transport": transport, "model": model });

    if let Some(reason) = policy_check(agent, &transport, model.as_deref()) {
        emit(serde_json::json!({ "base": base, "refused": reason }), 2);
    }

    // Identical requests are never sent twice.
    let key = format!("{:x}", Sha256::digest(format!("{agent}|{transport}|{model:?}|{SCHEMA}|{prompt}")));
    let cache_file = cache_dir.as_ref().map(|d| d.join(format!("{key}.json")));
    if let Some(Ok(hit)) = cache_file.as_ref().map(std::fs::read_to_string) {
        if let Ok(summary) = serde_json::from_str::<serde_json::Value>(&hit) {
            emit(serde_json::json!({ "base": base, "cached": true, "summary": summary }), 0);
        }
    }

    let t0 = Instant::now();
    let (summary, raw) = match transport.as_str() {
        "acp" => {
            let full = format!("{prompt}\n\nReply with ONLY a JSON object matching this schema:\n{SCHEMA}");
            match acp::run(agent, full, model.clone()).await {
                Ok(text) => (extract_json(&text), text),
                Err(e) => (None, e.to_string()),
            }
        }
        _ => {
            let res = match agent {
                "claude" => cli::claude(&prompt, SCHEMA, model.as_deref()),
                "codex" => cli::codex(&prompt, SCHEMA, model.as_deref()),
                "opencode" => cli::opencode(&format!("{prompt}\n\nReply with ONLY JSON matching: {SCHEMA}"), model.as_deref()),
                other => panic!("unknown agent {other}"),
            };
            match res {
                Ok((s, out)) => (s, format!("{}\n{}", out.stdout, out.stderr)),
                Err(e) => (None, e.to_string()),
            }
        }
    };
    let total_ms = t0.elapsed().as_millis() as u64;

    match summary {
        Some(s) => {
            if let Some(f) = &cache_file {
                std::fs::create_dir_all(f.parent().unwrap()).ok();
                std::fs::write(f, s.to_string()).ok();
            }
            emit(serde_json::json!({ "base": base, "cached": false, "totalMs": total_ms, "summary": s }), 0)
        }
        None if looks_rate_limited(&raw) => emit(
            serde_json::json!({ "base": base, "rateLimited": true, "error": raw.chars().take(400).collect::<String>() }),
            75,
        ),
        None => emit(serde_json::json!({ "base": base, "error": raw.chars().take(600).collect::<String>() }), 3),
    }
}
