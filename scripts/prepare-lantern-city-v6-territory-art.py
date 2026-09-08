#!/usr/bin/env python3
"""
Deterministic asset preparation for Lantern City V6 territory-state art.

Takes the 44 supplied source images (11 territories x 4 states), normalizes
each to the V6 production plate size (1536x994 RGBA) via a center/cover crop
(never distorting aspect ratio), and applies the same seam-safe feather
technique proven by Hollywood Locked V4: a fully opaque interior fading
smoothly to alpha 0 at the perimeter, with rounded (not rectangular) corners
so the plate integrates into the master board instead of reading as a pasted
screenshot. This is asset preparation, not a runtime CSS hack.

Usage: python3 scripts/prepare-lantern-city-v6-territory-art.py
"""
import json
import hashlib
from pathlib import Path
from PIL import Image
import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = REPO_ROOT / "artifacts" / "_scratch-not-committed"  # overridden by caller via SOURCE_DIR env
DEST_ROOT = REPO_ROOT / "client" / "public" / "assets" / "goldline" / "lantern-city" / "v6" / "territories"
REPORT_PATH = REPO_ROOT / "artifacts" / "lantern-city-v6-full-art-qa" / "asset-report.json"

TARGET_W, TARGET_H = 1536, 994
FEATHER_MARGIN_FRAC = 0.09  # calibrated to reproduce Hollywood V4's ~70.6% opaque interior

TERRITORIES = [
    "koreatown", "century-city", "beverly-hills", "west-hollywood", "hollywood",
    "los-feliz", "silver-lake", "east-hollywood", "mid-city", "echo-park", "downtown",
]
STATES = ["healthy", "cooling", "infested", "locked"]


def smoothstep(edge0: float, edge1: float, x: float) -> float:
    if edge1 == edge0:
        return 1.0 if x >= edge1 else 0.0
    t = max(0.0, min(1.0, (x - edge0) / (edge1 - edge0)))
    return t * t * (3 - 2 * t)


def center_cover_crop(img: Image.Image, target_w: int, target_h: int) -> Image.Image:
    src_w, src_h = img.size
    target_aspect = target_w / target_h
    src_aspect = src_w / src_h
    if src_aspect > target_aspect:
        # source is wider than target: crop left/right
        new_w = round(src_h * target_aspect)
        x0 = (src_w - new_w) // 2
        box = (x0, 0, x0 + new_w, src_h)
    else:
        # source is taller than target: crop top/bottom
        new_h = round(src_w / target_aspect)
        y0 = (src_h - new_h) // 2
        box = (0, y0, src_w, y0 + new_h)
    cropped = img.crop(box)
    return cropped.resize((target_w, target_h), Image.LANCZOS)


def smoothstep_np(edge0: float, edge1: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - edge0) / (edge1 - edge0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def build_feather_mask(w: int, h: int, margin_frac: float) -> Image.Image:
    margin_x = w * margin_frac
    margin_y = h * margin_frac
    xs = np.arange(w, dtype=np.float64)
    ys = np.arange(h, dtype=np.float64)
    fx = smoothstep_np(0, margin_x, xs) * smoothstep_np(0, margin_x, (w - 1) - xs)
    fy = smoothstep_np(0, margin_y, ys) * smoothstep_np(0, margin_y, (h - 1) - ys)
    grid = fy[:, None] * fx[None, :]
    arr = np.round(255 * grid).astype(np.uint8)
    return Image.fromarray(arr, mode="L")


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    h.update(path.read_bytes())
    return h.hexdigest()


def main(source_dir: Path):
    report = []
    seen_hashes: dict[str, str] = {}
    failures = []

    feather_cache: dict[tuple[int, int], Image.Image] = {}

    for territory in TERRITORIES:
        for state in STATES:
            src_name = f"{territory}-{state}.png"
            src_path = source_dir / src_name
            entry = {
                "territory": territory,
                "state": state,
                "sourceFilename": src_name,
                "productionPath": f"/assets/goldline/lantern-city/v6/territories/{territory}/{state}.png",
            }
            if not src_path.exists():
                entry["status"] = "MISSING_SOURCE"
                failures.append(entry)
                report.append(entry)
                continue
            if src_path.stat().st_size == 0:
                entry["status"] = "ZERO_BYTE_SOURCE"
                failures.append(entry)
                report.append(entry)
                continue

            digest = sha256_of(src_path)
            if digest in seen_hashes:
                entry["status"] = f"DUPLICATE_OF:{seen_hashes[digest]}"
                failures.append(entry)
                report.append(entry)
                continue
            seen_hashes[digest] = src_name

            img = Image.open(src_path).convert("RGBA")
            prepared = center_cover_crop(img, TARGET_W, TARGET_H)

            key = (TARGET_W, TARGET_H)
            if key not in feather_cache:
                feather_cache[key] = build_feather_mask(TARGET_W, TARGET_H, FEATHER_MARGIN_FRAC)
            mask = feather_cache[key]

            # Some sources already carry a real (sometimes fringed/matted)
            # alpha shape from a prior export — e.g. an "island cutout" on a
            # black canvas. Discarding that source alpha and trusting only
            # our own feather mask would let that black canvas and its
            # color-fringed edge show through as opaque content. Instead we
            # take the minimum of our feather mask and the source's own
            # alpha at every pixel: a fully-opaque source (the common case)
            # is unaffected, but a source with its own transparent/fringed
            # region stays suppressed there too.
            r, g, b, src_a = prepared.split()
            mask_arr = np.asarray(mask, dtype=np.int16)
            src_a_arr = np.asarray(src_a, dtype=np.int16)
            combined_arr = np.minimum(mask_arr, src_a_arr)
            # Kill straggler near-transparent fringe pixels outright rather
            # than let their (often color-contaminated) RGB show through at
            # a faint but visible alpha.
            combined_arr[src_a_arr < 25] = 0
            combined = Image.fromarray(combined_arr.astype(np.uint8), mode="L")
            prepared = Image.merge("RGBA", (r, g, b, combined))

            dest_dir = DEST_ROOT / territory
            dest_dir.mkdir(parents=True, exist_ok=True)
            dest_path = dest_dir / f"{state}.png"
            prepared.save(dest_path, "PNG")

            alphas = list(prepared.getdata(3))
            total = len(alphas)
            # "meaningful interior" = near-opaque, not exactly 255 — a
            # source whose own alpha channel carries a soft interior
            # vignette (rather than a hard cutout) can legitimately never
            # hit pure 255 while still reading as fully solid.
            opaque = sum(1 for v in alphas if v >= 200)
            transparent = sum(1 for v in alphas if v == 0)
            # perimeter check: sample the outer ring
            perimeter_vals = []
            for x in range(0, TARGET_W, 8):
                perimeter_vals.append(prepared.getpixel((x, 0))[3])
                perimeter_vals.append(prepared.getpixel((x, TARGET_H - 1))[3])
            for y in range(0, TARGET_H, 8):
                perimeter_vals.append(prepared.getpixel((0, y))[3])
                perimeter_vals.append(prepared.getpixel((TARGET_W - 1, y))[3])
            center_alpha = prepared.getpixel((TARGET_W // 2, TARGET_H // 2))[3]

            entry.update({
                "status": "OK",
                "sourceWidth": img.size[0],
                "sourceHeight": img.size[1],
                "sourceMode": img.mode,
                "sourceSha256": digest,
                "width": prepared.size[0],
                "height": prepared.size[1],
                "mode": prepared.mode,
                "alphaMin": min(alphas),
                "alphaMax": max(alphas),
                "perimeterAlphaMax": max(perimeter_vals),
                "opaquePixelPct": round(100 * opaque / total, 2),
                "transparentPixelPct": round(100 * transparent / total, 2),
                "centerAlpha": center_alpha,
                "fileSizeBytes": dest_path.stat().st_size,
            })
            if prepared.size != (TARGET_W, TARGET_H):
                entry["status"] = "WRONG_DIMENSIONS"
                failures.append(entry)
            elif prepared.mode != "RGBA":
                entry["status"] = "NOT_RGBA"
                failures.append(entry)
            elif max(perimeter_vals) > 40:
                entry["status"] = "PERIMETER_NOT_TRANSPARENT"
                failures.append(entry)
            elif entry["opaquePixelPct"] < 20:
                entry["status"] = "NO_MEANINGFUL_OPAQUE_INTERIOR"
                failures.append(entry)
            report.append(entry)

    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(json.dumps({
        "generatedBy": "scripts/prepare-lantern-city-v6-territory-art.py",
        "targetDimensions": {"width": TARGET_W, "height": TARGET_H},
        "featherMarginFrac": FEATHER_MARGIN_FRAC,
        "expectedCount": len(TERRITORIES) * len(STATES),
        "actualCount": len(report),
        "failureCount": len(failures),
        "failures": failures,
        "entries": report,
    }, indent=2))

    print(f"Processed {len(report)} entries, {len(failures)} failures.")
    if failures:
        for f in failures:
            print("FAIL:", f["territory"], f["state"], f["status"])
    return len(failures)


if __name__ == "__main__":
    import sys
    import os
    source_dir = Path(os.environ.get("SOURCE_DIR", str(SOURCE_DIR)))
    rc = main(source_dir)
    sys.exit(1 if rc else 0)
