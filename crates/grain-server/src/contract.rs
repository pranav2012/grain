//! Request and response bodies of the HTTP API, exported to TypeScript for the UI.

use grain_agent::Agent;
use grain_github::PrSummary;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub(crate) struct Me {
    pub login: String,
    pub agents_installed: Vec<Agent>,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub(crate) struct Inbox {
    pub review_requests: Vec<PrSummary>,
    pub mine: Vec<PrSummary>,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub(crate) struct RecentReview {
    pub repo: String,
    pub number: u64,
    pub title: String,
    pub author: String,
    pub url: String,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub(crate) struct OpenRequest {
    /// A GitHub PR link, `owner/repo#123` or `owner/repo/123`.
    pub pr: String,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub(crate) struct OpenResponse {
    /// `owner/repo/123`
    pub id: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub(crate) enum Stage {
    Preparing,
    Ready,
    Failed,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub(crate) struct Job {
    pub stage: Stage,
    pub message: String,
}

#[derive(Debug, Clone, Default, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub(crate) struct SummarizerStatus {
    pub running: bool,
    pub pending: usize,
    pub fresh_requests: usize,
    /// Why summaries stopped for this review (usage limit, policy, cap); nothing more is sent.
    pub stopped: Option<String>,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub(crate) struct Status {
    pub job: Job,
    pub summarizer: Option<SummarizerStatus>,
    pub agent: Option<Agent>,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub(crate) struct SummarizeRequest {
    /// Block content keys to summarize, nearest first.
    pub keys: Vec<String>,
}
