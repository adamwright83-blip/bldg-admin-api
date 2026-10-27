#!/usr/bin/env python3
"""Cut Driver Studio's Rodeo reaction sprites from the approved Beverly Hills sheets.

Nothing is redrawn. Each frame is the authored cell listed in
client/src/pages/goldline/beverlyHills2d/cells.ts, clipped to its largest
connected shape exactly like `sprite()` in beverlyHills2d/paint.ts does at
runtime, so a neighbouring drawing's nose never comes along. The frames are
then packed into fixed-size cells so CSS can step through them without
guessing background positions.

Run: python3 scripts/build-driver-studio-rodeo-sprites.py
"""
from collections import deque
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SHEETS = ROOT / "client/public/assets/goldline/beverly-hills-2d"
OUT = ROOT / "client/public/joystick/driver-studio"
SCALE = 0.5
ALPHA_FLOOR = 24  # same threshold as paint.ts

# From cells.ts (CALF.walk and TERRIER.heads.delighted).
CALF_WALK = [(337, 92, 339, 265), (638, 92, 326, 265), (945, 91, 316, 264), (1238, 91, 291, 265)]
TERRIER_DELIGHTED = (968, 725, 200, 207)


def clean_cell(sheet: Image.Image, rect) -> Image.Image:
    x, y, w, h = rect
    cell = sheet.crop((x, y, x + w, y + h)).convert("RGBA")
    alpha = cell.getchannel("A").load()
    seen = [[False] * w for _ in range(h)]
    best: list[tuple[int, int]] = []
    for sy in range(h):
        for sx in range(w):
            if seen[sy][sx] or alpha[sx, sy] < ALPHA_FLOOR:
                continue
            group = [(sx, sy)]
            seen[sy][sx] = True
            queue = deque(group)
            while queue:
                cx, cy = queue.popleft()
                for nx, ny in ((cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1)):
                    if 0 <= nx < w and 0 <= ny < h and not seen[ny][nx] and alpha[nx, ny] >= ALPHA_FLOOR:
                        seen[ny][nx] = True
                        group.append((nx, ny))
                        queue.append((nx, ny))
            if len(group) > len(best):
                best = group
    keep = Image.new("L", (w, h), 0)
    keep_px = keep.load()
    for px, py in best:
        keep_px[px, py] = 255
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    out.paste(cell, (0, 0), keep)
    # Keep the drawing's own soft edge where it touches the kept shape.
    out.putalpha(Image.composite(cell.getchannel("A"), Image.new("L", (w, h), 0), keep))
    return out


def scaled(img: Image.Image) -> Image.Image:
    return img.resize((round(img.width * SCALE), round(img.height * SCALE)), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    calf_sheet = Image.open(SHEETS / "04-calf-sheet.png")
    frames = [scaled(clean_cell(calf_sheet, r)) for r in CALF_WALK]
    cell_w = max(f.width for f in frames)
    cell_h = max(f.height for f in frames)
    strip = Image.new("RGBA", (cell_w * len(frames), cell_h), (0, 0, 0, 0))
    for i, frame in enumerate(frames):
        # Facing left: align noses (left edge) and hooves (bottom edge).
        strip.paste(frame, (i * cell_w, cell_h - frame.height), frame)
    strip.save(OUT / "rodeo-calf-walk.png", optimize=True)

    terrier_sheet = Image.open(SHEETS / "02-terrier-sheet.png")
    scaled(clean_cell(terrier_sheet, TERRIER_DELIGHTED)).save(OUT / "rodeo-terrier-delighted.png", optimize=True)
    print(f"calf walk: {len(frames)} frames of {cell_w}x{cell_h}")


if __name__ == "__main__":
    main()
