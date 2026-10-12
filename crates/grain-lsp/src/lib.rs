//! Precise "who uses this code" facts from language servers. Today: TypeScript 7 for TS/JS,
//! downloaded once from npm when missing. Every failure falls back to the engine's entity graph.

mod client;
pub mod typescript;
mod usage;

pub use usage::TsUsage;
