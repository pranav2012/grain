//! Which models an agent offers, and facts about them, without hardcoding any model names: the
//! agents list their own models (Codex's catalog, OpenCode's list), and the public models.dev
//! catalog (what OpenCode uses) gives release dates and prices for every provider.

use std::path::Path;
use std::process::Command;
use std::time::{Duration, SystemTime};

use serde::Serialize;
use ts_rs::TS;

use crate::agent::Agent;

const CATALOG_URL: &str = "https://models.dev/api.json";
const CATALOG_MAX_AGE: Duration = Duration::from_hours(24);

/// A model the reviewer can pick for an agent.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ModelOption {
    /// What the agent's `--model` takes.
    pub id: String,
    pub name: String,
    pub release_date: Option<String>,
    /// USD per million output tokens, when known.
    pub output_price: Option<f64>,
}

/// USD per million tokens: input, cached input, output.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Price {
    pub input: f64,
    pub cached: f64,
    pub output: f64,
}

/// The models.dev catalog: provider → model id → facts.
pub struct Catalog(serde_json::Value);

impl Catalog {
    /// The cached catalog, refreshed when older than a day; `None` when it can't be fetched or read.
    pub fn load(cache_dir: &Path) -> Option<Catalog> {
        let path = cache_dir.join("models-dev.json");
        let fresh = path
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| SystemTime::now().duration_since(t).ok())
            .is_some_and(|age| age < CATALOG_MAX_AGE);
        if !fresh {
            let fetched = Command::new("curl")
                .args(["-fsSL", "--max-time", "20", CATALOG_URL])
                .output()
                .ok()
                .filter(|o| o.status.success());
            if let Some(out) = fetched.filter(|o| serde_json::from_slice::<serde_json::Value>(&o.stdout).is_ok()) {
                let _ = std::fs::create_dir_all(cache_dir);
                let _ = std::fs::write(&path, &out.stdout);
            }
        }
        serde_json::from_slice(&std::fs::read(&path).ok()?).ok().map(Catalog)
    }

    /// Facts for a model id: `provider/model` (OpenCode) or a bare id, looked up in the agent's own provider first.
    fn model(&self, agent: Agent, id: &str) -> Option<&serde_json::Value> {
        if let Some((provider, model)) = id.split_once('/') {
            return self.0.get(provider)?.get("models")?.get(model);
        }
        let home = match agent {
            Agent::Claude => "anthropic",
            Agent::Codex => "openai",
            Agent::Opencode => "",
        };
        self.0
            .get(home)
            .and_then(|p| p.get("models")?.get(id))
            .or_else(|| self.0.as_object()?.values().find_map(|p| p.get("models")?.get(id)))
    }

    pub fn price(&self, agent: Agent, id: &str) -> Option<Price> {
        let cost = self.model(agent, id)?.get("cost")?;
        let input = cost.get("input")?.as_f64()?;
        let output = cost.get("output")?.as_f64()?;
        Some(Price {
            input,
            cached: cost.get("cache_read").and_then(serde_json::Value::as_f64).unwrap_or(input),
            output,
        })
    }

    fn option(&self, agent: Agent, id: &str, name: Option<String>) -> ModelOption {
        let m = self.model(agent, id);
        ModelOption {
            id: id.to_string(),
            name: name
                .or_else(|| m.and_then(|m| m["name"].as_str()).map(str::to_string))
                .unwrap_or_else(|| id.to_string()),
            release_date: m.and_then(|m| m["release_date"].as_str()).map(str::to_string),
            output_price: m.and_then(|m| m["cost"]["output"].as_f64()),
        }
    }

    /// Claude Code can't list its models, so these are Anthropic's models in the catalog, newest first.
    fn anthropic(&self) -> Vec<String> {
        let mut models: Vec<(&str, &str)> = self.0["anthropic"]["models"]
            .as_object()
            .into_iter()
            .flatten()
            .map(|(id, m)| (id.as_str(), m["release_date"].as_str().unwrap_or_default()))
            .collect();
        models.sort_by(|a, b| b.1.cmp(a.1).then(a.0.cmp(b.0)));
        models.into_iter().map(|(id, _)| id.to_string()).collect()
    }
}

/// Codex's own catalog for the signed-in account, in Codex's order of preference.
fn codex_models() -> Vec<(String, String)> {
    let Some(out) = Command::new(crate::resolve_program("codex"))
        .args(["debug", "models"])
        .output()
        .ok()
        .filter(|o| o.status.success())
    else {
        return Vec::new();
    };
    let v: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap_or_default();
    let mut models: Vec<(i64, String, String)> = v["models"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|m| m["visibility"] == "list")
        .filter_map(|m| {
            Some((
                m["priority"].as_i64().unwrap_or(i64::MAX),
                m["slug"].as_str()?.to_string(),
                m["display_name"].as_str().unwrap_or_default().to_string(),
            ))
        })
        .collect();
    models.sort();
    models.into_iter().map(|(_, id, name)| (id, name)).collect()
}

/// Every model OpenCode can use with the reviewer's providers (`provider/model`).
fn opencode_models() -> Vec<String> {
    Command::new(crate::resolve_program("opencode"))
        .args(["models", "--standalone"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .lines()
                .map(str::trim)
                .filter(|l| l.contains('/'))
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

/// The models `agent` offers, as the agent lists them (or, for Claude Code, from the catalog).
pub fn available(agent: Agent, catalog: Option<&Catalog>) -> Vec<ModelOption> {
    match agent {
        Agent::Codex => codex_models()
            .into_iter()
            .map(|(id, name)| match catalog {
                Some(c) => c.option(agent, &id, Some(name)),
                None => ModelOption { id, name, release_date: None, output_price: None },
            })
            .collect(),
        Agent::Opencode => opencode_models()
            .into_iter()
            .map(|id| match catalog {
                Some(c) => c.option(agent, &id, None),
                None => ModelOption { name: id.clone(), id, release_date: None, output_price: None },
            })
            .collect(),
        Agent::Claude => {
            catalog.map(|c| c.anthropic().iter().map(|id| c.option(agent, id, None)).collect()).unwrap_or_default()
        }
    }
}

/// [`available`], remembered for an hour per agent (listing can take a few seconds).
pub fn available_cached(agent: Agent, cache_dir: &Path) -> Vec<ModelOption> {
    static CACHE: std::sync::Mutex<Vec<(Agent, std::time::Instant, Vec<ModelOption>)>> =
        std::sync::Mutex::new(Vec::new());
    let mut cache = CACHE.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    if let Some((_, _, models)) =
        cache.iter().find(|(a, at, _)| *a == agent && at.elapsed() < Duration::from_hours(1))
    {
        return models.clone();
    }
    let models = available(agent, Catalog::load(cache_dir).as_ref());
    cache.retain(|(a, _, _)| *a != agent);
    cache.push((agent, std::time::Instant::now(), models.clone()));
    models
}

/// A top-level string setting (`"key": "value"`) from OpenCode's config; only this value is read.
fn opencode_setting(key: &str) -> Option<String> {
    let dir = dirs_config()?.join("opencode");
    let text = ["opencode.json", "opencode.jsonc", "config.json"]
        .iter()
        .find_map(|f| std::fs::read_to_string(dir.join(f)).ok())?;
    let needle = format!("\"{key}\"");
    let rest = text.split(&needle).nth(1)?.trim_start().strip_prefix(':')?.trim_start().strip_prefix('"')?;
    rest.split('"').next().map(str::to_string).filter(|v| !v.is_empty())
}

fn dirs_config() -> Option<std::path::PathBuf> {
    std::env::var_os("XDG_CONFIG_HOME")
        .map(std::path::PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| Path::new(&h).join(".config")))
}

/// What "Automatic" uses for summaries: OpenCode's own `small_model` when set; otherwise the newest of
/// the cheapest current models the agent offers, within OpenCode's default provider when one is set.
pub fn summary_auto(agent: Agent, models: &[ModelOption]) -> Option<ModelOption> {
    if agent == Agent::Opencode {
        if let Some(small) = opencode_setting("small_model") {
            return Some(models.iter().find(|m| m.id == small).cloned().unwrap_or(ModelOption {
                name: small.clone(),
                id: small,
                release_date: None,
                output_price: None,
            }));
        }
        if let Some(provider) = opencode_setting("model").and_then(|m| m.split_once('/').map(|(p, _)| format!("{p}/")))
        {
            let same: Vec<ModelOption> = models.iter().filter(|m| m.id.starts_with(&provider)).cloned().collect();
            if let Some(m) = cheapest_newest(&same) {
                return Some(m.clone());
            }
        }
    }
    cheapest_newest(models).cloned()
}

/// The model for summaries: the reviewer's choice, else [`summary_auto`], else `None` (the agent's default).
pub fn summary_model(agent: Agent, chosen: Option<&str>, cache_dir: &Path) -> Option<String> {
    chosen.map(str::to_string).or_else(|| summary_auto(agent, &available_cached(agent, cache_dir)).map(|m| m.id))
}

/// Release year and day of year as a comparable number (`2026-10-07` → 2026 * 366 + 280), roughly.
fn day_number(date: &str) -> Option<i64> {
    let mut parts = date.splitn(3, '-').map(|p| p.parse::<i64>().ok());
    let (y, m, d) = (parts.next()??, parts.next()?.unwrap_or(1), parts.next()?.unwrap_or(1));
    Some(y * 366 + (m - 1) * 31 + d)
}

/// For summaries: the newest of the cheapest current models the agent offers (by output price).
/// Free models (often rate-limited) and models over a year older than the newest one are left out.
/// `None` when prices are unknown, so the agent's default model is used.
pub fn cheapest_newest(models: &[ModelOption]) -> Option<&ModelOption> {
    let newest = models.iter().filter_map(|m| day_number(m.release_date.as_deref()?)).max();
    let current = |m: &&ModelOption| match (newest, m.release_date.as_deref().and_then(day_number)) {
        (Some(n), Some(d)) => n - d <= 366,
        _ => true,
    };
    let priced: Vec<&ModelOption> =
        models.iter().filter(current).filter(|m| m.output_price.is_some_and(|p| p > 0.0)).collect();
    let cheapest = priced.iter().filter_map(|m| m.output_price).fold(f64::INFINITY, f64::min);
    priced
        .into_iter()
        .filter(|m| m.output_price.is_some_and(|p| p <= cheapest * 1.01))
        .max_by(|a, b| a.release_date.cmp(&b.release_date))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opt(id: &str, date: &str, price: f64) -> ModelOption {
        ModelOption { id: id.into(), name: id.into(), release_date: Some(date.into()), output_price: Some(price) }
    }

    #[test]
    fn picks_the_newest_of_the_cheapest() {
        let models = [
            opt("big", "2026-09-01", 50.0),
            opt("small-old", "2025-01-01", 0.5),
            opt("small-new", "2026-10-01", 0.5),
            opt("mid", "2026-10-02", 10.0),
        ];
        assert_eq!(cheapest_newest(&models).map(|m| m.id.as_str()), Some("small-new"));
        let with_free_and_stale =
            [opt("free", "2026-10-01", 0.0), opt("ancient", "2024-01-01", 0.1), opt("ok", "2026-09-01", 2.0)];
        assert_eq!(cheapest_newest(&with_free_and_stale).map(|m| m.id.as_str()), Some("ok"));
        assert!(
            cheapest_newest(&[ModelOption {
                id: "x".into(),
                name: "x".into(),
                release_date: None,
                output_price: None
            }])
            .is_none()
        );
    }

    #[test]
    fn looks_up_prices_by_provider() {
        let c = Catalog(serde_json::json!({
            "anthropic": {"models": {"m-1": {"name": "M 1", "release_date": "2026-01-01", "cost": {"input": 1.0, "output": 5.0, "cache_read": 0.1}}}},
            "other": {"models": {"m-2": {"cost": {"input": 2.0, "output": 8.0}}}}
        }));
        assert_eq!(c.price(Agent::Claude, "m-1"), Some(Price { input: 1.0, cached: 0.1, output: 5.0 }));
        assert_eq!(c.price(Agent::Opencode, "other/m-2").map(|p| p.cached), Some(2.0));
        assert_eq!(c.price(Agent::Codex, "m-2").map(|p| p.output), Some(8.0));
        assert_eq!(c.anthropic(), ["m-1"]);
    }
}
