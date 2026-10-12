use crate::agent::Agent;
use crate::transport::cli;

fn env_set(keys: &[&str]) -> bool {
    keys.iter().any(|k| std::env::var(k).map(|v| !v.is_empty()).unwrap_or(false))
}

fn is_ci() -> bool {
    env_set(&["CI", "GITHUB_ACTIONS", "GITLAB_CI", "BUILDKITE", "CIRCLECI", "JENKINS_URL", "TF_BUILD"])
}

fn has_api_key(agent: Agent) -> bool {
    match agent {
        Agent::Claude => env_set(&["ANTHROPIC_API_KEY"]),
        Agent::Codex => env_set(&["CODEX_API_KEY", "OPENAI_API_KEY"]),
        Agent::Opencode => false,
    }
}

/// Provider-terms guardrails; returns why a request must not run.
pub fn policy_check(agent: Agent, model: Option<&str>) -> Option<String> {
    if is_ci() && !has_api_key(agent) {
        return Some("CI detected: subscriptions are for individual use only. Set an API key for automation.".into());
    }
    if agent == Agent::Opencode
        && cli::opencode_has_anthropic_oauth()
        && model.is_none_or(|m| m.starts_with("anthropic/"))
    {
        return Some(
            "OpenCode has a Claude subscription login, which Anthropic does not allow in third-party tools. \
             Choose a non-Anthropic model in OpenCode, or use Claude Code directly."
                .into(),
        );
    }
    None
}
