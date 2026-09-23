#!/usr/bin/env python3
"""
Split the approved broken-span painting into the live parts the Wayward needs.

Nothing is repainted. Every output pixel is copied from
client/public/assets/goldline/wayward/broken-span-tether-ring.webp; the script
only decides which part each pixel belongs to, so the ship's end can roll, the
ring can swing, the edge can break away and the city side can collapse.

    python3 scripts/assets/wayward/prep_span.py

Outputs (client/public/assets/goldline/wayward/voyage/):
  span-left.webp        ship end, without its breakable edge or the tether rope
  span-left-edge-N.webp breakable edge chunks (fall away when the Line bites)
  span-right-N.webp     city-side chunks (collapse after the tether is cut)
  span-ring.webp        tether ring and straps
  span-crate.webp       the hanging crate (reused as the loose cargo on the boom)
  span-rope.webp        a straight rope tile for live ropes (shaded strand in the painting's rope colours)
  span-barrel.webp      a barrel from the city side, reused as loose cargo
  span-parts.json       every part's position in painting coordinates
"""
import json, math, os
import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../.."))
SRC = os.path.join(ROOT, "client/public/assets/goldline/wayward/broken-span-tether-ring.webp")
OUT = os.path.join(ROOT, "client/public/assets/goldline/wayward/voyage")

RING = [(566, 250), (598, 237), (645, 250), (700, 220), (845, 220), (905, 236), (958, 231), (978, 242),
        (980, 270), (964, 300), (978, 346), (948, 356), (926, 344), (905, 364), (862, 348), (822, 374),
        (700, 376), (660, 342), (628, 322), (600, 312), (592, 334), (576, 302), (566, 272)]
# The tether's two rope runs on each side, from the pulley to the knot on the ring's strap.
LEFT_TETHER = [[(462, 168), (500, 196), (550, 231), (592, 250)],
               [(456, 191), (482, 217), (512, 246), (542, 263), (575, 268)]]
RIGHT_TETHER = [[(952, 246), (1000, 211), (1040, 181), (1058, 168)],
                [(958, 256), (1000, 226), (1045, 201), (1066, 188)]]
# Breakable edge of the ship's end, split into chunks by splintered cut lines.
LEFT_EDGE = [
    [(505, 330), (560, 332), (568, 360), (552, 392), (566, 424), (548, 470), (500, 476), (496, 420)],
    [(560, 332), (612, 336), (604, 372), (620, 404), (598, 446), (566, 470), (548, 470), (566, 424), (552, 392), (568, 360)],
    [(612, 336), (690, 345), (690, 384), (672, 426), (628, 436), (598, 446), (620, 404), (604, 372)],
]
# City side, left to right, cut where splintered planks already are.
RIGHT_CHUNKS = [
    [(900, 150), (1068, 150), (1060, 262), (1072, 330), (1050, 402), (1068, 470), (1040, 520), (900, 520)],
    [(1068, 150), (1262, 150), (1250, 300), (1268, 360), (1244, 430), (1262, 500), (1250, 560), (1068, 560),
     (1040, 520), (1068, 470), (1050, 402), (1072, 330), (1060, 262)],
    [(1262, 0), (1536, 0), (1536, 658), (1250, 658), (1250, 560), (1262, 500), (1244, 430), (1268, 360), (1250, 300)],
    [(1068, 0), (1262, 0), (1262, 150), (1068, 150)],
    [(900, 0), (1068, 0), (1068, 150), (900, 150)],
]
CRATE = [(925, 470), (1115, 470), (1115, 640), (925, 640)]
# A barrel from the city side, copied as loose cargo for the ship's rolling deck.
BARREL = [(1138, 248), (1236, 248), (1236, 348), (1138, 348)]


def poly_mask(size, poly):
    m = Image.new("L", size, 0)
    ImageDraw.Draw(m).polygon(poly, fill=255)
    return np.array(m) > 0


def band_mask(size, pts, half):
    m = Image.new("L", size, 0)
    d = ImageDraw.Draw(m)
    d.line(pts, fill=255, width=int(half * 2), joint="curve")
    for p in pts:
        d.ellipse((p[0] - half, p[1] - half, p[0] + half, p[1] + half), fill=255)
    return np.array(m) > 0


def save_part(rgba, mask, name, parts, anchor=None):
    a = rgba.copy()
    a[..., 3] = np.where(mask, a[..., 3], 0)
    ys, xs = np.nonzero(a[..., 3] > 4)
    if len(xs) == 0:
        raise SystemExit(f"empty part {name}")
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    img = Image.fromarray(a[y0:y1, x0:x1])
    img.save(os.path.join(OUT, f"{name}.webp"), "WEBP", quality=88, method=6, exact=False)
    parts[name] = {"x": int(x0), "y": int(y0), "w": int(x1 - x0), "h": int(y1 - y0)}
    if anchor:
        parts[name]["anchor"] = anchor
    return img


def rope_tile(rgba):
    """
    A straight rope tile for live ropes. Sampling the painted rope carried
    background into its edges and read as beads when tiled, so the tile is a
    shaded, gently twisted strand in the painted ropes' own colours instead.
    """
    del rgba
    W, H = 96, 16
    y = np.arange(H)[:, None] / (H - 1)
    x = np.arange(W)[None, :]
    r = np.abs(y - 0.5) * 2
    shade = np.clip(1.0 - r ** 1.8, 0, 1)
    twist = 0.5 + 0.5 * np.sin((x / 9.0 + y * 1.6) * 2 * np.pi)
    base = np.array([150, 104, 60], float)
    dark = np.array([74, 48, 26], float)
    light = np.array([214, 170, 112], float)
    col = dark[None, None, :] * (1 - shade[..., None]) + base[None, None, :] * shade[..., None]
    col = col * (0.86 + 0.14 * twist[..., None])
    hi = np.clip(1 - np.abs(y - 0.32) * 6, 0, 1) * 0.35
    col = col * (1 - hi[..., None]) + light[None, None, :] * hi[..., None]
    alpha = np.clip((1 - r) * 3.2, 0, 1) * 255
    img = Image.fromarray(np.dstack([np.clip(col, 0, 255), np.broadcast_to(alpha, (H, W))]).astype(np.uint8))
    img.save(os.path.join(OUT, "span-rope.webp"), "WEBP", quality=92)
    return img


def main():
    os.makedirs(OUT, exist_ok=True)
    im = Image.open(SRC).convert("RGBA")
    size = im.size
    rgba = np.array(im)
    ring = poly_mask(size, RING)
    tethers = np.zeros(size[::-1], bool)
    for run in LEFT_TETHER + RIGHT_TETHER:
        tethers |= band_mask(size, run, 11)
    edge = np.zeros(size[::-1], bool)
    for poly in LEFT_EDGE:
        edge |= poly_mask(size, poly)
    parts = {}
    xs = np.arange(size[0])[None, :].repeat(size[1], 0)
    left = (xs < 720) & ~ring & ~tethers & ~edge
    save_part(rgba, left, "span-left", parts)
    for i, poly in enumerate(LEFT_EDGE):
        save_part(rgba, poly_mask(size, poly) & ~ring & ~tethers, f"span-left-edge-{i + 1}", parts)
    crate = poly_mask(size, CRATE)
    for i, poly in enumerate(RIGHT_CHUNKS):
        m = poly_mask(size, poly) & ~ring & ~tethers & (xs >= 880)
        if i == 0:
            m &= ~crate
        save_part(rgba, m, f"span-right-{i + 1}", parts)
    save_part(rgba, crate & (xs >= 880), "span-crate", parts)
    save_part(rgba, ring & (xs >= 590), "span-ring", parts)
    save_part(rgba, poly_mask(size, BARREL), "span-barrel", parts)
    rope_tile(rgba)
    parts["ringCenter"] = {"x": 770, "y": 297}
    parts["leftPulley"] = {"x": 452, "y": 180}
    parts["rightPulley"] = {"x": 1070, "y": 184}
    parts["leftStrap"] = {"x": 600, "y": 266}
    parts["rightStrap"] = {"x": 952, "y": 246}
    json.dump({"source": "broken-span-tether-ring.webp", "size": list(size), "parts": parts},
              open(os.path.join(OUT, "span-parts.json"), "w"), indent=1)
    print(json.dumps(parts))


if __name__ == "__main__":
    main()
