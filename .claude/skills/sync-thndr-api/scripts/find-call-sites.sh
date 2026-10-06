#!/usr/bin/env bash
# Usage: find-call-sites.sh <path-fragment> [context-lines]
# Greps the synced ThndrX bundle (.cache/thndr-bundle/js) for a path, beautifying matching chunks on demand.
set -euo pipefail
fragment="${1:?usage: find-call-sites.sh <path-fragment> [context-lines]}"
context="${2:-12}"
root="$(git rev-parse --show-toplevel)"
js="$root/.cache/thndr-bundle/js"
pretty="$root/.cache/thndr-bundle/pretty"
[ -d "$js" ] || { echo "No bundle at $js — run: npm run sync:api" >&2; exit 1; }
mkdir -p "$pretty"
files="$(grep -lF -- "$fragment" "$js"/*.js || true)"
[ -n "$files" ] || { echo "No call sites for \"$fragment\" in the synced bundle." >&2; exit 0; }
echo "$files" | while read -r file; do
  out="$pretty/$(basename "$file")"
  [ -s "$out" ] || npx --yes js-beautify -s 2 "$file" > "$out"
  echo "=== $(basename "$file") ==="
  grep -nF -C "$context" -- "$fragment" "$out"
done
