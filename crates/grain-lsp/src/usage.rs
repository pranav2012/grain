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
    /// Total time allowed for queries; `None` for an interactive session (navigation).
    budget: Option<Duration>,
    /// Set after repeated timeouts or a crash; later queries fall back immediately.
    broken: bool,
    /// Failed requests in a row.
    failures: u32,
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
    /// Starts the language server for the checkout at `root`, for one analysis pass (time-boxed).
    pub fn start(tsc: &Path, root: &Path) -> Result<TsUsage> {
        Self::start_with(tsc, root, Some(BUDGET))
    }

    /// Starts a long-lived language server for go-to-definition and find-references.
    pub fn start_interactive(tsc: &Path, root: &Path) -> Result<TsUsage> {
        Self::start_with(tsc, root, None)
    }

    fn start_with(tsc: &Path, root: &Path, budget: Option<Duration>) -> Result<TsUsage> {
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
            state: Mutex::new(State { client, started: Instant::now(), budget, broken: false, failures: 0 }),
        })
    }

    fn relative(&self, path: &Path) -> Option<String> {
        let rel = path.strip_prefix(&self.real_root).or_else(|_| path.strip_prefix(&self.root)).ok()?;
        Some(rel.to_string_lossy().replace('\\', "/"))
    }
}

/// Which question to ask about the code at a position.
#[derive(Debug, Clone, Copy)]
pub enum Lookup {
    Definition,
    References,
}

/// A place in the checkout: path relative to the root, 0-based line and character.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Location {
    pub file: String,
    pub line: u32,
    pub character: u32,
}

impl TsUsage {
    /// Opens `file`, sends `method` at the position, and closes it again. `None` when the file
    /// isn't TS/JS, the budget is spent, or the server failed (it then stays off).
    fn ask_at(
        &self,
        method: &str,
        file: &str,
        line: u32,
        character: u32,
        extra: &serde_json::Value,
    ) -> Option<serde_json::Value> {
        let ext = Path::new(file).extension()?.to_str()?;
        if !EXTENSIONS.contains(&ext) {
            return None;
        }
        let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        if state.broken || state.budget.is_some_and(|b| state.started.elapsed() > b) {
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
        let mut params =
            json!({ "textDocument": { "uri": doc }, "position": { "line": line, "character": character } });
        if let (Some(p), Some(e)) = (params.as_object_mut(), extra.as_object()) {
            p.extend(e.clone());
        }
        let result = state.client.request(method, &params, PER_REQUEST);
        let _ = state.client.notify("textDocument/didClose", &json!({ "textDocument": { "uri": doc } }));
        match result {
            Ok(v) => {
                state.failures = 0;
                Some(v)
            }
            Err(e) => {
                // A slow answer while a big project loads isn't fatal; only repeated failures turn TypeScript off.
                state.failures += 1;
                state.broken = state.failures >= 3;
                tracing::warn!(error = %e, %method, failures = state.failures, "TypeScript lookup failed");
                None
            }
        }
    }

    /// Definition or references of the symbol at a 0-based position, inside the checkout
    /// (dependencies under `node_modules` are left out).
    pub fn locate(&self, lookup: Lookup, file: &str, line: u32, character: u32) -> Option<Vec<Location>> {
        let value = match lookup {
            Lookup::Definition => self.ask_at("textDocument/definition", file, line, character, &json!({}))?,
            Lookup::References => self.ask_at(
                "textDocument/references",
                file,
                line,
                character,
                &json!({ "context": { "includeDeclaration": false } }),
            )?,
        };
        // A Location, an array of them, or LocationLinks (targetUri + targetSelectionRange).
        let items: Vec<&serde_json::Value> = match &value {
            serde_json::Value::Array(xs) => xs.iter().collect(),
            serde_json::Value::Null => vec![],
            v => vec![v],
        };
        let mut out: Vec<Location> = items
            .into_iter()
            .filter_map(|l| {
                let uri = l["uri"].as_str().or_else(|| l["targetUri"].as_str())?;
                let range = if l["range"].is_object() { &l["range"] } else { &l["targetSelectionRange"] };
                let file = self.relative(&path_of(uri)?)?;
                let start = &range["start"];
                Some(Location {
                    file,
                    line: u32::try_from(start["line"].as_u64()?).ok()?,
                    character: u32::try_from(start["character"].as_u64().unwrap_or(0)).ok()?,
                })
            })
            .filter(|l| !l.file.split('/').any(|seg| seg == "node_modules"))
            .collect();
        out.sort_by(|a, b| a.file.cmp(&b.file).then(a.line.cmp(&b.line)));
        out.dedup();
        Some(out)
    }
}

impl UsageProvider for TsUsage {
    fn referencing_files(&self, file: &str, line: u32, character: u32) -> Option<Vec<String>> {
        let locations = self.locate(Lookup::References, file, line, character)?;
        let mut files: Vec<String> = locations.into_iter().map(|l| l.file).filter(|f| f != file).collect();
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
