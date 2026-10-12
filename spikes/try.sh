#!/usr/bin/env bash
# Review any GitHub PR in the Grain prototype: semantic grouping -> chapters and blocks,
# optionally with block summaries from your own agent CLI (see docs/COMPLIANCE.md).
#
# Usage: spikes/try.sh <owner/repo> <pr-number> [claude|codex|opencode|none] [max-summaries=3]
# Example: spikes/try.sh acme/widgets 2671 claude
set -euo pipefail

REPO=${1:?owner/repo}
PR=${2:?pr number}
AGENT=${3:-none}
MAX_SUMMARIES=${4:-3}
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

cp "$WORK/out/$NAME/review.json" "$WORK/patches/$NAME.review.json"
gh pr view "$PR" -R "$REPO" --json number,title,url,author,headRefName,baseRefName,additions,deletions,changedFiles \
  | python3 -c "import json,sys,subprocess; d=json.load(sys.stdin); d['viewer']=subprocess.run(['gh','api','user','--jq','.login'],capture_output=True,text=True).stdout.strip(); print(json.dumps(d))" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); d['agent']=None if '$AGENT'=='none' else '$AGENT'; print(json.dumps(d))" \
  > "$WORK/patches/$NAME.pr.json"
rm -f "$WORK/patches/$NAME.summaries.json"

if [ "$AGENT" != "none" ]; then
  # One request at a time, cached, stops on the first usage limit (docs/COMPLIANCE.md).
  echo "▸ Asking your own $AGENT CLI to summarize the first $MAX_SUMMARIES blocks (one at a time)"
  cargo build -q --release --manifest-path "$ROOT/agents/Cargo.toml"
  ids=$(python3 -c "
import json
r = json.load(open('$WORK/out/$NAME/review.json'))
order = [b for c in r['chapters'] for b in c['blocks']]
print(' '.join(map(str, order[:$MAX_SUMMARIES])))")
  for id in $ids; do
    python3 -c "
import json
b = {x['id']: x for x in json.load(open('$WORK/out/$NAME/review.json'))['blocks']}
print('\n'.join(b[$id]['files']))" | tr '\n' '\0' | xargs -0 git -C "$CLONE" -c core.quotepath=off diff "$MB" "$HEAD" -- > "$WORK/acp/$NAME-$id.diff"
    set +e
    "$ROOT/agents/target/release/agents-spike" "$AGENT" "$WORK/acp/$NAME-$id.diff" --cache-dir "$WORK/cache" > "$WORK/acp/$NAME-$id.json"
    code=$?
    set -e
    case $code in
      0) echo "  block $id ✓ $(python3 -c "import json;print(json.load(open('$WORK/acp/$NAME-$id.json'))['summary']['title'])")" ;;
      2) echo "  refused: $(python3 -c "import json;print(json.load(open('$WORK/acp/$NAME-$id.json'))['refused'])")"; break ;;
      75) echo "  usage limit reached — stopping (no retries)"; break ;;
      *) echo "  block $id failed (see $WORK/acp/$NAME-$id.json)" ;;
    esac
  done
  python3 - "$WORK" "$NAME" $ids <<'EOF2'
import json, sys, os
work, name, ids = sys.argv[1], sys.argv[2], sys.argv[3:]
keys = {b["id"]: b["key"] for b in json.load(open(f"{work}/patches/{name}.review.json"))["blocks"]}
out = {}
for i in ids:
    p = f"{work}/acp/{name}-{i}.json"
    if os.path.exists(p) and os.path.getsize(p):
        r = json.load(open(p))
        if isinstance(r.get("summary"), dict):
            out[keys[int(i)]] = r["summary"]
json.dump(out, open(f"{work}/patches/{name}.summaries.json", "w"), indent=2)
EOF2
fi

echo "▸ Opening Grain"
cd "$ROOT/../ui"
[ -d node_modules ] || pnpm install --silent
ln -sfn "$WORK/patches" public/data
URL="http://localhost:5174/?pr=$NAME"
echo "  $URL   (Ctrl-C to stop)"
[ -n "${GRAIN_NO_OPEN:-}" ] || (sleep 2 && open "$URL") &
exec pnpm exec vite --port 5174
