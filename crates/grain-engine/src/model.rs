//! The review the engine produces. Serialized as `review.json` and exported to TypeScript.

use serde::Serialize;
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Review {
    /// Feature-level groups of review blocks, in reading order.
    pub chapters: Vec<Chapter>,
    /// Ids of low-attention blocks (lockfiles, assets, repeated or mechanical edits).
    pub skim: Vec<usize>,
    pub blocks: Vec<Block>,
    pub total_lines: usize,
    /// False after a fast first pass: outside-usage facts are still being computed.
    pub complete: bool,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Chapter {
    pub id: usize,
    pub title: String,
    pub dir: String,
    pub lines: usize,
    pub layer: u8,
    pub blocks: Vec<usize>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Block {
    /// Position in reading order; changes when the PR is regrouped.
    pub id: usize,
    /// Stable identity (files + changed entities); survives regrouping and renumbering.
    pub key: String,
    /// Changes whenever the block's actual changes do: a reviewed block whose hash differs after
    /// a new push needs another look.
    pub content_hash: String,
    pub lines: usize,
    pub files: Vec<String>,
    pub entities: Vec<String>,
    pub residue_files: Vec<String>,
    pub mechanical_entities: usize,
    pub has_tests: bool,
    pub kind: String,
    /// Why the block only needs skimming, if it does.
    pub skim: Option<String>,
    /// Foundations-first layer: 0 data/services, 1 hooks/state, 2 components, 3 screens, 4 other.
    pub layer: u8,
    pub dir: String,
    pub changes: Vec<EntityChange>,
    /// Production code outside the PR that depends on this block's changes.
    pub used_by: usize,
    pub used_by_sample: Vec<String>,
    pub checks: Vec<Check>,
    pub est_risk: Risk,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct EntityChange {
    pub change: String,
    pub kind: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub old_name: Option<String>,
    pub file: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Check {
    pub level: CheckLevel,
    pub text: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum CheckLevel {
    Warn,
    Info,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum Risk {
    Low,
    Medium,
    High,
}

/// Engine output: the review plus human-readable stats for logs and `grain analyze`.
#[derive(Debug, Clone)]
pub struct Analysis {
    pub review: Review,
    pub summary: String,
}
