use std::path::Path;
use std::process::Command;
use std::time::Duration;

use anyhow::{Context, Result};
use serde::Deserialize;

use crate::{Diagnostic, Severity};

const CONFIGS: [&str; 3] = [".oxlintrc.json", "oxlintrc.json", "oxlint.json"];

#[derive(Deserialize)]
struct Report {
    diagnostics: Vec<Item>,
}

#[derive(Deserialize)]
struct Item {
    message: String,
    code: Option<String>,
    severity: String,
    url: Option<String>,
    filename: String,
    #[serde(default)]
    labels: Vec<Label>,
}

#[derive(Deserialize)]
struct Label {
    span: Span,
}

#[derive(Deserialize)]
struct Span {
    line: usize,
    column: usize,
    length: usize,
}

/// Lints `files` with the clone's oxlint and the nearest config above each file (JSON, so nothing
/// from the PR runs). `None` when the clone doesn't use oxlint.
pub(crate) fn check(clone: &Path, worktree: &Path, files: &[String]) -> Result<Option<Vec<Diagnostic>>> {
    let groups = crate::configs::groups(clone, files, &CONFIGS);
    if groups.is_empty() {
        return Ok(None);
    }
    let mut out = Vec::new();
    for (dir, config, files) in groups {
        let bin_name = if cfg!(windows) { "oxlint.cmd" } else { "oxlint" };
        let bin = Path::new(&dir)
            .ancestors()
            .map(|d| clone.join(d).join("node_modules/.bin").join(bin_name))
            .find(|p| p.is_file())
            .context("oxlint isn't installed in your clone")?;
        let mut cmd = Command::new(bin);
        cmd.current_dir(worktree.join(&dir)).arg("-c").arg(&config).args(["--format", "json"]);
        cmd.args(files.iter().map(|f| crate::configs::strip(&dir, f)));
        let run = crate::process::run(cmd, Duration::from_secs(120))?;
        out.extend(parse(&run.stdout)?.into_iter().map(|mut d| {
            d.file = crate::configs::join(&dir, &d.file);
            d
        }));
    }
    Ok(Some(out))
}

fn parse(text: &str) -> Result<Vec<Diagnostic>> {
    let report: Report = serde_json::from_str(text).context("read oxlint's output")?;
    Ok(report
        .diagnostics
        .into_iter()
        .map(|d| {
            let span = d.labels.first().map(|l| (l.span.line, l.span.column, l.span.length));
            let (line, column, length) = span.unwrap_or((1, 1, 0));
            Diagnostic {
                file: d.filename.replace('\\', "/"),
                line,
                end_line: line,
                column,
                length: (length > 0).then_some(length),
                severity: if d.severity == "error" { Severity::Error } else { Severity::Warning },
                message: d.message,
                source: "oxlint".into(),
                code: d.code,
                url: d.url,
            }
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_json_report() -> anyhow::Result<()> {
        let text = r#"{ "diagnostics": [{"message": "`debugger` statement is not allowed","code": "eslint(no-debugger)","severity": "warning","url": "https://oxc.rs/x","help": "Remove it","filename": "src/a.ts","labels": [{"span": {"offset": 35,"length": 9,"line": 1,"column": 36}}]}], "number_of_files": 1 }"#;
        let d = parse(text)?;
        assert_eq!((d[0].line, d[0].column, d[0].length), (1, 36, Some(9)));
        assert_eq!(d[0].severity, Severity::Warning);
        assert_eq!(d[0].code.as_deref(), Some("eslint(no-debugger)"));
        Ok(())
    }
}
