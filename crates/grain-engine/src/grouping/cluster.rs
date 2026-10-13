use std::collections::{BTreeMap, HashMap, HashSet};

use sem_core::model::change::SemanticChange;
use sem_core::parser::graph::EntityGraph;

use super::union_find::Uf;
use crate::classify::{is_test_path, kind_of, stem};
use crate::diff::hunks::FileHunks;
use crate::diff::units::Unit;

/// Largest block in changed lines, so any block fits in one review layer (`layers::MAX_LINES`).
pub(crate) const CAP: usize = super::layers::MAX_LINES;

pub(crate) const SMALL: usize = 60;

/// v2: file-level nodes, repeated-edit patterns, size-capped agglomerative merge, small-block absorption.
pub(crate) fn group_v2(
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
    let sigs: HashMap<usize, &HashSet<String>> =
        hunks.iter().filter(|(_, h)| !h.shape.is_empty()).map(|(p, h)| (fidx[p.as_str()], &h.shape)).collect();
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
    let id_to_file: HashMap<&str, usize> =
        changes.iter().map(|c| (c.entity_id.as_str(), fidx[c.file_path.as_str()])).collect();
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
    let code_by_stem: HashMap<String, usize> = files
        .iter()
        .enumerate()
        .filter(|(_, p)| !is_test_path(p) && kind_of(p) == "code")
        .map(|(i, p)| (stem(p), i))
        .collect();
    for (fi, p) in files.iter().enumerate().filter(|(_, p)| is_test_path(p)) {
        if let Some(&c) = code_by_stem.get(&stem(p)) {
            add(fi, c, 5.0, &mut w);
        }
    }
    let mut edges: Vec<((usize, usize), f64)> = w.into_iter().collect();
    edges.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));

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
            cands.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
            if cands.iter().any(|&(c, _)| merge(&mut uf, r, c, CAP, &mut csize)) {
                continue;
            }
            let dir = |p: &str| p.rsplit_once('/').map(|x| x.0.to_string()).unwrap_or_default();
            let my_dir = dir(&files[f]);
            let roots: Vec<usize> = (0..n).map(|g| uf.find(g)).collect();
            let mut sib: Vec<usize> =
                (0..n).filter(|&g| roots[g] != r && dir(&files[g]) == my_dir).map(|g| roots[g]).collect();
            sib.sort_by_key(|&g| (csize[g], g));
            sib.dedup();
            if sib.into_iter().any(|g| merge(&mut uf, r, g, CAP, &mut csize)) {
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
            near.sort_by(|a, b| b.0.cmp(&a.0).then(a.2.cmp(&b.2)).then(a.1.cmp(&b.1)));
            let _ = near.into_iter().any(|(_, g, _)| merge(&mut uf, r, g, CAP, &mut csize));
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
