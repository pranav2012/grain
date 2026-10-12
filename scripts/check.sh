#!/usr/bin/env bash
# Runs every check CI runs. Usage: scripts/check.sh
set -euo pipefail
cd "$(dirname "$0")/.."

cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
git diff --exit-code -- ui/src/types/generated || {
  echo "Generated TypeScript types changed; commit ui/src/types/generated." >&2
  exit 1
}
pnpm --dir ui check
