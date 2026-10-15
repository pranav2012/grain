use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use anyhow::{Result, bail};

use crate::{Diagnostic, Severity};

/// Nearest `tsconfig.json` above each file, as paths relative to `root` ("" for the root).
fn projects(root: &Path, files: &[String]) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    for f in files {
        let mut dir = Path::new(f).parent();
        while let Some(d) = dir {
            if root.join(d).join("tsconfig.json").is_file() {
                out.insert(d.to_string_lossy().into_owned());
                break;
            }
            dir = d.parent();
        }
    }
    out
}

/// The configs to check for a project: the solution's references when `tsconfig.json` only lists
/// other projects (`"files": []` with `references`), else the config itself.
fn configs(worktree: &Path, project: &str) -> Vec<PathBuf> {
    let main = Path::new(project).join("tsconfig.json");
    let text = std::fs::read_to_string(worktree.join(&main)).unwrap_or_default();
    let compact: String = text.chars().filter(|c| !c.is_whitespace()).collect();
    if !compact.contains("\"files\":[]") || !compact.contains("\"references\"") {
        return vec![main];
    }
    let refs: Vec<PathBuf> = compact
        .split("\"path\":\"")
        .skip(1)
        .filter_map(|rest| rest.split('"').next())
        .map(|p| {
            let p = Path::new(project).join(p);
            if p.extension().is_some_and(|e| e == "json") { p } else { p.join("tsconfig.json") }
        })
        .filter(|p| worktree.join(p).is_file())
        .collect();
    if refs.is_empty() { vec![main] } else { refs }
}

/// Type-checks every project that holds a changed file and returns errors in those files.
/// Incremental builds are off so nothing is written (their cache often lives in `node_modules`, which is the reviewer's).
pub(crate) fn check(tsc: &Path, worktree: &Path, files: &[String]) -> Result<Vec<Diagnostic>> {
    let changed: BTreeSet<&str> = files.iter().map(String::as_str).collect();
    let mut out = Vec::new();
    for config in projects(worktree, files).iter().flat_map(|p| configs(worktree, p)) {
        let mut cmd = Command::new(tsc);
        cmd.current_dir(worktree).arg("-p").arg(&config);
        cmd.args(["--noEmit", "--incremental", "false", "--composite", "false", "--pretty", "false"]);
        let run = crate::process::run(cmd, Duration::from_secs(180))?;
        let items = parse(&run.stdout);
        if !run.success && items.is_empty() {
            bail!("tsc failed for {}: {}", config.display(), run.stderr.trim().lines().next().unwrap_or("no output"));
        }
        out.extend(items.into_iter().filter(|d| changed.contains(d.file.as_str())));
    }
    Ok(out)
}

/// Parses `path(line,col): error TS1234: message` lines; indented lines continue the message above.
fn parse(text: &str) -> Vec<Diagnostic> {
    let mut out: Vec<Diagnostic> = Vec::new();
    for line in text.lines() {
        if line.starts_with(' ') {
            if let Some(last) = out.last_mut() {
                last.message.push('\n');
                last.message.push_str(line.trim_start());
            }
            continue;
        }
        let Some((place, rest)) = line.split_once("): ") else { continue };
        let Some((file, pos)) = place.rsplit_once('(') else { continue };
        let mut nums = pos.split(',').filter_map(|n| n.parse::<usize>().ok());
        let (Some(row), Some(col)) = (nums.next(), nums.next()) else { continue };
        let (severity, rest) = if let Some(r) = rest.strip_prefix("error ") {
            (Severity::Error, r)
        } else if let Some(r) = rest.strip_prefix("warning ") {
            (Severity::Warning, r)
        } else {
            continue;
        };
        let (code, message) = rest.split_once(": ").unwrap_or(("", rest));
        out.push(Diagnostic {
            file: file.replace('\\', "/"),
            line: row,
            end_line: row,
            column: col,
            length: None,
            severity,
            message: message.to_string(),
            source: "TypeScript".into(),
            code: (!code.is_empty()).then(|| code.to_string()),
            url: None,
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_errors_with_continuation_lines() {
        let text = "src/a.ts(3,7): error TS2322: Type 'string' is not assignable to type 'number'.\n  Details here.\nsrc/b(1).tsx(10,1): error TS1005: ';' expected.\nnoise\n";
        let d = parse(text);
        assert_eq!(d.len(), 2);
        assert_eq!((d[0].file.as_str(), d[0].line, d[0].column), ("src/a.ts", 3, 7));
        assert_eq!(d[0].code.as_deref(), Some("TS2322"));
        assert!(d[0].message.ends_with("\nDetails here."));
        assert_eq!(d[1].file, "src/b(1).tsx");
    }

    #[test]
    fn finds_nearest_project() -> anyhow::Result<()> {
        let root = tempfile::tempdir()?;
        std::fs::create_dir_all(root.path().join("packages/app/src"))?;
        std::fs::write(root.path().join("tsconfig.json"), "{}")?;
        std::fs::write(root.path().join("packages/app/tsconfig.json"), "{}")?;
        let files = ["packages/app/src/x.ts".to_string(), "src/y.ts".to_string()];
        assert_eq!(projects(root.path(), &files).into_iter().collect::<Vec<_>>(), ["", "packages/app"]);
        Ok(())
    }

    #[test]
    fn follows_solution_references() -> anyhow::Result<()> {
        let root = tempfile::tempdir()?;
        std::fs::create_dir_all(root.path().join("ui"))?;
        std::fs::write(
            root.path().join("ui/tsconfig.json"),
            r#"{ "files": [], "references": [{ "path": "./tsconfig.app.json" }, { "path": "./missing.json" }] }"#,
        )?;
        std::fs::write(root.path().join("ui/tsconfig.app.json"), "{}")?;
        assert_eq!(configs(root.path(), "ui"), [Path::new("ui/./tsconfig.app.json")]);
        Ok(())
    }
}
