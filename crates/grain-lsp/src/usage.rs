//! TypeScript/JavaScript outside usage from TypeScript 7's language server.

use std::fmt::Write as _;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};

use anyhow::Result;
use grain_engine::UsageProvider;
use serde_json::json;

use crate::client::Client;

const EXTENSIONS: [&str; 8] = ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"];
/// Whole-review budget: past this, remaining entities fall back to the entity graph.
const BUDGET: Duration = Duration::from_secs(90);
const PER_REQUEST: Duration = Duration::from_secs(15);

struct State {
    client: Client,
    started: Instant,
    /// Set after a timeout or crash; later queries fall back immediately.
    broken: bool,
}

/// Answers "which files reference this declaration" for TS/JS files in one checkout.
pub struct TsUsage {
    root: PathBuf,
    /// The checkout's real path, as the server reports it in file URIs (e.g. /private/tmp on macOS).
    real_root: PathBuf,
    state: Mutex<State>,
}

fn uri(path: &Path) -> String {
    let mut out = String::from("file://");
    for b in path.to_string_lossy().bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'/' | b'-' | b'_' | b'.' | b'~' => out.push(char::from(b)),
            _ => {
                let _ = write!(out, "%{b:02X}");
            }
        }
    }
    out
}

fn path_of(uri: &str) -> Option<PathBuf> {
    let raw = uri.strip_prefix("file://")?.as_bytes();
    let mut bytes = Vec::with_capacity(raw.len());
    let mut i = 0;
    while i < raw.len() {
        if raw[i] == b'%' && i + 2 < raw.len() {
            let hex = std::str::from_utf8(&raw[i + 1..i + 3]).ok()?;
            bytes.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            bytes.push(raw[i]);
            i += 1;
        }
    }
    Some(PathBuf::from(String::from_utf8(bytes).ok()?))
}

impl TsUsage {
    /// Starts the language server for the checkout at `root`.
    pub fn start(tsc: &Path, root: &Path) -> Result<TsUsage> {
        let real_root = root.canonicalize()?;
        let mut client = Client::start(tsc, &["--lsp", "--stdio"], &real_root)?;
        let root_uri = uri(&real_root);
        client.request(
            "initialize",
            &json!({
                "processId": std::process::id(),
                "rootUri": root_uri,
                "capabilities": {},
                "workspaceFolders": [{ "uri": root_uri, "name": "review" }],
            }),
            Duration::from_secs(30),
        )?;
        client.notify("initialized", &json!({}))?;
        Ok(TsUsage {
            root: root.to_path_buf(),
            real_root,
            state: Mutex::new(State { client, started: Instant::now(), broken: false }),
        })
    }

    fn relative(&self, path: &Path) -> Option<String> {
        let rel = path.strip_prefix(&self.real_root).or_else(|_| path.strip_prefix(&self.root)).ok()?;
        Some(rel.to_string_lossy().replace('\\', "/"))
    }
}

impl UsageProvider for TsUsage {
    fn referencing_files(&self, file: &str, line: u32, character: u32) -> Option<Vec<String>> {
        let ext = Path::new(file).extension()?.to_str()?;
        if !EXTENSIONS.contains(&ext) {
            return None;
        }
        let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        if state.broken || state.started.elapsed() > BUDGET {
            return None;
        }
        let path = self.real_root.join(file);
        let text = std::fs::read_to_string(&path).ok()?;
        let doc = uri(&path);
        let language = if ext.starts_with('t') || ext.ends_with('x') { "typescriptreact" } else { "javascript" };
        state
            .client
            .notify(
                "textDocument/didOpen",
                &json!({ "textDocument": { "uri": doc, "languageId": language, "version": 1, "text": text } }),
            )
            .ok()?;
        let result = state.client.request(
            "textDocument/references",
            &json!({
                "textDocument": { "uri": doc },
                "position": { "line": line, "character": character },
                "context": { "includeDeclaration": false },
            }),
            PER_REQUEST,
        );
        let _ = state.client.notify("textDocument/didClose", &json!({ "textDocument": { "uri": doc } }));
        let locations = match result {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!(error = %e, "TypeScript usage lookup failed; using the entity graph");
                state.broken = true;
                return None;
            }
        };
        let mut files: Vec<String> = locations
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|l| l["uri"].as_str().and_then(path_of))
            .filter_map(|p| self.relative(&p))
            .filter(|f| f != file && !f.split('/').any(|seg| seg == "node_modules"))
            .collect();
        files.sort();
        files.dedup();
        Some(files)
    }
}

#[cfg(test)]
mod tests {
    use super::{path_of, uri};
    use std::path::Path;

    #[test]
    fn uris_round_trip() {
        let p = Path::new("/tmp/my repo/src/a+b.ts");
        assert_eq!(uri(p), "file:///tmp/my%20repo/src/a%2Bb.ts");
        assert_eq!(path_of(&uri(p)).as_deref(), Some(p));
    }
}
