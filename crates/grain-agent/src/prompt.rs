use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub(crate) const PROMPT: &str = "You are helping a human review one block of a pull request.\n\
Answer only from the diff below; do not use tools.\n\
title: <= 8 words, what this block does. intent: 1-2 sentences on the behavior change.\n\
risk: low|medium|high. risk_reasons: concrete, specific to this diff. reviewer_questions: 2-4 sharp questions.\n\nDIFF:\n";

pub(crate) const SCHEMA: &str = r#"{"type":"object","additionalProperties":false,
"required":["title","intent","risk","risk_reasons","reviewer_questions"],
"properties":{"title":{"type":"string"},"intent":{"type":"string"},
"risk":{"type":"string","enum":["low","medium","high"]},
"risk_reasons":{"type":"array","items":{"type":"string"}},
"reviewer_questions":{"type":"array","items":{"type":"string"}}}}"#;

/// What the agent returns for one block; shape enforced by [`SCHEMA`].
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Summary {
    pub title: String,
    pub intent: String,
    pub risk: String,
    pub risk_reasons: Vec<String>,
    pub reviewer_questions: Vec<String>,
}

/// Extracts the first top-level JSON object from free text (tolerates stray prose or fences).
pub(crate) fn extract_json(text: &str) -> Option<serde_json::Value> {
    let (start, end) = (text.find('{')?, text.rfind('}')?);
    serde_json::from_str(&text[start..=end]).ok()
}
