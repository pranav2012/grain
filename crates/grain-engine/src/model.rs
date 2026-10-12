//! The review the engine produces. Serialized as `review.json` and exported to TypeScript.

use serde::Serialize;
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Review {
    /// Small, ordered review steps: foundations first, each a few related blocks.
    pub layers: Vec<Layer>,
    /// Ids of low-attention blocks (lockfiles, assets, repeated or mechanical edits).
    pub skim: Vec<usize>,
    pub blocks: Vec<Block>,
    pub total_lines: usize,
    /// False after a fast first pass: outside-usage facts are still being computed.
    pub complete: bool,
    /// Which blocks use which, for the map.
    pub links: Vec<BlockLink>,
}

/// Code changed in block `from` uses code changed in block `to`.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BlockLink {
    pub from: usize,
    pub to: usize,
    /// How many changed entities connect them.
    pub weight: usize,
}

/// One step of the review: blocks that belong together (code that uses each other, code and its
/// tests), ordered so code comes after what it builds on, and capped so it fits one sitting.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Layer {
    /// Position in reading order, from 1.
    pub id: usize,
    /// Stable identity from the member blocks' keys; layer summaries are cached by it.
    pub key: String,
    /// Main files, e.g. `voucherApi, useVoucher and 2 more`.
    pub title: String,
    /// What kind of code it is: `Data and services`, `Hooks and state`, `Components`, `Screens`, `Code` or `Tests`.
    pub role: String,
    pub dir: String,
    pub lines: usize,
    /// Block ids in reading order.
    pub blocks: Vec<usize>,
    /// Other layers whose changed code this one uses.
    pub uses: Vec<usize>,
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
    /// Set when a huge single-file change was cut into parts: which part, and the lines it covers.
    pub slice: Option<Slice>,
}

/// One part of a huge single-file change: whole entities in file order, about 200 lines each.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Slice {
    pub part: usize,
    pub of: usize,
    /// Inclusive line ranges on the new side; diff hunks touching them belong to this part.
    pub new_lines: Vec<(usize, usize)>,
    /// Inclusive line ranges on the old side (removed code).
    pub old_lines: Vec<(usize, usize)>,
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
