#!/bin/sh
# Bundles the standalone Lantern City into OUT_DIR with the world data, for publishing as an Artifact.
#   sh scripts/assets/lantern-city-fog/standalone/build.sh OUT_DIR
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../../../.." && pwd)
OUT="$1"
rm -rf "$OUT" && mkdir -p "$OUT/assets/v7" "$OUT/assets/v4"
"$REPO/node_modules/.bin/esbuild" "$HERE/main.ts" --bundle --format=esm --minify --target=es2020 \
  --alias:@shared="$REPO/shared" --outfile="$OUT/app.js"
cp "$HERE/index.html" "$OUT/index.html"
cp -R "$REPO/client/public/assets/goldline/lantern-city/v7/world" "$OUT/assets/v7/world"
cp "$REPO/client/public/assets/goldline/lantern-city/v4/tower-opus-la.png" "$REPO/client/public/assets/goldline/lantern-city/v4/tower-century-park-east.png" "$OUT/assets/v4/"
echo "[standalone] $OUT"
