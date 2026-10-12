//! GitHub access through the user's own `gh` login. Grain never reads or stores the token.

use std::process::Command;

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;

fn gh(args: &[&str]) -> Result<Value> {
    let out = Command::new("gh").args(args).output().context("`gh` is not installed. Install it from https://cli.github.com")?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        if err.contains("auth login") || err.contains("not logged") {
            bail!("GitHub CLI is not signed in. Run `gh auth login`.");
        }
        bail!("gh {}: {}", args.first().unwrap_or(&""), err.trim());
    }
    Ok(serde_json::from_slice(&out.stdout)?)
}

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct PrRef {
    pub owner: String,
    pub repo: String,
    pub number: u64,
}

impl PrRef {
    pub fn full_repo(&self) -> String {
        format!("{}/{}", self.owner, self.repo)
    }

    /// Accepts `https://github.com/o/r/pull/12`, `o/r#12`, `o/r/12` or `o/r/pull/12`.
    pub fn parse(input: &str) -> Option<PrRef> {
        let s = input.trim().trim_end_matches('/');
        let s = s.strip_prefix("https://").or_else(|| s.strip_prefix("http://")).unwrap_or(s);
        let s = s.strip_prefix("github.com/").unwrap_or(s);
        let s = s.split(['?']).next().unwrap_or(s);
        let (repo_part, num) = if let Some((r, n)) = s.split_once('#') {
            (r.to_string(), n.to_string())
        } else {
            let parts: Vec<&str> = s.split('/').collect();
            match parts.as_slice() {
                [o, r, "pull", n, ..] | [o, r, "pulls", n, ..] => (format!("{o}/{r}"), n.to_string()),
                [o, r, n] => (format!("{o}/{r}"), n.to_string()),
                _ => return None,
            }
        };
        let (owner, repo) = repo_part.split_once('/')?;
        let number = num.split(|c: char| !c.is_ascii_digit()).next()?.parse().ok()?;
        (!owner.is_empty() && !repo.is_empty()).then(|| PrRef { owner: owner.into(), repo: repo.into(), number })
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrSummary {
    pub repo: String,
    pub number: u64,
    pub title: String,
    pub author: String,
    pub updated_at: String,
    pub is_draft: bool,
    pub url: String,
}

pub fn viewer() -> Result<String> {
    let v = gh(&["api", "user"])?;
    Ok(v["login"].as_str().unwrap_or_default().to_string())
}

fn search_prs(filter: &str) -> Result<Vec<PrSummary>> {
    let v = gh(&["search", "prs", filter, "--state=open", "--limit=50", "--sort=updated", "--json", "repository,number,title,author,updatedAt,isDraft,url"])?;
    Ok(v.as_array()
        .into_iter()
        .flatten()
        .map(|p| PrSummary {
            repo: p["repository"]["nameWithOwner"].as_str().unwrap_or_default().into(),
            number: p["number"].as_u64().unwrap_or(0),
            title: p["title"].as_str().unwrap_or_default().into(),
            author: p["author"]["login"].as_str().unwrap_or_default().into(),
            updated_at: p["updatedAt"].as_str().unwrap_or_default().into(),
            is_draft: p["isDraft"].as_bool().unwrap_or(false),
            url: p["url"].as_str().unwrap_or_default().into(),
        })
        .collect())
}

/// Open PRs waiting on the viewer's review (directly or via a team).
pub fn review_requests() -> Result<Vec<PrSummary>> {
    search_prs("--review-requested=@me")
}

pub fn my_open_prs() -> Result<Vec<PrSummary>> {
    search_prs("--author=@me")
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoSummary {
    pub full_name: String,
    pub description: String,
    pub pushed_at: String,
}

static ACCESSIBLE: std::sync::Mutex<Option<(std::time::Instant, Vec<RepoSummary>)>> = std::sync::Mutex::new(None);

/// Every repo the viewer can access (all pages), cached for ten minutes.
fn accessible_repos() -> Result<Vec<RepoSummary>> {
    if let Some((at, rows)) = ACCESSIBLE.lock().unwrap().as_ref() {
        if at.elapsed() < std::time::Duration::from_secs(600) {
            return Ok(rows.clone());
        }
    }
    let v = gh(&["api", "--paginate", "--slurp", "/user/repos?sort=pushed&per_page=100&affiliation=owner,collaborator,organization_member"])?;
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
    *ACCESSIBLE.lock().unwrap() = Some((std::time::Instant::now(), rows.clone()));
    Ok(rows)
}

/// Repos the viewer can access, most recently pushed first, filtered by every word of `query`
/// against `owner/name` and description; falls back to GitHub search for repos outside that set.
pub fn repos(query: Option<&str>) -> Result<Vec<RepoSummary>> {
    let all = accessible_repos()?;
    let Some(q) = query.map(str::trim).filter(|q| !q.is_empty()) else {
        return Ok(all.into_iter().take(60).collect());
    };
    let words: Vec<String> = q.to_lowercase().split(|c: char| c.is_whitespace() || c == '/').filter(|w| !w.is_empty()).map(str::to_string).collect();
    let mut rows: Vec<RepoSummary> = all
        .into_iter()
        .filter(|r| {
            let hay = format!("{} {}", r.full_name, r.description).to_lowercase();
            words.iter().all(|w| hay.contains(w.as_str()))
        })
        .take(60)
        .collect();
    if rows.len() < 5 {
        let found = gh(&["search", "repos", q, "--limit=20", "--json", "fullName,description,updatedAt"]).unwrap_or_default();
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

pub fn repo_open_prs(full_repo: &str) -> Result<Vec<PrSummary>> {
    let v = gh(&["pr", "list", "-R", full_repo, "--state=open", "--limit=60", "--json", "number,title,author,updatedAt,isDraft,url"])?;
    Ok(v.as_array()
        .into_iter()
        .flatten()
        .map(|p| PrSummary {
            repo: full_repo.into(),
            number: p["number"].as_u64().unwrap_or(0),
            title: p["title"].as_str().unwrap_or_default().into(),
            author: p["author"]["login"].as_str().unwrap_or_default().into(),
            updated_at: p["updatedAt"].as_str().unwrap_or_default().into(),
            is_draft: p["isDraft"].as_bool().unwrap_or(false),
            url: p["url"].as_str().unwrap_or_default().into(),
        })
        .collect())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrDetails {
    pub number: u64,
    pub title: String,
    pub url: String,
    pub author: Value,
    pub head_ref_name: String,
    pub base_ref_name: String,
    pub additions: u64,
    pub deletions: u64,
    pub changed_files: u64,
    pub base_sha: String,
    pub head_sha: String,
    pub state: String,
}

pub fn pr_details(pr: &PrRef) -> Result<PrDetails> {
    let v = gh(&["api", &format!("repos/{}/pulls/{}", pr.full_repo(), pr.number)])?;
    Ok(PrDetails {
        number: pr.number,
        title: v["title"].as_str().unwrap_or_default().into(),
        url: v["html_url"].as_str().unwrap_or_default().into(),
        author: serde_json::json!({ "login": v["user"]["login"] }),
        head_ref_name: v["head"]["ref"].as_str().unwrap_or_default().into(),
        base_ref_name: v["base"]["ref"].as_str().unwrap_or_default().into(),
        additions: v["additions"].as_u64().unwrap_or(0),
        deletions: v["deletions"].as_u64().unwrap_or(0),
        changed_files: v["changed_files"].as_u64().unwrap_or(0),
        base_sha: v["base"]["sha"].as_str().unwrap_or_default().into(),
        head_sha: v["head"]["sha"].as_str().unwrap_or_default().into(),
        state: v["state"].as_str().unwrap_or_default().into(),
    })
}

#[cfg(test)]
mod tests {
    use super::PrRef;

    #[test]
    fn parses_pr_refs() {
        let want = Some(PrRef { owner: "acme".into(), repo: "widgets".into(), number: 2613 });
        assert_eq!(PrRef::parse("https://github.com/acme/widgets/pull/2613"), want);
        assert_eq!(PrRef::parse("https://github.com/acme/widgets/pull/2613/files?x=1"), want);
        assert_eq!(PrRef::parse("acme/widgets#2613"), want);
        assert_eq!(PrRef::parse("acme/widgets/2613"), want);
        assert_eq!(PrRef::parse("github.com/acme/widgets/pull/2613"), want);
        assert_eq!(PrRef::parse("nonsense"), None);
    }
}
