#!/usr/bin/env sh
# Fails when components bypass the design tokens in src/styles/index.css (see docs/DESIGN.md).
hits=$(grep -rnE '#[0-9a-fA-F]{3,8}\b|rgba?\(|text-\[[0-9.]+px\]|rounded-\[' src --include='*.tsx')
if [ -n "$hits" ]; then
  echo "$hits"
  echo "Use design tokens (colours, text-*, rounded-*) from src/styles/index.css instead of raw values." >&2
  exit 1
fi
