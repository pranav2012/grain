#!/usr/bin/env bash
# Sets Grain's version (workspace Cargo.toml and the grain crates in Cargo.lock) without
# needing a Rust toolchain. Usage: scripts/set-version.sh 0.2.0
set -euo pipefail
cd "$(dirname "$0")/.."
version="$1"
python3 - "$version" <<'PY'
import re, sys
version = sys.argv[1]
toml = open("Cargo.toml").read()
toml, n = re.subn(r'(\[workspace\.package\][^\[]*?\nversion = ")[^"]+(")', rf'\g<1>{version}\2', toml, count=1)
if n != 1:
    sys.exit("couldn't find [workspace.package] version in Cargo.toml")
open("Cargo.toml", "w").write(toml)
lock = open("Cargo.lock").read()
lock, m = re.subn(r'(name = "grain(?:-[a-z]+)?"\nversion = ")[^"]+(")', rf'\g<1>{version}\2', lock)
if m == 0:
    sys.exit("no grain crates found in Cargo.lock")
open("Cargo.lock", "w").write(lock)
print(f"version {version}: Cargo.toml and {m} crates in Cargo.lock")
PY
