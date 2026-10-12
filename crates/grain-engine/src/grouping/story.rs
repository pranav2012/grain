use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet, VecDeque};
use std::path::Path;

use sem_core::parser::graph::EntityGraph;

use super::blocks::stable_hash;
use crate::classify::is_test_path;
use crate::model::{Block, Chapter, ChapterKind, Section, Story};

/// How far calls are followed from an entry point.
const MAX_DEPTH: usize = 14;
/// Flow chapters bigger than this are split into sections by the component that leads to them.
const SPLIT_OVER: usize = 1200;
/// Flows smaller than this, and any beyond the biggest [`MAX_FLOWS`], go to "Other screens".
const SMALL_FLOW: usize = 300;
const MAX_FLOWS: usize = 20;
/// Sections smaller than this fold into "Other parts".
const SMALL_SECTION: usize = 150;
const MAX_SECTIONS: usize = 7;

/// Pages, routes and screens a user lands on (Next.js app and pages routers, React Native screens).
#[allow(clippy::case_sensitive_file_extension_comparisons, reason = "the path is lowercased first")]
pub(crate) fn is_entry_file(path: &str) -> bool {
    let l = format!("/{}", path.to_lowercase());
    let name = l.rsplit('/').next().unwrap_or("");
    let stem = name.split('.').next().unwrap_or("");
    let js = [".ts", ".tsx", ".js", ".jsx", ".mjs"].iter().any(|e| name.ends_with(e));
    if !js || is_test_path(&l) || l.contains("/mocks/") || l.contains("/__mocks__/") {
        return false;
    }
    // Screens folders also hold hooks and helpers; only components (JSX files, not `use…`) are screens.
    let component = (name.ends_with(".tsx") || name.ends_with(".jsx")) && !stem.starts_with("use");
    (l.contains("/app/") && matches!(stem, "page" | "route"))
        || l.contains("/pages/")
        || (l.contains("/screens/") && component)
        || (stem.ends_with("screen") && component)
}

/// Entries that reach almost everything (navigators, layouts, app shells) or aren't real user
/// journeys (dummy, preview, debug pages): they only get what no real page reaches.
fn is_weak_entry(path: &str) -> bool {
    let l = path.to_lowercase();
    is_dev_entry(&l)
        || ["navigat", "stack", "router", "layout", "/_app", "/_document", "/index."].iter().any(|h| l.contains(h))
}

fn is_dev_entry(path: &str) -> bool {
    let l = path.to_lowercase();
    ["dummy", "preview", "debug", "mock", "storybook", "example", "/dev/", "playground"].iter().any(|h| l.contains(h))
}

/// What a reader calls the entry: the URL path for routes, the file name for screens.
pub(crate) fn entry_title(path: &str) -> String {
    let p = format!("/{path}");
    if let Some(i) = p.find("/app/") {
        let dir = p[i + 4..].rsplit_once('/').map_or("", |x| x.0);
        let segs: Vec<&str> = dir.split('/').filter(|s| !s.is_empty() && !s.starts_with('(')).collect();
        return format!("/{}", segs.join("/"));
    }
    if let Some(i) = p.find("/pages/") {
        let route = p[i + 7..].rsplit_once('.').map_or("", |x| x.0);
        let route = route.trim_end_matches("index").trim_end_matches('/');
        return format!("/{route}");
    }
    let name = p.rsplit('/').next().unwrap_or(&p);
    name.split('.').next().unwrap_or(name).to_string()
}

/// One changed block reached from an entry: calls away, and the entities on the way.
struct Hit {
    block: usize,
    depth: usize,
    path: Vec<String>,
}

/// The review as a story. With the whole-repo graph (complete analysis) the chapters are user flows:
/// each page or screen and the changed code it runs, in call order. Code no flow reaches, and every
/// language without entry points, falls back to chapters by area. Skim blocks end the story.
pub(crate) fn build_story(
    repo: &Path,
    blocks: &[Block],
    entity_block: &HashMap<String, usize>,
    full_graph: Option<&EntityGraph>,
) -> Story {
    let review: Vec<&Block> = blocks.iter().filter(|b| b.skim.is_none()).collect();
    let lines: HashMap<usize, usize> = blocks.iter().map(|b| (b.id, b.lines)).collect();
    let mut chapters: Vec<Chapter> = Vec::new();
    let mut covered: HashSet<usize> = HashSet::new();

    if let Some(graph) = full_graph {
        let (flow_chapters, reached) = flow_chapters(repo, graph, entity_block, &lines);
        covered = reached;
        chapters = flow_chapters;
    }
    let flows = !chapters.is_empty();

    let rest: Vec<&Block> = review.iter().copied().filter(|b| !covered.contains(&b.id)).collect();
    if !rest.is_empty() {
        let sections = area_sections(&rest);
        if flows {
            let n = rest.len();
            chapters.push(chapter(
                ChapterKind::Also,
                "Also changed",
                None,
                sections,
                format!("{n} changes no page or screen reaches"),
            ));
        } else {
            // Without flows, each area is its own chapter.
            for s in sections {
                let title = s.title.clone();
                chapters.push(chapter(
                    ChapterKind::Area,
                    &title,
                    None,
                    vec![Section { title: String::new(), ..s }],
                    String::new(),
                ));
            }
        }
    }
    let skim: Vec<usize> = blocks.iter().filter(|b| b.skim.is_some()).map(|b| b.id).collect();
    if !skim.is_empty() {
        let s = Section { title: String::new(), blocks: skim };
        chapters.push(chapter(
            ChapterKind::Routine,
            "Routine",
            None,
            vec![s],
            "Lockfiles, generated files, moves and repeated edits".into(),
        ));
    }
    for (i, c) in chapters.iter_mut().enumerate() {
        c.id = i + 1;
    }
    Story { chapters, flows }
}

fn chapter(kind: ChapterKind, title: &str, entry: Option<String>, sections: Vec<Section>, about: String) -> Chapter {
    let mut keys: Vec<String> = sections.iter().flat_map(|s| s.blocks.iter().map(usize::to_string)).collect();
    keys.sort();
    Chapter {
        id: 0,
        key: stable_hash(std::iter::once(title).chain(keys.iter().map(String::as_str))),
        kind,
        title: title.to_string(),
        entry,
        about,
        sections,
    }
}

/// Changes grouped by their feature folder (`src/features/voucher`), biggest risk first, then size.
fn area_sections(blocks: &[&Block]) -> Vec<Section> {
    let mut by: BTreeMap<String, Vec<&Block>> = BTreeMap::new();
    for b in blocks {
        let segs: Vec<&str> = b.dir.split('/').filter(|s| !s.is_empty()).collect();
        let depth = if segs.first().is_some_and(|s| matches!(*s, "src" | "lib" | "app" | "packages" | "crates")) {
            3
        } else {
            2
        };
        let area = segs.iter().take(depth).copied().collect::<Vec<_>>().join("/");
        by.entry(if area.is_empty() { "Root".into() } else { area }).or_default().push(b);
    }
    let rank = |r: &crate::model::Risk| match r {
        crate::model::Risk::High => 0,
        crate::model::Risk::Medium => 1,
        crate::model::Risk::Low => 2,
    };
    let mut out: Vec<(usize, usize, Section)> = by
        .into_iter()
        .map(|(title, mut bs)| {
            bs.sort_by_key(|b| (rank(&b.est_risk), std::cmp::Reverse(b.lines), b.id));
            let risk = bs.iter().map(|b| rank(&b.est_risk)).min().unwrap_or(2);
            let size: usize = bs.iter().map(|b| b.lines).sum();
            (risk, size, Section { title, blocks: bs.iter().map(|b| b.id).collect() })
        })
        .collect();
    out.sort_by(|a, b| a.0.cmp(&b.0).then(b.1.cmp(&a.1)).then(a.2.title.cmp(&b.2.title)));
    out.into_iter().map(|x| x.2).collect()
}

/// User-flow chapters from every entry point that reaches changed code. Each block goes to its
/// nearest real entry; weak entries keep only the rest. Returns the chapters and the blocks they hold.
fn flow_chapters(
    repo: &Path,
    graph: &EntityGraph,
    entity_block: &HashMap<String, usize>,
    lines: &HashMap<usize, usize>,
) -> (Vec<Chapter>, HashSet<usize>) {
    let deps = edges_with_jsx(repo, graph);
    let mut entries: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    for (id, e) in &graph.entities {
        if e.parent_id.is_none() && is_entry_file(&e.file_path) {
            entries.entry(e.file_path.as_str()).or_default().push(id.as_ref());
        }
    }
    let mut flows: Vec<(&str, Vec<Hit>)> = Vec::new();
    for (file, ids) in &mut entries {
        ids.sort_unstable();
        let mut parent: HashMap<&str, Option<&str>> = ids.iter().map(|i| (*i, None)).collect();
        let mut queue: VecDeque<(&str, usize)> = ids.iter().map(|i| (*i, 0)).collect();
        let mut hits: Vec<Hit> = Vec::new();
        let mut seen_blocks: HashSet<usize> = HashSet::new();
        while let Some((id, depth)) = queue.pop_front() {
            if let Some(&b) = entity_block.get(id)
                && seen_blocks.insert(b)
            {
                let mut path = vec![id.to_string()];
                let mut cur = id;
                while let Some(Some(p)) = parent.get(cur) {
                    path.push((*p).to_string());
                    cur = p;
                }
                path.reverse();
                hits.push(Hit { block: b, depth, path });
            }
            if depth < MAX_DEPTH {
                for next in deps.get(id).into_iter().flatten() {
                    if !parent.contains_key(next.as_str()) {
                        parent.insert(next.as_str(), Some(id));
                        queue.push_back((next.as_str(), depth + 1));
                    }
                }
            }
        }
        if !hits.is_empty() {
            flows.push((file, hits));
        }
    }

    let mut best: HashMap<usize, (bool, usize, usize, usize)> = HashMap::new();
    for (fi, (file, hits)) in flows.iter().enumerate() {
        for h in hits {
            let key = (is_weak_entry(file), h.depth, hits.len(), fi);
            if best.get(&h.block).is_none_or(|k| key < *k) {
                best.insert(h.block, key);
            }
        }
    }
    let size = |bs: &[usize]| bs.iter().map(|b| lines.get(b).copied().unwrap_or(0)).sum::<usize>();
    let name_of = |id: &str| graph.entities.get(id).map(|e| e.name.clone()).unwrap_or_default();

    let mut real: Vec<Chapter> = Vec::new();
    let (mut dev, mut minor): (Vec<Section>, Vec<Section>) = (Vec::new(), Vec::new());
    for (fi, (file, hits)) in flows.iter().enumerate() {
        let own: Vec<&Hit> = hits.iter().filter(|h| best[&h.block].3 == fi).collect();
        if own.is_empty() {
            continue;
        }
        let ids: Vec<usize> = own.iter().map(|h| h.block).collect();
        let title = entry_title(file);
        if is_dev_entry(file) {
            dev.push(Section { title, blocks: by_depth(&own) });
        } else if size(&ids) < SMALL_FLOW {
            minor.push(Section { title, blocks: by_depth(&own) });
        } else {
            let sections = if size(&ids) > SPLIT_OVER {
                split_by_component(&own, &size, &name_of)
            } else {
                vec![Section { title: String::new(), blocks: by_depth(&own) }]
            };
            let about = format!("What runs from {file}");
            real.push(chapter(ChapterKind::Flow, &title, Some((*file).to_string()), sections, about));
        }
    }
    real.sort_by(|a, b| {
        let sa: usize = a.sections.iter().map(|s| size(&s.blocks)).sum();
        let sb: usize = b.sections.iter().map(|s| size(&s.blocks)).sum();
        sb.cmp(&sa).then(a.title.cmp(&b.title))
    });
    for extra in real.split_off(real.len().min(MAX_FLOWS)) {
        minor.push(Section { title: extra.title, blocks: extra.sections.into_iter().flat_map(|s| s.blocks).collect() });
    }
    for (kind, title, about, mut sections) in [
        (ChapterKind::Screens, "Other screens", "Smaller changes reached from other pages and screens", minor),
        (ChapterKind::Preview, "Preview and dev pages", "Code only preview, dummy or debug pages reach", dev),
    ] {
        if !sections.is_empty() {
            sections.sort_by(|a, b| size(&b.blocks).cmp(&size(&a.blocks)).then(a.title.cmp(&b.title)));
            real.push(chapter(kind, title, None, sections, about.into()));
        }
    }
    (real, best.into_keys().collect())
}

fn by_depth(hits: &[&Hit]) -> Vec<usize> {
    let mut v: Vec<(usize, usize)> = hits.iter().map(|h| (h.depth, h.block)).collect();
    v.sort_unstable();
    v.into_iter().map(|x| x.1).collect()
}

/// Sections by the component that leads to each change: go down the call tree while one child
/// carries every change, then split by child. Small sections fold into "Other parts".
fn split_by_component(
    hits: &[&Hit],
    size: &dyn Fn(&[usize]) -> usize,
    name_of: &dyn Fn(&str) -> String,
) -> Vec<Section> {
    let mut level = 1;
    loop {
        let mut groups: BTreeMap<&str, Vec<&Hit>> = BTreeMap::new();
        for h in hits {
            let key = h.path.get(level).or(h.path.last()).map_or("", String::as_str);
            groups.entry(key).or_default().push(h);
        }
        if groups.len() == 1 && level < MAX_DEPTH && hits.iter().any(|h| h.path.len() > level + 1) {
            level += 1;
            continue;
        }
        let mut gs: Vec<(String, Vec<&Hit>)> = groups.into_iter().map(|(k, v)| (name_of(k), v)).collect();
        gs.sort_by(|a, b| {
            let (sa, sb) = (size(&by_depth(&a.1)), size(&by_depth(&b.1)));
            sb.cmp(&sa).then(a.0.cmp(&b.0))
        });
        let mut out: Vec<Section> = Vec::new();
        let mut rest: Vec<&Hit> = Vec::new();
        for (title, g) in gs {
            let blocks = by_depth(&g);
            if out.len() < MAX_SECTIONS && size(&blocks) >= SMALL_SECTION {
                out.push(Section { title, blocks });
            } else {
                rest.extend(g);
            }
        }
        if !rest.is_empty() {
            out.push(Section { title: "Other parts".into(), blocks: by_depth(&rest) });
        }
        return out;
    }
}

/// The graph's forward edges plus JSX usage (`<Name ...>`), which it doesn't record: each tag is
/// resolved through the file's imports to the component's definition. Neighbour lists are sorted.
fn edges_with_jsx(repo: &Path, graph: &EntityGraph) -> HashMap<String, Vec<String>> {
    let mut out: HashMap<String, BTreeSet<String>> = graph
        .dependencies()
        .iter()
        .map(|(k, v)| (k.to_string(), v.iter().map(ToString::to_string).collect()))
        .collect();
    let mut top: HashMap<&str, Vec<(&str, &str)>> = HashMap::new();
    let mut by_file: BTreeMap<&str, Vec<(usize, usize, &str)>> = BTreeMap::new();
    for (id, e) in &graph.entities {
        if e.parent_id.is_none() {
            top.entry(e.name.as_str()).or_default().push((id.as_ref(), e.file_path.as_str()));
            by_file.entry(e.file_path.as_str()).or_default().push((e.start_line, e.end_line, id.as_ref()));
        }
    }
    for (file, ents) in &by_file {
        if !std::path::Path::new(file)
            .extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("tsx") || e.eq_ignore_ascii_case("jsx"))
        {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(repo.join(file)) else { continue };
        let imports = import_sources(&text);
        for (i, line) in text.lines().enumerate() {
            let ln = i + 1;
            let Some(from) =
                ents.iter().filter(|(s, e, _)| *s <= ln && ln <= *e).min_by_key(|(s, e, _)| e - s).map(|x| x.2)
            else {
                continue;
            };
            for tag in line.split('<').skip(1) {
                let name: String = tag.chars().take_while(|c| c.is_alphanumeric() || *c == '_').collect();
                if !name.starts_with(|c: char| c.is_ascii_uppercase()) {
                    continue;
                }
                let Some(cands) = top.get(name.as_str()) else { continue };
                let tail = imports.get(&name).map_or("", |s| s.trim_start_matches(['.', '/', '@', '~']));
                let target = cands
                    .iter()
                    .find(|(_, f)| !tail.is_empty() && f.contains(tail))
                    .or_else(|| if cands.len() == 1 { cands.first() } else { None })
                    .map(|x| x.0);
                if let Some(t) = target
                    && t != from
                {
                    out.entry(from.to_string()).or_default().insert(t.to_string());
                }
            }
        }
    }
    out.into_iter().map(|(k, v)| (k, v.into_iter().collect())).collect()
}

/// `Name → module` for each imported name (default, named and aliased imports).
fn import_sources(text: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for stmt in text.split("import ").skip(1) {
        let Some((head, rest)) = stmt.split_once(" from ") else { continue };
        let src = rest.trim_start().trim_start_matches(['\'', '"']).split(['\'', '"']).next().unwrap_or("");
        for n in head.replace(['{', '}', '\n'], ",").split(',') {
            let n = n.trim().rsplit(" as ").next().unwrap_or("").trim();
            if !n.is_empty() && n != "type" && !n.contains(' ') {
                out.insert(n.to_string(), src.to_string());
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::{entry_title, import_sources, is_entry_file, is_weak_entry};

    #[test]
    fn finds_entry_points_and_names_them() {
        assert!(is_entry_file("app/voucher/[bookingId]/page.tsx"));
        assert!(is_entry_file("src/pages/[lang]/profile.tsx"));
        assert!(is_entry_file("src/screens/myBookings/MyBookingsScreen.tsx"));
        assert!(!is_entry_file("src/screens/__tests__/MyBookingsScreen.test.tsx"));
        assert!(!is_entry_file("src/components/Card.tsx"));
        assert_eq!(entry_title("app/voucher/[bookingId]/page.tsx"), "/voucher/[bookingId]");
        assert_eq!(entry_title("app/(shop)/cart/page.tsx"), "/cart");
        assert_eq!(entry_title("pages/[lang]/profile/index.tsx"), "/[lang]/profile");
        assert_eq!(entry_title("src/screens/MyBookingsScreen.tsx"), "MyBookingsScreen");
        assert!(is_weak_entry("app/voucher/dummy/preview/page.tsx"));
        assert!(is_weak_entry("src/navigation/BookingFlowNavigationStack.tsx"));
    }

    #[test]
    fn reads_imports() {
        let m = import_sources("import A, { B, C as D } from './x';\nimport type { T } from \"@/t\";");
        assert_eq!(m.get("A").map(String::as_str), Some("./x"));
        assert_eq!(m.get("D").map(String::as_str), Some("./x"));
        assert_eq!(m.get("T").map(String::as_str), Some("@/t"));
    }
}
