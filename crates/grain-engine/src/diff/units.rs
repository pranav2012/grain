use std::collections::{BTreeMap, HashMap};

use sem_core::model::change::{ChangeType, SemanticChange};

use super::hunks::FileHunks;

/// The smallest reviewable piece: one changed entity, or a file's changed lines outside any entity.
pub(crate) enum Unit {
    Entity(usize),
    Residue(String),
}

pub(crate) struct Units {
    pub(crate) items: Vec<Unit>,
    /// Changed lines attributed to each unit.
    pub(crate) lines: Vec<usize>,
    pub(crate) total_lines: usize,
    pub(crate) covered_lines: usize,
    /// Residue unit → its changed (new-side, old-side) line numbers.
    residue_lines: HashMap<usize, (Vec<usize>, Vec<usize>)>,
}

/// Inclusive `(first, last)` line ranges.
pub(crate) type Ranges = Vec<(usize, usize)>;

/// Sorts and merges overlapping or touching ranges.
pub(crate) fn merge_ranges(mut r: Ranges) -> Ranges {
    r.sort_unstable();
    let mut out: Ranges = Vec::with_capacity(r.len());
    for (s, e) in r {
        match out.last_mut() {
            Some(last) if s <= last.1 + 1 => last.1 = last.1.max(e),
            _ => out.push((s, e)),
        }
    }
    out
}

impl Units {
    pub(crate) fn file<'a>(&'a self, changes: &'a [SemanticChange], u: usize) -> &'a str {
        match &self.items[u] {
            Unit::Entity(i) => &changes[*i].file_path,
            Unit::Residue(p) => p,
        }
    }

    pub(crate) fn start_line(&self, changes: &[SemanticChange], u: usize) -> usize {
        match &self.items[u] {
            Unit::Entity(i) => changes[*i].start_line,
            Unit::Residue(_) => {
                self.residue_lines.get(&u).and_then(|(new, old)| new.first().or(old.first()).copied()).unwrap_or(0)
            }
        }
    }

    /// Lines a unit covers on the (new, old) side of its file.
    pub(crate) fn ranges(&self, changes: &[SemanticChange], u: usize) -> (Ranges, Ranges) {
        match &self.items[u] {
            Unit::Entity(i) => {
                let c = &changes[*i];
                match c.change_type {
                    ChangeType::Deleted => (vec![], vec![(c.start_line, c.end_line)]),
                    _ => {
                        let old = c.old_start_line.zip(c.old_end_line).into_iter().collect();
                        (vec![(c.start_line, c.end_line)], old)
                    }
                }
            }
            Unit::Residue(_) => {
                let (new, old) = self.residue_lines.get(&u).cloned().unwrap_or_default();
                let to_ranges = |v: Vec<usize>| merge_ranges(v.into_iter().map(|l| (l, l)).collect());
                (to_ranges(new), to_ranges(old))
            }
        }
    }
}

/// Attributes every changed line to the innermost changed entity containing it; lines outside
/// any entity (imports, top-level statements) go to one residue unit per file.
pub(crate) fn build_units(changes: &[SemanticChange], hunks: &BTreeMap<String, FileHunks>) -> Units {
    let mut units: Vec<Unit> = (0..changes.len()).map(Unit::Entity).collect();
    let mut unit_lines: Vec<usize> = vec![0; changes.len()];
    let mut residue_idx: HashMap<String, usize> = HashMap::new();
    let mut by_file: HashMap<&str, Vec<usize>> = HashMap::new();
    for (i, c) in changes.iter().enumerate() {
        by_file.entry(c.file_path.as_str()).or_default().push(i);
        if let Some(op) = &c.old_file_path
            && op != &c.file_path
        {
            by_file.entry(op.as_str()).or_default().push(i);
        }
    }
    let innermost = |file: &str, line: usize, old_side: bool| -> Option<usize> {
        by_file
            .get(file)?
            .iter()
            .copied()
            .filter_map(|i| {
                let c = &changes[i];
                let deleted = matches!(c.change_type, ChangeType::Deleted);
                let (s, e) = if old_side {
                    if deleted { (c.start_line, c.end_line) } else { (c.old_start_line?, c.old_end_line?) }
                } else {
                    if deleted {
                        return None;
                    }
                    (c.start_line, c.end_line)
                };
                (s <= line && line <= e).then(|| (e - s, i))
            })
            .min()
            .map(|(_, i)| i)
    };
    let (mut total_lines, mut covered_lines) = (0usize, 0usize);
    let mut residue_lines: HashMap<usize, (Vec<usize>, Vec<usize>)> = HashMap::new();
    for (path, fh) in hunks {
        let old_path = fh.old_path.as_deref().unwrap_or(path);
        let sides =
            fh.added.iter().map(|&l| (path.as_str(), l, false)).chain(fh.deleted.iter().map(|&l| (old_path, l, true)));
        for (file, line, old_side) in sides {
            total_lines += 1;
            if let Some(i) = innermost(file, line, old_side) {
                covered_lines += 1;
                unit_lines[i] += 1;
            } else {
                let idx = *residue_idx.entry(path.clone()).or_insert_with(|| {
                    units.push(Unit::Residue(path.clone()));
                    unit_lines.push(0);
                    units.len() - 1
                });
                unit_lines[idx] += 1;
                let (new, old) = residue_lines.entry(idx).or_default();
                if old_side { old.push(line) } else { new.push(line) }
            }
        }
    }
    Units { items: units, lines: unit_lines, total_lines, covered_lines, residue_lines }
}

#[cfg(test)]
mod tests {
    use super::merge_ranges;

    #[test]
    fn merges_overlapping_and_touching_ranges() {
        assert_eq!(merge_ranges(vec![(10, 12), (1, 3), (4, 5), (11, 20), (30, 30)]), [(1, 5), (10, 20), (30, 30)]);
        assert!(merge_ranges(vec![]).is_empty());
    }
}
