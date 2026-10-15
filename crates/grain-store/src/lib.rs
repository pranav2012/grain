//! Grain's on-disk state. Everything lives under `~/.grain` (override with `GRAIN_HOME`).

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use grain_agent::Agent;
use grain_github::PrRef;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

mod usage;
pub use usage::{Spend, UsageRecord, local_day};

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

    pub fn worktrees_root(&self) -> PathBuf {
        self.root.join("worktrees")
    }

    pub fn repos_root(&self) -> PathBuf {
        self.root.join("repos")
    }

    fn repo_choices_path(&self) -> PathBuf {
        self.root.join("repos.json")
    }

    /// Where the reviewer said `owner/repo` lives locally: `Some(Some(path))` to borrow from that
    /// clone, `Some(None)` to download a copy, `None` when they haven't been asked yet.
    pub fn repo_choice(&self, full_repo: &str) -> Option<Option<PathBuf>> {
        let all: HashMap<String, Option<PathBuf>> = std::fs::read_to_string(self.repo_choices_path())
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        all.get(full_repo).cloned()
    }

    pub fn set_repo_choice(&self, full_repo: &str, local: Option<PathBuf>) -> std::io::Result<()> {
        let path = self.repo_choices_path();
        let mut all: HashMap<String, Option<PathBuf>> =
            std::fs::read_to_string(&path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
        all.insert(full_repo.to_string(), local);
        write_atomic(&path, serde_json::to_string_pretty(&all)?.as_bytes())
    }

    /// Records that a review was just opened (drives the 14-day cleanup).
    pub fn touch_review(&self, pr: &PrRef) {
        let dir = self.review_dir(pr);
        let _ = std::fs::create_dir_all(&dir);
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let _ = std::fs::write(dir.join("last-opened"), now.to_string());
    }

    /// Seconds since the review was last opened, if it ever was.
    pub fn review_idle_secs(&self, pr: &PrRef) -> Option<u64> {
        let at: u64 = std::fs::read_to_string(self.review_dir(pr).join("last-opened")).ok()?.trim().parse().ok()?;
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).ok()?.as_secs();
        Some(now.saturating_sub(at))
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
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct Settings {
    /// `None` means review without AI (the default).
    pub agent: Option<Agent>,
    pub model: Option<String>,
    /// Fresh (non-cached) agent requests allowed per PR review.
    pub max_summaries_per_review: usize,
    /// Summarize the next blocks automatically while reading. Off by default: summaries are
    /// otherwise only made when the reviewer asks for one, and never for the initial view.
    pub auto_summarize: bool,
    /// Prepare the newest review requests in the background (git and grouping only, never AI).
    pub prefetch: bool,
    /// With an agent set, review each PR the reviewer opens with the review skill (read-only, in
    /// Grain's checkout) and show its findings beside the code. Nothing is posted.
    pub second_opinion: bool,
    /// Estimated AI spend allowed per day (USD at API prices); 0 means no cap.
    pub daily_budget_usd: f64,
    /// Folders the reviewer keeps their clones in; searched (two levels deep) along with the
    /// usual code folders when a repository opens for the first time.
    pub work_folders: Vec<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            agent: None,
            model: None,
            max_summaries_per_review: 30,
            auto_summarize: false,
            prefetch: true,
            second_opinion: true,
            daily_budget_usd: 5.0,
            work_folders: Vec::new(),
        }
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

/// Total size of the files under `path` (best effort; unreadable entries are skipped).
pub fn disk_usage(path: &Path) -> u64 {
    let Ok(meta) = std::fs::symlink_metadata(path) else { return 0 };
    if !meta.is_dir() {
        return meta.len();
    }
    std::fs::read_dir(path).into_iter().flatten().flatten().map(|e| disk_usage(&e.path())).sum()
}
