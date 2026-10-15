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
    /// Type errors and lint findings are being computed.
    pub diagnosing: bool,
    /// The reviewer's agent is reviewing the PR (or waiting for its turn).
    pub reviewing: bool,
    /// AI spend today, this month and on this PR, with the daily cap.
    pub spend: grain_store::Spend,
}

/// Go to definition or find references for the name at a position in the new version of a file.
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub(crate) struct NavigateRequest {
    pub file: String,
    /// 1-based line in the new version.
    pub line: u32,
    /// 0-based column of the name.
    pub character: u32,
    pub name: String,
    pub references: bool,
    /// The name is on the old side of the diff (removed or replaced code); it's looked up in the new
    /// version near the same line.
    #[serde(default)]
    #[ts(optional)]
    pub old_side: Option<bool>,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub(crate) struct NavigateResponse {
    /// Set when an old-side name no longer appears in the new version of the file.
    pub removed: bool,
    /// False when found by name search (other languages, or the language server is unavailable).
    pub precise: bool,
    pub results: Vec<NavLocation>,
    /// More matches than shown.
    pub truncated: bool,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub(crate) struct NavLocation {
    pub file: String,
    /// 1-based.
    pub line: u32,
    /// The lines around it, starting at `snippet_start` (1-based).
    pub snippet: Vec<String>,
    pub snippet_start: u32,
    /// The change in this review that holds this line, if any.
    pub block: Option<usize>,
}

/// A reviewer's question to their agent about one change.
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub(crate) struct AskRequest {
    /// Block content key.
    pub key: String,
    pub question: String,
    /// Selected lines, when asking about specific code.
    pub code: Option<String>,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub(crate) struct AskResponse {
    pub answer: String,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub(crate) struct SummarizeRequest {
    /// Block content keys, or `chapter:` + a chapter key, to summarize, nearest first.
    pub keys: Vec<String>,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub(crate) struct DiffRequest {
    /// Paths (old or new) whose diff sections to return; empty for the whole PR.
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
pub(crate) struct PickFolderRequest {
    /// Shown in the picker window, e.g. "Choose your clone of acme/widgets".
    pub prompt: String,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub(crate) struct PickFolderResponse {
    /// The chosen folder, or `null` when the reviewer cancelled.
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

/// AI spend for the Settings page: totals and this month's spend per PR, highest first.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub(crate) struct UsageReport {
    pub spend: grain_store::Spend,
    pub prs: Vec<PrSpend>,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub(crate) struct PrSpend {
    pub pr: String,
    pub cost: f64,
    pub requests: usize,
}

/// Models an agent offers, for the Settings pickers.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub(crate) struct ModelsResponse {
    pub models: Vec<grain_agent::models::ModelOption>,
    /// What "Automatic" would use for summaries right now; none means the agent's default.
    pub summary_auto: Option<grain_agent::models::ModelOption>,
    /// False when the models.dev catalog couldn't be fetched (no prices or dates).
    pub catalog: bool,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ModelsQuery {
    pub agent: String,
}

/// Where code outside the PR uses one changed name of a file.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub(crate) struct OutsideUse {
    pub name: String,
    pub locations: Vec<NavLocation>,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub(crate) struct OutsideUsesResponse {
    /// False when found by name search (other languages, or the language server is unavailable).
    pub precise: bool,
    pub uses: Vec<OutsideUse>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SourceQuery {
    pub path: String,
    /// `base` for the version the PR started from (the merge base); the PR's head otherwise.
    pub rev: Option<String>,
}

/// Outside uses of every changed file, computed in the background for one head (`outside-uses.json`).
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub(crate) struct OutsideUsesFile {
    pub head: String,
    pub files: std::collections::BTreeMap<String, OutsideUsesResponse>,
}
