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


def strip_background(im, tol=34):
    """
    Flood the outer background to transparent from the four corners.

    Gradients and cast shadows get baked in as geometry, so they have to go. A
    corner flood is used rather than a colour key because the subject may share
    hues with the backdrop; only background CONNECTED to the border is removed,
    so an enclosed pocket of similar colour inside the character survives.
    """
    im = im.convert("RGBA")
    w, h = im.size
    px = im.load()
    seeds = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]
    ref = [px[s][:3] for s in seeds]
    seen = bytearray(w * h)
    stack = list(seeds)
    hits = 0
    while stack:
        x, y = stack.pop()
        if x < 0 or y < 0 or x >= w or y >= h:
            continue
        i = y * w + x
        if seen[i]:
            continue
        r, g, b, a = px[x, y]
        if not any(abs(r - c[0]) + abs(g - c[1]) + abs(b - c[2]) <= tol * 3 for c in ref):
            continue
        seen[i] = 1
        px[x, y] = (r, g, b, 0)
        hits += 1
        stack.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
    return im, hits


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
    ap.add_argument("--tol", type=int, default=34)
    a = ap.parse_args()
    os.makedirs(a.out_dir, exist_ok=True)

    src = Image.open(a.image).convert("RGBA")
    cut, removed = strip_background(src, a.tol)
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
            "background_px_removed": removed, "source_bbox": bbox,
            **report(framed), "files": paths}
    with open(os.path.join(a.out_dir, f"{a.id}-prep.json"), "w") as fh:
        json.dump(meta, fh, indent=1)
    print("PREP " + json.dumps(meta))


if __name__ == "__main__":
    main()
