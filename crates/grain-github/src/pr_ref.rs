use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct PrRef {
    pub owner: String,
    pub repo: String,
    pub number: u64,
}

/// Owner of reviews of local changes. Not a valid GitHub login, so it never clashes with a repo.
pub const LOCAL_OWNER: &str = "~local";

impl PrRef {
    /// A review of uncommitted and unpushed work in a local repository.
    pub fn local(id: &str) -> PrRef {
        PrRef { owner: LOCAL_OWNER.into(), repo: id.into(), number: 0 }
    }

    pub fn is_local(&self) -> bool {
        self.owner == LOCAL_OWNER
    }

    pub fn full_repo(&self) -> String {
        format!("{}/{}", self.owner, self.repo)
    }

    /// Accepts `https://github.com/o/r/pull/12`, `o/r#12`, `o/r/12` or `o/r/pull/12`.
    pub fn parse(input: &str) -> Option<PrRef> {
        let s = input.trim().trim_end_matches('/');
        let s = s.strip_prefix("https://").or_else(|| s.strip_prefix("http://")).unwrap_or(s);
        let s = s.strip_prefix("github.com/").unwrap_or(s);
        let s = s.split(['?']).next().unwrap_or(s);
        let (repo_part, num) = if let Some((r, n)) = s.split_once('#') {
            (r.to_string(), n.to_string())
        } else {
            let parts: Vec<&str> = s.split('/').collect();
            match parts.as_slice() {
                [o, r, "pull" | "pulls", n, ..] => (format!("{o}/{r}"), n.to_string()),
                [o, r, n] => (format!("{o}/{r}"), n.to_string()),
                _ => return None,
            }
        };
        let (owner, repo) = repo_part.split_once('/')?;
        let number = num.split(|c: char| !c.is_ascii_digit()).next()?.parse().ok()?;
        (!owner.is_empty() && !repo.is_empty()).then(|| PrRef { owner: owner.into(), repo: repo.into(), number })
    }
}

#[cfg(test)]
mod tests {
    use super::PrRef;

    #[test]
    fn parses_pr_refs() {
        let want = Some(PrRef { owner: "acme".into(), repo: "widgets".into(), number: 42 });
        assert_eq!(PrRef::parse("https://github.com/acme/widgets/pull/42"), want);
        assert_eq!(PrRef::parse("https://github.com/acme/widgets/pull/42/files?x=1"), want);
        assert_eq!(PrRef::parse("acme/widgets#42"), want);
        assert_eq!(PrRef::parse("acme/widgets/42"), want);
        assert_eq!(PrRef::parse("github.com/acme/widgets/pull/42"), want);
        assert_eq!(PrRef::parse("nonsense"), None);
    }
}
