#!/usr/bin/env bash
# Downloads the Thndr Android app (com.axismarkets.thndr) for STATIC analysis and unpacks it.
#
#   .claude/skills/reverse-engineer-thndr-mobile/scripts/fetch-apk.sh [out-dir]   # default .cache/thndr-mobile
#
# Layout written (all git-ignored under .cache/):
#   <out>/tools/apkeep                         the downloader (EFF's apkeep, project-local)
#   <out>/download/<pkg>@<arch>.xapk           the untrusted download — never installed or executed
#   <out>/<version>/unpacked/                  split APKs + manifest.json
#   <out>/<version>/base/assets/index.android.bundle   the Hermes bytecode with the app's JavaScript
#   <out>/latest -> <version>
#
# APKPure is a third-party mirror that has distributed modified apps, so `acknowledge_dangers=true` is passed only
# because nothing here installs or runs the app: it is unzipped and read as data.
set -euo pipefail

PKG=com.axismarkets.thndr
ARCH=arm64-v8a
OUT=${1:-.cache/thndr-mobile}
APKEEP_URL=https://github.com/EFForg/apkeep/releases/latest/download/apkeep-x86_64-unknown-linux-gnu

mkdir -p "$OUT/tools" "$OUT/download"
if [[ ! -x "$OUT/tools/apkeep" ]]; then
  echo "Fetching apkeep…" >&2
  curl -fsSL -o "$OUT/tools/apkeep" "$APKEEP_URL"
  chmod +x "$OUT/tools/apkeep"
fi

echo "Downloading $PKG ($ARCH) from APKPure…" >&2
rm -f "$OUT/download/"*.xapk "$OUT/download/"*.apk
"$OUT/tools/apkeep" -a "$PKG" -d apk-pure -o "acknowledge_dangers=true,arch=$ARCH" "$OUT/download" >&2
XAPK=$(ls "$OUT/download/"*.xapk "$OUT/download/"*.apk 2>/dev/null | head -1)
[[ -n "$XAPK" ]] || { echo "Download failed: no .xapk/.apk in $OUT/download" >&2; exit 1; }

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
if [[ "$XAPK" == *.xapk ]]; then
  unzip -q -o "$XAPK" -d "$STAGE/unpacked"
  BASE_APK="$STAGE/unpacked/$PKG.apk"
  VERSION=$(python3 -I -c 'import json,sys; m=json.load(open(sys.argv[1])); print(m.get("version_name","unknown"))' "$STAGE/unpacked/manifest.json")
else
  mkdir -p "$STAGE/unpacked" && cp "$XAPK" "$STAGE/unpacked/$PKG.apk"
  BASE_APK="$STAGE/unpacked/$PKG.apk"
  VERSION=unknown-$(date +%Y%m%d)
fi

DEST="$OUT/$VERSION"
rm -rf "$DEST" && mkdir -p "$DEST"
mv "$STAGE/unpacked" "$DEST/unpacked"
unzip -q -o "$DEST/unpacked/$(basename "$BASE_APK")" -d "$DEST/base"
ln -sfn "$VERSION" "$OUT/latest"

BUNDLE="$DEST/base/assets/index.android.bundle"
[[ -f "$BUNDLE" ]] || { echo "No assets/index.android.bundle: not a React Native build any more?" >&2; exit 1; }
echo "version:  $VERSION"
echo "bundle:   $BUNDLE ($(stat -c %s "$BUNDLE") bytes)"
echo "format:   $(file -b "$BUNDLE")"
echo "sha256:   $(sha256sum "$XAPK" | cut -d' ' -f1)  $(basename "$XAPK")"
