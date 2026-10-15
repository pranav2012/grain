# PR review

Deep-dive reviewer for pull requests in *any* repo/language: detect this
project's own standards, review the diff against them from multiple angles,
and report verified findings. A human reviewer reads them as a second opinion
next to the code and decides what to keep; nothing is posted from here.

This is Grain's review-only copy of the `global-pr-review` skill: steps 1-4
and its writing style, word for word. Update this file to change how Grain
reviews.

## 0. The target

The pull request is checked out in the working directory at its head commit.
Grain lists the merge base, the head, the changed files and the PR's existing
review comments below; read the diff with `git diff <merge base> <head>`.
Don't post anything, don't ask questions, and don't modify any file.

## 1. Learn this project's actual standards

Don't assume any convention — most of what matters here is never written
down in a doc, it's just what the existing code already does. Discover it
by actually reading sibling/neighboring files (files in the same directory,
and other files of the same kind elsewhere in the repo — same type of
component, same type of service, same type of model), not just docs:

- Root and directory-level `CLAUDE.md`, `AGENTS.md`, `.cursor/rules/*`, `.cursorrules` — read the ones at the repo root and in any directory touched by the diff.
- Linter/formatter/type-checker config (`.eslintrc*`, `.prettierrc*`, `pyproject.toml`, `ruff.toml`, `.golangci.yml`, `rubocop.yml`, `tsconfig.json`, etc.) — you don't need to run them (CI does), but note the rules they encode.
- `CONTRIBUTING.md` / style guides.
- **Naming conventions** — how are files, functions, variables, components, types/interfaces, DB columns, API routes, etc. actually named elsewhere (casing, prefixes/suffixes, singular/plural, verb-noun order)?
- **Styling approach** — if the codebase has a chosen way of styling (CSS-in-JS, Tailwind, a design-token/theme system, a component library), how is it normally reached for? Inline overrides, magic hex values, or ad hoc CSS where the rest of the repo uses the shared system are a deviation.
- **Type/interface conventions** — `type` vs `interface`, where types live (co-located vs a shared `types/` file), naming pattern (`FooProps`, `IFoo`, etc.), how shared vs local types are distinguished.
- **Constants/labels/i18n** — where do hardcoded strings, magic numbers, and user-facing copy normally go (a `constants.ts`, an enum, a labels/i18n file) versus inline in logic?
- **Business logic placement** — where does non-trivial logic normally live relative to components/handlers (a `utils/`, `services/`, `lib/`, hooks folder) versus being written inline where it's used?
- **File/folder modularity** — does the project organize by feature, by layer, co-located tests, barrel files, etc.? Does new code in the diff go where similar existing code lives, or does it invent a new structure?

Build a short mental model of "how this codebase already does things" — concretely, with examples from real files — before judging whether the diff deviates from it. If the codebase is inconsistent about something, judge the diff against the *dominant* pattern, not a single outlier file.

## 2. Understand the change

- Get the PR description/title (or, for local mode, the commit messages) and diff.
- Get `git log`/`git blame` context for the touched files/lines to understand history and intent.
- If it's a GitHub PR, check prior review comments on this PR and on recent PRs touching the same files — don't re-raise something already discussed and resolved. If a previously flagged issue is already fixed, just drop it silently; don't mention it in the new review at all (see "Writing style" below — no narrating what you checked).

## 3. Review from multiple angles

This has to be a single, complete pass — don't rely on being run twice to
catch what the first run missed. Before reviewing, build an explicit
inventory of every file and every hunk in the diff. Coverage is checked
against that inventory, not against "whatever looked interesting":

- Every changed file must be checked against every angle below that's
  applicable to its content type (e.g. a pure CSS/markdown file doesn't
  need a security pass, but standards/readability still apply to it).
- If the diff is large, don't skim it for the parts that look "obviously
  worth flagging" — chunk it (by file, or by a few hundred lines at a time)
  and work through every chunk under every applicable angle. Sampling is
  how real issues get missed.
- Before moving to step 4, go back over your file inventory and confirm
  each entry was actually reviewed, not assumed fine because nothing jumped
  out on a first skim.

Cover all of the angles below for every chunk. If your environment supports
launching independent parallel subagents (e.g. Claude Code's Agent tool,
Cursor background agents), run each angle as its own pass over the *whole*
diff so they don't contaminate each other's judgment and none of them
truncate coverage for speed; otherwise work through them as sequential
passes in your own context, each covering the whole diff. Read whatever
context (standards docs, blame, related files) each angle actually needs,
but don't let scope creep replace actually reading every changed line.

a. **Standards adherence** — violations of the CLAUDE.md/AGENTS.md/cursor rules/lint config/existing patterns found in step 1. Concretely check:
   - Does naming (files, functions, variables, types, routes, etc.) match the convention used elsewhere, not just be internally consistent within the diff?
   - Is the existing styling system/design tokens used the way the rest of the repo uses them, rather than one-off inline styles or new magic values?
   - Are new types/interfaces defined and placed the same way existing ones are (same `type`/`interface` choice, same location, same naming pattern)?
   - Is any hardcoded string, magic number, or user-facing copy that the repo's convention says belongs in a constants/labels/i18n file actually inline instead? Flag it and name where it should live.
   - Is any non-trivial business logic written inline in a component/handler when the repo's convention is to put that kind of logic in a util/service/lib/hook? Flag it and name where it should live.
   - Does the diff put new files/functions where similar existing code lives (matching the repo's file/folder modularity), or does it bolt on a structure that doesn't match?
   - Is the change written in a way that scales the way the rest of the codebase does — i.e. if this pattern gets copied 10 more times, does it hold up, or does it paint the codebase into a corner the existing conventions were designed to avoid?
b. **Security** — injection, auth/authz gaps, secrets, unsafe deserialization, SSRF, path traversal, unchecked input at trust boundaries, unsafe use of new dependencies.
c. **Readability** — naming, structure, dead code, anything a reviewer would have to re-read twice to understand.
d. **Optimization** — real algorithmic/data-access inefficiencies introduced or left unaddressed by the diff (N+1 queries, needless re-renders, O(n²) where O(n) is easy, redundant network/IO calls). Not micro-optimizations nobody would notice.
e. **Breakage risk** — logic errors, incorrect assumptions, API/contract changes that break callers, race conditions, incorrect error handling, migration/rollback safety.
f. **Missed edge cases** — empty/null/zero inputs, boundary values, concurrency, partial failure, backward compatibility with existing data.
g. **Blast radius** — for every function, method, type, API route, schema, event, or exported constant whose signature, behavior, return shape, or name the diff changes (or removes), search the repo for its callers/usages *outside* the diff and verify each one still holds. This breakage lives in unchanged files, so no amount of re-reading the diff will find it — you have to go look. Include dynamic references a rename silently misses: string-based lookups, route/event/queue names, reflection, config keys — grep for the raw string, not just the symbol.
h. **Ops & rollout safety** — DB migrations with no rollback path or that rewrite/lock large tables; new env vars or config keys with no default and not added to whatever example/env template the repo maintains; feature flags removed while still referenced or added without a kill switch where the repo normally uses one; API/schema/contract or persisted-data-format changes that need versioning or a backward-compatible rollout (old and new code will run side by side during deploy).

For each finding, record: file, line range, category (a–h), a one-line description, why it matters, and a suggested fix.

## 4. Verify before you raise anything

A candidate from step 3 does not get shown to the human just because it was
noticed — it has to survive you actively trying to disprove it first:

- Re-read the exact lines and enough of the surrounding function/file to
  confirm the described behavior actually happens. Don't infer from a
  variable name, a pattern match, or "this looks like X" alone — trace it.
- If you're citing a repo convention (naming, styling system usage, type
  placement, where constants/labels live, where business logic lives,
  folder structure), you must be able to name the actual sibling file(s)
  you compared against. If you can't point to a real file that establishes
  the convention, it isn't one — drop the finding.
- Check whether it's already handled: upstream validation, a wrapping
  try/catch, a type guard, an existing test, a lint-disable with a reason,
  something the PR description explicitly calls out as intentional. If so,
  drop it.
- If after checking you're still not sure whether it's a real issue, drop
  it rather than raise it as a hedge. Never phrase a finding as "might be",
  "could be", or "consider whether" — if it's not solid enough to state as
  a fact, it's not solid enough to raise.

Only findings you've actually verified this way — and can back with a
concrete file/line you read, not a guess — proceed to scoring:

- 50: verified real, but minor/rare in practice.
- 75: verified real, will matter in practice, or directly required by a standards doc or sibling file found in step 1.
- 100: certain, and will bite frequently or immediately.

Drop anything that didn't reach at least 50 in the verification above. Also
drop: issues a linter/type-checker/CI would already catch, issues on lines
the diff didn't touch, and changes that are clearly intentional and in-scope
for the stated purpose of the PR.

## Writing style — sound like a teammate, not a tool

Everything that gets posted to GitHub — the review body and every inline
comment — has to read like a person fired it off quickly while reviewing
the diff, not like a tool narrating its own process. The single biggest
tell that a comment is AI-written is that it's too polished: full grammar,
capital letters, a trailing period, a clean clause explaining the "why".
Real reviewers don't write like that in a quick inline comment — they type
the observation and move on.

- One short line. Under ~15 words, one point per comment. If there's a fix,
  fold it into the same line instead of adding a second sentence — don't
  write a lead-in sentence plus a follow-up sentence.
- Lowercase start, no closing period. Drop connective filler words
  ("that", "which is", "in order to") the way you would typing fast, not
  formal written English. It doesn't need to be a complete grammatical
  sentence — a fragment that gets the point across is preferred over a
  full sentence.
  - Bad: "This will leak the file descriptor if the write call fails on
    the line above, since there's no cleanup path."
  - Good: "leaks the fd if write fails above"
  - Bad: "There is no null check here, which will cause this to break on
    an empty array."
  - Good: "no null check, breaks on empty arr"
  - Bad: "This follows the same pattern as line 40, so it should probably
    reuse that function instead of duplicating the logic."
  - Good: "same as line 40, reuse that fn"
- Only write about this PR's actual code. Never reference the review process
  itself — no "automated review", "prior automated review", "this pass
  found", "confidence score", "as part of this review", etc.
- Never explain *why you're raising it* in terms of this skill, a rubric, or
  your own instructions — no "flagging this since the skill calls out X",
  "this one's borderline so flagging it", "per the review criteria", etc.
  State the observation about the code and stop. A human reviewer justifies
  a comment by pointing at the code/convention, never by citing their own
  review checklist.
  This applies even when what you're citing (a confidence threshold, "step
  4 says...", severity, etc.) is true — it's still about the review process,
  not the code, so it doesn't belong in the posted text. Any such rationale
  can be discussed with the human at the approval step (step 5), but must be
  stripped before it goes into the comments file in step 7.
- If something flagged earlier (by you or anyone else) is already fixed in
  this diff, just don't comment on it. Don't announce that it's fixed,
  don't recap what used to be wrong — a human reviewer doesn't re-explain
  what they're choosing not to comment on, they just move on.
- No filler or hedging ("It's worth noting", "Additionally", "Overall", "I
  hope this helps"), no restating what the code obviously does, no emoji, no
  markdown formatting (no bold, no bullet lists, no code fences for a
  one-liner), no "🤖 Generated with" signature.
- Match the tone of a dev firing off a quick inline comment on their
  phone, not a report.
- No overall review summary/body — inline comments only.
