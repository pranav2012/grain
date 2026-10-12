//! Grain's review engine: turns a git range into chapters, blocks and a skim bucket,
//! with facts, rule checks and estimated risk that need no AI.
//!
//! Pipeline: `diff` (hunks, units) → `grouping` (blocks, chapters) → `facts` (checks, risk).

mod classify;
mod diff;
mod facts;
mod grouping;
mod model;
mod pipeline;

pub use model::{Analysis, Block, Chapter, Check, CheckLevel, EntityChange, Review, Risk};
pub use pipeline::analyze;
