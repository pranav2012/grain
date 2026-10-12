use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::SystemTime;

/// One stored `diff.patch` split into per-file sections, keyed by both old and new path.
pub(crate) struct PatchIndex {
    text: String,
    files: HashMap<String, (usize, usize)>,
}

impl PatchIndex {
    fn build(text: String) -> PatchIndex {
        let mut starts: Vec<usize> = text
            .match_indices("diff --git ")
            .map(|(i, _)| i)
            .filter(|&i| i == 0 || text.as_bytes()[i - 1] == b'\n')
            .collect();
        starts.push(text.len());
        let mut files = HashMap::new();
        for w in starts.windows(2) {
            let (a, b) = (w[0], w[1]);
            for path in section_paths(&text[a..b]) {
                files.insert(path, (a, b));
            }
        }
        PatchIndex { text, files }
    }

    /// Concatenated sections for `paths`, each file once, in the given order.
    pub(crate) fn sections(&self, paths: &[String]) -> String {
        let mut seen = Vec::new();
        let mut out = String::new();
        for p in paths {
            if let Some(&(a, b)) = self.files.get(p)
                && !seen.contains(&a)
            {
                seen.push(a);
                out.push_str(&self.text[a..b]);
            }
        }
        out
    }
}

/// Old and new paths named by one `diff --git` section (unquoted, as written with `core.quotepath=off`).
fn section_paths(section: &str) -> Vec<String> {
    let mut out = Vec::new();
    for line in section.lines().skip(1) {
        if line.starts_with("@@") {
            break;
        }
        let path = line
            .strip_prefix("--- a/")
            .or_else(|| line.strip_prefix("+++ b/"))
            .or_else(|| line.strip_prefix("rename from "))
            .or_else(|| line.strip_prefix("rename to "));
        if let Some(p) = path {
            out.push(p.trim_matches('"').to_string());
        }
    }
    if out.is_empty() {
        // Binary or mode-only changes have no ---/+++ lines; fall back to the header.
        let header = section.lines().next().unwrap_or_default();
        if let Some((_, b)) = header.split_once(" b/") {
            out.push(b.trim_matches('"').to_string());
        }
    }
    out
}

/// Per-review cache, invalidated when `diff.patch` changes on disk.
#[derive(Default)]
pub(crate) struct PatchCache(Mutex<HashMap<std::path::PathBuf, (SystemTime, Arc<PatchIndex>)>>);

impl PatchCache {
    pub(crate) fn get(&self, patch: &Path) -> std::io::Result<Arc<PatchIndex>> {
        let modified = std::fs::metadata(patch)?.modified()?;
        let mut cache = self.0.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some((at, index)) = cache.get(patch)
            && *at == modified
        {
            return Ok(index.clone());
        }
        let index = Arc::new(PatchIndex::build(std::fs::read_to_string(patch)?));
        cache.insert(patch.to_path_buf(), (modified, index.clone()));
        Ok(index)
    }
}

#[cfg(test)]
mod tests {
    use super::PatchIndex;

    const PATCH: &str = "diff --git a/src/a.ts b/src/a.ts\nindex 1..2 100644\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-a\n+b\n\
diff --git a/old.ts b/new.ts\nsimilarity index 90%\nrename from old.ts\nrename to new.ts\n\
diff --git a/img.png b/img.png\nBinary files a/img.png and b/img.png differ\n";

    #[test]
    fn splits_sections_by_path() {
        let idx = PatchIndex::build(PATCH.to_string());
        assert!(idx.sections(&["src/a.ts".into()]).contains("+b"));
        assert!(idx.sections(&["new.ts".into()]).contains("rename to new.ts"));
        assert_eq!(idx.sections(&["old.ts".into()]), idx.sections(&["new.ts".into()]));
        assert!(idx.sections(&["img.png".into()]).starts_with("diff --git a/img.png"));
        assert_eq!(idx.sections(&["src/a.ts".into(), "src/a.ts".into()]).matches("diff --git").count(), 1);
        assert_eq!(idx.sections(&["missing.ts".into()]), "");
    }
}
