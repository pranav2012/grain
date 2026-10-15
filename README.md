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
grain                       # opens http://localhost:7420
grain owner/repo#123        # straight to a PR
grain .                     # self-review your branch plus uncommitted and new files
```

Self-review reads your repository without changing it: Grain records your working tree as a commit object using its own index, so your branch, staging area and files stay untouched. When you edit files, the review offers to refresh and keeps the blocks you already checked.

For TypeScript and JavaScript, "used by" facts come from TypeScript 7's language server, which Grain downloads once from npm (about 27 MB, checksum-verified) the first time it's needed; other languages use Grain's own code graph.

Errors show up like in an editor: type errors (TypeScript 7) and your linter's findings (ESLint or oxlint) are underlined on the lines the PR changed, next to failing CI annotations. Grain needs your own clone of the repository with its packages installed for this; it borrows those packages and your clone's lint config, so nothing from the PR's branch runs on your machine.

With an agent set, Grain can also give you a second opinion on each PR you open: your agent runs Grain's review skill (`crates/grain-agent/src/review/pr-review.md`) read-only on the PR, and its findings appear as quiet cards beside the lines they're about. Keep one and it becomes your draft comment; nothing is posted until you submit your review.

AI summaries are optional. Press `,` in the app to pick Claude Code, Codex or OpenCode if you have one installed.

## Run from source

```bash
pnpm --dir ui install && pnpm --dir ui build   # build the UI (it gets embedded into the binary)
cargo run --release -p grain                   # opens http://localhost:7420
```

### Developing the UI

```bash
cargo run -p grain -- --no-open      # API on :7420
pnpm --dir ui dev --port 5174        # UI with hot reload, proxies /api to :7420
```

## Layout

See [ARCHITECTURE.md](ARCHITECTURE.md) for the crate map, UI structure and the rules the checks enforce, and [CONTRIBUTING.md](CONTRIBUTING.md) for setup and conventions.

Data lives in `~/.grain` (set `GRAIN_HOME` to change it): read-only partial clones, worktrees, prepared reviews, summary cache and settings.
