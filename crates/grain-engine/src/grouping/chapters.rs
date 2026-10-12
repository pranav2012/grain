use std::collections::BTreeMap;

use crate::model::{Block, Chapter};

/// Top-down split of review blocks into feature chapters along the directory tree.
/// Target count grows with PR size (about sqrt(lines / 150), between 1 and 12).
pub(crate) fn build_chapters(blocks: &[Block]) -> Vec<Chapter> {
    let review: Vec<&Block> = blocks.iter().filter(|b| b.skim.is_none()).collect();
    let total: usize = review.iter().map(|b| b.lines).sum();
    #[allow(clippy::cast_sign_loss, reason = "square root of a non-negative count")]
    let target = ((total as f64 / 150.0).sqrt().round() as usize).clamp(1, 12);
    let segs = |b: &Block| -> Vec<String> { b.dir.split('/').filter(|s| !s.is_empty()).map(str::to_string).collect() };
    let common_depth = |members: &[usize]| -> usize {
        let all: Vec<Vec<String>> = members.iter().map(|&i| segs(review[i])).collect();
        let first = all.first().cloned().unwrap_or_default();
        (0..first.len()).take_while(|&d| all.iter().all(|s| s.get(d) == first.get(d))).count()
    };
    let lines_of = |m: &[usize]| -> usize { m.iter().map(|&i| review[i].lines).sum() };

    let mut chapters: Vec<(Vec<usize>, bool)> = vec![((0..review.len()).collect(), true)];
    while chapters.len() < target {
        let Some(ci) = chapters
            .iter()
            .enumerate()
            .filter(|(_, c)| c.1 && c.0.len() > 1)
            .max_by_key(|(_, c)| lines_of(&c.0))
            .map(|(i, _)| i)
        else {
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
            rest.extend(parts.pop().unwrap_or_default());
        }
        if !rest.is_empty() {
            let full = parts.len() == room;
            match parts.last_mut() {
                Some(last) if full => last.extend(rest),
                _ => parts.push(rest),
            }
        }
        if parts.len() <= 1 {
            chapters.push((parts.into_iter().next().unwrap_or(members), false));
        } else {
            chapters.extend(parts.into_iter().map(|m| (m, true)));
        }
    }

    // Fold chapters under 3% of the PR into the chapter sharing the longest directory prefix.
    loop {
        if chapters.len() <= 1 {
            break;
        }
        let Some(ti) = (0..chapters.len())
            .filter(|&i| lines_of(&chapters[i].0) * 33 < total)
            .min_by_key(|&i| lines_of(&chapters[i].0))
        else {
            break;
        };
        let (tiny, _) = chapters.swap_remove(ti);
        let my = segs(review[tiny[0]]);
        let best = (0..chapters.len()).max_by_key(|&j| {
            let other = segs(review[chapters[j].0[0]]);
            (other.iter().zip(&my).take_while(|(a, b)| a == b).count(), std::cmp::Reverse(lines_of(&chapters[j].0)))
        });
        let Some(best) = best else { break };
        chapters[best].0.extend(tiny);
    }
    let mut out: Vec<Chapter> = chapters
        .into_iter()
        .map(|(members, _)| {
            let depth = common_depth(&members);
            let first = segs(review[members[0]]);
            let dir = first[..depth.min(first.len())].join("/");
            // Name after the heaviest sub-area so sibling chapters don't share a title.
            let mut area: BTreeMap<String, usize> = BTreeMap::new();
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
            let mut ids: Vec<&Block> = members.iter().map(|&i| review[i]).collect();
            ids.sort_by(|a, b| a.layer.cmp(&b.layer).then(b.lines.cmp(&a.lines)).then(a.key.cmp(&b.key)));
            Chapter {
                id: 0,
                title,
                dir,
                lines: lines_of(&members),
                layer: ids.iter().map(|b| b.layer).min().unwrap_or(4),
                blocks: ids.iter().map(|b| b.id).collect(),
            }
        })
        .collect();
    out.sort_by(|a, b| {
        a.layer.cmp(&b.layer).then(b.lines.cmp(&a.lines)).then(a.dir.cmp(&b.dir)).then(a.blocks.cmp(&b.blocks))
    });
    for (i, c) in out.iter_mut().enumerate() {
        c.id = i + 1;
    }
    out
}
