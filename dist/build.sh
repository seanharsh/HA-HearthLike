#!/bin/sh
# Regenerates dist/hearthlike-cards.js by concatenating www/hearthlike-cards/*.js.
# Each card file is wrapped in its own block scope so top-level names can't collide,
# and the bundle is syntax-checked as an ES module. Run from the repo root before tagging a release.
set -e
cd "$(dirname "$0")/.."

OUT=dist/hearthlike-cards.js
set -- www/hearthlike-cards/*.js
if [ ! -e "$1" ]; then
  echo "No cards in www/hearthlike-cards/ - nothing to bundle." >&2
  exit 1
fi

{
  echo "// Bundled build of www/hearthlike-cards/*.js — regenerate with dist/build.sh before tagging a release."
  for f in "$@"; do
    echo ""
    echo "// ---- $f ----"
    echo "{"
    cat "$f"
    echo ""
    echo "}"
  done
} > "$OUT"

# Version banner: the newest "## [x.y.z]" heading in CHANGELOG.md. With none yet, the banner says "dev".
VERSION=$(sed -n 's/^## \[\([0-9][0-9A-Za-z.+-]*\)\].*/\1/p' CHANGELOG.md | head -n 1)
if [ -n "$VERSION" ]; then
  sed "s/__HEARTHLIKE_VERSION__/$VERSION/g" "$OUT" > "$OUT.tmp"
  mv "$OUT.tmp" "$OUT"
fi

if command -v node >/dev/null 2>&1; then
  cp "$OUT" "$OUT.check.mjs"
  node --check "$OUT.check.mjs" || { rm -f "$OUT.check.mjs"; echo "Bundle failed module syntax check" >&2; exit 1; }
  rm -f "$OUT.check.mjs"
else
  echo "node not found - skipped module syntax check" >&2
fi
echo "Wrote $OUT"
