use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::process::Command;

use sem_core::model::change::{ChangeType, SemanticChange};

use crate::classify::{is_test_path, lang_family};

/// Removed symbol names that the head revision still mentions in other files (one tokenizing pass over tracked sources).
pub(crate) fn removed_names_still_mentioned(repo: &Path, changes: &[SemanticChange]) -> HashMap<String, Vec<String>> {
    const GENERIC: [&str; 12] = [
        "styles",
        "props",
        "state",
        "default",
        "index",
        "Container",
        "testID",
        "testIdentifier",
        "TEST_ID",
        "render",
        "constructor",
        "options",
    ];
    let still_defined: HashSet<&str> = changes
        .iter()
        .filter(|c| !matches!(c.change_type, ChangeType::Deleted))
        .map(|c| c.entity_name.as_str())
        .collect();
    let mut own_files: HashMap<String, HashSet<String>> = HashMap::new();
    for c in changes.iter().filter(|c| matches!(c.change_type, ChangeType::Deleted) && !is_test_path(&c.file_path)) {
        let declaration = c.parent_name.is_none()
            && [
                "function",
                "class",
                "interface",
                "type",
                "type_alias",
                "enum",
                "struct",
                "trait",
                "variable",
                "constant",
                "const",
            ]
            .contains(&c.entity_type.as_str());
        let ok = declaration
            && distinctive(&c.entity_name)
            && c.entity_name.len() >= 4
            && !still_defined.contains(c.entity_name.as_str())
            && !GENERIC.contains(&c.entity_name.as_str())
            && c.entity_name.chars().all(|ch| ch.is_alphanumeric() || ch == '_' || ch == '$');
        if ok {
            own_files.entry(c.entity_name.clone()).or_default().insert(c.file_path.clone());
        }
    }
    let mut out: HashMap<String, Vec<String>> = HashMap::new();
    // Bounded: enormous deletions (release merges) skip the check instead of slowing the review.
    if own_files.is_empty() || own_files.len() > MAX_REMOVED_NAMES {
        return out;
    }
    let families: HashSet<&str> = own_files.values().flatten().filter_map(|f| lang_family(f)).collect();
    let Ok(ls) = Command::new("git").args(["-c", "core.quotepath=off", "ls-files"]).current_dir(repo).output() else {
        return out;
    };
    for file in String::from_utf8_lossy(&ls.stdout).lines() {
        if is_test_path(file) || SKIP_EXT.iter().any(|e| file.ends_with(e)) {
            continue;
        }
        let Some(fam) = lang_family(file) else { continue };
        if !families.contains(fam) {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(repo.join(file)) else { continue };
        let mut seen: HashSet<&str> = HashSet::new();
        for word in text.split(|ch: char| !(ch.is_alphanumeric() || ch == '_' || ch == '$')) {
            if word.len() < 4 || !seen.insert(word) {
                continue;
            }
            let Some(own) = own_files.get(word) else { continue };
            if own.contains(file) || !own.iter().any(|o| lang_family(o) == Some(fam)) {
                continue;
            }
            let short = file.rsplit('/').next().unwrap_or(file).to_string();
            let v = out.entry(word.to_string()).or_default();
            if !v.contains(&short) {
                v.push(short);
            }
        }
    }
    out
}

/// Data and generated files never reference code symbols.
const SKIP_EXT: [&str; 8] = [".json", ".lock", ".snap", ".svg", ".md", ".png", ".jpg", ".map"];

pub(crate) const MAX_REMOVED_NAMES: usize = 5000;

/// Compound identifiers (camelCase, `PascalCase` with 2+ words, `SNAKE_CASE`) are unlikely to collide with prose.
pub(crate) fn distinctive(name: &str) -> bool {
    let chars: Vec<char> = name.chars().collect();
    let hump = chars.windows(2).any(|w| w[0].is_lowercase() && w[1].is_uppercase());
    let snake = name.trim_matches('_').contains('_');
    hump || snake
}

#[cfg(test)]
mod tests {
    use super::distinctive;

    #[test]
    fn only_compound_names_are_distinctive() {
        assert!(distinctive("getRedemptionLocation"));
        assert!(distinctive("IFulfillmentType"));
        assert!(distinctive("POI_NAMES"));
        assert!(!distinctive("label"));
        assert!(!distinctive("Voucher"));
    }
}
