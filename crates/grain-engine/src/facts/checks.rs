use std::collections::HashMap;

use crate::classify::{is_test_path, kind_of};
use crate::model::{Check, CheckLevel, EntityChange, Risk};

pub(crate) fn list(names: &[String]) -> String {
    match names.len() {
        0 => String::new(),
        1..=3 => names.join(", "),
        n => format!("{} and {} more", names[..3].join(", "), n - 3),
    }
}

/// Deterministic review checks and an estimated risk, so blocks are useful without any AI.
pub(crate) fn rule_checks(
    changes: &[EntityChange],
    files: &[String],
    lines: usize,
    has_tests: bool,
    mechanical: usize,
    used_by: usize,
    test_users: usize,
    used_sample: &[String],
    still_mentioned: &HashMap<String, Vec<String>>,
) -> (Vec<Check>, Risk) {
    let mut checks = Vec::new();
    let mut score = 0i32;
    let code_changes: Vec<&EntityChange> = changes.iter().filter(|c| !is_test_path(&c.file)).collect();

    let joined = files.join(" ").to_lowercase();
    let areas = [
        (&["payment", "checkout", "billing", "coupon", "price"][..], "payment"),
        (&["auth", "login", "session", "token", "password", "permission", "security"][..], "sign-in or security"),
        (&["secret", "crypto", "encrypt"][..], "secrets or encryption"),
        (&["migration", "schema.sql", "/db/"][..], "database"),
    ];
    for (words, area) in areas {
        if words.iter().any(|w| joined.contains(w)) {
            checks.push(Check {
                level: CheckLevel::Warn,
                text: format!("Touches {area} code. Read the edge cases carefully."),
            });
            score += 2;
            break;
        }
    }

    let mut dangling: Vec<String> = Vec::new();
    for c in code_changes.iter().filter(|c| c.change == "deleted") {
        if let Some(where_) = still_mentioned.get(&c.name) {
            dangling.push(format!("{} (still in {})", c.name, list(where_)));
        }
    }
    if !dangling.is_empty() {
        checks.push(Check {
            level: CheckLevel::Warn,
            text: format!("Removes code that other files still mention: {}.", list(&dangling)),
        });
        score += 2;
    }
    let renamed: Vec<String> =
        code_changes.iter().filter_map(|c| c.old_name.as_ref().map(|o| format!("{o} to {}", c.name))).collect();
    if !renamed.is_empty() {
        checks.push(Check {
            level: CheckLevel::Warn,
            text: format!("Renames {}. Check callers outside this PR.", list(&renamed)),
        });
        score += 1;
    }
    if used_by > 0 {
        let level = if used_by > 3 { CheckLevel::Warn } else { CheckLevel::Info };
        let text = format!(
            "Changed code is used in {used_by} {} outside this PR, including {}.",
            if used_by == 1 { "place" } else { "places" },
            used_sample.iter().take(3).cloned().collect::<Vec<_>>().join(", ")
        );
        checks.push(Check { level, text });
        score += if used_by > 10 { 2 } else { i32::from(used_by > 3) };
    }
    if test_users > 0 {
        checks.push(Check {
            level: CheckLevel::Info,
            text: format!(
                "Covered by {test_users} {} outside this PR.",
                if test_users == 1 { "test" } else { "tests" }
            ),
        });
    }
    let config: Vec<&String> = files
        .iter()
        .filter(|f| {
            let n = f.rsplit('/').next().unwrap_or(f);
            matches!(
                n,
                "package.json" | "Podfile" | "build.gradle" | "Cargo.toml" | "Dockerfile" | "go.mod" | "pyproject.toml"
            ) || f.contains(".github/workflows/")
                || n.starts_with(".env")
        })
        .collect();
    if !config.is_empty() {
        checks.push(Check { level: CheckLevel::Warn, text: "Changes dependencies or build configuration.".into() });
        score += 1;
    }
    if !has_tests && lines >= 40 && files.iter().any(|f| kind_of(f) == "code" && !is_test_path(f)) {
        checks.push(Check { level: CheckLevel::Info, text: "No tests changed alongside this code.".into() });
        score += 1;
    }
    if lines > 400 {
        checks.push(Check {
            level: CheckLevel::Info,
            text: format!("Large block ({lines} changed lines). Reading it file by file helps."),
        });
        score += 1;
    }
    if !changes.is_empty() && mechanical * 2 >= changes.len() {
        checks.push(Check { level: CheckLevel::Info, text: "Mostly formatting, moves or renames.".into() });
        score -= 1;
    }
    let risk = if score >= 4 {
        Risk::High
    } else if score >= 2 {
        Risk::Medium
    } else {
        Risk::Low
    };
    (checks, risk)
}
