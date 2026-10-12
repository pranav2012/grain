use anyhow::Result;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::gh::gh_with_input;
use crate::pr_ref::PrRef;

/// A comment on specific lines of the diff.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LineComment {
    pub path: String,
    /// Last line of the range (a single line when `start_line` is absent).
    pub line: u32,
    /// `RIGHT` for new code, `LEFT` for removed code.
    pub side: String,
    pub start_line: Option<u32>,
    pub body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum ReviewEvent {
    #[serde(rename = "COMMENT")]
    Comment,
    #[serde(rename = "APPROVE")]
    Approve,
    #[serde(rename = "REQUEST_CHANGES")]
    RequestChanges,
}

/// What gets posted: one review on `commit_id` with a summary and line comments.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct ReviewPayload {
    pub commit_id: String,
    pub event: ReviewEvent,
    pub body: String,
    pub comments: Vec<PayloadComment>,
}

/// GitHub's wire format for a review comment.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct PayloadComment {
    pub path: String,
    pub line: u32,
    pub side: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub start_line: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub start_side: Option<String>,
    pub body: String,
}

/// Posts one review as the signed-in `gh` user and returns its URL.
pub fn submit_review(pr: &PrRef, payload: &ReviewPayload) -> Result<String> {
    let path = format!("repos/{}/pulls/{}/reviews", pr.full_repo(), pr.number);
    let v = gh_with_input(&["api", &path, "-X", "POST", "--input", "-"], &serde_json::to_string(payload)?)?;
    Ok(v["html_url"].as_str().unwrap_or_default().to_string())
}
