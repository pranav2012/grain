//! Request and response bodies of the HTTP API, exported to TypeScript for the UI.

use grain_agent::Agent;
use grain_github::{LineComment, PrSummary, ReviewEvent, ReviewPayload};
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
    #[ts(type = "number")]
    pub number: u64,
    pub title: String,
    pub author: String,
    pub url: String,
    /// The folder, for reviews of local changes.
    pub local_path: Option<String>,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub(crate) struct LocalOpenRequest {
    /// A folder inside a git repository; `~/` is expanded.
    pub path: String,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub(crate) struct LocalCandidate {
    pub path: String,
    pub name: String,
    /// `null` on a detached HEAD.
    pub branch: Option<String>,
    /// When git last touched the repository (Unix seconds).
    #[ts(type = "number")]
    pub active_at: u64,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub(crate) struct OpenRequest {
    /// A GitHub PR link, `owner/repo#123` or `owner/repo/123`.
    pub pr: String,
    /// Wait for new commits or local edits instead of showing the stored review right away.
    #[serde(default)]
    pub refresh: bool,
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
    /// Grain needs to know whether the reviewer already has this repository locally.
    NeedsRepo,
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
#[serde(rename_all = "camelCase")]
pub(crate) struct Status {
    pub job: Job,
    pub summarizer: Option<SummarizerStatus>,
    pub agent: Option<Agent>,
    pub auto_summarize: bool,
    /// The review is open; whole-repo facts are still being added.
    pub enriching: bool,
    /// Head commit of the stored review; differs from the open one when new commits arrived.
    pub head_sha: Option<String>,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub(crate) struct SummarizeRequest {
    /// Block content keys to summarize, nearest first.
    pub keys: Vec<String>,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub(crate) struct DiffRequest {
    /// Paths (old or new) whose diff sections to return.
    pub files: Vec<String>,
    /// Diff from this earlier head instead of from the base: what changed since a past review.
    #[serde(default)]
    pub since: Option<String>,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub(crate) struct LocalRepo {
    /// Whether the reviewer has answered already.
    pub asked: bool,
    /// Their local clone to borrow from; `null` (when asked) means download a copy.
    pub path: Option<String>,
    /// Folders on this machine that look like this repository.
    pub candidates: Vec<String>,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub(crate) struct LocalRepoRequest {
    /// Path of an existing clone, or `null` to download a copy.
    pub path: Option<String>,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub(crate) struct ThreadReplyRequest {
    pub body: String,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
pub(crate) struct ThreadResolved {
    pub resolved: bool,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub(crate) struct SubmitRequest {
    pub event: ReviewEvent,
    /// Overall review text (already including block-level notes).
    pub body: String,
    pub comments: Vec<LineComment>,
    /// The head commit the reviewer actually looked at.
    pub commit_id: String,
    /// Build and return the payload without posting anything.
    #[serde(default)]
    pub dry_run: bool,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub(crate) struct SubmitResponse {
    /// Link to the posted review; `null` for a dry run.
    pub url: Option<String>,
    pub payload: ReviewPayload,
    /// Line comments outside the diff, moved into the review text so GitHub accepts the review.
    pub moved_to_body: usize,
}
