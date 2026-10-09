#!/bin/sh
# Frames + end card + sound -> trailer MP4.
#   sh scripts/assets/coastal-proof/hero_chase/assemble.sh FRAMES_DIR ENDCARD.png AUDIO.wav OUT.mp4 [CARD_AT_SECONDS]
set -e
FR="$1"; CARD="$2"; AUD="$3"; OUT="$4"
ffmpeg -loglevel error -y \
  -framerate 24 -i "$FR/f%04d.png" \
  -loop 1 -framerate 24 -t 3.7 -i "$CARD" \
  -i "$AUD" \
  -filter_complex "[0:v]format=yuv420p,setsar=1[a];[1:v]format=yuv420p,setsar=1[b];[a][b]xfade=transition=fade:duration=0.5:offset=${5:-18.0}[v]" \
  -map "[v]" -map 2:a -c:v libx264 -preset slow -crf 17 -pix_fmt yuv420p -c:a aac -b:a 256k -shortest -movflags +faststart "$OUT"
echo "[assemble] $OUT"
