use anyhow::Result;
use serde::Serialize;
use ts_rs::TS;

use crate::gh::gh;
use crate::pr_ref::PrRef;

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
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
    let v = gh(&[
        "search",
        "prs",
        filter,
        "--state=open",
        "--limit=50",
        "--sort=updated",
        "--json",
        "repository,number,title,author,updatedAt,isDraft,url",
    ])?;
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

pub fn repo_open_prs(full_repo: &str) -> Result<Vec<PrSummary>> {
    let v = gh(&[
        "pr",
        "list",
        "-R",
        full_repo,
        "--state=open",
        "--limit=60",
        "--json",
        "number,title,author,updatedAt,isDraft,url",
    ])?;
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

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct Author {
    pub login: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PrDetails {
    pub number: u64,
    pub title: String,
    pub url: String,
    pub author: Author,
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
        author: Author { login: v["user"]["login"].as_str().unwrap_or_default().into() },
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
