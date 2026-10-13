//! Spike: can a PR be read as user flows? Finds entry points (pages, routes, screens), follows
//! calls (plus JSX usage) through the whole repo, and groups changed blocks into flow chapters with
//! sub-chapters. Usage: flows-spike <checkout-at-head> <review.json> <base> <head> [out.json]

use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};
use std::process::Command;

use sem_core::parser::graph::EntityGraph;
use sem_core::parser::plugins::create_default_registry;
use serde_json::{json, Value};

const MAX_DEPTH: usize = 14;
/// Chapters smaller than this fold into "Other screens".
const SMALL_CHAPTER: u64 = 300;
/// Chapters bigger than this are split into sub-chapters.
const SPLIT_OVER: u64 = 1200;

fn is_entry_file(p: &str) -> bool {
    let l = format!("/{}", p.to_lowercase());
    let name = l.rsplit('/').next().unwrap_or("");
    let stem = name.split('.').next().unwrap_or("");
    let js = [".ts", ".tsx", ".js", ".jsx"].iter().any(|e| name.ends_with(e));
    if !js || l.contains("__tests__") || l.contains(".test.") || l.contains(".spec.") || l.contains("/mocks/") {
        return false;
    }
    (l.contains("/app/") && matches!(stem, "page" | "route" | "layout"))
        || l.contains("/pages/")
        || l.contains("/screens/")
        || stem.ends_with("screen")
        || l.contains("/routes/")
}

/// Entries that reach everything (navigators, layouts) or aren't real user journeys (debug,
/// preview, dummy pages) only get what no real screen reaches.
fn is_weak_entry(p: &str) -> bool {
    let l = p.to_lowercase();
    ["navigat", "stack", "router", "layout", "_app", "/index.", "dummy", "preview", "debug", "mock", "storybook", "example", "/dev/"]
        .iter()
        .any(|h| l.contains(h))
}

fn route_label(p: &str) -> String {
    let p = &format!("/{p}");
    if let Some(i) = p.find("/app/") {
        let rest = &p[i + 4..];
        let dir = rest.rsplit_once('/').map(|x| x.0).unwrap_or("");
        let segs: Vec<&str> = dir.split('/').filter(|s| !s.is_empty() && !s.starts_with('(')).collect();
        return format!("/{}", segs.join("/"));
    }
    if let Some(i) = p.find("/pages/") {
        let r = p[i + 7..].rsplit_once('.').map(|x| x.0).unwrap_or("");
        return format!("/{}", r.trim_end_matches("/index").trim_end_matches("index"));
    }
    p.rsplit('/').next().unwrap_or(p).split('.').next().unwrap_or(p).to_string()
}

/// One reached block: how many calls from the entry, and the entity path that led to it.
struct Hit {
    block: u64,
    depth: usize,
    path: Vec<String>,
}

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let (repo, review_path, base, head_sha) = (std::path::Path::new(&args[1]), &args[2], &args[3], &args[4]);
    let review: Value = serde_json::from_str(&std::fs::read_to_string(review_path)?)?;
    let registry = create_default_registry();
    let files: Vec<String> = String::from_utf8(Command::new("git").args(["ls-files"]).current_dir(repo).output()?.stdout)?
        .lines()
        .filter(|p| registry.get_explicit_plugin(p).is_some())
        .map(str::to_string)
        .collect();
    let (graph, _) = EntityGraph::build(repo, &files, &registry);
    let deps = with_jsx_edges(repo, &graph);
    let name_of = |id: &str| graph.entities.get(id).map(|e| e.name.clone()).unwrap_or_default();

    let blocks = review["blocks"].as_array().unwrap();
    let skim: HashSet<u64> = review["skim"].as_array().unwrap().iter().filter_map(|v| v.as_u64()).collect();
    let mut by_name: HashMap<(String, String), Vec<&str>> = HashMap::new();
    for (id, e) in &graph.entities {
        by_name.entry((e.file_path.clone(), e.name.clone())).or_default().push(id.as_ref());
    }
    let mut block_of: HashMap<String, u64> = HashMap::new();
    let mut info: BTreeMap<u64, &Value> = BTreeMap::new();
    for b in blocks {
        let id = b["id"].as_u64().unwrap();
        if skim.contains(&id) {
            continue;
        }
        info.insert(id, b);
        for c in b["changes"].as_array().unwrap() {
            let key = (c["file"].as_str().unwrap().to_string(), c["name"].as_str().unwrap().to_string());
            for e in by_name.get(&key).into_iter().flatten() {
                block_of.insert((*e).to_string(), id);
            }
        }
    }
    let lines = |b: &u64| info[b]["lines"].as_u64().unwrap_or(0);
    let review_lines: u64 = info.keys().map(lines).sum();

    let mut entries: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for (id, e) in &graph.entities {
        if e.parent_id.is_none() && is_entry_file(&e.file_path) {
            entries.entry(e.file_path.clone()).or_default().push(id.to_string());
        }
    }
    // BFS per entry file, keeping the path to each changed block.
    let mut flows: Vec<(String, Vec<Hit>)> = Vec::new();
    for (file, ids) in &entries {
        let mut parent: HashMap<String, Option<String>> = HashMap::new();
        let mut q: VecDeque<(String, usize)> = VecDeque::new();
        for i in ids {
            parent.insert(i.clone(), None);
            q.push_back((i.clone(), 0));
        }
        let mut hits: Vec<Hit> = Vec::new();
        while let Some((id, d)) = q.pop_front() {
            if let Some(&b) = block_of.get(&id) {
                if !hits.iter().any(|h| h.block == b) {
                    let mut path = vec![id.clone()];
                    let mut cur = id.clone();
                    while let Some(Some(p)) = parent.get(&cur) {
                        path.push(p.clone());
                        cur = p.clone();
                    }
                    path.reverse();
                    hits.push(Hit { block: b, depth: d, path });
                }
            }
            if d < MAX_DEPTH {
                for n in deps.get(id.as_str()).into_iter().flatten() {
                    if !parent.contains_key(n) {
                        parent.insert(n.clone(), Some(id.clone()));
                        q.push_back((n.clone(), d + 1));
                    }
                }
            }
        }
        if !hits.is_empty() {
            flows.push((file.clone(), hits));
        }
    }
    // Each block goes to its nearest strong entry; weak entries only take the rest.
    let mut best: HashMap<u64, (bool, usize, usize, usize)> = HashMap::new();
    for (fi, (f, hits)) in flows.iter().enumerate() {
        for h in hits {
            let key = (is_weak_entry(f), h.depth, hits.len(), fi);
            if best.get(&h.block).is_none_or(|k| key < *k) {
                best.insert(h.block, key);
            }
        }
    }
    struct Chapter {
        title: String,
        entry: String,
        reaches: usize,
        subs: Vec<(String, Vec<u64>)>,
    }
    let mut chapters: Vec<Chapter> = Vec::new();
    let mut other: Vec<(String, Vec<u64>)> = Vec::new();
    for (fi, (f, hits)) in flows.iter().enumerate() {
        let own: Vec<&Hit> = hits.iter().filter(|h| best[&h.block].3 == fi).collect();
        if own.is_empty() {
            continue;
        }
        let total: u64 = own.iter().map(|h| lines(&h.block)).sum();
        let title = route_label(f);
        if total < SMALL_CHAPTER {
            other.push((title, own.iter().map(|h| h.block).collect()));
            continue;
        }
        // Sub-chapters: go down the call tree while one child carries everything, then split by child.
        let mut subs: Vec<(String, Vec<u64>)> = vec![(String::new(), own.iter().map(|h| h.block).collect())];
        if total > SPLIT_OVER {
            let mut level = 1;
            loop {
                let mut groups: BTreeMap<String, Vec<&Hit>> = BTreeMap::new();
                for h in &own {
                    let key = h.path.get(level).cloned().unwrap_or_else(|| h.path.last().cloned().unwrap_or_default());
                    groups.entry(key).or_default().push(h);
                }
                if groups.len() == 1 && level < MAX_DEPTH {
                    level += 1;
                    continue;
                }
                let mut gs: Vec<(String, Vec<u64>)> = groups.into_iter().map(|(k, v)| (name_of(&k), v.iter().map(|h| h.block).collect())).collect();
                gs.sort_by_key(|g| std::cmp::Reverse(g.1.iter().map(lines).sum::<u64>()));
                let (mut keep, mut rest): (Vec<_>, Vec<_>) = (Vec::new(), Vec::new());
                for g in gs {
                    if keep.len() < 7 && g.1.iter().map(lines).sum::<u64>() >= 150 { keep.push(g) } else { rest.extend(g.1) }
                }
                if !rest.is_empty() {
                    keep.push(("Other parts".to_string(), rest));
                }
                subs = keep;
                break;
            }
        }
        // Inside each sub-chapter, call order (nearest first).
        for s in &mut subs {
            s.1.sort_by_key(|b| own.iter().find(|h| h.block == *b).map_or(99, |h| h.depth));
        }
        chapters.push(Chapter { title, entry: f.clone(), reaches: hits.len(), subs });
    }
    chapters.sort_by_key(|c| std::cmp::Reverse(c.subs.iter().flat_map(|s| &s.1).map(lines).sum::<u64>()));
    let covered: HashSet<u64> = best.keys().copied().collect();
    let also: Vec<u64> = info.keys().copied().filter(|b| !covered.contains(b)).collect();

    let sum = |bs: &[u64]| bs.iter().map(lines).sum::<u64>();
    let other_blocks: Vec<u64> = other.iter().flat_map(|o| o.1.clone()).collect();
    println!(
        "{} chapters + other screens ({} screens, {} lines) · flows cover {:.0}% · also changed {} blocks, {} lines",
        chapters.len(),
        other.len(),
        sum(&other_blocks),
        100.0 * (review_lines - sum(&also)) as f64 / review_lines.max(1) as f64,
        also.len(),
        sum(&also)
    );
    for c in &chapters {
        let all: Vec<u64> = c.subs.iter().flat_map(|s| s.1.clone()).collect();
        println!("  {:<40} {:>3} blocks {:>6} lines", c.title, all.len(), sum(&all));
        if c.subs.len() > 1 {
            for s in &c.subs {
                println!("      · {:<34} {:>3} blocks {:>6} lines", s.0, s.1.len(), sum(&s.1));
            }
        }
    }

    if let Some(out) = args.get(5) {
        let block_json = |b: &u64| {
            let v = info[b];
            let file = v["files"][0].as_str().unwrap_or("").to_string();
            json!({"id": b, "file": file, "files": v["files"], "lines": v["lines"], "risk": v["estRisk"], "changes": v["changes"], "checks": v["checks"], "diff": key_lines(repo, base, head_sha, &file)})
        };
        let mut all_ids: Vec<u64> = Vec::new();
        let chs: Vec<Value> = chapters
            .iter()
            .map(|c| {
                json!({"title": c.title, "entry": c.entry, "reaches": c.reaches, "subs": c.subs.iter().map(|s| { all_ids.extend(s.1.clone()); json!({"title": s.0, "blocks": s.1}) }).collect::<Vec<_>>()})
            })
            .collect();
        all_ids.extend(other_blocks.clone());
        all_ids.extend(also.clone());
        let bj: serde_json::Map<String, Value> = all_ids.iter().map(|b| (b.to_string(), block_json(b))).collect();
        let doc = json!({"chapters": chs, "other": other.iter().map(|o| json!({"title": o.0, "blocks": o.1})).collect::<Vec<_>>(), "also": also, "blocks": bj, "coverage": 100.0 * (review_lines - sum(&also)) as f64 / review_lines.max(1) as f64});
        std::fs::write(out, serde_json::to_string(&doc)?)?;
    }
    Ok(())
}

/// The first few changed lines of a file, as (new line number or 0, add|del, text).
fn key_lines(repo: &std::path::Path, base: &str, head: &str, file: &str) -> Vec<(usize, &'static str, String)> {
    let out = Command::new("git").args(["diff", "-U0", base, head, "--", file]).current_dir(repo).output();
    let Ok(out) = out else { return vec![] };
    let text = String::from_utf8_lossy(&out.stdout);
    let mut res = Vec::new();
    let mut n = 0usize;
    for l in text.lines() {
        if let Some(h) = l.strip_prefix("@@") {
            n = h.split('+').nth(1).and_then(|x| x.split([',', ' ']).next()).and_then(|x| x.parse().ok()).unwrap_or(0);
            continue;
        }
        if l.starts_with("+++") || l.starts_with("---") {
            continue;
        }
        if let Some(t) = l.strip_prefix('+') {
            res.push((n, "add", t.to_string()));
            n += 1;
        } else if let Some(t) = l.strip_prefix('-') {
            res.push((0, "del", t.to_string()));
        }
        if res.len() >= 8 {
            break;
        }
    }
    res
}

/// Forward edges from the entity graph plus JSX usage (`<Name`) resolved through each file's imports,
/// which the graph doesn't record.
fn with_jsx_edges(repo: &std::path::Path, g: &EntityGraph) -> HashMap<String, Vec<String>> {
    let mut out: HashMap<String, Vec<String>> = g.dependencies().iter().map(|(k, v)| (k.to_string(), v.iter().map(|x| x.to_string()).collect())).collect();
    let mut top: HashMap<&str, Vec<(&str, &str)>> = HashMap::new();
    let mut by_file: HashMap<&str, Vec<(usize, usize, &str)>> = HashMap::new();
    for (id, e) in &g.entities {
        if e.parent_id.is_none() {
            top.entry(e.name.as_str()).or_default().push((id.as_ref(), e.file_path.as_str()));
            by_file.entry(e.file_path.as_str()).or_default().push((e.start_line, e.end_line, id.as_ref()));
        }
    }
    let mut added = 0usize;
    for (file, ents) in &by_file {
        if !(file.ends_with(".tsx") || file.ends_with(".jsx")) {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(repo.join(file)) else { continue };
        // name -> import source
        let mut imports: HashMap<String, String> = HashMap::new();
        for stmt in text.split("import ").skip(1) {
            let Some((head, rest)) = stmt.split_once(" from ") else { continue };
            let src = rest.trim_start().trim_start_matches(['\'', '"']).split(['\'', '"']).next().unwrap_or("");
            for n in head.replace(['{', '}', '\n'], ",").split(',') {
                let n = n.trim().rsplit(" as ").next().unwrap_or("").trim();
                if !n.is_empty() && n != "type" {
                    imports.insert(n.to_string(), src.to_string());
                }
            }
        }
        for (ln, line) in text.lines().enumerate() {
            let ln = ln + 1;
            let mut rest = line;
            while let Some(i) = rest.find('<') {
                rest = &rest[i + 1..];
                let name: String = rest.chars().take_while(|c| c.is_alphanumeric() || *c == '_').collect();
                if !name.starts_with(|c: char| c.is_ascii_uppercase()) {
                    continue;
                }
                let Some(cands) = top.get(name.as_str()) else { continue };
                let src = imports.get(&name).map(String::as_str).unwrap_or("");
                let tail = src.trim_start_matches("./").trim_start_matches("../").trim_start_matches("@/").trim_start_matches('~').trim_start_matches('/');
                let target = cands
                    .iter()
                    .find(|(_, f)| !tail.is_empty() && (f.contains(tail) || f.contains(&format!("{tail}/index"))))
                    .or_else(|| if cands.len() == 1 { cands.first() } else { None })
                    .map(|x| x.0);
                let from = ents.iter().filter(|(s, e, _)| *s <= ln && ln <= *e).min_by_key(|(s, e, _)| e - s).map(|x| x.2);
                if let (Some(f), Some(t)) = (from, target) {
                    if f != t {
                        out.entry(f.to_string()).or_default().push(t.to_string());
                        added += 1;
                    }
                }
            }
        }
    }
    eprintln!("added {added} JSX edges");
    out
}
