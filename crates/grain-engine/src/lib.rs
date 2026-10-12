//! Grain's review engine: turns a git range into ordered layers of blocks and a skim bucket,
//! with facts, rule checks and estimated risk that need no AI.
//!
//! Pipeline: `diff` (hunks, units) → `grouping` (blocks, layers) → `facts` (checks, risk).

mod classify;
mod diff;
mod facts;
mod grouping;
mod model;
mod pipeline;

pub use facts::usage::UsageProvider;
pub use model::{Analysis, Block, BlockLink, Check, CheckLevel, EntityChange, Layer, Review, Risk, Slice};
pub use pipeline::{Depth, analyze, analyze_with, analyze_with_usage};

/// Version of the [`Review`] format. Bump when the engine's output changes (fields or grouping),
/// so stored reviews are recomputed instead of being shown in an outdated shape.
pub const REVIEW_FORMAT: u32 = 8;
