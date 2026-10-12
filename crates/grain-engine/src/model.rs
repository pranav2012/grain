//! The review the engine produces. Serialized as `review.json` and exported to TypeScript.

use serde::Serialize;
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Review {
    /// Small, ordered review steps: foundations first, each a few related blocks.
    pub layers: Vec<Layer>,
    /// How the review reads: user flows (page or screen → the changed code it runs), then the rest.
    pub story: Story,
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

/// The review as chapters to read. `flows` is false until the whole repository has been analyzed,
/// and for languages without known entry points; chapters are then areas of the codebase.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Story {
    pub chapters: Vec<Chapter>,
    pub flows: bool,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Chapter {
    /// Position in the story, from 1.
    pub id: usize,
    /// Stable identity from the title and blocks; chapter intros are cached by it.
    pub key: String,
    pub kind: ChapterKind,
    /// A route (`/voucher/[bookingId]`), a screen, an area (`src/features/voucher`) or a fixed name.
    pub title: String,
    /// The page or screen file a flow starts at.
    pub entry: Option<String>,
    /// One plain line on what the chapter holds, from the code.
    pub about: String,
    pub sections: Vec<Section>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ChapterKind {
    /// A page or screen and the changed code it runs.
    Flow,
    /// Small flows from several screens.
    Screens,
    /// Code only preview, dummy or debug pages reach.
    Preview,
    /// Changed code no flow reaches.
    Also,
    /// One area of the codebase (when there are no flows).
    Area,
    /// Skim blocks.
    Routine,
}

/// Part of a chapter: in a flow, the component that leads to these changes; elsewhere, an area.
/// Blocks are in reading order (call order in flows). The title is empty for a single section.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Section {
    pub title: String,
    pub blocks: Vec<usize>,
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
    /// Stage of the review it belongs to, in reading order: `Foundations`, `Hooks and state`,
    /// `Components`, `Screens`, `Code`, `Tests`. Layers are sorted by stage.
    pub stage: String,
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
