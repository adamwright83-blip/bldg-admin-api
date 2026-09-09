#!/usr/bin/env python3
"""Crop/repack the mediterranean_art_deco_rooftop_asset_sheet.png source sheet
into a single 1536x1024, 3x2, six-512-cell scenery atlas matching the same
convention as the existing mechanism/props/fx atlases (see
docs/goldline/creative-mechanism-provenance.md). Deterministic, re-runnable if
crop boxes need adjusting — edit CROPS below and re-run.

Frame index -> game usage (ChapterScene.ts, key 'scenery'):
  1: raised machinery island platform
  2: foreground occlusion rail
  3: main gate (closed)
  4: shortcut crate
  5: decorative wheel
  0: unused / reserved
"""
from PIL import Image, ImageFilter
import os

SRC = "client/public/assets/goldline/chapters/the-last-valet/references/mediterranean_art_deco_rooftop_asset_sheet.png"
OUT = "client/public/assets/goldline/chapters/the-last-valet/mechanisms/scenery-atlas.png"
CELL = 512
COLS, ROWS = 3, 2

# (x0, y0, x1, y1) tight boxes in source-sheet pixel space (1448x1086), with
# a little padding, chosen by visual inspection of the source sheet.
CROPS = {
    1: (30, 260, 640, 650),     # monument platform/pedestal (island housing)
    2: (10, 900, 545, 1030),    # plain lower fence/rail strip
    3: (760, 30, 1135, 545),    # gate + pillars, closed
    4: (1175, 65, 1420, 300),   # wooden brass-trimmed crate
    5: (1155, 360, 1315, 545),  # brass wheel mechanism
}


def despill_and_trim(im: Image.Image) -> Image.Image:
    """Erode the alpha mask by ~2px to eat the yellow/green halo fringe left
    by the source generator's matting, then trim to the visible bbox."""
    r, g, b, a = im.split()
    a = a.filter(ImageFilter.MinFilter(3))
    im = Image.merge("RGBA", (r, g, b, a))
    bbox = im.getbbox()
    return im.crop(bbox) if bbox else im


def fit_into_cell(im: Image.Image, cell: int = CELL, margin: int = 48) -> Image.Image:
    target = cell - margin * 2
    w, h = im.size
    scale = min(target / w, target / h, 1.0)
    if scale < 1.0:
        im = im.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)
    canvas = Image.new("RGBA", (cell, cell), (0, 0, 0, 0))
    ox = (cell - im.size[0]) // 2
    oy = cell - im.size[1] - (margin // 2)  # anchor toward the bottom of the cell, like the other atlases
    canvas.paste(im, (ox, max(0, oy)), im)
    return canvas


def main():
    src = Image.open(SRC).convert("RGBA")
    atlas = Image.new("RGBA", (CELL * COLS, CELL * ROWS), (0, 0, 0, 0))
    for frame, box in CROPS.items():
        piece = src.crop(box)
        piece = despill_and_trim(piece)
        cell_img = fit_into_cell(piece)
        col, row = frame % COLS, frame // COLS
        atlas.paste(cell_img, (col * CELL, row * CELL), cell_img)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    atlas.save(OUT)
    print(f"wrote {OUT} {atlas.size}")


if __name__ == "__main__":
    main()
