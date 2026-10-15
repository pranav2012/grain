<img src="assets/icon.svg" width="64" height="64" alt="">

# grain

Review any pull request as a series of small, connected blocks instead of a wall of files.
Grain reads a PR like a story of user flows: for each page or screen it shows the changed code that runs there, in call order, so you review what a user would hit together. Code no flow reaches and routine changes (lockfiles, generated files, moves) come last. Each change gets plain-language facts and Grain's own checks; right-click any name to go to its definition or find references, and, if you turn AI on, ask your own coding agent to explain a change or a few lines. You stay the reviewer: the agent never marks or posts anything. AI summaries from your own coding agent are optional.

Everything runs on your machine. GitHub access goes through your `gh` login.

## Install

```bash
brew install pranav2012/tap/grain                                                        # Homebrew
curl -LsSf https://github.com/pranav2012/grain/releases/latest/download/grain-installer.sh | sh   # macOS, Linux
npm i -g grain-ci     # or: pnpm add -g grain-ci · yarn global add grain-ci · bun add -g grain-ci
```

Or run it once without installing: `npx grain-ci` (also `pnpm dlx grain-ci`, `bunx grain-ci`).

Windows (untested so far): `powershell -c "irm https://github.com/pranav2012/grain/releases/latest/download/grain-installer.ps1 | iex"`

Then check your setup. Grain needs `git` and the GitHub CLI signed in (`gh auth login`); `grain doctor` says exactly what's missing and how to fix it:

```bash
grain doctor
grain                       # opens http://grain.localhost:7420
grain owner/repo#123        # straight to a PR
grain .                     # self-review your branch plus uncommitted and new files
grain stop                  # stop it (also: grain status, grain logs -f)
```

`grain` starts Grain in the background and gives your terminal back; its log is in `~/.grain/logs/grain.log`. It stops by itself 30 minutes after the last Grain tab closed, once no background work (an AI review, an error check) is running; unsent comments and progress are saved first (`GRAIN_IDLE_MINUTES` changes the wait, `0` keeps it running). On macOS and Linux the first run also lets the system start Grain on demand (a launchd agent or systemd user socket on port 7420): opening or refreshing a Grain tab starts it again, and a stopped Grain uses nothing. `grain service uninstall` turns that off; `GRAIN_NO_SERVICE=1` skips it.

Self-review reads your repository without changing it: Grain records your working tree as a commit object using its own index, so your branch, staging area and files stay untouched. When you edit files, the review offers to refresh and keeps the blocks you already checked.

For TypeScript and JavaScript, "used by" facts come from TypeScript 7's language server, which Grain downloads once from npm (about 27 MB, checksum-verified) the first time it's needed; other languages use Grain's own code graph.

Errors show up like in an editor: type errors (TypeScript 7) and your linter's findings (ESLint or oxlint) are underlined on the lines the PR changed, next to failing CI annotations. Grain needs your own clone of the repository with its packages installed for this; it borrows those packages and your clone's lint config, so nothing from the PR's branch runs on your machine.

With an agent set, Grain can also give you a second opinion on each PR you open: your agent runs Grain's review skill (`crates/grain-agent/src/review/pr-review.md`) read-only on the PR, and its findings appear as quiet cards beside the lines they're about. Keep one and it becomes your draft comment; nothing is posted until you submit your review.

Grain records what each AI request uses and shows it: today's spend in the top bar, the cost of each second opinion, and this month per PR in Settings. Claude Code reports its own cost; Codex and OpenCode costs are estimated from token counts and the prices in the public [models.dev](https://models.dev) catalog (fetched once a day; nothing about you or your code is sent). On a subscription this is usage, not a bill. A daily budget (default $5, set in Settings) pauses AI for the day once it's reached. To spend less, second opinions skip PRs with only routine changes, ask before reviewing a PR whose estimated cost (learned from your past reviews) is a large share of the budget, and after new commits review only the files changed since the last review. Settings has two model choices per agent, listed live from the agent itself: one for second opinions and questions (Automatic: the agent's own default, kept current by its maker) and one for summaries (Automatic: the newest of the cheapest models the agent offers, run at low effort). Grain hardcodes no model names, so new models show up by themselves.

AI summaries are optional. Press `,` in the app to pick Claude Code, Codex or OpenCode if you have one installed.

## Run from source

```bash
pnpm --dir ui install && pnpm --dir ui build   # build the UI (it gets embedded into the binary)
cargo run --release -p grain                   # opens http://grain.localhost:7420
```

### Developing the UI

```bash
cargo run -p grain -- serve         # API on :7420, logging in this terminal
pnpm --dir ui dev --port 5174        # UI with hot reload, proxies /api to :7420
```

## Layout

See [ARCHITECTURE.md](ARCHITECTURE.md) for the crate map, UI structure and the rules the checks enforce, and [CONTRIBUTING.md](CONTRIBUTING.md) for setup and conventions.

Data lives in `~/.grain` (set `GRAIN_HOME` to change it): read-only partial clones, worktrees, prepared reviews, summary cache and settings.
