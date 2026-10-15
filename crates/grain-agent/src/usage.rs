//! What an agent request used: tokens and cost. Claude Code reports its cost; Codex and OpenCode
//! report tokens (OpenCode sometimes cost), which are priced from list prices and marked estimated.
//! On a subscription the cost is what the same usage would cost at API prices, not a bill.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Usage {
    pub model: Option<String>,
    #[ts(type = "number")]
    pub input_tokens: u64,
    /// Input tokens served from the provider's cache (cheaper).
    #[ts(type = "number")]
    pub cached_tokens: u64,
    #[ts(type = "number")]
    pub output_tokens: u64,
    pub cost_usd: f64,
    /// True when the cost was computed by Grain from token counts and list prices.
    pub estimated: bool,
}

/// USD per million tokens: (input, cached input, output). Approximate list prices; update when providers change them.
fn price(model: Option<&str>) -> (f64, f64, f64) {
    let m = model.unwrap_or_default().to_ascii_lowercase();
    if m.contains("mini") || m.contains("haiku") || m.contains("flash") {
        (0.25, 0.025, 2.0)
    } else if m.contains("opus") {
        (15.0, 1.5, 75.0)
    } else if m.contains("sonnet") || m.contains("claude") {
        (3.0, 0.3, 15.0)
    } else {
        (1.25, 0.125, 10.0)
    }
}

fn estimate(model: Option<String>, input: u64, cached: u64, output: u64) -> Usage {
    let (pi, pc, po) = price(model.as_deref());
    let fresh = input.saturating_sub(cached);
    let cost = (fresh as f64 * pi + cached as f64 * pc + output as f64 * po) / 1_000_000.0;
    Usage { model, input_tokens: input, cached_tokens: cached, output_tokens: output, cost_usd: cost, estimated: true }
}

fn n(v: &serde_json::Value) -> u64 {
    v.as_u64().unwrap_or(0)
}

/// From `claude -p --output-format json`: its own `total_cost_usd`, tokens, and the main model.
pub(crate) fn from_claude(out: &serde_json::Value) -> Option<Usage> {
    let cost = out.get("total_cost_usd")?.as_f64()?;
    let u = &out["usage"];
    let cached = n(&u["cache_read_input_tokens"]);
    let input = n(&u["input_tokens"]) + n(&u["cache_creation_input_tokens"]) + cached;
    let model = out["modelUsage"]
        .as_object()
        .and_then(|m| {
            m.iter().max_by(|a, b| {
                a.1["costUSD"].as_f64().partial_cmp(&b.1["costUSD"].as_f64()).unwrap_or(std::cmp::Ordering::Equal)
            })
        })
        .map(|(name, _)| name.clone());
    Some(Usage {
        model,
        input_tokens: input,
        cached_tokens: cached,
        output_tokens: n(&u["output_tokens"]),
        cost_usd: cost,
        estimated: false,
    })
}

/// From `codex exec --json` events: the `turn.completed` usage, priced for `model`.
pub(crate) fn from_codex(stdout: &str, model: Option<&str>) -> Option<Usage> {
    let mut found = None;
    for line in stdout.lines() {
        let Ok(e) = serde_json::from_str::<serde_json::Value>(line) else { continue };
        if e["type"] == "turn.completed" {
            let u = &e["usage"];
            let output = n(&u["output_tokens"]) + n(&u["reasoning_output_tokens"]);
            found =
                Some(estimate(model.map(str::to_string), n(&u["input_tokens"]), n(&u["cached_input_tokens"]), output));
        }
    }
    found
}

/// From `opencode run --format json` events: summed step costs and tokens.
pub(crate) fn from_opencode(stdout: &str, model: Option<String>) -> Option<Usage> {
    let (mut input, mut cached, mut output, mut cost, mut seen) = (0, 0, 0, 0.0, false);
    for line in stdout.lines() {
        let Ok(e) = serde_json::from_str::<serde_json::Value>(line) else { continue };
        let part = &e["part"];
        if part["type"] != "step-finish" {
            continue;
        }
        seen = true;
        input += n(&part["tokens"]["input"]);
        cached += n(&part["tokens"]["cache"]["read"]);
        output += n(&part["tokens"]["output"]);
        cost += part["cost"].as_f64().unwrap_or(0.0);
    }
    if !seen {
        return None;
    }
    let mut u = estimate(model, input + cached, cached, output);
    if cost > 0.0 {
        u.cost_usd = cost;
        u.estimated = false;
    }
    Some(u)
}

/// The model Codex uses when none is chosen in Grain: `model` in `~/.codex/config.toml` (settings only, no credentials).
pub(crate) fn codex_default_model() -> Option<String> {
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"))?;
    let config = std::fs::read_to_string(std::path::Path::new(&home).join(".codex/config.toml")).ok()?;
    config.lines().find_map(|l| {
        let (k, v) = l.split_once('=')?;
        (k.trim() == "model").then(|| v.trim().trim_matches('"').to_string())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_claude_cost() {
        let out = serde_json::json!({"total_cost_usd": 0.0123, "usage": {"input_tokens": 10, "cache_creation_input_tokens": 5, "cache_read_input_tokens": 100, "output_tokens": 7},
            "modelUsage": {"claude-haiku": {"costUSD": 0.001}, "claude-opus": {"costUSD": 0.01}}});
        let u = from_claude(&out).unwrap_or_default();
        assert_eq!((u.input_tokens, u.cached_tokens, u.output_tokens), (115, 100, 7));
        assert_eq!(u.model.as_deref(), Some("claude-opus"));
        assert!(!u.estimated);
    }

    #[test]
    fn estimates_codex_cost() {
        let out = r#"{"type":"turn.started"}
{"type":"turn.completed","usage":{"input_tokens":17830,"cached_input_tokens":13184,"output_tokens":5,"reasoning_output_tokens":0}}"#;
        let u = from_codex(out, Some("gpt-x")).unwrap_or_default();
        assert_eq!((u.input_tokens, u.cached_tokens, u.output_tokens), (17830, 13184, 5));
        assert!(u.estimated && u.cost_usd > 0.0 && u.cost_usd < 0.01);
    }
}
