#!/usr/bin/env bash
# Decompiles the Thndr app's Hermes bundle with hermes-dec (P1sec), installed in a project-local virtualenv.
#
#   .claude/skills/reverse-engineer-thndr-mobile/scripts/decompile.sh [app-dir]   # default .cache/thndr-mobile/latest
#
# Writes <app-dir>/decompiled/{disassembly.hasm,decompiled.js} and prints the bytecode version. The bundle is read as
# data only; nothing from the download is executed.
set -euo pipefail

APP=${1:-.cache/thndr-mobile/latest}
BUNDLE="$APP/base/assets/index.android.bundle"
VENV=.cache/thndr-mobile/venv
OUT="$APP/decompiled"
[[ -f "$BUNDLE" ]] || { echo "No bundle at $BUNDLE — run fetch-apk.sh first" >&2; exit 1; }

if [[ ! -x "$VENV/bin/hbc-decompiler" ]]; then
  echo "Installing hermes-dec into $VENV…" >&2
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install -q --upgrade pip
  "$VENV/bin/pip" install -q "git+https://github.com/P1sec/hermes-dec"
fi

mkdir -p "$OUT"
echo "format: $(file -b "$BUNDLE")"
echo "Disassembling…" >&2
"$VENV/bin/hbc-disassembler" "$BUNDLE" "$OUT/disassembly.hasm"
echo "Decompiling (several minutes for a ~16 MB bundle)…" >&2
"$VENV/bin/hbc-decompiler" "$BUNDLE" "$OUT/decompiled.js"
ls -la "$OUT"
