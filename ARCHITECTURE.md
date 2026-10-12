# Architecture

Grain runs locally. The `grain` binary serves a React UI and an HTTP API on `localhost:7420`, prepares pull requests on demand, and keeps everything under `~/.grain`.

## Data flow

```
GitHub (via gh) ──► prepare job ──► grain-engine ──► review.json ──► UI
                    clone, fetch,    diff → grouping     chapters,      outline, grain map,
                    worktree, diff   → facts             blocks, skim   block view, context
                                                            │
                                     summarize job ◄────────┘ (optional: user's own agent CLI,
                                                               only blocks near the reader)
```

Local self-reviews (`grain .`) skip GitHub: `jobs/local.rs` snapshots the working tree into an
unreferenced commit (private `GIT_INDEX_FILE`), diffs it against the merge base with the default
branch, and feeds that range to the same engine. They are addressed as `~local/<folder-hash>/0`,
so every review route works unchanged.

## Rust crates (`crates/`)

Each crate has one job. Dependencies only point down this list; nothing depends on `grain` or `grain-server`.

| Crate | Job | Depends on |
|---|---|---|
| `grain` | CLI (clap): start the server or run `grain analyze` | server, engine, github |
| `grain-server` | axum routes, shared state, background jobs, typed API contract | engine, git, github, agent, store |
| `grain-engine` | Git range → chapters, blocks, skim, facts, checks, estimated risk | sem-core |
| `grain-git` | git CLI operations (fetch, merge-base, worktrees, diffs) | — |
| `grain-github` | PR and repo lookups, clones, via the user's `gh` login | — |
| `grain-agent` | Optional block summaries from the user's own agent CLI, with provider-terms guards | — |
| `grain-store` | `~/.grain` layout, settings, atomic writes | agent, github |

### Inside `grain-engine`

```
lib.rs        public API: analyze(), model types, REVIEW_FORMAT
pipeline.rs   orchestration of the steps below
diff/         hunks.rs (git -U0 parsing, edit shapes), units.rs (lines → entity/residue units)
grouping/     cluster.rs (units → blocks), chapters.rs (blocks → chapters), blocks.rs, union_find.rs
facts/        checks.rs (rule checks, estimated risk), removed.rs (removed code still referenced)
classify.rs   path conventions: file kinds, tests, layers, language families
model.rs      Review, Chapter, Block, Check (serialized as review.json, exported to TypeScript)
```

### Rules

- **Deterministic output.** The same PR must always give the same review. Never let hash-map iteration order decide anything; give every sort a full tie-break.
- **Bump `grain_engine::REVIEW_FORMAT`** whenever the engine's output changes (fields or grouping). Stored reviews in another format are recomputed.
- **AI is optional.** Nothing in the engine or UI may require an agent. Agent access follows [docs/COMPLIANCE.md](docs/COMPLIANCE.md): the user's own CLI, read-only, one request at a time, cached, never in CI on a subscription.
- **No tokens.** GitHub goes through `gh`; agents through their own CLIs. Grain never reads, stores or forwards credentials.
- Git commands that may need missing objects (partial clones) go through the git CLI (`grain-git`), not libgit2.

## UI (`ui/src/`)

Feature-based layout (as in bulletproof-react):

```
app/          shell: routing (?pr=owner/repo/123), providers, home page, app-wide dialogs
features/
  review/     api.ts, model/ (pure logic), state/ (persisted state), hooks/, components/
  pr-picker/  find a PR: requests, mine, recent, browse repos, pasted link
  settings/   AI agent and limits
components/   shared, feature-agnostic UI: ui/ primitives, CommandPalette, Icons
lib/          framework-free helpers: http, formatting, PR refs, hotkeys
styles/       Tailwind entry and design tokens (@theme)
types/generated/   TypeScript types generated from Rust (do not edit)
```

### Rules (enforced by oxlint)

- A feature exposes itself only through its `index.ts`; nothing imports `features/<name>/<file>` from outside.
- Features never import each other or `app/`; `app/` composes them.
- `components/` and `lib/` never import features or `app/`.
- Styling uses Tailwind utilities with the tokens in `styles/index.css` (`bg-graphite`, `text-fog`, `text-coral`…). Colour carries meaning only: sage reviewed, coral risk or change, amber warning, periwinkle focus.
- Server types come from `types/generated`. Change the Rust type, run `cargo test`, and commit the regenerated files.
