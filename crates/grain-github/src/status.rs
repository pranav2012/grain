use anyhow::Result;
use serde::Serialize;
use serde_json::Value;
use ts_rs::TS;

use crate::gh::gh;
use crate::pr_ref::PrRef;

/// Where a PR stands on GitHub: reviews, discussion, CI and whether it can merge.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PrStatus {
    /// `OPEN`, `MERGED` or `CLOSED`.
    pub state: String,
    pub is_draft: bool,
    /// `APPROVED`, `CHANGES_REQUESTED`, `REVIEW_REQUIRED` or none.
    pub review_decision: Option<String>,
    /// `MERGEABLE`, `CONFLICTING` or `UNKNOWN`.
    pub mergeable: String,
    /// GitHub's `mergeStateStatus`: `CLEAN`, `BLOCKED`, `BEHIND`, `DIRTY`, `UNSTABLE`, …
    pub merge_state: String,
    pub reviewers: Vec<Reviewer>,
    pub comments: usize,
    pub body: String,
    pub checks: Vec<CheckRun>,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Reviewer {
    /// A login, or `org/team` for a requested team.
    pub name: String,
    /// `APPROVED`, `CHANGES_REQUESTED`, `COMMENTED`, `DISMISSED` or `REQUESTED` (not reviewed yet).
    pub state: String,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CheckRun {
    pub name: String,
    /// `queued`, `in_progress` or `completed` (commit statuses map `pending` to `in_progress`).
    pub status: String,
    /// When completed: `success`, `failure`, `neutral`, `cancelled`, `skipped`, `timed_out`, `action_required`.
    pub conclusion: Option<String>,
    pub url: String,
    pub annotations: Vec<CheckAnnotation>,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CheckAnnotation {
    pub path: String,
    pub start_line: usize,
    pub end_line: usize,
    /// `failure`, `warning` or `notice`.
    pub level: String,
    pub title: String,
    pub message: String,
}

const FAILED: [&str; 4] = ["failure", "timed_out", "action_required", "cancelled"];

fn s(v: &Value) -> String {
    v.as_str().unwrap_or_default().to_string()
}

/// Reviews, comments, merge state and CI for a PR at `head`. Annotations are fetched only for
/// failed runs (passing runs only annotate CI housekeeping), which keeps this to a few `gh` calls.
pub fn pr_status(pr: &PrRef, head: &str) -> Result<PrStatus> {
    let repo = pr.full_repo();
    let v = gh(&[
        "pr",
        "view",
        &pr.number.to_string(),
        "-R",
        &repo,
        "--json",
        "state,isDraft,reviewDecision,mergeable,mergeStateStatus,latestReviews,reviewRequests,comments,body",
    ])?;
    let mut reviewers: Vec<Reviewer> = v["latestReviews"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|r| Reviewer { name: s(&r["author"]["login"]), state: s(&r["state"]) })
        .collect();
    for r in v["reviewRequests"].as_array().into_iter().flatten() {
        let name = r["login"].as_str().map(str::to_string).unwrap_or_else(|| s(&r["name"]));
        if !name.is_empty() && !reviewers.iter().any(|x| x.name == name) {
            reviewers.push(Reviewer { name, state: "REQUESTED".into() });
        }
    }

    let runs = gh(&["api", &format!("repos/{repo}/commits/{head}/check-runs?per_page=100")])?;
    let mut checks = Vec::new();
    for r in runs["check_runs"].as_array().into_iter().flatten() {
        let conclusion = r["conclusion"].as_str().map(str::to_string);
        let failed = conclusion.as_deref().is_some_and(|c| FAILED.contains(&c));
        let annotations = if failed && r["output"]["annotations_count"].as_u64().unwrap_or(0) > 0 {
            annotations(&repo, r["id"].as_u64().unwrap_or(0)).unwrap_or_default()
        } else {
            Vec::new()
        };
        checks.push(CheckRun {
            name: s(&r["name"]),
            status: s(&r["status"]),
            conclusion,
            url: s(&r["html_url"]),
            annotations,
        });
    }
    let statuses = gh(&["api", &format!("repos/{repo}/commits/{head}/status")])?;
    for st in statuses["statuses"].as_array().into_iter().flatten() {
        let state = s(&st["state"]);
        let (status, conclusion) = if state == "pending" {
            ("in_progress", None)
        } else {
            ("completed", Some(if state == "error" { "failure".into() } else { state }))
        };
        checks.push(CheckRun {
            name: s(&st["context"]),
            status: status.into(),
            conclusion,
            url: s(&st["target_url"]),
            annotations: Vec::new(),
        });
    }
    checks.sort_by(|a, b| a.name.cmp(&b.name));

    Ok(PrStatus {
        state: s(&v["state"]),
        is_draft: v["isDraft"].as_bool().unwrap_or(false),
        review_decision: v["reviewDecision"].as_str().filter(|d| !d.is_empty()).map(str::to_string),
        mergeable: s(&v["mergeable"]),
        merge_state: s(&v["mergeStateStatus"]),
        reviewers,
        comments: v["comments"].as_array().map_or(0, Vec::len),
        body: s(&v["body"]),
        checks,
    })
}

fn annotations(repo: &str, run: u64) -> Result<Vec<CheckAnnotation>> {
    let v = gh(&["api", &format!("repos/{repo}/check-runs/{run}/annotations?per_page=100")])?;
    Ok(v.as_array()
        .into_iter()
        .flatten()
        .map(|a| CheckAnnotation {
            path: s(&a["path"]),
            start_line: a["start_line"].as_u64().unwrap_or(1) as usize,
            end_line: a["end_line"].as_u64().unwrap_or(1) as usize,
            level: s(&a["annotation_level"]),
            title: s(&a["title"]),
            message: s(&a["message"]),
        })
        .collect())
}
