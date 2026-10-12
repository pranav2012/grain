# Using AI subscriptions within provider terms

Grain uses the coding agent each reviewer already has (Claude Code, Codex, OpenCode) to name chapters and summarize blocks.
This page records what the providers allow, what Grain does about it, and when it was last checked.
Providers changed these rules several times in 2026: **re-check before every release.**
This is our reading of public terms, not legal advice.

_Last checked: 2026-10-12_

## What the providers say

### Anthropic (Claude)

- [Claude Code legal & compliance](https://code.claude.com/docs/en/legal-and-compliance)
  - Developers building products, *"including those using the Agent SDK, should use API key authentication."*
  - Third parties may not *"offer Claude.ai login"*, *"route requests through Free, Pro, or Max plan credentials on behalf of their users"*, or *"collect, store, or intermediate Claude.ai credentials or session tokens."*
  - It *"does not … prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription."*
  - *"Advertised usage limits for Pro and Max plans assume ordinary, individual usage."* Enforcement *"may [happen] without prior notice."*
- [Use the Claude Agent SDK with your Claude plan](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan), updated 2026-10-07: *"You can still use the Claude Agent SDK, `claude -p`, and third-party apps with your subscription limits."* Max and Team plans also include monthly API credits.
- Precedent: T3 Code drives the user's own installed `claude` binary with the user's own login. It uses `claude -p --json-schema … --tools ""` for short structured text.

### OpenAI (Codex)

- [Codex authentication](https://learn.chatgpt.com/docs/auth)
  - Sign in with ChatGPT for subscription access, or an API key for usage-based access.
  - *"Use API key authentication for programmatic Codex CLI workflows, such as CI/CD jobs."*
  - Treat `~/.codex/auth.json` like a password.
- [Sign in with ChatGPT plan usage](https://www.developersdigest.tech/blog/sign-in-with-chatgpt-coding-agents-plan-usage-2026), 2026-10-07: third-party apps can use a user's ChatGPT plan through OpenAI's official OAuth program. Open-source and locally run projects are eligible at launch. Users set per-app weekly caps.

### OpenCode

- OpenCode is an official *Sign in with ChatGPT* launch partner, so OpenAI logins in OpenCode are fine.
- A Claude **subscription** login inside OpenCode is not allowed (Anthropic terms above). Claude API keys are fine.

## What Grain does

| Rule | How it's enforced |
|---|---|
| Only the user's own, **unmodified** agent CLI and the user's own login | Claude: `claude -p --output-format json --json-schema … --tools "" --strict-mcp-config --permission-mode dontAsk --no-session-persistence`. Codex: `codex exec --ephemeral -s read-only --output-schema …`. OpenCode: `opencode run --format json`. |
| Never touch credentials | Grain never reads, copies, stores or forwards tokens (`~/.claude*`, `~/.codex/auth.json`, keychain). It never calls provider APIs with a user's subscription token and never imitates another client's user-agent. |
| ACP adapters need an API key | `--transport acp` is refused for Claude/Codex unless `ANTHROPIC_API_KEY` / `CODEX_API_KEY` / `OPENAI_API_KEY` is set (the Claude ACP adapter is built on the Agent SDK). |
| Ordinary, individual usage | Summaries run **one at a time**, only for blocks near where the reviewer is reading. Every result is cached by content hash, so the same request is never sent twice. Each review has a cap (default 3 in the spike), and the run stops on the first rate- or usage-limit error, with no retry storms. |
| No subscriptions in CI or on shared machines | When CI is detected (`CI`, `GITHUB_ACTIONS`, …), Grain refuses subscription logins and requires an API key. Grain is never hosted to share one account across a team. |
| Agents are read-only | Tools disabled, read-only sandbox, empty scratch working directory; any permission request is rejected. |
| No Claude subscription inside OpenCode | Refused when `opencode auth list` shows an Anthropic OAuth login and the model is `anthropic/*` or unspecified. |
| Clear disclosure | The UI shows which agent and billing are in use, and asks for consent on first use. Provider names appear in plain text only, with no logos and no implied endorsement. |

## Planned

- OpenAI's official **Sign in with ChatGPT** plan-usage OAuth as a first-class Codex option, with the user's per-app cap honoured.
- A usage counter in the UI (requests this review / today) and a user-set daily cap.
