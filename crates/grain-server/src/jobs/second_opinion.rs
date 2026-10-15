use std::collections::HashSet;
use std::sync::Mutex;

use anyhow::{Context, Result};
use grain_agent::review::{AiReview, Finding, PrContext};
use grain_github::PrRef;
use grain_store::{Home, Settings, read_json, write_atomic};
use sha2::{Digest, Sha256};

/// Reviews use the reviewer's plan heavily; only one runs at a time, across all PRs.
static ONE_AT_A_TIME: Mutex<()> = Mutex::new(());

/// Cost per changed line of code when there's no review history to learn from yet.
const DEFAULT_COST_PER_LINE: f64 = 0.0004;

/// Changed lines of code (not routine changes) touching `files`, from the engine's blocks.
fn code_lines(review: &serde_json::Value, files: Option<&HashSet<String>>) -> u64 {
    review["blocks"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|b| b["skim"].is_null())
        .filter(|b| {
            files.is_none_or(|fs| {
                b["files"].as_array().into_iter().flatten().any(|f| f.as_str().is_some_and(|f| fs.contains(f)))
            })
        })
        .map(|b| b["lines"].as_u64().unwrap_or(0))
        .sum()
}

/// What earlier reviews cost per line of code they covered, across all PRs.
fn cost_per_line(home: &Home) -> f64 {
    let (mut cost, mut lines) = (0.0, 0u64);
    let Ok(owners) = std::fs::read_dir(home.reviews_root()) else { return DEFAULT_COST_PER_LINE };
    for review in owners
        .flatten()
        .flat_map(|o| std::fs::read_dir(o.path()).into_iter().flatten().flatten())
        .flat_map(|r| std::fs::read_dir(r.path()).into_iter().flatten().flatten())
    {
        let Some(r) = read_json(&review.path().join("ai-review.json")) else { continue };
        if let (Some(c), Some(l)) = (r["usage"]["costUsd"].as_f64(), r["lines"].as_u64().filter(|l| *l > 0)) {
            cost += c;
            lines += l;
        }
    }
    if lines >= 200 { cost / lines as f64 } else { DEFAULT_COST_PER_LINE }
}

/// Runs Grain's review skill on the PR's head with the reviewer's agent and writes `ai-review.json`.
/// Skipped without an agent, with the setting off, before the full checkout exists, or when this head
/// was already reviewed with the same agent and skill. Unless `force`d (the reviewer asked), it also
/// holds back on routine-only PRs and on reviews estimated to cost a large share of the daily budget,
/// and after new commits it reviews only the files changed since the last review.
pub(crate) fn run(home: &Home, settings: &Settings, pr: &PrRef, force: bool) -> Result<()> {
    let Some(agent) = settings.agent.filter(|_| settings.second_opinion) else { return Ok(()) };
    let out_dir = home.review_dir(pr);
    let pr_json = read_json(&out_dir.join("pr.json")).context("PR not prepared")?;
    let head = pr_json["headSha"].as_str().unwrap_or_default().to_string();
    let merge_base = pr_json["mergeBase"].as_str().unwrap_or_default().to_string();
    let skill_hash = format!("{:x}", Sha256::digest(grain_agent::review::BUNDLED_SKILL))[..16].to_string();
    let target = out_dir.join("ai-review.json");
    let previous = read_json(&target).and_then(|r| serde_json::from_value::<AiReview>(r).ok());
    let same_setup = |r: &AiReview| r.agent == agent && r.skill_hash == skill_hash;
    if !force && previous.as_ref().is_some_and(|r| r.head == head && same_setup(r)) {
        return Ok(());
    }
    let Some(review_json) = read_json(&out_dir.join("review.json")) else { return Ok(()) };
    if !pr.is_local() && review_json["complete"] != true {
        return Ok(());
    }
    let _turn = ONE_AT_A_TIME.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    let write = |review: &AiReview| -> Result<()> {
        // A newer push may have been prepared meanwhile; only keep results for the current head.
        let current = read_json(&out_dir.join("pr.json")).and_then(|v| v["headSha"].as_str().map(str::to_string));
        if current.as_deref() == Some(review.head.as_str()) {
            write_atomic(&target, serde_json::to_string(review)?.as_bytes())?;
        }
        Ok(())
    };
    let base = AiReview {
        head: head.clone(),
        agent,
        skill_hash: skill_hash.clone(),
        findings: Vec::new(),
        error: None,
        ms: 0,
        usage: None,
        paused: None,
        lines: 0,
        since: None,
    };
    if let Some(why) = home.over_budget() {
        return write(&AiReview { error: Some(why), ..base });
    }
    let git = super::prepare::git_dir(home, pr)?;
    let files = grain_git::changed_paths(&git, &merge_base, &head)?;

    // After new commits, only files changed since the last good review need another look.
    let carried =
        previous.filter(|r| same_setup(r) && r.error.is_none() && r.paused.is_none() && r.head != head && !force);
    let focus: Option<(String, Vec<String>)> = carried.as_ref().and_then(|r| {
        let since: HashSet<String> = grain_git::changed_paths(&git, &r.head, &head).ok()?.into_iter().collect();
        Some((r.head.clone(), files.iter().filter(|f| since.contains(*f)).cloned().collect()))
    });
    let keep = |old: &AiReview, focus: &[String]| -> Vec<Finding> {
        old.findings.iter().filter(|f| !focus.contains(&f.file) && files.contains(&f.file)).cloned().collect()
    };
    if let (Some(old), Some((since, focus))) = (&carried, &focus)
        && focus.is_empty()
    {
        return write(&AiReview { findings: keep(old, focus), since: Some(since.clone()), lines: old.lines, ..base });
    }

    let lines =
        code_lines(&review_json, focus.as_ref().map(|(_, f)| f.iter().cloned().collect::<HashSet<_>>()).as_ref());
    // New commits that only touched routine files: nothing new to review, keep the earlier findings.
    if let (Some(old), Some((since, focus)), 0) = (&carried, &focus, lines) {
        return write(&AiReview { findings: keep(old, focus), since: Some(since.clone()), lines: old.lines, ..base });
    }
    if !force && lines == 0 {
        return write(&AiReview {
            paused: Some(
                "Only routine changes (lockfiles, generated files, docs, formatting); nothing for a review to look at."
                    .into(),
            ),
            ..base
        });
    }
    let estimate = lines as f64 * cost_per_line(home);
    let budget = settings.daily_budget_usd;
    let left = if budget > 0.0 { budget - home.spend(None).today } else { f64::INFINITY };
    let limit = if budget > 0.0 { (budget * 0.25).max(0.5) } else { 1.0 };
    if !force && (estimate > limit || estimate > left) {
        return write(&AiReview {
            paused: Some(format!(
                "This PR has about {lines} changed lines of code; a second opinion would cost about ${estimate:.2}{}.",
                if estimate > left {
                    format!(", more than the ${left:.2} left in today's budget")
                } else {
                    String::new()
                }
            )),
            lines,
            ..base
        });
    }

    let checkout = if pr.is_local() { super::local::repo_path(home, pr)? } else { home.worktree_dir(pr) };
    let prior: Vec<String> = if pr.is_local() {
        Vec::new()
    } else {
        grain_github::conversation(pr)
            .map(|c| {
                c.threads
                    .iter()
                    .filter_map(|t| {
                        let first = t.comments.first()?;
                        let state = if t.resolved { " (resolved)" } else { "" };
                        Some(format!("{}:{}{state}: {}", t.path, t.line.unwrap_or(0), first.body.replace('\n', " ")))
                    })
                    .collect()
            })
            .unwrap_or_default()
    };
    let repo = pr.full_repo();
    let title = pr_json["title"].as_str().unwrap_or_default();
    let context = PrContext {
        repo: &repo,
        number: pr.number,
        title,
        merge_base: &merge_base,
        head: &head,
        files: &files,
        prior_comments: &prior,
        since: focus.as_ref().map(|(since, f)| (since.as_str(), f.as_slice())),
    };
    let started = std::time::Instant::now();
    let (result, usage) = grain_agent::review::review(agent, settings.model.as_deref(), &checkout, &context);
    if let Some(u) = &usage {
        home.record_usage(&format!("{repo}/{}", pr.number), "review", agent, u);
    }
    let ms = started.elapsed().as_millis() as u64;
    let (mut findings, error) = match result {
        Ok(f) => (f, None),
        Err(e) => (Vec::new(), Some(e)),
    };
    if let (Some(old), Some((_, focus)), None) = (&carried, &focus, &error) {
        findings.extend(keep(old, focus));
    }
    write(&AiReview { findings, error, ms, usage, lines, since: focus.map(|(s, _)| s), ..base })
}

#[cfg(test)]
mod tests {
    use super::code_lines;

    #[test]
    fn counts_code_lines_not_routine() {
        let review = serde_json::json!({"blocks": [
            {"files": ["a.ts"], "lines": 40, "skim": null},
            {"files": ["yarn.lock"], "lines": 900, "skim": "lockfile"},
            {"files": ["b.ts", "c.ts"], "lines": 10, "skim": null},
        ]});
        assert_eq!(code_lines(&review, None), 50);
        let only_c = ["c.ts".to_string()].into_iter().collect();
        assert_eq!(code_lines(&review, Some(&only_c)), 10);
    }
}
