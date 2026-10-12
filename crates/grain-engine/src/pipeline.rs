use std::collections::{BTreeMap, HashMap, HashSet};
use std::fmt::Write as _;
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

use crate::classify::{is_test_path, kind_of, layer_of};
use crate::diff::hunks::hunk_lines;
use crate::diff::units::{Unit, Units, build_units, merge_ranges};
use crate::facts::checks::rule_checks;
use crate::facts::removed::removed_names_still_mentioned;
use crate::facts::usage::{UsageProvider, name_position};
use crate::grouping::blocks::{block_dir, block_key, stable_hash};
use crate::grouping::chapters::build_chapters;
use crate::grouping::cluster::group_v2;
use crate::model::{Analysis, Block, EntityChange, Review, Risk, Slice};

/// How much of the repository the analysis may read.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Depth {
    /// Only the changed files: enough for grouping, titles and most checks. Opens instantly.
    Fast,
    /// Also the whole repository at `head`: outside usage and dangling removals.
    Complete,
}

/// Analyzes `base..head` in a checkout of `head` at `repo` (full depth).
pub fn analyze(repo: &Path, base: &str, head: &str) -> Result<Analysis> {
    analyze_with(repo, base, head, Depth::Complete)
}

/// Analyzes `base..head`. With [`Depth::Fast`] only the changed files must be checked out;
/// blocks and chapters are identical at both depths, only facts differ.
pub fn analyze_with(repo: &Path, base: &str, head: &str, depth: Depth) -> Result<Analysis> {
    analyze_with_usage(repo, base, head, depth, None)
}

/// Like [`analyze_with`]; at [`Depth::Complete`], `usage` answers outside usage for the files it
/// supports (precise), and the entity graph answers the rest.
pub fn analyze_with_usage(
    repo: &Path,
    base: &str,
    head: &str,
    depth: Depth,
    usage: Option<&dyn UsageProvider>,
) -> Result<Analysis> {
    let mut timings: Vec<(&str, u128)> = Vec::new();

    let t = Instant::now();
    let bridge = GitBridge::open(repo).context("open repo")?;
    let file_changes =
        bridge.get_changed_files(&DiffScope::Range { from: base.to_string(), to: head.to_string() }, &[])?;
    timings.push(("git changed files", t.elapsed().as_millis()));

    let t = Instant::now();
    let registry = create_default_registry();
    let changes: Vec<SemanticChange> = compute_semantic_diff(&file_changes, &registry, None, None).changes;
    timings.push(("semantic diff", t.elapsed().as_millis()));

    let t = Instant::now();
    let hunks = hunk_lines(repo, base, head)?;
    timings.push(("git -U0 hunks", t.elapsed().as_millis()));

    // Graph over changed, still-existing, parser-supported files: edges between changed entities.
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
    let full_graph = if depth == Depth::Complete {
        let all_files: Vec<String> =
            String::from_utf8(Command::new("git").args(["ls-files"]).current_dir(repo).output()?.stdout)?
                .lines()
                .filter(|p| registry.get_explicit_plugin(p).is_some())
                .map(str::to_string)
                .collect();
        let t = Instant::now();
        let (g, _) = EntityGraph::build(repo, &all_files, &registry);
        timings.push(("graph (full repo)", t.elapsed().as_millis()));
        Some(g)
    } else {
        None
    };

    let units = build_units(&changes, &hunks);

    let t = Instant::now();
    let (mut uf, pattern_files) = group_v2(&changes, &units.items, &units.lines, &graph, &hunks);
    let mut groups: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    for u in 0..units.items.len() {
        groups.entry(uf.find(u)).or_default().push(u);
    }
    let member_sets = split_huge_files(groups, &units, &changes);
    timings.push(("grouping", t.elapsed().as_millis()));

    let t = Instant::now();
    let still_mentioned =
        if depth == Depth::Complete { removed_names_still_mentioned(repo, &changes) } else { HashMap::new() };
    timings.push(("removed-name check", t.elapsed().as_millis()));

    let ctx = BlockContext {
        changes: &changes,
        units: &units,
        full_graph: full_graph.as_ref(),
        usage: usage.filter(|_| depth == Depth::Complete),
        pr_files: file_changes
            .iter()
            .flat_map(|f| std::iter::once(f.file_path.as_str()).chain(f.old_file_path.as_deref()))
            .collect(),
        changed_ids: changes.iter().map(|c| c.entity_id.as_str()).collect(),
        pattern_files: &pattern_files,
        still_mentioned: &still_mentioned,
        hunks: &hunks,
    };
    let mut blocks: Vec<Block> = member_sets
        .iter()
        .map(|(m, part)| assemble_block(&ctx, m, *part))
        .filter(|b| b.lines > 0 || !b.entities.is_empty())
        .collect();
    // Parts of a split file sort as one unit (by their combined size), in part order.
    let mut split_lines: HashMap<String, usize> = HashMap::new();
    for b in blocks.iter().filter(|b| b.slice.is_some()) {
        *split_lines.entry(b.files[0].clone()).or_default() += b.lines;
    }
    let sort_key = |b: &Block| {
        let lines = if b.slice.is_some() { split_lines[&b.files[0]] } else { b.lines };
        (
            b.layer,
            std::cmp::Reverse(lines),
            b.slice.as_ref().map(|_| b.files[0].clone()),
            b.slice.as_ref().map(|s| s.part),
        )
    };
    blocks.sort_by(|a, b| sort_key(a).cmp(&sort_key(b)).then(a.key.cmp(&b.key)));
    for (i, b) in blocks.iter_mut().enumerate() {
        b.id = i + 1;
    }
    let chapters = build_chapters(&blocks);
    let skim: Vec<usize> = blocks.iter().filter(|b| b.skim.is_some()).map(|b| b.id).collect();

    let summary = summarize(&timings, &units, &blocks, &chapters, &skim, &graph_files, &changes, &graph);
    let complete = depth == Depth::Complete;
    Ok(Analysis { review: Review { chapters, skim, blocks, total_lines: units.total_lines, complete }, summary })
}

/// `(split above, part size)` in changed lines. Code is cut finer than tests and fixtures,
/// which are skimmed in bigger runs. A single entity larger than a part stays whole.
fn slice_limits(file: &str) -> (usize, usize) {
    if is_test_path(file) || file.to_ascii_lowercase().contains("fixture") { (1200, 600) } else { (400, 200) }
}

/// A group's units, and `(part, of)` when it is one part of a split file.
type MemberSet = (Vec<usize>, Option<(usize, usize)>);

/// Huge single-file groups (big rewrites, 10K-line test files) are cut into runs of whole
/// entities in file order (sizes from [`slice_limits`]).
fn split_huge_files(groups: BTreeMap<usize, Vec<usize>>, units: &Units, changes: &[SemanticChange]) -> Vec<MemberSet> {
    let mut member_sets = Vec::new();
    for members in groups.into_values() {
        let files: HashSet<&str> = members.iter().map(|&u| units.file(changes, u)).collect();
        let lines: usize = members.iter().map(|&u| units.lines[u]).sum();
        let (split_over, slice) = files.iter().next().map_or((usize::MAX, usize::MAX), |f| slice_limits(f));
        if files.len() != 1 || lines <= split_over || members.len() < 2 {
            member_sets.push((members, None));
            continue;
        }
        let mut sorted = members;
        sorted.sort_by_key(|&u| (units.start_line(changes, u), u));
        let mut parts: Vec<Vec<usize>> = Vec::new();
        let mut cur: Vec<usize> = Vec::new();
        let mut cur_lines = 0;
        for u in sorted {
            if cur_lines + units.lines[u] > slice && !cur.is_empty() {
                parts.push(std::mem::take(&mut cur));
                cur_lines = 0;
            }
            cur_lines += units.lines[u];
            cur.push(u);
        }
        parts.push(cur);
        let of = parts.len();
        if of == 1 {
            member_sets.extend(parts.into_iter().map(|p| (p, None)));
        } else {
            member_sets.extend(parts.into_iter().enumerate().map(|(i, p)| (p, Some((i + 1, of)))));
        }
    }
    member_sets
}

struct BlockContext<'a> {
    changes: &'a [SemanticChange],
    units: &'a Units,
    /// Whole-repo graph; `None` at [`Depth::Fast`].
    full_graph: Option<&'a EntityGraph>,
    usage: Option<&'a dyn UsageProvider>,
    /// Every path the PR touches; usage inside the PR doesn't count as outside usage.
    pr_files: HashSet<&'a str>,
    changed_ids: HashSet<&'a str>,
    pattern_files: &'a HashSet<String>,
    still_mentioned: &'a HashMap<String, Vec<String>>,
    hunks: &'a BTreeMap<String, crate::diff::hunks::FileHunks>,
}

/// Builds one block: its entities, outside usage, skim reason, layer, checks and estimated risk.
fn assemble_block(ctx: &BlockContext<'_>, members: &[usize], part: Option<(usize, usize)>) -> Block {
    let mut file_lines: BTreeMap<String, usize> = BTreeMap::new();
    let (mut entities, mut residue_files, mut mech, mut lines, mut tests) = (vec![], vec![], 0, 0, false);
    let mut changes_out: Vec<EntityChange> = Vec::new();
    let mut users: BTreeMap<String, String> = BTreeMap::new();
    let mut test_users: HashSet<String> = HashSet::new();
    for &u in members {
        lines += ctx.units.lines[u];
        *file_lines.entry(ctx.units.file(ctx.changes, u).to_string()).or_default() += ctx.units.lines[u];
        match &ctx.units.items[u] {
            Unit::Entity(i) => {
                let c = &ctx.changes[*i];
                tests |= is_test_path(&c.file_path);
                let mechanical = c.structural_change == Some(false)
                    || (matches!(c.change_type, ChangeType::Moved | ChangeType::Renamed | ChangeType::Reordered)
                        && !c.has_content_change());
                mech += usize::from(mechanical);
                entities.push(format!("{} {} `{}` ({})", c.change_type, c.entity_type, c.entity_name, c.file_path));
                changes_out.push(EntityChange {
                    change: c.change_type.to_string(),
                    kind: c.entity_type.clone(),
                    name: c.entity_name.clone(),
                    old_name: c.old_entity_name.clone().filter(|o| o != &c.entity_name),
                    file: c.file_path.clone(),
                });
                let outside = !matches!(c.change_type, ChangeType::Deleted) && !is_test_path(&c.file_path);
                let precise = ctx.usage.filter(|_| outside).and_then(|u| {
                    let (line, character) = name_position(c)?;
                    u.referencing_files(&c.file_path, line, character)
                });
                if let Some(files) = precise {
                    for f in files.into_iter().filter(|f| !ctx.pr_files.contains(f.as_str())) {
                        if is_test_path(&f) {
                            test_users.insert(f);
                        } else {
                            let label = f.rsplit('/').next().unwrap_or(&f).to_string();
                            users.insert(f, label);
                        }
                    }
                } else if let Some(full_graph) = ctx.full_graph
                    && outside
                {
                    for dep in full_graph.dependents().get(c.entity_id.as_str()).into_iter().flatten() {
                        if ctx.changed_ids.contains(dep.as_str()) {
                            continue;
                        }
                        if let Some(info) = full_graph.entities.get(dep.as_str()) {
                            if is_test_path(&info.file_path) {
                                test_users.insert(dep.to_string());
                            } else {
                                users.insert(
                                    dep.to_string(),
                                    format!("{} ({})", info.name, info.file_path.rsplit('/').next().unwrap_or("")),
                                );
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
    let kind = if kinds.len() == 1 {
        kinds.into_iter().next().unwrap_or("code").to_string()
    } else if kinds.contains("code") {
        "code".into()
    } else {
        "mixed".into()
    };
    let skim = if matches!(kind.as_str(), "lockfile" | "generated" | "asset" | "docs") {
        Some(kind.clone())
    } else if files.len() >= 3 && files.iter().all(|f| ctx.pattern_files.contains(f)) {
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
        (vec![], Risk::Low)
    } else {
        rule_checks(
            &changes_out,
            &files,
            lines,
            tests,
            mech,
            users.len(),
            test_users.len(),
            &used_by_sample,
            ctx.still_mentioned,
        )
    };
    // What the reviewer actually read: every entity's before/after text, and the changed-line
    // shapes of lines outside entities. Any edit to the block changes this hash.
    let mut content: Vec<String> = Vec::new();
    for &u in members {
        match &ctx.units.items[u] {
            Unit::Entity(i) => {
                let c = &ctx.changes[*i];
                content.push(format!(
                    "{}\0{}\0{}",
                    c.entity_id,
                    c.before_content.as_deref().unwrap_or_default(),
                    c.after_content.as_deref().unwrap_or_default()
                ));
            }
            Unit::Residue(p) => {
                let mut shapes: Vec<&String> = ctx.hunks.get(p).map(|h| h.shape.iter().collect()).unwrap_or_default();
                shapes.sort();
                content.push(format!("{p}\0{}", shapes.iter().map(|s| s.as_str()).collect::<Vec<_>>().join("\n")));
            }
        }
    }
    content.sort();
    let slice = part.map(|(part, of)| {
        let (mut new, mut old) = (vec![], vec![]);
        for &u in members {
            let (n, o) = ctx.units.ranges(ctx.changes, u);
            new.extend(n);
            old.extend(o);
        }
        Slice { part, of, new_lines: merge_ranges(new), old_lines: merge_ranges(old) }
    });
    Block {
        id: 0,
        key: block_key(&files, &entities),
        content_hash: stable_hash(content.iter().map(String::as_str)),
        lines,
        files,
        entities,
        residue_files,
        mechanical_entities: mech,
        has_tests: tests,
        kind,
        skim,
        layer,
        dir,
        changes: changes_out,
        used_by: users.len(),
        used_by_sample,
        checks,
        est_risk,
        slice,
    }
}

#[allow(clippy::too_many_arguments)]
fn summarize(
    timings: &[(&str, u128)],
    units: &Units,
    blocks: &[Block],
    chapters: &[crate::model::Chapter],
    skim: &[usize],
    graph_files: &[String],
    changes: &[SemanticChange],
    graph: &EntityGraph,
) -> String {
    let pct = |part: usize, whole: usize| 100.0 * part as f64 / whole.max(1) as f64;
    let matched = changes.iter().filter(|c| graph.entities.contains_key(c.entity_id.as_str())).count();
    let skim_lines: usize = blocks.iter().filter(|b| b.skim.is_some()).map(|b| b.lines).sum();
    let mut s = String::new();
    for (k, v) in timings {
        let _ = writeln!(s, "time  {k:<24} {v:>8} ms");
    }
    let _ = writeln!(
        s,
        "{} changed lines ({:.1}% inside entities, {matched} matched in graph, {} graph files)",
        units.total_lines,
        pct(units.covered_lines, units.total_lines),
        graph_files.len(),
    );
    let _ = writeln!(
        s,
        "{} chapters, {} review blocks, {} skim groups ({skim_lines} lines, {:.0}% of PR)",
        chapters.len(),
        blocks.len() - skim.len(),
        skim.len(),
        pct(skim_lines, units.total_lines),
    );
    s
}
