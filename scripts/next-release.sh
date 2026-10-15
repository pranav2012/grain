#!/usr/bin/env bash
# Prints the next version (e.g. 0.2.0) when commits since the last tag warrant a release,
# or nothing when they don't. Releases happen for feat, fix, perf, revert and breaking
# changes; docs, chores, refactors, CI and website-only changes alone never ship.
set -euo pipefail
cd "$(dirname "$0")/.."

releasable=$(git cliff --unreleased --exclude-path 'website/**' --context 2>/dev/null | python3 -c '
import json, sys
ctx = json.load(sys.stdin)
commits = ctx[0]["commits"] if ctx else []
ships = [c for c in commits if c.get("breaking") or (c.get("group") or "").split("-->")[-1] in ("Features", "Fixes", "Performance", "Reverts")]
print(len(ships))')
if [ "$releasable" -eq 0 ]; then
  exit 0
fi
git cliff --exclude-path 'website/**' --bumped-version 2>/dev/null | sed 's/^v//'
