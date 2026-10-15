# Contributing

Read [ARCHITECTURE.md](ARCHITECTURE.md) first: it explains where code goes and the rules the checks enforce.

## Setup

- Rust: the toolchain in `rust-toolchain.toml` installs automatically with rustup.
- Node 24 and pnpm (`corepack enable` picks the version from `ui/package.json`).
- GitHub CLI signed in: `gh auth login`.

```bash
pnpm --dir ui install
cargo run -p grain -- serve         # API on :7420, logging in this terminal
pnpm --dir ui dev --port 5174        # UI with hot reload
```

## Commit messages

Titles are [Conventional Commits](https://www.conventionalcommits.org); they decide releases and the changelog. CI rejects other titles.

```
feat(ui): show linked blocks          # new minor release
fix: keep part order when sorting     # new patch release
feat!: change the review format       # breaking change
docs: / chore: / refactor: / test: / ci: / build: / style:   # no release
```

Check titles before pushing with the hook: `git config core.hooksPath .githooks` (once per clone).

## Before you push

```bash
scripts/check.sh
```

It runs exactly what CI runs: rustfmt, clippy (pedantic, warnings are errors), tests, the generated-types check, then UI typecheck, lint and build.

## Conventions

- **Rust:** one job per crate; split files over ~400 lines into a module folder; `pub(crate)` by default. Return `anyhow::Result` in applications and use typed errors at API boundaries. Log with `tracing`, never `println!`.
- **Types shared with the UI** derive `ts_rs::TS` with `#[ts(export)]`. `cargo test` regenerates `ui/src/types/generated`; commit the result.
- **Engine changes:** keep output deterministic, bump `REVIEW_FORMAT` when output changes, and compare `grain analyze <repo> <base> <head> --json` before and after a refactor.
- **UI:** new screens go in a feature folder; shared pieces go in `components/` only when a second feature needs them. Style with Tailwind tokens, not new CSS.
- **Comments:** explain why or describe a function's contract; don't restate the code.
