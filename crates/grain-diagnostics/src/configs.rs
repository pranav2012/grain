use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// Files grouped by the nearest folder (in `clone`) holding one of `names`: `(folder, config, files)`,
/// with folder and files relative to the repository root. Files with no config above them are skipped.
pub(crate) fn groups(clone: &Path, files: &[String], names: &[&str]) -> Vec<(String, PathBuf, Vec<String>)> {
    let mut by_dir: BTreeMap<String, (PathBuf, Vec<String>)> = BTreeMap::new();
    for f in files {
        let mut dir = Path::new(f).parent();
        while let Some(d) = dir {
            if let Some(config) = names.iter().map(|n| clone.join(d).join(n)).find(|p| p.is_file()) {
                by_dir
                    .entry(d.to_string_lossy().into_owned())
                    .or_insert_with(|| (config, Vec::new()))
                    .1
                    .push(f.clone());
                break;
            }
            dir = d.parent();
        }
    }
    by_dir.into_iter().map(|(d, (c, fs))| (d, c, fs)).collect()
}

/// `file` relative to `dir` (both relative to the repository root).
pub(crate) fn strip(dir: &str, file: &str) -> String {
    if dir.is_empty() {
        file.to_string()
    } else {
        file.strip_prefix(dir).map_or(file, |f| f.trim_start_matches('/')).to_string()
    }
}

/// `file` (relative to `dir`) relative to the repository root again.
pub(crate) fn join(dir: &str, file: &str) -> String {
    if dir.is_empty() { file.to_string() } else { format!("{dir}/{file}") }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nearest_config_wins() -> anyhow::Result<()> {
        let root = tempfile::tempdir()?;
        std::fs::create_dir_all(root.path().join("ui/src"))?;
        std::fs::create_dir_all(root.path().join("api"))?;
        std::fs::write(root.path().join("ui/.oxlintrc.json"), "{}")?;
        let files = ["ui/src/a.ts".to_string(), "api/b.ts".to_string()];
        let g = groups(root.path(), &files, &[".oxlintrc.json"]);
        assert_eq!(g.len(), 1);
        assert_eq!((g[0].0.as_str(), g[0].2.clone()), ("ui", vec!["ui/src/a.ts".to_string()]));
        assert_eq!(strip("ui", "ui/src/a.ts"), "src/a.ts");
        assert_eq!(join("ui", "src/a.ts"), "ui/src/a.ts");
        Ok(())
    }
}
