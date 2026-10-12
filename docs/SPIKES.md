# Phase 0 spikes

Goal: validate the libraries Grain builds on before designing around them.
All numbers come from real internal PRs (TypeScript / React Native codebases), on an Apple Silicon laptop.

| Test PR | Files | Changed lines |
|---|---|---|
| Small | 22 | +647 / −45 |
| Medium | 164 | +10,331 / −3,143 |
| Large | 395 | +50,016 / −1,915 |
| Stress (release merge) | 2,648 | +161,926 / −237,234 |

## Spike A: `sem-core` for change units + grouping (`spikes/sem-grouping`): **GO**

`sem-core` 0.27 (MIT OR Apache-2.0) used as a library: `GitBridge` → `compute_semantic_diff` → `EntityGraph::build`.

| | Small | Medium | Large | Stress |
|---|---|---|---|---|
| Semantic diff | 36 ms | 90 ms | 147 ms | 427 ms |
| Graph of changed files | 61 ms | 112 ms | 224 ms | 704 ms |
| Graph of whole repo | 0.9 s | 0.9 s | 0.45 s | 1.0 s |
| Grouping | <1 ms | 2 ms | 7 ms | 81 ms |
| Changed entities | 87 | 1,315 | 9,931 | 29,855 |
| Changed lines inside an entity | 97.5% | 98.2% | 97.4% | 98.7% |
| Blocks (v2) | 7 | 53 | 163 | 1,047 |
| Peak memory | 0.66 GB | 0.67 GB | 0.46 GB | 0.93 GB |

The end-to-end engine pass is under 1 s for normal PRs and about 5 s for a 400K-line release merge (mostly git I/O).

### Grouping lessons

- **v1 (union-find on call edges)** fails both ways: hub entities chain 70–80% of a PR into one block, while unlinked pieces fragment into dozens of 1–5 line blocks.
- **v2** works well. Its passes:
  - nodes are whole files;
  - "same edit across sibling files" pattern blocks, found by Jaccard ≥ 0.7 on *edited-line shapes* (string literals and numbers stripped), so 13 locale files become one block;
  - lockfiles, snapshots and assets go into per-kind low-attention blocks;
  - size-capped agglomerative merge on weighted edges (calls/refs, tests↔subject by file stem), cap 400 lines;
  - small blocks are absorbed into their strongest neighbour, else a directory sibling.
- Results: most blocks are 50–400 lines, and components land in the same block as their tests.

### Still to solve (v0.1 work)

1. Split single huge files (10K-line test files) into sub-blocks by entity or `describe`.
2. Order blocks foundations-first (types → logic → UI → tests).
3. Pattern blocks need a UI that reviews one representative file and skims the rest.
4. Git paths: always run git with `core.quotepath=off`, or non-ASCII file names won't match.

## Spike B: diff renderer (`spikes/diff-ui`): **GO with `@pierre/diffs`**

Production build, real Chrome via Playwright, 1440×900. Scroll test: 300 frames, flicking 1,200 px per frame.

| PR | Library | First paint | Main-thread blocking | Heap after scroll | FPS | p95 frame | Frames > 50 ms |
|---|---|---|---|---|---|---|---|
| Medium | **pierre** | 61 ms | 0 ms | 49 MB | **60** | 18 ms | **0** |
| Medium | git-diff-view | 52 ms | 64 ms | 70 MB | 44 | 59 ms | 21 |
| Large | **pierre** | 89 ms | 0 ms | 46 MB | **60** | 17 ms | **0** |
| Large | git-diff-view | 314 ms | 205 ms | 77 MB | 42 | 61 ms | 25 |
| Stress | **pierre** | 546 ms | 252 ms | 88 MB | **60** | 18 ms | **0** |
| Stress | git-diff-view | 280 ms | 0 ms | 176 MB | 42 | 71 ms | 19 |

- `@pierre/diffs` 1.5 (Apache-2.0) has these built in, and they're what Grain needs:
  - virtualized `CodeView` (one scroll container for many files);
  - Shiki highlighting in a worker pool;
  - word-level diffs and sticky headers;
  - line annotations for comments;
  - edit mode, usable for suggested edits.
- git-diff-view (MIT) needs an external virtualizer, and it janks during fast scroll.
- Grain renders one *block* at a time, so real loads will be far smaller than these whole-PR tests.

## Spike C: the user's own agent via ACP (`spikes/acp-agents`): **GO**

Rust `agent-client-protocol` 3.3 client. It sends one block diff (~260 lines), asks for strict JSON (title, intent, risk, reasons, reviewer questions), and rejects every tool permission request.

| Agent | Transport | Ready | First token | Total | Valid JSON |
|---|---|---|---|---|---|
| Claude | `@agentclientprotocol/claude-agent-acp` 0.89 | 15.5 s | 23.5 s | 42 s | yes |
| Codex | `@agentclientprotocol/codex-acp` 2.2 | 11.9 s | 20.0 s | 29 s | yes |
| OpenCode | `opencode acp` (native) | — | — | — | blocked by local login (provider 401, also outside ACP) |

- Summary quality is high. Both agents flagged real, non-obvious risks, such as a fail-closed path blocking valid users and a zero-price bypass of a validation rule.
- **Startup cost is about 10–15 s** (`npx` + agent boot). Grain must keep **one warm agent session per review** and stream block summaries in the background, ordered by the reviewer's position.
- ACP gives everything needed without agent-specific code:
  - `authenticate` with advertised methods;
  - model choice through standard session config options (`GRAIN_MODEL=provider/model`);
  - permission requests the client can reject.
- Agent login problems must be shown clearly in the UI, with the fix command (e.g. `opencode auth login`).

## Decisions

- Core engine: Rust + `sem-core`, wrapped behind Grain's own `ChangeUnit` / `Graph` types so it can be forked if needed.
- Grouping: v2 algorithm as the deterministic baseline; AI enrichment only adds titles, intent and risk on top.
- UI: React + `@pierre/diffs` `CodeView` with the worker pool.
- Agents: ACP only (Claude and Codex adapters, OpenCode native), a warm session, and all tool permissions rejected during review.

## Follow-up (same day): provider terms + grouping v3

### Agents v2 (`spikes/agents`), within provider terms

The ACP adapter for Claude is built on the Agent SDK, which Anthropic says third-party products should only use with API keys.
The default transport is now the **user's own CLI** (T3 Code's approach); ACP is limited to API-key setups. See [COMPLIANCE.md](COMPLIANCE.md).

| Agent | Command | Time (same 260-line block) | Valid JSON |
|---|---|---|---|
| Claude | `claude -p --json-schema … --tools ""` | 27 s | yes (schema-validated `structured_output`) |
| Codex | `codex exec -s read-only --output-schema …` | 21 s | yes |

- Cache hits are instant.
- Guards verified:
  - subscription use in CI is refused (exit 2);
  - ACP without an API key is refused;
  - a Claude subscription inside OpenCode is refused;
  - rate or usage limits stop the run (exit 75).

### Grouping v3: chapters → blocks + skim

- **Skim bucket**: lockfiles, generated files, assets, docs, near-identical edits across ≥ 3 sibling files, and blocks whose entities are all mechanical (formatting-only, pure moves or renames).
- **Blocks**:
  - cap raised to 600 lines;
  - merges need a link that is strong relative to the smaller side (weight / size ≥ 0.01), so one incidental call no longer fuses two features;
  - tiny leftovers are absorbed by longest shared path;
  - single files over 1,200 lines are split into runs of consecutive entities.
- **Chapters**:
  - a top-down split along the directory tree, targeting about √(lines/150) chapters (between 1 and 12);
  - chapters under 3% of the PR are folded into their nearest chapter;
  - layer ordering (types/data → hooks/state → components → screens → other) is applied to chapters and blocks.

| PR | v2 (flat) | v3 |
|---|---|---|
| Small (692 lines) | 7 blocks | 1 chapter, **2 blocks** (checkout fix + its tests; debug overlay) + skim |
| Medium (13K) | 53 blocks | **7 chapters, 35 blocks** + skim (15% of lines) |
| Large (52K) | 163 blocks | 10 chapters, ~128 blocks + skim (12%) |
| Stress (400K) | 1,047 blocks | 12 chapters, ~900 blocks + skim (39%) |
