<img src="assets/icon.svg" width="64" height="64" alt="">

# grain

Review any pull request as a series of small, connected blocks instead of a wall of files.
Grain groups a PR into chapters and blocks by what the code does, puts low-attention changes in a skim pile, runs its own checks, and lets you review block by block from the keyboard. AI summaries from your own coding agent are optional.

Everything runs on your machine. GitHub access goes through your `gh` login.

## Run it

Requirements: Rust (stable), Node with pnpm, the GitHub CLI signed in (`gh auth login`), and git.

```bash
pnpm --dir ui install && pnpm --dir ui build   # build the UI once
cargo run --release -p grain                    # opens http://localhost:7420
cargo run --release -p grain -- acme/widgets#2671   # straight to a PR
```

In the app, press `⌘O` to switch pull requests: review requests, your PRs, recently opened, any repo's open PRs, or paste a link.
Press `,` for settings, including which AI agent to use, or none.

### Developing the UI

```bash
cargo run -p grain -- --no-open      # API on :7420
pnpm --dir ui dev --port 5174        # UI with hot reload, proxies /api to :7420
```

## Layout

| Path | What it is |
|---|---|
| `crates/grain-engine` | Turns a git range into chapters, blocks, skim, facts, checks and estimated risk |
| `crates/grain-github` | PR and repo lookups through the `gh` CLI |
| `crates/grain-agent` | Optional block summaries from your own `claude` / `codex` / `opencode` CLI |
| `crates/grain` | The `grain` binary: local server, PR preparation, summarizer queue |
| `ui/` | React review app (`@pierre/diffs` for diffs) |
| `docs/` | Spike results, provider-terms compliance |
| `spikes/` | Phase 0 experiments, kept for reference |

Data lives in `~/.grain` (set `GRAIN_HOME` to change it): read-only partial clones, worktrees, prepared reviews, summary cache and settings.
