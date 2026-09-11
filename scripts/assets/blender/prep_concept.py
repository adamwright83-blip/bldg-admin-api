#!/usr/bin/env python3
"""
Concept image -> image-to-3D input.

Image-to-3D fails in predictable ways, and most of them are fixable in the
source image rather than in the mesh afterwards. This does the fixable ones and
reports honestly on the ones it cannot fix.

    python3 prep_concept.py in.png --out-dir artifacts/rook --id rook
"""
import argparse, json, os, sys
from PIL import Image, ImageFilter


def strip_background(im, tol=26, sat_max=14):
    """
    Flood the outer background to transparent, following a gradient.

    Gradients and cast shadows bake into geometry, so they have to go. The naive
    version of this compared every pixel against a fixed corner colour, which on a
    smooth studio gradient stops dead at the tolerance isoline and leaves a bright
    arc of background stuck to the subject. It looked like wings.

    So the test is LOCAL: a pixel joins the background if it is close to the pixel
    the flood arrived from. That tracks an arbitrarily long gradient. Two guards
    stop it leaking into the character:

      - saturation. Studio backdrops are near-grey; this subject is saturated
        green and red. A pixel above `sat_max` chroma is never background. That threshold must sit well BELOW the
        subject's least saturated part: at 42 it ate this character's olive tail
        highlights, whose chroma runs lower than the body green.
      - connectivity to the border, so an enclosed pocket of background-coloured
        pixels inside the character survives.
    """
    im = im.convert("RGBA")
    w, h = im.size
    px = im.load()
    seen = bytearray(w * h)
    stack = [(x, 0) for x in range(0, w, 2)] + [(x, h - 1) for x in range(0, w, 2)] \
          + [(0, y) for y in range(0, h, 2)] + [(w - 1, y) for y in range(0, h, 2)]
    stack = [(x, y, px[x, y][:3]) for (x, y) in stack]
    hits = 0
    while stack:
        x, y, came_from = stack.pop()
        if x < 0 or y < 0 or x >= w or y >= h:
            continue
        i = y * w + x
        if seen[i]:
            continue
        r, g, b, a = px[x, y]
        if max(r, g, b) - min(r, g, b) > sat_max:      # saturated: this is the subject
            continue
        if abs(r - came_from[0]) + abs(g - came_from[1]) + abs(b - came_from[2]) > tol * 3:
            continue
        seen[i] = 1
        px[x, y] = (r, g, b, 0)
        hits += 1
        here = (r, g, b)
        stack.extend(((x + 1, y, here), (x - 1, y, here), (x, y + 1, here), (x, y - 1, here)))
    return im, hits


def despeckle(im, min_px=24):
    """
    Drop stray opaque islands left by soft edges and shadow residue.

    The island count is the signal for whether limbs are fused, so it is only
    meaningful once speckle is gone. Removes small islands, keeps real detached
    detail like hanging charms.
    """
    a = im.split()[3]
    w, h = im.size
    px = a.load()
    seen = [[False] * h for _ in range(w)]
    removed = 0
    op = im.load()
    for sy in range(h):
        for sx in range(w):
            if seen[sx][sy] or px[sx, sy] <= 128:
                continue
            stack, cells = [(sx, sy)], []
            while stack:
                x, y = stack.pop()
                if x < 0 or y < 0 or x >= w or y >= h or seen[x][y] or px[x, y] <= 128:
                    continue
                seen[x][y] = True
                cells.append((x, y))
                stack.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
            if len(cells) < min_px:
                for (x, y) in cells:
                    r, g, b, _ = op[x, y]
                    op[x, y] = (r, g, b, 0)
                removed += 1
    return im, removed


def trim_and_pad(im, margin=0.08):
    """Centre the subject with even margin. Reconstruction wants the whole body framed."""
    bbox = im.getbbox()
    if not bbox:
        return im, None
    sub = im.crop(bbox)
    side = int(max(sub.size) * (1 + margin * 2))
    out = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    out.paste(sub, ((side - sub.width) // 2, (side - sub.height) // 2))
    return out, bbox


def on_flat(im, rgb=(242, 242, 242)):
    """Image-to-3D wants a flat plate, not transparency."""
    bg = Image.new("RGBA", im.size, rgb + (255,))
    bg.alpha_composite(im)
    return bg.convert("RGB")


def silhouette(im, size=48):
    a = im.split()[3].resize((size, size), Image.LANCZOS)
    out = Image.new("RGBA", (size, size), (255, 255, 255, 255))
    out.putalpha(a)
    return out


def report(im):
    """What the cutout can and cannot tell us about reconstruction risk."""
    a = im.split()[3]
    w, h = im.size
    px = a.load()
    cover = sum(1 for y in range(0, h, 2) for x in range(0, w, 2) if px[x, y] > 128)
    cover = cover * 4 / (w * h)
    # Count separate opaque islands on a coarse grid. One island means every limb
    # touches the body, which is exactly what fuses during reconstruction.
    step = max(1, min(w, h) // 120)
    grid = {(x, y) for y in range(0, h, step) for x in range(0, w, step) if px[x, y] > 128}
    islands, seen = 0, set()
    for cell in grid:
        if cell in seen:
            continue
        islands += 1
        stack = [cell]
        while stack:
            c = stack.pop()
            if c in seen:
                continue
            seen.add(c)
            for d in ((step, 0), (-step, 0), (0, step), (0, -step)):
                n = (c[0] + d[0], c[1] + d[1])
                if n in grid and n not in seen:
                    stack.append(n)
    return {"coverage": round(cover, 3), "opaque_islands": islands}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--id", required=True)
    ap.add_argument("--tol", type=int, default=26)
    a = ap.parse_args()
    os.makedirs(a.out_dir, exist_ok=True)

    src = Image.open(a.image).convert("RGBA")
    cut, removed = strip_background(src, a.tol)
    cut, speckles = despeckle(cut)
    framed, bbox = trim_and_pad(cut)
    plate = on_flat(framed)

    paths = {
        "cutout": os.path.join(a.out_dir, f"{a.id}-cutout.png"),
        "trellis_input": os.path.join(a.out_dir, f"{a.id}-trellis-input.png"),
        "silhouette": os.path.join(a.out_dir, f"{a.id}-silhouette-48.png"),
    }
    framed.save(paths["cutout"])
    plate.save(paths["trellis_input"])
    silhouette(framed).resize((192, 192), Image.NEAREST).save(paths["silhouette"])

    meta = {"id": a.id, "source": os.path.basename(a.image),
            "source_size": list(src.size), "output_size": list(framed.size),
            "background_px_removed": removed, "speckle_islands_removed": speckles, "source_bbox": bbox,
            **report(framed), "files": paths}
    with open(os.path.join(a.out_dir, f"{a.id}-prep.json"), "w") as fh:
        json.dump(meta, fh, indent=1)
    print("PREP " + json.dumps(meta))


if __name__ == "__main__":
    main()
