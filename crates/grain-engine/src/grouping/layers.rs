use std::collections::{BTreeMap, BTreeSet, HashMap};

use super::blocks::stable_hash;
use super::union_find::Uf;
use crate::classify::{is_test_path, stem};
use crate::model::{Block, BlockLink, Layer};

/// Most changed lines in one layer; a single bigger block gets a layer of its own.
pub(crate) const MAX_LINES: usize = 400;
/// Most blocks in one layer.
pub(crate) const MAX_BLOCKS: usize = 6;
/// Neighbouring layers this small are combined even when they aren't linked.
const SMALL: usize = 120;
/// A layer this small never stands alone: it takes the next block of its unit even past the cap.
const TINY: usize = 60;

/// Review blocks merged so far, tracked by union-find root.
struct Units {
    uf: Uf,
    lines: Vec<usize>,
    count: Vec<usize>,
}

impl Units {
    fn fits(&mut self, a: usize, b: usize) -> bool {
        let (ra, rb) = (self.uf.find(a), self.uf.find(b));
        ra != rb && self.lines[ra] + self.lines[rb] <= MAX_LINES && self.count[ra] + self.count[rb] <= MAX_BLOCKS
    }

    fn join(&mut self, a: usize, b: usize) {
        let (ra, rb) = (self.uf.find(a), self.uf.find(b));
        if ra == rb {
            return;
        }
        self.uf.union(ra, rb);
        let (l, c) = (self.lines[rb], self.count[rb]);
        self.lines[ra] += l;
        self.count[ra] += c;
    }
}

fn tests_only(b: &Block) -> bool {
    b.files.iter().all(|f| is_test_path(f))
}

/// Builds ordered layers from the review blocks (skim blocks are left out):
/// 1. related blocks become units: parts of one split file, tests with the code they test,
///    then the strongest links while the unit fits [`MAX_LINES`] and [`MAX_BLOCKS`];
/// 2. units are ordered so code comes after the code it uses (cycles broken by tier, then id);
/// 3. oversized units are cut into consecutive layers, and small neighbours are combined.
pub(crate) fn build_layers(blocks: &[Block], links: &[BlockLink]) -> Vec<Layer> {
    let review: Vec<&Block> = blocks.iter().filter(|b| b.skim.is_none()).collect();
    if review.is_empty() {
        return Vec::new();
    }
    let n = review.len();
    let idx: HashMap<usize, usize> = review.iter().enumerate().map(|(i, b)| (b.id, i)).collect();
    let edges: Vec<(usize, usize, usize)> =
        links.iter().filter_map(|l| Some((*idx.get(&l.from)?, *idx.get(&l.to)?, l.weight))).collect();
    let mut units = Units { uf: Uf::new(n), lines: review.iter().map(|b| b.lines).collect(), count: vec![1; n] };

    // Parts of one split file stay one unit (cut into consecutive layers later).
    let mut parts: BTreeMap<&str, usize> = BTreeMap::new();
    for (i, b) in review.iter().enumerate().filter(|(_, b)| b.slice.is_some()) {
        let first = *parts.entry(b.files[0].as_str()).or_insert(i);
        units.join(first, i);
    }

    // Tests join the code they exercise: the block they use most, else one with a matching file name.
    for (t, b) in review.iter().enumerate().filter(|(_, b)| tests_only(b)) {
        let used = edges
            .iter()
            .filter(|&&(from, to, _)| from == t && !tests_only(review[to]))
            .max_by_key(|&&(_, to, w)| (w, std::cmp::Reverse(to)))
            .map(|&(_, to, _)| to);
        let stems: BTreeSet<String> = b.files.iter().map(|f| stem(f)).collect();
        let named = || {
            review
                .iter()
                .position(|c| !tests_only(c) && c.files.iter().any(|f| !is_test_path(f) && stems.contains(&stem(f))))
        };
        if let Some(code) = used.or_else(named) {
            units.join(code, t);
        }
    }

    // Strongest links first, while the unit still fits in one layer.
    let mut by_weight = edges.clone();
    by_weight.sort_by_key(|&(from, to, w)| (std::cmp::Reverse(w), from, to));
    for (from, to, _) in by_weight {
        if units.fits(from, to) {
            units.join(from, to);
        }
    }

    let mut members: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    for i in 0..n {
        members.entry(units.uf.find(i)).or_default().push(i);
    }
    // Inside a unit: code before its tests, foundations first, then reading order.
    for m in members.values_mut() {
        m.sort_by_key(|&i| (tests_only(review[i]), review[i].layer, review[i].id));
    }
    let tier = |m: &[usize]| m.iter().filter(|&&i| !tests_only(review[i])).map(|&i| review[i].layer).min().unwrap_or(5);
    let first_id = |m: &[usize]| m.iter().map(|&i| review[i].id).min().unwrap_or(0);

    // Order units: a unit comes after every unit it uses. With a cycle, the lowest tier goes first.
    let roots: Vec<usize> = members.keys().copied().collect();
    let mut after: BTreeMap<usize, BTreeSet<usize>> = BTreeMap::new();
    for &(from, to, _) in &edges {
        let (user, used) = (units.uf.find(from), units.uf.find(to));
        if user != used {
            after.entry(user).or_default().insert(used);
        }
    }
    let mut placed: BTreeSet<usize> = BTreeSet::new();
    let mut order: Vec<usize> = Vec::with_capacity(roots.len());
    while order.len() < roots.len() {
        let key = |r: &usize| (tier(&members[r]), first_id(&members[r]));
        let open = roots.iter().filter(|r| !placed.contains(r));
        let ready = open.clone().filter(|r| after.get(r).is_none_or(|deps| deps.iter().all(|d| placed.contains(d))));
        let Some(&next) = ready.min_by_key(|r| key(r)).or_else(|| open.min_by_key(|r| key(r))) else { break };
        placed.insert(next);
        order.push(next);
    }

    // Cut oversized units into consecutive layers, never leaving a tiny piece on its own.
    let mut groups: Vec<Vec<usize>> = Vec::new();
    for r in order {
        let mut cur: Vec<usize> = Vec::new();
        let mut cur_lines = 0;
        for &i in &members[&r] {
            if cur_lines >= TINY && (cur_lines + review[i].lines > MAX_LINES || cur.len() == MAX_BLOCKS) {
                groups.push(std::mem::take(&mut cur));
                cur_lines = 0;
            }
            cur_lines += review[i].lines;
            cur.push(i);
        }
        groups.push(cur);
    }

    // Combine neighbours that fit together and are linked, share a directory, or are both small.
    // Merging neighbours keeps the order valid.
    let lines_of = |g: &[usize]| g.iter().map(|&i| review[i].lines).sum::<usize>();
    let area = |g: &[usize]| {
        g.iter().max_by_key(|&&i| (review[i].lines, std::cmp::Reverse(i))).map(|&i| review[i].dir.as_str())
    };
    let linked = |a: &[usize], b: &[usize]| {
        edges.iter().any(|&(f, t, _)| (a.contains(&f) && b.contains(&t)) || (b.contains(&f) && a.contains(&t)))
    };
    let mut merged: Vec<Vec<usize>> = Vec::new();
    for g in groups {
        if let Some(prev) = merged.last_mut() {
            let (pl, gl) = (lines_of(prev), lines_of(&g));
            let fits = pl + gl <= MAX_LINES && prev.len() + g.len() <= MAX_BLOCKS;
            if fits && (linked(prev, &g) || area(prev) == area(&g) || (pl < SMALL && gl < SMALL)) {
                prev.extend(g);
                continue;
            }
        }
        merged.push(g);
    }

    let layer_of: HashMap<usize, usize> =
        merged.iter().enumerate().flat_map(|(l, g)| g.iter().map(move |&i| (i, l + 1))).collect();
    merged
        .iter()
        .enumerate()
        .map(|(l, g)| {
            let uses: BTreeSet<usize> = edges
                .iter()
                .filter(|&&(from, _, _)| layer_of[&from] == l + 1)
                .map(|&(_, to, _)| layer_of[&to])
                .filter(|&other| other != l + 1)
                .collect();
            let mut keys: Vec<&str> = g.iter().map(|&i| review[i].key.as_str()).collect();
            keys.sort_unstable();
            let blocks: Vec<&Block> = g.iter().map(|&i| review[i]).collect();
            Layer {
                id: l + 1,
                key: stable_hash(keys.into_iter()),
                title: title(&blocks),
                role: role(&blocks).to_string(),
                dir: common_dir(&blocks),
                lines: lines_of(g),
                blocks: blocks.iter().map(|b| b.id).collect(),
                uses: uses.into_iter().collect(),
            }
        })
        .collect()
}

fn role(blocks: &[&Block]) -> &'static str {
    match blocks.iter().filter(|b| !tests_only(b)).map(|b| b.layer).min() {
        None => "Tests",
        Some(0) => "Data and services",
        Some(1) => "Hooks and state",
        Some(2) => "Components",
        Some(3) => "Screens",
        Some(_) => "Code",
    }
}

/// File name without extension; generic names keep their folder (`checkout/index`).
fn display_name(path: &str) -> String {
    let s = stem(path);
    if matches!(s.as_str(), "index" | "mod" | "lib" | "main" | "__init__" | "types" | "utils") {
        let parent = path.rsplit('/').nth(1).unwrap_or_default();
        if !parent.is_empty() {
            return format!("{parent}/{s}");
        }
    }
    s
}

/// The main files, heaviest block first: `voucherApi, useVoucher and 2 more`.
fn title(blocks: &[&Block]) -> String {
    let all_tests = blocks.iter().all(|b| tests_only(b));
    let mut sorted: Vec<&&Block> = blocks.iter().collect();
    sorted.sort_by_key(|b| (std::cmp::Reverse(b.lines), b.id));
    let mut names: Vec<String> = Vec::new();
    for b in sorted {
        let files: Vec<&String> = b.files.iter().filter(|f| all_tests || !is_test_path(f)).collect();
        // The file with the most changed entities leads, as in the block's own title.
        let main =
            files.iter().max_by_key(|f| (b.changes.iter().filter(|c| &&c.file == *f).count(), std::cmp::Reverse(**f)));
        for f in main.into_iter().chain(files.iter()) {
            let name = display_name(f);
            if !names.contains(&name) {
                names.push(name);
            }
        }
    }
    let parts: Vec<_> = blocks.iter().filter_map(|b| b.slice.as_ref()).collect();
    if names.len() == 1 && parts.len() == blocks.len() && !parts.is_empty() {
        let (lo, hi) =
            (parts.iter().map(|s| s.part).min().unwrap_or(1), parts.iter().map(|s| s.part).max().unwrap_or(1));
        let range = if lo == hi { format!("part {lo}") } else { format!("parts {lo}–{hi}") };
        return format!("{}, {range} of {}", names[0], parts[0].of);
    }
    let head = match names.len() {
        0 => "Changes".to_string(),
        1 => names[0].clone(),
        2 => format!("{} and {}", names[0], names[1]),
        k => format!("{}, {} and {} more", names[0], names[1], k - 2),
    };
    if all_tests { format!("Tests: {head}") } else { head }
}

fn common_dir(blocks: &[&Block]) -> String {
    let mut common: Option<Vec<&str>> = None;
    for b in blocks {
        let segs: Vec<&str> = b.dir.split('/').filter(|s| !s.is_empty()).collect();
        common = Some(match common {
            None => segs,
            Some(c) => c.iter().zip(&segs).take_while(|(a, b)| a == b).map(|(a, _)| *a).collect(),
        });
    }
    common.unwrap_or_default().join("/")
}

#[cfg(test)]
mod tests {
    use super::{MAX_BLOCKS, MAX_LINES, build_layers};
    use crate::model::{Block, BlockLink, Risk};

    fn block(id: usize, file: &str, lines: usize, layer: u8) -> Block {
        Block {
            id,
            key: format!("k{id}"),
            content_hash: String::new(),
            lines,
            files: vec![file.to_string()],
            entities: vec![],
            residue_files: vec![],
            mechanical_entities: 0,
            has_tests: file.contains(".test."),
            kind: "code".into(),
            skim: None,
            layer,
            dir: file.rsplit_once('/').map(|x| x.0.to_string()).unwrap_or_default(),
            changes: vec![],
            used_by: 0,
            used_by_sample: vec![],
            checks: vec![],
            est_risk: Risk::Low,
            slice: None,
        }
    }

    fn link(from: usize, to: usize) -> BlockLink {
        BlockLink { from, to, weight: 1 }
    }

    fn layer_with(layers: &[crate::model::Layer], id: usize) -> usize {
        layers.iter().position(|l| l.blocks.contains(&id)).expect("block placed")
    }

    #[test]
    fn puts_used_code_first_and_tests_with_their_code() {
        let blocks = vec![
            block(1, "src/screens/Checkout.tsx", 300, 3),
            block(2, "src/api/voucher.ts", 300, 0),
            block(3, "src/api/__tests__/voucher.test.ts", 80, 4),
        ];
        let layers = build_layers(&blocks, &[link(1, 2), link(3, 2)]);
        assert!(layer_with(&layers, 2) < layer_with(&layers, 1), "the API comes before the screen using it");
        assert_eq!(layer_with(&layers, 2), layer_with(&layers, 3), "tests sit with the code they test");
        assert_eq!(layers[0].role, "Data and services");
        assert_eq!(layers[0].title, "voucher");
    }

    #[test]
    fn caps_layer_size() {
        let blocks: Vec<Block> = (1..=20).map(|i| block(i, &format!("src/lib/f{i}.ts"), 90, 0)).collect();
        let links: Vec<BlockLink> = (1..20).map(|i| link(i + 1, i)).collect();
        let layers = build_layers(&blocks, &links);
        assert!(layers.iter().all(|l| l.lines <= MAX_LINES && l.blocks.len() <= MAX_BLOCKS));
        assert_eq!(layers.iter().map(|l| l.blocks.len()).sum::<usize>(), 20);
        for l in &layers[1..] {
            assert!(l.uses.iter().all(|&u| u < l.id), "layers only build on earlier layers");
        }
    }

    #[test]
    fn oversized_block_gets_its_own_layer_and_small_neighbours_combine() {
        let blocks = vec![block(1, "a/big.ts", 900, 0), block(2, "b/x.ts", 20, 4), block(3, "c/y.ts", 30, 4)];
        let layers = build_layers(&blocks, &[]);
        assert_eq!(layers.len(), 2);
        assert_eq!(layers[0].blocks, vec![1]);
        assert_eq!(layers[1].blocks, vec![2, 3]);
    }

    #[test]
    fn tiny_split_part_rides_with_the_next() {
        let mut blocks =
            vec![block(1, "a/huge.ts", 20, 0), block(2, "a/huge.ts", 390, 0), block(3, "a/huge.ts", 390, 0)];
        for (i, b) in blocks.iter_mut().enumerate() {
            b.slice = Some(crate::model::Slice { part: i + 1, of: 3, new_lines: vec![], old_lines: vec![] });
        }
        let layers = build_layers(&blocks, &[]);
        assert_eq!(layers.iter().map(|l| l.blocks.clone()).collect::<Vec<_>>(), vec![vec![1, 2], vec![3]]);
        assert_eq!(layers[0].title, "huge, parts 1–2 of 3");
    }

    #[test]
    fn breaks_cycles_deterministically() {
        let blocks = vec![block(1, "a/one.ts", 300, 2), block(2, "b/two.ts", 300, 0)];
        let layers = build_layers(&blocks, &[link(1, 2), link(2, 1)]);
        assert_eq!(layers.iter().map(|l| l.blocks.clone()).collect::<Vec<_>>(), vec![vec![2], vec![1]]);
    }
}
