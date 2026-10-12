//! Spike A: can sem-core's entity diff + graph produce review blocks a human would accept?
//!
//! Usage: sem-grouping-spike <worktree> <base-sha> <head-sha> <out-dir> [--full-graph]

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::Path;
use std::process::Command;
use std::time::Instant;

use anyhow::{Context, Result};
use sem_core::git::bridge::GitBridge;
use sem_core::git::types::{DiffScope, FileStatus};
use sem_core::model::change::{ChangeType, SemanticChange};
use sem_core::parser::differ::compute_semantic_diff;
use sem_core::parser::graph::EntityGraph;
use sem_core::parser::plugins::create_default_registry;
use serde::Serialize;

struct Uf(Vec<usize>);

impl Uf {
    fn new(n: usize) -> Self {
        Uf((0..n).collect())
    }
    fn find(&mut self, x: usize) -> usize {
        let p = self.0[x];
        if p == x {
            return x;
        }
        let r = self.find(p);
        self.0[x] = r;
        r
    }
    fn union(&mut self, a: usize, b: usize) {
        let (ra, rb) = (self.find(a), self.find(b));
        if ra != rb {
            self.0[rb] = ra;
        }
    }
}

/// Changed line numbers per file, split by side (new = added lines, old = deleted lines).
#[derive(Default)]
struct FileHunks {
    old_path: Option<String>,
    added: Vec<usize>,
    deleted: Vec<usize>,
    shape: HashSet<String>,
}

/// Edited line with string literals, numbers and whitespace removed: `KEY: 'Hallo',` -> `+KEY:'',`.
fn line_shape(line: &str) -> String {
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
fn hunk_lines(repo: &Path, base: &str, head: &str) -> Result<BTreeMap<String, FileHunks>> {
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
                entry.old_path = old.clone();
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

fn kind_of(path: &str) -> &'static str {
    let p = path.to_lowercase();
    let name = p.rsplit('/').next().unwrap_or(&p);
    if matches!(
        name,
        "package-lock.json" | "yarn.lock" | "pnpm-lock.yaml" | "podfile.lock" | "gemfile.lock" | "cargo.lock" | "bun.lockb"
    ) {
        "lockfile"
    } else if p.contains("/generated/") || p.contains("__generated__") || name.ends_with(".snap") || name.contains(".min.") {
        "generated"
    } else if [".png", ".jpg", ".jpeg", ".svg", ".gif", ".webp", ".ttf", ".otf", ".woff", ".woff2", ".mp4", ".json"]
        .iter()
        .any(|e| name.ends_with(e) && !name.ends_with("package.json") && !name.ends_with("tsconfig.json"))
    {
        "asset"
    } else if name.ends_with(".md") || name.ends_with(".mdx") {
        "docs"
    } else if name.ends_with(".yml") || name.ends_with(".yaml") || name.ends_with(".toml") || name.starts_with('.') || name.ends_with("package.json") || name.ends_with("tsconfig.json") || name.ends_with(".gradle") || name.ends_with(".plist") || name.ends_with(".xml") {
        "config"
    } else {
        "code"
    }
}

fn is_test_path(p: &str) -> bool {
    p.contains(".test.") || p.contains(".spec.") || p.contains("__tests__/") || p.contains("/test/") || p.contains("/tests/")
}

/// Strips test markers and extension: `a/b/foo.test.tsx` -> `foo`.
fn stem(p: &str) -> String {
    let name = p.rsplit('/').next().unwrap_or(p);
    name.split('.').next().unwrap_or(name).to_string()
}

enum Unit {
    Entity(usize),
    Residue(String),
}

#[derive(Serialize)]
struct BlockOut {
    id: usize,
    key: String,
    lines: usize,
    files: Vec<String>,
    entities: Vec<String>,
    residue_files: Vec<String>,
    mechanical_entities: usize,
    has_tests: bool,
    kind: String,
    skim: Option<String>,
    layer: u8,
    dir: String,
    changes: Vec<EntityChange>,
    used_by: usize,
    used_by_sample: Vec<String>,
    checks: Vec<Check>,
    est_risk: &'static str,
}

#[derive(Serialize)]
struct EntityChange {
    change: String,
    kind: String,
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    old_name: Option<String>,
    file: String,
}

#[derive(Serialize)]
struct Check {
    level: &'static str,
    text: String,
}

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let (repo, base, head, out_dir) = (Path::new(&args[1]), &args[2], &args[3], Path::new(&args[4]));
    std::fs::create_dir_all(out_dir)?;
    let mut timings: Vec<(&str, u128)> = Vec::new();

    let t = Instant::now();
    let bridge = GitBridge::open(repo).context("open repo")?;
    let file_changes = bridge.get_changed_files(&DiffScope::Range { from: base.clone(), to: head.clone() }, &[])?;
    timings.push(("git changed files", t.elapsed().as_millis()));

    let t = Instant::now();
    let registry = create_default_registry();
    let diff = compute_semantic_diff(&file_changes, &registry, None, None);
    timings.push(("semantic diff", t.elapsed().as_millis()));
    let changes: Vec<SemanticChange> = diff.changes;

    let t = Instant::now();
    let hunks = hunk_lines(repo, base, head)?;
    timings.push(("git -U0 hunks", t.elapsed().as_millis()));

    // Graph over changed, still-existing, parser-supported files only: edges between changed entities.
    let graph_files: Vec<String> = file_changes
        .iter()
        .filter(|f| !matches!(f.status, FileStatus::Deleted))
        .filter(|f| registry.get_explicit_plugin(&f.file_path).is_some())
        .map(|f| f.file_path.clone())
        .collect();
    let t = Instant::now();
    let (graph, _) = EntityGraph::build(repo, &graph_files, &registry);
    timings.push(("graph (changed files)", t.elapsed().as_millis()));

    // Whole-repo graph at head: who outside this PR depends on the changed code.
    let full_graph = {
        let all: Vec<String> = String::from_utf8(Command::new("git").args(["ls-files"]).current_dir(repo).output()?.stdout)?
            .lines()
            .filter(|p| registry.get_explicit_plugin(p).is_some())
            .map(str::to_string)
            .collect();
        let t = Instant::now();
        let (g, _) = EntityGraph::build(repo, &all, &registry);
        timings.push(("graph (full repo)", t.elapsed().as_millis()));
        g
    };
    let full_graph_stats = Some((full_graph.entities.len(), full_graph.entities.len(), full_graph.edges.len()));
    let changed_ids: HashSet<&str> = changes.iter().map(|c| c.entity_id.as_str()).collect();

    // Units: one per changed entity, plus one "residue" per file for changed lines no entity covers.
    let mut units: Vec<Unit> = (0..changes.len()).map(Unit::Entity).collect();
    let mut unit_lines: Vec<usize> = vec![0; changes.len()];
    let mut residue_idx: HashMap<String, usize> = HashMap::new();
    let mut by_file: HashMap<&str, Vec<usize>> = HashMap::new();
    for (i, c) in changes.iter().enumerate() {
        by_file.entry(c.file_path.as_str()).or_default().push(i);
        if let Some(op) = &c.old_file_path {
            if op != &c.file_path {
                by_file.entry(op.as_str()).or_default().push(i);
            }
        }
    }
    let innermost = |file: &str, line: usize, old_side: bool| -> Option<usize> {
        by_file.get(file)?.iter().copied().filter_map(|i| {
            let c = &changes[i];
            let deleted = matches!(c.change_type, ChangeType::Deleted);
            let (s, e) = if old_side {
                if deleted { (c.start_line, c.end_line) } else { (c.old_start_line?, c.old_end_line?) }
            } else {
                if deleted { return None; }
                (c.start_line, c.end_line)
            };
            (s <= line && line <= e).then_some((e - s, i))
        }).min().map(|(_, i)| i)
    };
    let (mut total_lines, mut covered_lines) = (0usize, 0usize);
    for (path, fh) in &hunks {
        let old_path = fh.old_path.as_deref().unwrap_or(path);
        let sides = fh.added.iter().map(|&l| (path.as_str(), l, false)).chain(fh.deleted.iter().map(|&l| (old_path, l, true)));
        for (file, line, old_side) in sides {
            total_lines += 1;
            match innermost(file, line, old_side) {
                Some(i) => {
                    covered_lines += 1;
                    unit_lines[i] += 1;
                }
                None => {
                    let idx = *residue_idx.entry(path.clone()).or_insert_with(|| {
                        units.push(Unit::Residue(path.clone()));
                        unit_lines.push(0);
                        units.len() - 1
                    });
                    unit_lines[idx] += 1;
                }
            }
        }
    }

    let t = Instant::now();
    let mut uf = Uf::new(units.len());
    let id_to_change: HashMap<&str, usize> = changes.iter().enumerate().map(|(i, c)| (c.entity_id.as_str(), i)).collect();
    let mut matched_in_graph = 0;
    for c in &changes {
        if graph.entities.contains_key(c.entity_id.as_str()) {
            matched_in_graph += 1;
        }
    }
    let mut edges_between_changed = 0;
    for e in &graph.edges {
        if let (Some(&a), Some(&b)) = (id_to_change.get(e.from_entity.as_str()), id_to_change.get(e.to_entity.as_str())) {
            if a != b {
                edges_between_changed += 1;
                uf.union(a, b);
            }
        }
    }
    // Sibling members of the same changed parent (e.g. methods of one class) belong together.
    let mut parent_key: HashMap<(String, String), usize> = HashMap::new();
    for (i, c) in changes.iter().enumerate() {
        if let Some(p) = &c.parent_name {
            let k = (c.file_path.clone(), p.clone());
            match parent_key.get(&k) {
                Some(&j) => uf.union(i, j),
                None => {
                    parent_key.insert(k, i);
                }
            }
        }
    }
    // A file's residue (imports, top-level statements) joins the file's biggest entity block.
    for (path, &r) in &residue_idx {
        if let Some(ents) = by_file.get(path.as_str()) {
            if let Some(&best) = ents.iter().max_by_key(|&&i| unit_lines[i]) {
                uf.union(r, best);
            }
        }
    }
    // Test files attach to the code file sharing their stem, when the graph didn't already link them.
    let file_unit = |p: &str, uf: &mut Uf| -> Option<usize> {
        by_file.get(p).and_then(|v| v.first().copied()).or_else(|| residue_idx.get(p).copied()).map(|u| uf.find(u))
    };
    let code_by_stem: HashMap<String, String> = hunks.keys().filter(|p| !is_test_path(p) && kind_of(p) == "code").map(|p| (stem(p), p.clone())).collect();
    let mut test_links = 0;
    for p in hunks.keys().filter(|p| is_test_path(p)) {
        if let Some(code) = code_by_stem.get(&stem(p)) {
            if let (Some(a), Some(b)) = (file_unit(p, &mut uf), file_unit(code, &mut uf)) {
                if a != b {
                    test_links += 1;
                    uf.union(a, b);
                }
            }
        }
    }
    // Non-code leftovers with no entities: one block per (kind, top-level dir).
    let mut kind_bucket: HashMap<(String, String), usize> = HashMap::new();
    for (path, &r) in &residue_idx {
        let k = kind_of(path);
        if by_file.contains_key(path.as_str()) || k == "code" {
            continue;
        }
        let top = path.split('/').next().unwrap_or("").to_string();
        match kind_bucket.get(&(k.to_string(), top.clone())) {
            Some(&j) => uf.union(r, j),
            None => {
                kind_bucket.insert((k.to_string(), top), r);
            }
        }
    }
    let mut pattern_files: HashSet<String> = HashSet::new();
    if !args.iter().any(|a| a == "--v1") {
        (uf, pattern_files) = group_v2(&changes, &units, &unit_lines, &graph, &hunks);
    }
    timings.push(("grouping", t.elapsed().as_millis()));

    let unit_file = |u: usize| -> &str {
        match &units[u] {
            Unit::Entity(i) => &changes[*i].file_path,
            Unit::Residue(p) => p,
        }
    };
    let unit_start = |u: usize| -> usize {
        match &units[u] {
            Unit::Entity(i) => changes[*i].start_line,
            Unit::Residue(_) => 0,
        }
    };
    let mut groups: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    for u in 0..units.len() {
        let r = uf.find(u);
        groups.entry(r).or_default().push(u);
    }
    // Huge single-file groups (e.g. 10K-line test files) are cut into CAP-sized runs of consecutive entities.
    let mut member_sets: Vec<Vec<usize>> = Vec::new();
    for members in groups.into_values() {
        let files: HashSet<&str> = members.iter().map(|&u| unit_file(u)).collect();
        let lines: usize = members.iter().map(|&u| unit_lines[u]).sum();
        if files.len() == 1 && lines > 2 * CAP && members.len() > 1 {
            let mut sorted = members.clone();
            sorted.sort_by_key(|&u| unit_start(u));
            let mut cur: Vec<usize> = Vec::new();
            let mut cur_lines = 0;
            for u in sorted {
                if cur_lines + unit_lines[u] > CAP && !cur.is_empty() {
                    member_sets.push(std::mem::take(&mut cur));
                    cur_lines = 0;
                }
                cur_lines += unit_lines[u];
                cur.push(u);
            }
            member_sets.push(cur);
        } else {
            member_sets.push(members);
        }
    }

    let t_grep = Instant::now();
    let still_mentioned = removed_names_still_mentioned(repo, &changes);
    timings.push(("removed-name check", t_grep.elapsed().as_millis()));

    let mut blocks: Vec<BlockOut> = member_sets
        .iter()
        .map(|members| {
            let mut file_lines: BTreeMap<String, usize> = BTreeMap::new();
            let (mut entities, mut residue_files, mut mech, mut lines, mut tests) = (vec![], vec![], 0, 0, false);
            let mut changes_out: Vec<EntityChange> = Vec::new();
            let mut users: BTreeMap<String, String> = BTreeMap::new();
            let mut test_users: HashSet<String> = HashSet::new();
            for &u in members {
                lines += unit_lines[u];
                *file_lines.entry(unit_file(u).to_string()).or_default() += unit_lines[u];
                match &units[u] {
                    Unit::Entity(i) => {
                        let c = &changes[*i];
                        tests |= is_test_path(&c.file_path);
                        let mechanical = c.structural_change == Some(false)
                            || (matches!(c.change_type, ChangeType::Moved | ChangeType::Renamed | ChangeType::Reordered) && !c.has_content_change());
                        mech += mechanical as usize;
                        entities.push(format!("{} {} `{}` ({})", c.change_type, c.entity_type, c.entity_name, c.file_path));
                        changes_out.push(EntityChange {
                            change: c.change_type.to_string(),
                            kind: c.entity_type.clone(),
                            name: c.entity_name.clone(),
                            old_name: c.old_entity_name.clone().filter(|o| o != &c.entity_name),
                            file: c.file_path.clone(),
                        });
                        if !matches!(c.change_type, ChangeType::Deleted) && !is_test_path(&c.file_path) {
                            for dep in full_graph.dependents().get(c.entity_id.as_str()).into_iter().flatten() {
                                if changed_ids.contains(dep.as_str()) {
                                    continue;
                                }
                                if let Some(info) = full_graph.entities.get(dep.as_str()) {
                                    if is_test_path(&info.file_path) {
                                        test_users.insert(dep.to_string());
                                    } else {
                                        users.insert(dep.to_string(), format!("{} ({})", info.name, info.file_path.rsplit('/').next().unwrap_or("")));
                                    }
                                }
                            }
                        }
                    }
                    Unit::Residue(p) => {
                        tests |= is_test_path(p);
                        residue_files.push(p.clone());
                    }
                }
            }
            let files: Vec<String> = file_lines.keys().cloned().collect();
            let kinds: HashSet<&str> = files.iter().map(|f| kind_of(f)).collect();
            let kind = if kinds.len() == 1 { kinds.into_iter().next().unwrap().to_string() } else if kinds.contains("code") { "code".into() } else { "mixed".into() };
            let skim = if matches!(kind.as_str(), "lockfile" | "generated" | "asset" | "docs") {
                Some(kind.clone())
            } else if files.len() >= 3 && files.iter().all(|f| pattern_files.contains(f)) {
                Some("repeated edit".to_string())
            } else if !entities.is_empty() && mech == entities.len() && residue_files.is_empty() {
                Some("mechanical".to_string())
            } else {
                None
            };
            let layer = files.iter().filter(|f| !is_test_path(f)).map(|f| layer_of(f)).min().unwrap_or(4);
            let dir = block_dir(&file_lines);
            let used_by_sample: Vec<String> = users.values().take(5).cloned().collect();
            let (checks, est_risk) = if skim.is_some() {
                (vec![], "low")
            } else {
                rule_checks(&changes_out, &files, lines, tests, mech, users.len(), test_users.len(), &used_by_sample, &still_mentioned)
            };
            BlockOut {
                id: 0,
                key: block_key(&files, &entities),
                lines, files, entities, residue_files, mechanical_entities: mech, has_tests: tests, kind, skim, layer, dir,
                changes: changes_out, used_by: users.len(), used_by_sample, checks, est_risk,
            }
        })
        .filter(|b| b.lines > 0 || !b.entities.is_empty())
        .collect();
    blocks.sort_by(|a, b| a.layer.cmp(&b.layer).then(b.lines.cmp(&a.lines)));
    for (i, b) in blocks.iter_mut().enumerate() {
        b.id = i + 1;
    }
    let chapters = build_chapters(&blocks);
    timings.push(("grouping (total)", t.elapsed().as_millis()));

    std::fs::write(out_dir.join("blocks.json"), serde_json::to_string_pretty(&blocks)?)?;
    let skim: Vec<usize> = blocks.iter().filter(|b| b.skim.is_some()).map(|b| b.id).collect();
    let review = serde_json::json!({ "chapters": chapters, "skim": skim, "blocks": blocks, "totalLines": total_lines });
    std::fs::write(out_dir.join("review.json"), serde_json::to_string_pretty(&review)?)?;
    write_report(out_dir, &args, &timings, &changes, &graph_files, &graph, matched_in_graph, edges_between_changed, test_links, total_lines, covered_lines, &blocks, full_graph_stats)?;
    let skim_lines: usize = blocks.iter().filter(|b| b.skim.is_some()).map(|b| b.lines).sum();
    let mut summary = std::fs::read_to_string(out_dir.join("summary.txt"))?;
    summary.push_str(&format!(
        "v3: {} chapters, {} review blocks, {} skim groups ({} lines, {:.0}% of PR)\n",
        chapters.len(),
        blocks.len() - skim.len(),
        skim.len(),
        skim_lines,
        100.0 * skim_lines as f64 / total_lines.max(1) as f64
    ));
    for c in &chapters {
        summary.push_str(&format!("  chapter {:<44} {:>6} lines  {:>3} blocks\n", c.title, c.lines, c.blocks.len()));
    }
    std::fs::write(out_dir.join("summary.txt"), &summary)?;
    println!("{summary}");
    Ok(())
}

/// Removed symbol names that the head revision still mentions in other files (one tokenizing pass over tracked sources).
fn removed_names_still_mentioned(repo: &Path, changes: &[SemanticChange]) -> HashMap<String, Vec<String>> {
    const GENERIC: [&str; 12] = ["styles", "props", "state", "default", "index", "Container", "testID", "testIdentifier", "TEST_ID", "render", "constructor", "options"];
    let still_defined: HashSet<&str> = changes.iter().filter(|c| !matches!(c.change_type, ChangeType::Deleted)).map(|c| c.entity_name.as_str()).collect();
    let mut own_files: HashMap<String, HashSet<String>> = HashMap::new();
    for c in changes.iter().filter(|c| matches!(c.change_type, ChangeType::Deleted) && !is_test_path(&c.file_path)) {
        let declaration = c.parent_name.is_none()
            && ["function", "class", "interface", "type", "type_alias", "enum", "struct", "trait", "variable", "constant", "const"].contains(&c.entity_type.as_str());
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
    let Ok(ls) = Command::new("git").args(["-c", "core.quotepath=off", "ls-files"]).current_dir(repo).output() else { return out };
    const SKIP_EXT: [&str; 8] = [".json", ".lock", ".snap", ".svg", ".md", ".png", ".jpg", ".map"];
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

const MAX_REMOVED_NAMES: usize = 5000;

/// Stable content key for a block (files + changed entities), so summaries survive regrouping and renumbering.
fn block_key(files: &[String], entities: &[String]) -> String {
    use std::hash::{Hash, Hasher};
    let mut parts: Vec<&String> = files.iter().chain(entities).collect();
    parts.sort();
    let mut h = std::collections::hash_map::DefaultHasher::new();
    parts.hash(&mut h);
    format!("{:016x}", h.finish())
}

/// Compound identifiers (camelCase, PascalCase with 2+ words, SNAKE_CASE) are unlikely to collide with prose.
fn distinctive(name: &str) -> bool {
    let chars: Vec<char> = name.chars().collect();
    let hump = chars.windows(2).any(|w| w[0].is_lowercase() && w[1].is_uppercase());
    let snake = name.trim_matches('_').contains('_');
    hump || snake
}

/// Files that can reference each other's symbols share a family.
fn lang_family(path: &str) -> Option<&'static str> {
    let ext = path.rsplit_once('.')?.1;
    Some(match ext {
        "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs" | "mts" | "cts" | "vue" | "svelte" => "js",
        "py" => "py",
        "go" => "go",
        "rs" => "rs",
        "java" | "kt" | "kts" | "scala" => "jvm",
        "swift" | "m" | "mm" | "h" => "apple",
        "c" | "cc" | "cpp" | "hpp" => "c",
        "rb" => "rb",
        "php" => "php",
        "cs" => "cs",
        "dart" => "dart",
        _ => return None,
    })
}

fn list(names: &[String]) -> String {
    match names.len() {
        0 => String::new(),
        1..=3 => names.join(", "),
        n => format!("{} and {} more", names[..3].join(", "), n - 3),
    }
}

/// Deterministic review checks and an estimated risk, so blocks are useful without any AI.
fn rule_checks(
    changes: &[EntityChange],
    files: &[String],
    lines: usize,
    has_tests: bool,
    mechanical: usize,
    used_by: usize,
    test_users: usize,
    used_sample: &[String],
    still_mentioned: &HashMap<String, Vec<String>>,
) -> (Vec<Check>, &'static str) {
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
            checks.push(Check { level: "warn", text: format!("Touches {area} code. Read the edge cases carefully.") });
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
        checks.push(Check { level: "warn", text: format!("Removes code that other files still mention: {}.", list(&dangling)) });
        score += 2;
    }
    let renamed: Vec<String> = code_changes.iter().filter_map(|c| c.old_name.as_ref().map(|o| format!("{o} to {}", c.name))).collect();
    if !renamed.is_empty() {
        checks.push(Check { level: "warn", text: format!("Renames {}. Check callers outside this PR.", list(&renamed)) });
        score += 1;
    }
    if used_by > 0 {
        let level = if used_by > 3 { "warn" } else { "info" };
        let text = format!(
            "Changed code is used in {used_by} {} outside this PR, including {}.",
            if used_by == 1 { "place" } else { "places" },
            used_sample.iter().take(3).cloned().collect::<Vec<_>>().join(", ")
        );
        checks.push(Check { level, text });
        score += if used_by > 10 { 2 } else if used_by > 3 { 1 } else { 0 };
    }
    if test_users > 0 {
        checks.push(Check {
            level: "info",
            text: format!("Covered by {test_users} {} outside this PR.", if test_users == 1 { "test" } else { "tests" }),
        });
    }
    let config: Vec<&String> = files
        .iter()
        .filter(|f| {
            let n = f.rsplit('/').next().unwrap_or(f);
            matches!(n, "package.json" | "Podfile" | "build.gradle" | "Cargo.toml" | "Dockerfile" | "go.mod" | "pyproject.toml")
                || f.contains(".github/workflows/")
                || n.starts_with(".env")
        })
        .collect();
    if !config.is_empty() {
        checks.push(Check { level: "warn", text: "Changes dependencies or build configuration.".into() });
        score += 1;
    }
    if !has_tests && lines >= 40 && files.iter().any(|f| kind_of(f) == "code" && !is_test_path(f)) {
        checks.push(Check { level: "info", text: "No tests changed alongside this code.".into() });
        score += 1;
    }
    if lines > 400 {
        checks.push(Check { level: "info", text: format!("Large block ({lines} changed lines). Reading it file by file helps.") });
        score += 1;
    }
    if !changes.is_empty() && mechanical * 2 >= changes.len() {
        checks.push(Check { level: "info", text: "Mostly formatting, moves or renames.".into() });
        score -= 1;
    }
    let risk = if score >= 4 { "high" } else if score >= 2 { "medium" } else { "low" };
    (checks, risk)
}

/// Foundations-first layer from path conventions: 0 types/data/services, 1 hooks/state, 2 components, 3 screens, 4 other.
fn layer_of(path: &str) -> u8 {
    let p = format!("/{}", path.to_lowercase());
    let has = |xs: &[&str]| xs.iter().any(|x| p.contains(x));
    if p.ends_with(".d.ts") || has(&["/types/", "/models/", "/schema", "/constants/", "/api/", "/services/", "/store/", "/util/", "/utils/", "/lib/", "/migrations/", "/db/"]) {
        0
    } else if has(&["/hooks/", "/context/", "/contexts/", "/providers/", "/state/"]) || p.rsplit('/').next().is_some_and(|n| n.starts_with("use")) {
        1
    } else if has(&["/components/", "/atoms/", "/molecules/", "/ui/", "/widgets/"]) {
        2
    } else if has(&["/screens/", "/pages/", "/app/", "/routes/", "/views/"]) {
        3
    } else {
        4
    }
}

/// Directory that best describes a block: the files' common directory, or the heaviest file's directory.
fn block_dir(file_lines: &BTreeMap<String, usize>) -> String {
    let dirs: Vec<Vec<&str>> = file_lines.keys().map(|f| f.split('/').collect::<Vec<_>>()).map(|v| v[..v.len() - 1].to_vec()).collect();
    let mut common: Vec<&str> = dirs.first().cloned().unwrap_or_default();
    for d in &dirs[1.min(dirs.len())..] {
        let n = common.iter().zip(d).take_while(|(a, b)| a == b).count();
        common.truncate(n);
    }
    if common.len() >= 2 {
        return common.join("/");
    }
    let heaviest = file_lines.iter().max_by_key(|(_, &l)| l).map(|(f, _)| f.as_str()).unwrap_or("");
    heaviest.rsplit_once('/').map(|x| x.0.to_string()).unwrap_or_default()
}

#[derive(Serialize)]
struct ChapterOut {
    id: usize,
    title: String,
    dir: String,
    lines: usize,
    layer: u8,
    blocks: Vec<usize>,
}

/// Top-down split of review blocks into feature chapters along the directory tree.
/// Target count grows with PR size (about sqrt(lines / 150), between 1 and 12).
fn build_chapters(blocks: &[BlockOut]) -> Vec<ChapterOut> {
    let review: Vec<&BlockOut> = blocks.iter().filter(|b| b.skim.is_none()).collect();
    let total: usize = review.iter().map(|b| b.lines).sum();
    let target = ((total as f64 / 150.0).sqrt().round() as usize).clamp(1, 12);
    let segs = |b: &BlockOut| -> Vec<String> { b.dir.split('/').filter(|s| !s.is_empty()).map(str::to_string).collect() };
    let common_depth = |members: &[usize]| -> usize {
        let all: Vec<Vec<String>> = members.iter().map(|&i| segs(review[i])).collect();
        let first = all.first().cloned().unwrap_or_default();
        (0..first.len()).take_while(|&d| all.iter().all(|s| s.get(d) == first.get(d))).count()
    };
    let lines_of = |m: &[usize]| -> usize { m.iter().map(|&i| review[i].lines).sum() };

    let mut chapters: Vec<(Vec<usize>, bool)> = vec![((0..review.len()).collect(), true)];
    while chapters.len() < target {
        let Some(ci) = chapters.iter().enumerate().filter(|(_, c)| c.1 && c.0.len() > 1).max_by_key(|(_, c)| lines_of(&c.0)).map(|(i, _)| i) else {
            break;
        };
        let (members, _) = chapters.swap_remove(ci);
        let depth = common_depth(&members);
        let mut by_seg: BTreeMap<String, Vec<usize>> = BTreeMap::new();
        for &i in &members {
            by_seg.entry(segs(review[i]).get(depth).cloned().unwrap_or_default()).or_default().push(i);
        }
        // Tiny sub-areas stay together instead of becoming their own chapter.
        let mut parts: Vec<Vec<usize>> = Vec::new();
        let mut rest: Vec<usize> = Vec::new();
        for (_, m) in by_seg {
            if lines_of(&m) * 25 < total.max(1) {
                rest.extend(m);
            } else {
                parts.push(m);
            }
        }
        parts.sort_by_key(|m| std::cmp::Reverse(lines_of(m)));
        let room = target.saturating_sub(chapters.len()).max(1);
        while parts.len() > room {
            rest.extend(parts.pop().unwrap());
        }
        if !rest.is_empty() {
            if parts.len() == room {
                parts.last_mut().unwrap().extend(rest);
            } else {
                parts.push(rest);
            }
        }
        if parts.len() <= 1 {
            chapters.push((parts.into_iter().next().unwrap_or(members), false));
        } else {
            chapters.extend(parts.into_iter().map(|m| (m, true)));
        }
    }

    // Fold chapters under 3% of the PR into the chapter sharing the longest directory prefix.
    let mut chapters = chapters;
    loop {
        if chapters.len() <= 1 {
            break;
        }
        let Some(ti) = (0..chapters.len()).filter(|&i| lines_of(&chapters[i].0) * 33 < total).min_by_key(|&i| lines_of(&chapters[i].0)) else {
            break;
        };
        let (tiny, _) = chapters.swap_remove(ti);
        let my = segs(review[tiny[0]]);
        let best = (0..chapters.len())
            .max_by_key(|&j| {
                let other = segs(review[chapters[j].0[0]]);
                (other.iter().zip(&my).take_while(|(a, b)| a == b).count(), std::cmp::Reverse(lines_of(&chapters[j].0)))
            })
            .unwrap();
        chapters[best].0.extend(tiny);
    }
    let mut out: Vec<ChapterOut> = chapters
        .into_iter()
        .map(|(members, _)| {
            let depth = common_depth(&members);
            let first = segs(review[members[0]]);
            let dir = first[..depth.min(first.len())].join("/");
            // Name after the heaviest sub-area so sibling chapters don't share a title.
            let mut area: HashMap<String, usize> = HashMap::new();
            for &i in &members {
                let s = segs(review[i]);
                let tail = s[depth.min(s.len())..].iter().take(2).cloned().collect::<Vec<_>>().join("/");
                *area.entry(tail).or_default() += review[i].lines;
            }
            let top = area.into_iter().max_by_key(|(_, l)| *l).map(|(a, _)| a).unwrap_or_default();
            let base = dir.rsplit('/').next().unwrap_or("").to_string();
            let title = match (base.is_empty(), top.is_empty()) {
                (true, true) => "Across the codebase".to_string(),
                (true, false) => top,
                (false, true) => base,
                (false, false) => format!("{base} › {top}"),
            };
            let mut ids: Vec<&BlockOut> = members.iter().map(|&i| review[i]).collect();
            ids.sort_by(|a, b| a.layer.cmp(&b.layer).then(b.lines.cmp(&a.lines)));
            ChapterOut {
                id: 0,
                title,
                dir,
                lines: lines_of(&members),
                layer: ids.iter().map(|b| b.layer).min().unwrap_or(4),
                blocks: ids.iter().map(|b| b.id).collect(),
            }
        })
        .collect();
    out.sort_by(|a, b| a.layer.cmp(&b.layer).then(b.lines.cmp(&a.lines)));
    for (i, c) in out.iter_mut().enumerate() {
        c.id = i + 1;
    }
    out
}

const CAP: usize = 600;
const SMALL: usize = 60;

/// v2: file-level nodes, repeated-edit patterns, size-capped agglomerative merge, small-block absorption.
fn group_v2(
    changes: &[SemanticChange],
    units: &[Unit],
    unit_lines: &[usize],
    graph: &EntityGraph,
    hunks: &BTreeMap<String, FileHunks>,
) -> (Uf, HashSet<String>) {
    let unit_file = |u: usize| -> &str {
        match &units[u] {
            Unit::Entity(i) => &changes[*i].file_path,
            Unit::Residue(p) => p,
        }
    };
    let mut files: Vec<String> = hunks.keys().cloned().collect();
    for c in changes {
        if !hunks.contains_key(&c.file_path) {
            files.push(c.file_path.clone());
        }
    }
    files.sort();
    files.dedup();
    let fidx: HashMap<&str, usize> = files.iter().enumerate().map(|(i, f)| (f.as_str(), i)).collect();
    let n = files.len();
    let mut size = vec![0usize; n];
    for u in 0..units.len() {
        size[fidx[unit_file(u)]] += unit_lines[u];
    }

    let mut uf = Uf::new(n);
    let mut frozen = vec![false; n];

    // Near-identical edits across >= 3 sibling files (locale tables, codemods) => one pattern block.
    // Files are bucketed by (dir, ext), then linked when their changed-entity sets have Jaccard >= 0.7 over edited-line shapes.
    let sigs: HashMap<usize, &HashSet<String>> = hunks
        .iter()
        .filter(|(_, h)| !h.shape.is_empty())
        .map(|(p, h)| (fidx[p.as_str()], &h.shape))
        .collect();
    let mut buckets: HashMap<(String, String), Vec<usize>> = HashMap::new();
    for &fi in sigs.keys() {
        let f = &files[fi];
        let dir = f.rsplit_once('/').map(|x| x.0).unwrap_or("").to_string();
        let ext = f.rsplit_once('.').map(|x| x.1).unwrap_or("").to_string();
        buckets.entry((dir, ext)).or_default().push(fi);
    }
    let mut pat = Uf::new(n);
    for b in buckets.values().filter(|b| b.len() >= 3) {
        for (i, &a) in b.iter().enumerate() {
            for &c in &b[i + 1..] {
                let (sa, sc) = (sigs[&a], sigs[&c]);
                let inter = sa.intersection(sc).count();
                if inter as f64 / (sa.len() + sc.len() - inter) as f64 >= 0.7 {
                    pat.union(a, c);
                }
            }
        }
    }
    let mut pat_groups: HashMap<usize, Vec<usize>> = HashMap::new();
    for &fi in sigs.keys() {
        pat_groups.entry(pat.find(fi)).or_default().push(fi);
    }
    let mut pattern_files: HashSet<String> = HashSet::new();
    for group in pat_groups.values().filter(|g| g.len() >= 3) {
        for &f in group {
            pattern_files.insert(files[f].clone());
            uf.union(group[0], f);
            frozen[f] = true;
        }
    }
    // Lockfiles / generated / assets: one block per kind, kept out of semantic merging.
    let mut kind_root: HashMap<&str, usize> = HashMap::new();
    for (fi, f) in files.iter().enumerate() {
        let k = kind_of(f);
        if matches!(k, "lockfile" | "generated" | "asset") && !frozen[fi] {
            let r = *kind_root.entry(k).or_insert(fi);
            uf.union(r, fi);
            frozen[fi] = true;
        }
    }

    // Weighted file-to-file edges.
    let id_to_file: HashMap<&str, usize> = changes.iter().map(|c| (c.entity_id.as_str(), fidx[c.file_path.as_str()])).collect();
    let mut w: HashMap<(usize, usize), f64> = HashMap::new();
    let add = |a: usize, b: usize, x: f64, w: &mut HashMap<(usize, usize), f64>| {
        if a != b {
            *w.entry((a.min(b), a.max(b))).or_default() += x;
        }
    };
    for e in &graph.edges {
        if let (Some(&a), Some(&b)) = (id_to_file.get(e.from_entity.as_str()), id_to_file.get(e.to_entity.as_str())) {
            add(a, b, 1.0, &mut w);
        }
    }
    let code_by_stem: HashMap<String, usize> = files.iter().enumerate().filter(|(_, p)| !is_test_path(p) && kind_of(p) == "code").map(|(i, p)| (stem(p), i)).collect();
    for (fi, p) in files.iter().enumerate().filter(|(_, p)| is_test_path(p)) {
        if let Some(&c) = code_by_stem.get(&stem(p)) {
            add(fi, c, 5.0, &mut w);
        }
    }
    let mut edges: Vec<((usize, usize), f64)> = w.into_iter().collect();
    edges.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());

    let mut csize = size.clone();
    let merge = |uf: &mut Uf, a: usize, b: usize, cap: usize, csize: &mut Vec<usize>| -> bool {
        let (ra, rb) = (uf.find(a), uf.find(b));
        if ra == rb || frozen[ra] || frozen[rb] || csize[ra] + csize[rb] > cap {
            return false;
        }
        uf.union(ra, rb);
        csize[ra] += csize[rb];
        true
    };
    // Merge only when the link is strong relative to the smaller side, so one incidental call
    // doesn't fuse two unrelated features; small pairs always merge.
    for &((a, b), w) in &edges {
        let (ra, rb) = (uf.find(a), uf.find(b));
        let small = csize[ra].min(csize[rb]).max(1);
        if csize[ra] + csize[rb] <= 120 || w / small as f64 >= 0.01 {
            merge(&mut uf, a, b, CAP, &mut csize);
        }
    }

    // Absorb small clusters: strongest neighbour first, then nearest directory sibling.
    for _ in 0..2 {
        for f in 0..n {
            let r = uf.find(f);
            if r != f || frozen[r] || csize[r] >= SMALL {
                continue;
            }
            let mut best: HashMap<usize, f64> = HashMap::new();
            for &((a, b), x) in &edges {
                let (ra, rb) = (uf.find(a), uf.find(b));
                if ra == r && rb != r {
                    *best.entry(rb).or_default() += x;
                } else if rb == r && ra != r {
                    *best.entry(ra).or_default() += x;
                }
            }
            let mut cands: Vec<(usize, f64)> = best.into_iter().collect();
            cands.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
            if cands.iter().any(|&(c, _)| merge(&mut uf, r, c, CAP * 3 / 2, &mut csize)) {
                continue;
            }
            let dir = |p: &str| p.rsplit_once('/').map(|x| x.0.to_string()).unwrap_or_default();
            let my_dir = dir(&files[f]);
            let roots: Vec<usize> = (0..n).map(|g| uf.find(g)).collect();
            let mut sib: Vec<usize> = (0..n).filter(|&g| roots[g] != r && dir(&files[g]) == my_dir).map(|g| roots[g]).collect();
            sib.sort_by_key(|&g| csize[g]);
            sib.dedup();
            if sib.into_iter().any(|g| merge(&mut uf, r, g, CAP * 3 / 2, &mut csize)) {
                continue;
            }
            // Last resort: the cluster sharing the longest path prefix (at least one directory).
            let my: Vec<&str> = files[f].split('/').collect();
            let mut near: Vec<(usize, usize, usize)> = (0..n)
                .filter(|&g| roots[g] != r && !frozen[roots[g]])
                .map(|g| {
                    let common = files[g].split('/').zip(&my).take_while(|(a, b)| a == *b).count();
                    (common, roots[g], csize[roots[g]])
                })
                .filter(|&(common, _, _)| common >= 1)
                .collect();
            near.sort_by(|a, b| b.0.cmp(&a.0).then(a.2.cmp(&b.2)));
            let _ = near.into_iter().any(|(_, g, _)| merge(&mut uf, r, g, CAP * 3 / 2, &mut csize));
        }
    }

    // Lift file clusters back to units.
    let mut out = Uf::new(units.len());
    let mut first: HashMap<usize, usize> = HashMap::new();
    for u in 0..units.len() {
        let root = uf.find(fidx[unit_file(u)]);
        match first.get(&root) {
            Some(&v) => out.union(v, u),
            None => {
                first.insert(root, u);
            }
        }
    }
    (out, pattern_files)
}

#[allow(clippy::too_many_arguments)]
fn write_report(
    out_dir: &Path,
    args: &[String],
    timings: &[(&str, u128)],
    changes: &[SemanticChange],
    graph_files: &[String],
    graph: &EntityGraph,
    matched: usize,
    edges_between_changed: usize,
    test_links: usize,
    total_lines: usize,
    covered_lines: usize,
    blocks: &[BlockOut],
    full_graph: Option<(usize, usize, usize)>,
) -> Result<()> {
    use std::fmt::Write;
    let mut s = String::new();
    writeln!(s, "repo: {}", args[1])?;
    for (k, v) in timings {
        writeln!(s, "time  {k:<24} {v:>8} ms")?;
    }
    if let Some((f, e, ed)) = full_graph {
        writeln!(s, "full graph: {f} files, {e} entities, {ed} edges")?;
    }
    let mut by_type: BTreeMap<String, usize> = BTreeMap::new();
    for c in changes {
        *by_type.entry(c.change_type.to_string()).or_default() += 1;
    }
    writeln!(s, "changed entities: {} {:?}", changes.len(), by_type)?;
    writeln!(s, "graph: {} files, {} entities, {} edges; changed entities found in graph: {}", graph_files.len(), graph.entities.len(), graph.edges.len(), matched)?;
    writeln!(s, "edges between changed entities: {edges_between_changed}; test-by-stem links: {test_links}")?;
    writeln!(s, "changed lines: {total_lines}; inside an entity: {covered_lines} ({:.1}%)", 100.0 * covered_lines as f64 / total_lines.max(1) as f64)?;
    let sizes: Vec<usize> = blocks.iter().map(|b| b.lines).collect();
    let bucket = |lo: usize, hi: usize| sizes.iter().filter(|&&x| x >= lo && x < hi).count();
    writeln!(
        s,
        "blocks: {} | <10 lines: {} | 10-50: {} | 50-300: {} | 300-1000: {} | >=1000: {}",
        blocks.len(), bucket(0, 10), bucket(10, 50), bucket(50, 300), bucket(300, 1000), bucket(1000, usize::MAX)
    )?;
    writeln!(s, "largest blocks (lines): {:?}", &sizes[..sizes.len().min(10)])?;
    let largest_share = sizes.first().copied().unwrap_or(0) as f64 / total_lines.max(1) as f64;
    writeln!(s, "largest block share of all changed lines: {:.1}%", 100.0 * largest_share)?;
    std::fs::write(out_dir.join("summary.txt"), &s)?;

    let mut md = format!("# Spike A blocks\n\n```\n{s}```\n\n");
    for b in blocks.iter().take(60) {
        writeln!(md, "## Block {} — {} lines, {} files, kind={}, tests={}, mechanical={}", b.id, b.lines, b.files.len(), b.kind, b.has_tests, b.mechanical_entities)?;
        for e in b.entities.iter().take(15) {
            writeln!(md, "- {e}")?;
        }
        if b.entities.len() > 15 {
            writeln!(md, "- … {} more entities", b.entities.len() - 15)?;
        }
        if !b.residue_files.is_empty() {
            writeln!(md, "- non-entity lines in: {}", b.residue_files.iter().take(8).cloned().collect::<Vec<_>>().join(", "))?;
        }
        md.push('\n');
    }
    std::fs::write(out_dir.join("report.md"), md)?;
    Ok(())
}
