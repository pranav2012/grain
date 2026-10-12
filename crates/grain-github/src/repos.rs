use anyhow::Result;
use serde::Serialize;
use ts_rs::TS;

use crate::gh::gh;

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RepoSummary {
    pub full_name: String,
    pub description: String,
    pub pushed_at: String,
}

static ACCESSIBLE: std::sync::Mutex<Option<(std::time::Instant, Vec<RepoSummary>)>> = std::sync::Mutex::new(None);

/// Every repo the viewer can access (all pages), cached for ten minutes.
fn accessible_repos() -> Result<Vec<RepoSummary>> {
    if let Some((at, rows)) = ACCESSIBLE.lock().unwrap_or_else(std::sync::PoisonError::into_inner).as_ref()
        && at.elapsed() < std::time::Duration::from_secs(600)
    {
        return Ok(rows.clone());
    }
    let v = gh(&[
        "api",
        "--paginate",
        "--slurp",
        "/user/repos?sort=pushed&per_page=100&affiliation=owner,collaborator,organization_member",
    ])?;
    let rows: Vec<RepoSummary> = v
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|page| page.as_array().cloned().unwrap_or_default())
        .map(|r| RepoSummary {
            full_name: r["full_name"].as_str().unwrap_or_default().into(),
            description: r["description"].as_str().unwrap_or_default().into(),
            pushed_at: r["pushed_at"].as_str().unwrap_or_default().into(),
        })
        .collect();
    *ACCESSIBLE.lock().unwrap_or_else(std::sync::PoisonError::into_inner) =
        Some((std::time::Instant::now(), rows.clone()));
    Ok(rows)
}

/// Repos the viewer can access, most recently pushed first, filtered by every word of `query`
/// against `owner/name` and description; falls back to GitHub search for repos outside that set.
pub fn repos(query: Option<&str>) -> Result<Vec<RepoSummary>> {
    let all = accessible_repos()?;
    let Some(q) = query.map(str::trim).filter(|q| !q.is_empty()) else {
        return Ok(all.into_iter().take(60).collect());
    };
    let words: Vec<String> = q
        .to_lowercase()
        .split(|c: char| c.is_whitespace() || c == '/')
        .filter(|w| !w.is_empty())
        .map(str::to_string)
        .collect();
    let mut rows: Vec<RepoSummary> = all
        .into_iter()
        .filter(|r| {
            let hay = format!("{} {}", r.full_name, r.description).to_lowercase();
            words.iter().all(|w| hay.contains(w.as_str()))
        })
        .take(60)
        .collect();
    if rows.len() < 5 {
        let found =
            gh(&["search", "repos", q, "--limit=20", "--json", "fullName,description,updatedAt"]).unwrap_or_default();
        for r in found.as_array().into_iter().flatten() {
            let name = r["fullName"].as_str().unwrap_or_default();
            if !rows.iter().any(|x| x.full_name == name) {
                rows.push(RepoSummary {
                    full_name: name.into(),
                    description: r["description"].as_str().unwrap_or_default().into(),
                    pushed_at: r["updatedAt"].as_str().unwrap_or_default().into(),
                });
            }
        }
    }
    Ok(rows)
}
