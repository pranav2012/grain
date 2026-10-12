# Contributing

Read [ARCHITECTURE.md](ARCHITECTURE.md) first: it explains where code goes and the rules the checks enforce.

## Setup

- Rust: the toolchain in `rust-toolchain.toml` installs automatically with rustup.
- Node 24 and pnpm (`corepack enable` picks the version from `ui/package.json`).
- GitHub CLI signed in: `gh auth login`.

```bash
pnpm --dir ui install
cargo run -p grain -- --no-open      # API on :7420
pnpm --dir ui dev --port 5174        # UI with hot reload
```

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
