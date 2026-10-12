use std::collections::{BTreeMap, HashSet};
use std::path::Path;
use std::process::Command;

use anyhow::Result;

/// Changed line numbers per file, split by side (new = added lines, old = deleted lines).
#[derive(Default)]
pub(crate) struct FileHunks {
    pub(crate) old_path: Option<String>,
    pub(crate) added: Vec<usize>,
    pub(crate) deleted: Vec<usize>,
    pub(crate) shape: HashSet<String>,
}

/// Edited line with string literals, numbers and whitespace removed: `KEY: 'Hallo',` -> `+KEY:'',`.
pub(crate) fn line_shape(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut quote: Option<char> = None;
    for ch in line.chars() {
        match quote {
            Some(q) if ch == q => {
                out.push(q);
                out.push(q);
                quote = None;
            }
            Some(_) => {}
            None if matches!(ch, '\'' | '"' | '`') => quote = Some(ch),
            None if ch.is_ascii_digit() || ch.is_whitespace() => {}
            None => out.push(ch),
        }
    }
    out
}

/// Parses `git diff -U0` output into changed line numbers per (new) file path.
pub(crate) fn hunk_lines(repo: &Path, base: &str, head: &str) -> Result<BTreeMap<String, FileHunks>> {
    let out = Command::new("git")
        .args(["-c", "core.quotepath=off", "diff", "-U0", "-M", "--no-color", "--no-ext-diff", base, head])
        .current_dir(repo)
        .output()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let mut files: BTreeMap<String, FileHunks> = BTreeMap::new();
    let (mut old, mut cur): (Option<String>, Option<String>) = (None, None);
    let mut in_header = false;
    for line in text.lines() {
        if line.starts_with("diff --git ") {
            in_header = true;
            old = None;
        } else if !in_header && !line.starts_with("@@ ") {
            if let (Some(c), true) = (cur.as_ref(), line.starts_with('+') || line.starts_with('-')) {
                let shape = line_shape(line);
                if shape.len() > 2 {
                    files.entry(c.clone()).or_default().shape.insert(shape);
                }
            }
        } else if let Some(p) = line.strip_prefix("--- ") {
            old = p.trim_matches('"').strip_prefix("a/").map(str::to_string);
        } else if let Some(p) = line.strip_prefix("+++ ") {
            cur = p.trim_matches('"').strip_prefix("b/").map(str::to_string).or_else(|| old.clone());
            let Some(path) = cur.clone() else { continue };
            let entry = files.entry(path).or_default();
            if old != cur {
                entry.old_path.clone_from(&old);
            }
        } else if let Some(rest) = line.strip_prefix("@@ ") {
            in_header = false;
            let Some(cur) = cur.as_ref() else { continue };
            let mut parts = rest.split_whitespace();
            let parse = |s: &str| -> (usize, usize) {
                let s = &s[1..];
                match s.split_once(',') {
                    Some((a, b)) => (a.parse().unwrap_or(0), b.parse().unwrap_or(0)),
                    None => (s.parse().unwrap_or(0), 1),
                }
            };
            let (os, oc) = parse(parts.next().unwrap_or("-0,0"));
            let (ns, nc) = parse(parts.next().unwrap_or("+0,0"));
            let f = files.entry(cur.clone()).or_default();
            f.deleted.extend(os..os + oc);
            f.added.extend(ns..ns + nc);
        }
    }
    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::line_shape;

    #[test]
    fn shapes_ignore_literals_numbers_and_whitespace() {
        assert_eq!(line_shape("+  GREETING: 'Hallo',"), line_shape("+GREETING: 'Hello',"));
        assert_eq!(line_shape("-  width: 12,"), line_shape("-width: 400,"));
        assert_ne!(line_shape("+GREETING: 'Hi',"), line_shape("+FAREWELL: 'Bye',"));
    }
}
