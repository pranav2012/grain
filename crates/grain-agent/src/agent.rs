use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A coding-agent CLI the reviewer may already be signed in to.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum Agent {
    Claude,
    Codex,
    Opencode,
}

impl Agent {
    pub fn parse(s: &str) -> Option<Agent> {
        match s {
            "claude" => Some(Agent::Claude),
            "codex" => Some(Agent::Codex),
            "opencode" => Some(Agent::Opencode),
            _ => None,
        }
    }

    pub fn id(self) -> &'static str {
        match self {
            Agent::Claude => "claude",
            Agent::Codex => "codex",
            Agent::Opencode => "opencode",
        }
    }

    pub(crate) fn binary(self) -> &'static str {
        self.id()
    }

    /// Whether the agent's CLI is installed and on PATH.
    pub fn installed(self) -> bool {
        std::process::Command::new(self.binary()).arg("--version").output().map(|o| o.status.success()).unwrap_or(false)
    }
}
