#!/bin/sh
# Bundles the standalone island board into OUT_DIR with the world data, for publishing as an Artifact.
#   sh scripts/assets/lantern-city-fog/islands/build.sh OUT_DIR
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../../../.." && pwd)
OUT="$1"
rm -rf "$OUT" && mkdir -p "$OUT/assets/v7/world"
"$REPO/node_modules/.bin/esbuild" "$HERE/main.ts" --bundle --format=esm --minify --target=es2020 \
  --alias:@shared="$REPO/shared" --outfile="$OUT/app.js"
cp "$HERE/index.html" "$OUT/index.html"
cp "$REPO/client/public/assets/goldline/lantern-city/v7/world/manifest.json" "$OUT/assets/v7/world/"
echo "[islands] $OUT"
