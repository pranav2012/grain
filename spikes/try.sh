#!/usr/bin/env bash
# Try the Phase 0 spikes on any GitHub PR: semantic grouping -> block-by-block viewer,
# optionally with AI summaries from your own agent.
#
# Usage: spikes/try.sh <owner/repo> <pr-number> [claude|codex|opencode|none] [max-summaries]
# Example: spikes/try.sh acme/widgets 2671 claude 5
set -euo pipefail

REPO=${1:?owner/repo}
PR=${2:?pr number}
AGENT=${3:-none}
MAX_SUMMARIES=${4:-5}
ROOT=$(cd "$(dirname "$0")" && pwd)
WORK=${GRAIN_SPIKE_DIR:-$HOME/.grain-spike}
NAME="${REPO##*/}-$PR"
CLONE="$WORK/repos/${REPO##*/}"
mkdir -p "$WORK"/{repos,wt,out,patches,acp}

echo "▸ Fetching $REPO#$PR (read-only, blobs on demand)"
[ -d "$CLONE" ] || gh repo clone "$REPO" "$CLONE" -- --filter=blob:none --no-checkout -q
read -r BASE HEAD < <(gh api "repos/$REPO/pulls/$PR" --jq '.base.sha+" "+.head.sha')
git -C "$CLONE" fetch -q origin "$BASE" "pull/$PR/head"
MB=$(git -C "$CLONE" merge-base "$BASE" "$HEAD")
[ -d "$WORK/wt/$NAME" ] || git -C "$CLONE" worktree add -q --detach "$WORK/wt/$NAME" "$HEAD"

echo "▸ Grouping changes into review blocks"
cargo build -q --release --manifest-path "$ROOT/sem-grouping/Cargo.toml"
"$ROOT/sem-grouping/target/release/sem-grouping-spike" "$WORK/wt/$NAME" "$MB" "$HEAD" "$WORK/out/$NAME" | grep -E "^(changed|blocks|time  (semantic|grouping))"
git -C "$CLONE" -c core.quotepath=off diff -M --no-color --no-ext-diff "$MB" "$HEAD" > "$WORK/patches/$NAME.patch"
cp "$WORK/out/$NAME/blocks.json" "$WORK/patches/$NAME.blocks.json"
rm -f "$WORK/patches/$NAME.summaries.json"

if [ "$AGENT" != "none" ]; then
  echo "▸ Asking $AGENT to summarize up to $MAX_SUMMARIES code blocks (in parallel, ~30-60s)"
  cargo build -q --release --manifest-path "$ROOT/acp-agents/Cargo.toml"
  ids=$(python3 -c "
import json, sys
b = json.load(open('$WORK/out/$NAME/blocks.json'))
print(' '.join([str(x['id']) for x in b if x['kind'] in ('code', 'mixed') and x['lines'] <= 1500][:$MAX_SUMMARIES]))")
  for id in $ids; do
    files=$(python3 -c "
import json
b = {x['id']: x for x in json.load(open('$WORK/out/$NAME/blocks.json'))}
print('\n'.join(b[$id]['files']))")
    (
      echo "$files" | tr '\n' '\0' | xargs -0 git -C "$CLONE" -c core.quotepath=off diff "$MB" "$HEAD" -- > "$WORK/acp/$NAME-$id.diff"
      "$ROOT/acp-agents/target/release/acp-agents-spike" "$AGENT" "$WORK/acp/$NAME-$id.diff" "$WORK/wt/$NAME" \
        > "$WORK/acp/$NAME-$id.json" 2> "$WORK/acp/$NAME-$id.err" || echo "  block $id: agent failed (see $WORK/acp/$NAME-$id.err)"
    ) &
  done
  wait
  python3 - "$WORK" "$NAME" $ids <<'EOF'
import json, sys, os
work, name, ids = sys.argv[1], sys.argv[2], sys.argv[3:]
out = {}
for i in ids:
    p = f"{work}/acp/{name}-{i}.json"
    if os.path.exists(p) and os.path.getsize(p):
        r = json.load(open(p))
        if isinstance(r.get("summary"), dict):
            out[i] = r["summary"]
json.dump(out, open(f"{work}/patches/{name}.summaries.json", "w"), indent=2)
print(f"  {len(out)}/{len(ids)} blocks summarized")
EOF
fi

echo "▸ Starting viewer"
cd "$ROOT/diff-ui"
[ -d node_modules ] || pnpm install --silent
ln -sfn "$WORK/patches" public/patches
URL="http://localhost:5173/?lib=blocks&pr=$NAME"
echo "  $URL   (Ctrl-C to stop)"
[ -n "${GRAIN_NO_OPEN:-}" ] || (sleep 2 && open "$URL") &
exec pnpm exec vite --port 5173 --strictPort
