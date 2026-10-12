use anyhow::Result;
use serde::Serialize;
use serde_json::Value;
use ts_rs::TS;

use crate::gh::gh;
use crate::pr_ref::PrRef;

/// One review thread on a pull request: anchored to a line, or outdated by later pushes.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ReviewThread {
    pub id: String,
    pub path: String,
    /// Line on the current diff; `None` when the thread is outdated.
    pub line: Option<u32>,
    pub start_line: Option<u32>,
    /// `RIGHT` (new code) or `LEFT` (removed code).
    pub side: String,
    pub resolved: bool,
    pub outdated: bool,
    pub comments: Vec<ThreadComment>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ThreadComment {
    pub author: String,
    pub body: String,
    pub created_at: String,
    pub url: String,
}

/// A submitted review (approve, request changes, comment) with its summary text.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SubmittedReview {
    pub author: String,
    pub state: String,
    pub body: String,
    pub submitted_at: String,
    pub url: String,
}

#[derive(Debug, Clone, Default, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Conversation {
    pub threads: Vec<ReviewThread>,
    pub reviews: Vec<SubmittedReview>,
}

const QUERY: &str = r"query($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id isResolved isOutdated path line startLine diffSide
          comments(first: 50) { nodes { author { login } body createdAt url } }
        }
      }
      reviews(last: 30) { nodes { author { login } state body submittedAt url } }
    }
  }
}";

fn text(v: &Value) -> String {
    v.as_str().unwrap_or_default().to_string()
}

/// Existing review threads and submitted reviews, via the user's `gh` login (all pages).
pub fn conversation(pr: &PrRef) -> Result<Conversation> {
    let mut out = Conversation::default();
    let mut cursor: Option<String> = None;
    loop {
        let query = format!("query={QUERY}");
        let (owner, repo, number) =
            (format!("owner={}", pr.owner), format!("repo={}", pr.repo), format!("number={}", pr.number));
        let mut args = vec!["api", "graphql", "-f", &query, "-F", &owner, "-F", &repo, "-F", &number];
        let cursor_arg = cursor.as_ref().map(|c| format!("cursor={c}"));
        if let Some(c) = &cursor_arg {
            args.extend(["-f", c]);
        }
        let v = gh(&args)?;
        let pull = &v["data"]["repository"]["pullRequest"];
        for t in pull["reviewThreads"]["nodes"].as_array().into_iter().flatten() {
            out.threads.push(ReviewThread {
                id: text(&t["id"]),
                path: text(&t["path"]),
                line: t["line"].as_u64().and_then(|n| u32::try_from(n).ok()),
                start_line: t["startLine"].as_u64().and_then(|n| u32::try_from(n).ok()),
                side: text(&t["diffSide"]),
                resolved: t["isResolved"].as_bool().unwrap_or(false),
                outdated: t["isOutdated"].as_bool().unwrap_or(false),
                comments: t["comments"]["nodes"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(|c| ThreadComment {
                        author: text(&c["author"]["login"]),
                        body: text(&c["body"]),
                        created_at: text(&c["createdAt"]),
                        url: text(&c["url"]),
                    })
                    .collect(),
            });
        }
        if cursor.is_none() {
            out.reviews = pull["reviews"]["nodes"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|r| SubmittedReview {
                    author: text(&r["author"]["login"]),
                    state: text(&r["state"]),
                    body: text(&r["body"]),
                    submitted_at: text(&r["submittedAt"]),
                    url: text(&r["url"]),
                })
                .collect();
        }
        let page = &pull["reviewThreads"]["pageInfo"];
        if page["hasNextPage"] != true {
            return Ok(out);
        }
        cursor = page["endCursor"].as_str().map(str::to_string);
    }
}
