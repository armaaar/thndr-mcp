#!/usr/bin/env bash
# Downloads the Thndr Android app (com.axismarkets.thndr) for STATIC analysis and unpacks it.
#
#   .claude/skills/sync-thndr-mobile-api/scripts/fetch-apk.sh [out-dir]   # default .cache/thndr-mobile (repo root)
#
# Layout written (git-ignored under .cache/):
#   <out>/tools/apkeep                                 the downloader (EFF's apkeep, pinned and checksummed)
#   <out>/download/<pkg>@<arch>.xapk                   the untrusted download — never installed or executed
#   <out>/<version>/unpacked/                          split APKs + manifest.json
#   <out>/<version>/base/assets/index.android.bundle   the Hermes bytecode with the app's JavaScript
#   <out>/latest -> <version>
#
# APKPure is a third-party mirror that has distributed modified apps, so `acknowledge_dangers=true` is passed only
# because nothing here installs or runs the app: it is unzipped and read as data. Values read from the download (the
# version name) are validated before they touch the filesystem.
set -euo pipefail
shopt -s nullglob

cd "$(git rev-parse --show-toplevel)"

PKG=com.axismarkets.thndr
ARCH=arm64-v8a
OUT=${1:-.cache/thndr-mobile}
APKEEP_VERSION=1.1.0
APKEEP_SHA256=badd7ad9fa7d2f32abe01eaf33b7ff086361a95bbc000a33bf44b630d4bf2140
APKEEP_URL=https://github.com/EFForg/apkeep/releases/download/$APKEEP_VERSION/apkeep-x86_64-unknown-linux-gnu

mkdir -p "$OUT/tools" "$OUT/download"
APKEEP="$OUT/tools/apkeep-$APKEEP_VERSION"
if [[ ! -x "$APKEEP" ]]; then
  echo "Fetching apkeep $APKEEP_VERSION…" >&2
  curl -fsSL -o "$APKEEP.part" "$APKEEP_URL"
  echo "$APKEEP_SHA256  $APKEEP.part" | sha256sum -c --quiet - || { rm -f "$APKEEP.part"; exit 1; }
  chmod +x "$APKEEP.part" && mv "$APKEEP.part" "$APKEEP"
fi

echo "Downloading $PKG ($ARCH) from APKPure…" >&2
rm -f "$OUT"/download/*.xapk "$OUT"/download/*.apk
"$APKEEP" -a "$PKG" -d apk-pure -o "acknowledge_dangers=true,arch=$ARCH" "$OUT/download" >&2
downloads=("$OUT"/download/*.xapk "$OUT"/download/*.apk)
XAPK=${downloads[0]:-}
[[ -n "$XAPK" ]] || { echo "Download failed: no .xapk/.apk in $OUT/download" >&2; exit 1; }

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/unpacked"
if [[ "$XAPK" == *.xapk ]]; then
  unzip -q -o "$XAPK" -d "$STAGE/unpacked"
  VERSION=$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1])).get("version_name", ""))' \
    "$STAGE/unpacked/manifest.json")
else
  cp "$XAPK" "$STAGE/unpacked/$PKG.apk"
  VERSION=unknown-$(date +%Y%m%d)
fi
# The version names a directory we replace: accept only a plain name, never a path.
[[ "$VERSION" =~ ^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$ ]] || { echo "Refusing unexpected version name: $VERSION" >&2; exit 1; }
[[ -f "$STAGE/unpacked/$PKG.apk" ]] || { echo "No $PKG.apk in the download" >&2; exit 1; }

DEST="$OUT/$VERSION"
rm -rf "$DEST" && mkdir -p "$DEST"
mv "$STAGE/unpacked" "$DEST/unpacked"
unzip -q -o "$DEST/unpacked/$PKG.apk" -d "$DEST/base"
ln -sfn "$VERSION" "$OUT/latest"

BUNDLE="$DEST/base/assets/index.android.bundle"
[[ -f "$BUNDLE" ]] || { echo "No assets/index.android.bundle: not a React Native build any more?" >&2; exit 1; }
echo "version:  $VERSION"
echo "bundle:   $BUNDLE ($(stat -c %s "$BUNDLE") bytes)"
echo "format:   $(file -b "$BUNDLE")"
echo "sha256:   $(sha256sum "$XAPK" | cut -d' ' -f1)  $(basename "$XAPK")"
