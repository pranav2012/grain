use std::collections::BTreeMap;

/// Stable content key for a block (files + changed entities), so summaries survive regrouping and renumbering.
pub(crate) fn block_key(files: &[String], entities: &[String]) -> String {
    let mut parts: Vec<&String> = files.iter().chain(entities).collect();
    parts.sort();
    stable_hash(parts.iter().map(|s| s.as_str()))
}

/// Short SHA-256 of `parts` (each length-prefixed), stable across Grain and Rust versions.
pub(crate) fn stable_hash<'a>(parts: impl Iterator<Item = &'a str>) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    for p in parts {
        h.update((p.len() as u64).to_le_bytes());
        h.update(p.as_bytes());
    }
    h.finalize().iter().take(8).map(|b| format!("{b:02x}")).collect()
}

/// Directory that best describes a block: the files' common directory, or the heaviest file's directory.
pub(crate) fn block_dir(file_lines: &BTreeMap<String, usize>) -> String {
    let dirs: Vec<Vec<&str>> =
        file_lines.keys().map(|f| f.split('/').collect::<Vec<_>>()).map(|v| v[..v.len() - 1].to_vec()).collect();
    let mut common: Vec<&str> = dirs.first().cloned().unwrap_or_default();
    for d in &dirs[1.min(dirs.len())..] {
        let n = common.iter().zip(d).take_while(|(a, b)| a == b).count();
        common.truncate(n);
    }
    if common.len() >= 2 {
        return common.join("/");
    }
    let heaviest = file_lines.iter().max_by_key(|&(_, l)| *l).map(|(f, _)| f.as_str()).unwrap_or("");
    heaviest.rsplit_once('/').map(|x| x.0.to_string()).unwrap_or_default()
}
