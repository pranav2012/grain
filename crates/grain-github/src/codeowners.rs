//! GitHub CODEOWNERS: who owns which paths. Patterns follow gitignore rules and the last
//! matching line wins, as on GitHub.

use globset::{Glob, GlobBuilder, GlobMatcher};

/// Where GitHub looks for the file, in its order of precedence.
pub const CODEOWNERS_PATHS: [&str; 3] = [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"];

struct Rule {
    matchers: Vec<GlobMatcher>,
    owners: Vec<String>,
}

pub struct CodeOwners {
    rules: Vec<Rule>,
}

fn glob(pattern: &str) -> Option<GlobMatcher> {
    GlobBuilder::new(pattern).literal_separator(true).build().ok().map(|g: Glob| g.compile_matcher())
}

/// gitignore-style pattern → globs: unanchored patterns match at any depth, and a pattern
/// naming a directory also matches everything inside it.
fn matchers(pattern: &str) -> Vec<GlobMatcher> {
    let dir_only = pattern.ends_with('/');
    let p = pattern.trim_end_matches('/');
    let anchored = p.starts_with('/') || p.contains('/');
    let p = p.trim_start_matches('/');
    if p.is_empty() {
        return vec![];
    }
    let base = if anchored || p.starts_with("**") { p.to_string() } else { format!("**/{p}") };
    let mut globs = vec![format!("{base}/**")];
    if !dir_only {
        globs.push(base);
    }
    globs.iter().filter_map(|g| glob(g)).collect()
}

impl CodeOwners {
    pub fn parse(text: &str) -> CodeOwners {
        let rules = text
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty() && !l.starts_with('#'))
            .filter_map(|l| {
                let mut parts = l.split_whitespace();
                let pattern = parts.next()?;
                let owners = parts.take_while(|o| !o.starts_with('#')).map(str::to_string).collect();
                Some(Rule { matchers: matchers(pattern), owners })
            })
            .collect();
        CodeOwners { rules }
    }

    /// Owners of `path` (`@user`, `@org/team` or an email); empty when nobody owns it.
    pub fn owners(&self, path: &str) -> &[String] {
        self.rules
            .iter()
            .rev()
            .find(|r| r.matchers.iter().any(|m| m.is_match(path)))
            .map_or(&[], |r| r.owners.as_slice())
    }
}

/// Whether `owners` include the user directly or through one of their teams (`org/team`).
pub fn is_owner(owners: &[String], login: &str, teams: &[String]) -> bool {
    owners.iter().any(|o| {
        let o = o.trim_start_matches('@');
        o.eq_ignore_ascii_case(login) || teams.iter().any(|t| t.eq_ignore_ascii_case(o))
    })
}

#[cfg(test)]
mod tests {
    use super::{CodeOwners, is_owner};

    const FILE: &str = "
# Default owners
*       @acme/everyone
*.js    @js-owner
/docs/  @acme/docs  # trailing comment
apps/   @acme/apps
/build/logs/ @ops
src/**/tests @qa
config.yml   @acme/config
/apps/github @octo
";

    #[test]
    fn last_matching_rule_wins() {
        let c = CodeOwners::parse(FILE);
        assert_eq!(c.owners("README.md"), ["@acme/everyone"]);
        assert_eq!(c.owners("web/app.js"), ["@js-owner"]);
        assert_eq!(c.owners("docs/guide/intro.md"), ["@acme/docs"]);
        assert_eq!(c.owners("nested/docs/x.md"), ["@acme/everyone"], "anchored to the root");
        assert_eq!(c.owners("apps/web/main.ts"), ["@acme/apps"]);
        assert_eq!(c.owners("build/logs/a.log"), ["@ops"]);
        assert_eq!(c.owners("src/a/b/tests/x.ts"), ["@qa"]);
        assert_eq!(c.owners("deep/dir/config.yml"), ["@acme/config"], "unanchored names match anywhere");
        assert_eq!(c.owners("apps/github/x.ts"), ["@octo"]);
    }

    #[test]
    fn no_owners_without_a_match() {
        assert_eq!(CodeOwners::parse("/only/here @x").owners("elsewhere.rs"), [] as [String; 0]);
    }

    #[test]
    fn matches_user_and_teams_case_insensitively() {
        let owners = vec!["@Acme/Web".to_string(), "dev@acme.com".to_string()];
        assert!(is_owner(&owners, "someone", &["acme/web".into()]));
        assert!(is_owner(&["@Pranav".to_string()], "pranav", &[]));
        assert!(!is_owner(&owners, "someone", &["acme/api".into()]));
    }
}
