#!/usr/bin/env bash
# Checks commit titles (arguments) against Conventional Commits, e.g. "fix(ui): map crash".
set -uo pipefail
pattern='^(feat|fix|perf|revert|docs|refactor|style|test|build|ci|chore)(\([a-z0-9._/-]+\))?!?: [^ ].+'
status=0
for title in "$@"; do
  case "$title" in Merge\ *|Revert\ \"*|fixup\!*|squash\!*) continue ;; esac
  if ! printf '%s' "$title" | grep -Eq "$pattern"; then
    echo "Not a Conventional Commit title: \"$title\"" >&2
    status=1
  fi
done
if [ "$status" -ne 0 ]; then
  cat >&2 <<'HELP'
Use "<type>(<optional scope>)!: <summary>", for example:
  feat(ui): show linked blocks        → new minor version
  fix: keep part order when sorting  → new patch version
  feat!: change the review format    → breaking change
  docs: / chore: / refactor: / test: / ci: / build: / style: → no release
HELP
fi
exit "$status"
