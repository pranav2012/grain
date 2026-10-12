//! Grain's on-disk state. Everything lives under `~/.grain` (override with `GRAIN_HOME`).

use std::path::{Path, PathBuf};

use grain_agent::Agent;
use grain_github::PrRef;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Clone)]
pub struct Home {
    pub root: PathBuf,
}

impl Home {
    pub fn locate() -> Home {
        let root = std::env::var_os("GRAIN_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| dirs::home_dir().unwrap_or_default().join(".grain"));
        std::fs::create_dir_all(&root).ok();
        Home { root }
    }

    pub fn clone_dir(&self, pr: &PrRef) -> PathBuf {
        self.root.join("repos").join(&pr.owner).join(&pr.repo)
    }

    pub fn worktree_dir(&self, pr: &PrRef) -> PathBuf {
        self.root.join("worktrees").join(&pr.owner).join(&pr.repo).join(pr.number.to_string())
    }

    pub fn review_dir(&self, pr: &PrRef) -> PathBuf {
        self.root.join("reviews").join(&pr.owner).join(&pr.repo).join(pr.number.to_string())
    }

    pub fn reviews_root(&self) -> PathBuf {
        self.root.join("reviews")
    }

    pub fn cache_dir(&self) -> PathBuf {
        self.root.join("cache")
    }

    fn settings_path(&self) -> PathBuf {
        self.root.join("settings.json")
    }

    pub fn load_settings(&self) -> Settings {
        std::fs::read_to_string(self.settings_path())
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    pub fn save_settings(&self, s: &Settings) -> std::io::Result<()> {
        std::fs::write(self.settings_path(), serde_json::to_string_pretty(s)?)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Settings {
    /// `None` means review without AI.
    pub agent: Option<Agent>,
    pub model: Option<String>,
    /// Fresh (non-cached) agent requests allowed per PR review.
    pub max_summaries_per_review: usize,
}

impl Default for Settings {
    fn default() -> Self {
        Settings { agent: None, model: None, max_summaries_per_review: 30 }
    }
}

pub fn read_json(path: &Path) -> Option<serde_json::Value> {
    serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()
}

/// Atomic write so the UI never reads a half-written file.
pub fn write_atomic(path: &Path, contents: &[u8]) -> std::io::Result<()> {
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, contents)?;
    std::fs::rename(tmp, path)
}

/// Every `<reviews>/<owner>/<repo>/<number>/<file>` that exists.
pub fn list_review_files(reviews_root: &Path, file: &str) -> Vec<PathBuf> {
    let dirs = |p: &Path| std::fs::read_dir(p).into_iter().flatten().flatten().map(|e| e.path()).collect::<Vec<_>>();
    dirs(reviews_root)
        .iter()
        .flat_map(|owner| dirs(owner))
        .flat_map(|repo| dirs(&repo))
        .map(|n| n.join(file))
        .filter(|p| p.exists())
        .collect()
}
