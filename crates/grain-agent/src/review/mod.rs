//! A full PR review by the reviewer's own agent: Grain's bundled review skill, run read-only in
//! Grain's checkout of the PR. Findings are a second
//! opinion shown next to the code; nothing here posts anything.

use std::path::Path;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::agent::Agent;
use crate::policy::policy_check;
use crate::transport::cli;

/// Grain's review-only copy of the `global-pr-review` skill (steps 1-4 and its writing style).
pub const BUNDLED_SKILL: &str = include_str!("pr-review.md");

const LIMIT: Duration = Duration::from_mins(25);

const SCHEMA: &str = r#"{"type":"object","additionalProperties":false,"required":["findings"],
"properties":{"findings":{"type":"array","items":{"type":"object","additionalProperties":false,
"required":["file","line","endLine","category","score","title","why","fix","comment"],
"properties":{"file":{"type":"string"},"line":{"type":"integer"},"endLine":{"type":"integer"},
"category":{"type":"string","enum":["standards","security","readability","optimization","breakage","edge cases","blast radius","ops"]},
"score":{"type":"integer","enum":[50,75,100]},"title":{"type":"string"},"why":{"type":"string"},
"fix":{"type":"string"},"comment":{"type":"string"}}}}}}"#;

/// One verified finding, at lines of the PR's new code.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Finding {
    pub file: String,
    pub line: usize,
    pub end_line: usize,
    pub category: String,
    /// 50, 75 or 100, as the skill scores them.
    pub score: u8,
    /// The issue in one line.
    pub title: String,
    pub why: String,
    pub fix: String,
    /// The inline comment to post if the reviewer keeps it, in the skill's writing style.
    pub comment: String,
}

/// A finished (or failed) review of one head commit, stored as `ai-review.json`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AiReview {
    pub head: String,
    pub agent: Agent,
    pub skill_hash: String,
    pub findings: Vec<Finding>,
    pub error: Option<String>,
    /// What the review used, when the agent reported it.
    pub usage: Option<crate::Usage>,
    /// Why the review didn't run by itself (only routine changes, or a large PR that would cost a lot);
    /// the reviewer can start it anyway.
    pub paused: Option<String>,
    /// Changed lines of code the review covered, for estimating what later reviews cost.
    #[ts(type = "number")]
    pub lines: u64,
    /// The earlier head this review built on: only files changed since then were reviewed again.
    pub since: Option<String>,
    #[ts(type = "number")]
    pub ms: u64,
}

/// What Grain tells the agent about the PR.
pub struct PrContext<'a> {
    pub repo: &'a str,
    pub number: u64,
    pub title: &'a str,
    pub merge_base: &'a str,
    pub head: &'a str,
    pub files: &'a [String],
    /// Existing review comments, one per line as `path:line: text`, so settled points aren't raised again.
    pub prior_comments: &'a [String],
    /// A follow-up after new commits: the head reviewed before, and the files changed since then.
    pub since: Option<(&'a str, &'a [String])>,
}

fn prompt(skill: &str, pr: &PrContext) -> String {
    let files = pr.files.iter().map(|f| format!("- {f}")).collect::<Vec<_>>().join("\n");
    let prior = if pr.prior_comments.is_empty() { "none".to_string() } else { pr.prior_comments.join("\n") };
    format!(
        "{skill}\n\n---\n\nYou are running inside Grain, a local code review app, as a second opinion for the human \
         reviewer of {repo}#{number} \"{title}\". The PR is checked out in the working directory at its head.\n\
         Merge base: {base}\nHead: {head}\nRead the changes with `git diff {base} {head}`.\n\nChanged files:\n{files}\n\n\
         Existing review comments on the PR:\n{prior}\n\n\
         {follow_up}Do steps 1 to 4 of the review above, completely, then stop: don't ask for approval, don't post anything to \
         GitHub and don't modify any file. Return every finding that survived step 4 with a score of 50 or more, \
         most severe first, as JSON matching the schema. `line` and `endLine` are line numbers in the head version of \
         `file`. `title` is the issue in one line, `why` why it matters, `fix` the suggested fix, and `comment` the \
         inline comment exactly as the writing style above says to write it. Return an empty list when nothing \
         survives.",
        follow_up = pr.since.map_or_else(String::new, |(since, focus)| format!(
            "This is a follow-up: the PR was already reviewed at {since}. Only these files changed since then:\n{}\n\
             Review the PR's changes in these files only (`git diff {since} {head} -- <file>` shows what is new); \
             report findings only in them.\n\n",
            focus.iter().map(|f| format!("- {f}")).collect::<Vec<_>>().join("\n"),
            head = pr.head,
        )),
        repo = pr.repo,
        number = pr.number,
        title = pr.title,
        base = pr.merge_base,
        head = pr.head,
    )
}

/// Runs Grain's review skill on the PR checked out at `checkout`. Takes minutes; errors explain what
/// went wrong. Usage is returned either way, since a failed run can still have used tokens.
pub fn review(
    agent: Agent,
    model: Option<&str>,
    checkout: &Path,
    pr: &PrContext,
    cache_dir: &Path,
) -> (Result<Vec<Finding>, String>, Option<crate::Usage>) {
    if let Some(reason) = policy_check(agent, model) {
        return (Err(reason), None);
    }
    let prompt = prompt(BUNDLED_SKILL, pr);
    let res = match agent {
        Agent::Claude => cli::claude_review(&prompt, SCHEMA, model, checkout, LIMIT),
        Agent::Codex => cli::codex_review(&prompt, SCHEMA, model, checkout, LIMIT),
        Agent::Opencode => cli::opencode_review(
            &format!("{prompt}\n\nReply with ONLY JSON matching: {SCHEMA}"),
            model,
            checkout,
            LIMIT,
        ),
    };
    let priced = |u: Option<crate::Usage>| {
        u.map(|mut u| {
            crate::usage::price(&mut u, agent, crate::models::Catalog::load(cache_dir).as_ref());
            u
        })
    };
    match res {
        Ok((Some(v), out)) => (
            serde_json::from_value::<Vec<Finding>>(v["findings"].clone())
                .map_err(|e| format!("unexpected answer: {e}")),
            priced(out.usage),
        ),
        Ok((None, out)) => {
            let raw = format!("{}\n{}", out.stdout, out.stderr);
            let raw = raw.trim();
            (Err(raw[raw.floor_char_boundary(raw.len().saturating_sub(800))..].to_string()), priced(out.usage))
        }
        Err(e) => (Err(e.to_string()), None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_skill_keeps_the_review_steps_and_style() {
        for heading in
            ["## 1. Learn this project", "## 3. Review from multiple angles", "## 4. Verify before", "## Writing style"]
        {
            assert!(BUNDLED_SKILL.contains(heading), "{heading}");
        }
        assert!(!BUNDLED_SKILL.contains("post_review.py"));
    }

    #[test]
    fn schema_is_valid_json() -> Result<(), serde_json::Error> {
        serde_json::from_str::<serde_json::Value>(SCHEMA).map(|_| ())
    }
}
