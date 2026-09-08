#!/usr/bin/env python3
"""
Master-world-derived territory state art for Lantern City V6.

For territories whose supplied bespoke art conflicted with the painterly
master board (a standalone photograph, a mismatched camera, a checkerboard
export defect), this generates all four states directly from the exact
registered crop of client/public/assets/goldline/lantern-city/v6/world-neutral.png
at that territory's authored stateArtBounds. Because the source pixels are
literally sampled from the spot on the board where they will be recomposited,
geography, camera, roads and buildings are identical across all four states
by construction — there is no way for a camera-angle or skyline mismatch to
occur.

Seam-safety: each state's transformed RGB is blended back toward the
UNTRANSFORMED base crop as a function of distance from center (full
transform in the interior, ~0% transform at the perimeter), and only then
does alpha feather to 0. So at the very edge, both RGB and alpha converge to
"invisible" — not just alpha alone.

Usage: python3 scripts/generate-lantern-city-v6-derived-territory-art.py
"""
import json
from pathlib import Path
from PIL import Image
import numpy as np
import colorsys

REPO_ROOT = Path(__file__).resolve().parents[1]
BASE_PATH = REPO_ROOT / "client/public/assets/goldline/lantern-city/v6/world-neutral.png"
DEST_ROOT = REPO_ROOT / "client/public/assets/goldline/lantern-city/v6/territories"

WORLD_W, WORLD_H = 3840, 2160
TARGET_W, TARGET_H = 1536, 994
FEATHER_MARGIN_FRAC = 0.09

# territory: stateArtBounds (x,y,width,height) percent of world stage —
# copied verbatim from territoryPresentation.ts's district() calls.
STATE_ART_BOUNDS = {
    "west-hollywood": (23, 24, 20, 23),
    "beverly-hills": (4, 31, 20, 23),
    "los-feliz": (59, 15, 20, 23),
    "silver-lake": (68, 33, 20, 23),
    "east-hollywood": (53, 34, 20, 23),
    "mid-city": (28, 62, 20, 23),
    "echo-park": (70, 52, 20, 23),
    "downtown": (56, 63, 20, 23),
    "westlake": (50, 52, 20, 23),
    "arts-district": (75, 67, 20, 23),
    "hollywood-hills-west": (22, 8, 20, 23),
}
STATES = ["healthy", "cooling", "infested", "locked"]


def smoothstep_np(edge0, edge1, x):
    t = np.clip((x - edge0) / (edge1 - edge0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def build_feather_and_blend(w, h, margin_frac):
    """Returns (alpha_mask[h,w] 0..1, blend_mask[h,w] 0..1).
    alpha_mask: 0 at the outer edge, 1 through most of the interior.
    blend_mask: how much of the transform to apply — 0 at edge (pure base
    RGB), 1 in the interior — using a slightly larger margin than alpha so
    the RGB itself visibly relaxes toward the base before alpha even starts
    cutting in, exactly per the seam-safe requirement.
    """
    margin_x = w * margin_frac
    margin_y = h * margin_frac
    xs = np.arange(w, dtype=np.float64)
    ys = np.arange(h, dtype=np.float64)
    fx = smoothstep_np(0, margin_x, xs) * smoothstep_np(0, margin_x, (w - 1) - xs)
    fy = smoothstep_np(0, margin_y, ys) * smoothstep_np(0, margin_y, (h - 1) - ys)
    alpha_mask = fy[:, None] * fx[None, :]

    blend_margin_x = w * (margin_frac * 1.8)
    blend_margin_y = h * (margin_frac * 1.8)
    bx = smoothstep_np(0, blend_margin_x, xs) * smoothstep_np(0, blend_margin_x, (w - 1) - xs)
    by = smoothstep_np(0, blend_margin_y, ys) * smoothstep_np(0, blend_margin_y, (h - 1) - ys)
    blend_mask = by[:, None] * bx[None, :]
    return alpha_mask, blend_mask


def rgb_to_hsv_np(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    maxc = np.max(rgb, axis=-1)
    minc = np.min(rgb, axis=-1)
    v = maxc
    delta = maxc - minc
    s = np.where(maxc == 0, 0, delta / np.maximum(maxc, 1e-6))
    delta_safe = np.where(delta == 0, 1, delta)
    rc = (maxc - r) / delta_safe
    gc = (maxc - g) / delta_safe
    bc = (maxc - b) / delta_safe
    h = np.zeros_like(maxc)
    h = np.where(maxc == r, bc - gc, h)
    h = np.where(maxc == g, 2.0 + rc - bc, h)
    h = np.where(maxc == b, 4.0 + gc - rc, h)
    h = (h / 6.0) % 1.0
    h = np.where(delta == 0, 0, h)
    return np.stack([h, s, v], axis=-1)


def hsv_to_rgb_np(hsv):
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    i = np.floor(h * 6.0)
    f = h * 6.0 - i
    p = v * (1.0 - s)
    q = v * (1.0 - s * f)
    t = v * (1.0 - s * (1.0 - f))
    i = i.astype(int) % 6
    conditions = [i == k for k in range(6)]
    r = np.select(conditions, [v, q, p, p, t, v])
    g = np.select(conditions, [t, v, v, q, p, p])
    b = np.select(conditions, [p, p, t, v, v, q])
    return np.stack([r, g, b], axis=-1)


def make_grime_texture(w: int, h: int, seed: int, strength: float) -> np.ndarray:
    """Low-frequency patchy multiplier in [1-strength, 1] for a neglected,
    unevenly-decayed look — real generated texture, not a flat filter."""
    rng = np.random.default_rng(seed)
    small = rng.random((h // 24 + 2, w // 24 + 2))
    tex = np.array(Image.fromarray((small * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC), dtype=np.float64) / 255.0
    return 1.0 - strength * tex


def apply_state_transform(rgb01: np.ndarray, state: str, seed: int = 0) -> np.ndarray:
    hsv = rgb_to_hsv_np(rgb01)
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    if state == "healthy":
        v = np.clip(v * 1.08 + 0.03, 0, 1)
        s = np.clip(s * 1.18, 0, 1)
        h = (h + 0.01) % 1.0  # nudge slightly warm
    elif state == "cooling":
        v = np.clip(v * 0.62, 0, 1)
        s = np.clip(s * 0.40, 0, 1)
        h = (h + 0.035) % 1.0  # amber/dusk nudge
    elif state == "infested":
        v = np.clip(v * 0.40, 0, 1)
        s = np.clip(s * 0.18, 0, 1)
        # olive/gray push: pull hue toward ~0.22 (olive).
        target = 0.22
        h = h + (target - h) * 0.55
        h = h % 1.0
    elif state == "locked":
        v = np.clip(v * 0.28, 0, 1)
        s = np.clip(s * 0.45, 0, 1)
        target = 0.62  # cool blue
        h = h + (target - h) * 0.55
        h = h % 1.0
    hsv2 = np.stack([h, s, v], axis=-1)
    out = hsv_to_rgb_np(hsv2)
    out = np.clip(out, 0, 1)
    if state == "infested":
        grime = make_grime_texture(rgb01.shape[1], rgb01.shape[0], seed, strength=0.4)
        out = np.clip(out * grime[..., None], 0, 1)
    return out


def add_locked_beacons(rgb01: np.ndarray, seed: int) -> np.ndarray:
    """Deterministic small red warning-glow accents for the locked state,
    scattered across the interior — not a single dominant lock icon (that
    stays a separate runtime object)."""
    rng = np.random.default_rng(seed)
    h, w = rgb01.shape[:2]
    out = rgb01.copy()
    n = 6
    yy, xx = np.mgrid[0:h, 0:w]
    for _ in range(n):
        cx = rng.uniform(0.15, 0.85) * w
        cy = rng.uniform(0.15, 0.85) * h
        radius = rng.uniform(0.02, 0.045) * min(w, h)
        d2 = (xx - cx) ** 2 + (yy - cy) ** 2
        glow = np.exp(-d2 / (2 * radius * radius))
        out[..., 0] = np.clip(out[..., 0] + glow * 0.55, 0, 1)
        out[..., 1] = np.clip(out[..., 1] - glow * 0.05, 0, 1)
        out[..., 2] = np.clip(out[..., 2] - glow * 0.05, 0, 1)
    return out


def generate_territory(territory: str, bounds: tuple[int, int, int, int], base: Image.Image):
    px, py, pw, ph = bounds
    x = round(px / 100 * WORLD_W)
    y = round(py / 100 * WORLD_H)
    w = round(pw / 100 * WORLD_W)
    h = round(ph / 100 * WORLD_H)
    crop = base.crop((x, y, x + w, y + h)).convert("RGB")
    crop = crop.resize((TARGET_W, TARGET_H), Image.LANCZOS)
    base_rgb01 = np.asarray(crop, dtype=np.float64) / 255.0

    alpha_mask, blend_mask = build_feather_and_blend(TARGET_W, TARGET_H, FEATHER_MARGIN_FRAC)

    dest_dir = DEST_ROOT / territory
    dest_dir.mkdir(parents=True, exist_ok=True)

    results = []
    for i, state in enumerate(STATES):
        transformed = apply_state_transform(base_rgb01, state, seed=hash((territory, state, "grime")) & 0xFFFFFFFF)
        if state == "locked":
            transformed = add_locked_beacons(transformed, seed=hash((territory, state)) & 0xFFFFFFFF)
        blend = blend_mask[..., None]
        final_rgb01 = base_rgb01 * (1 - blend) + transformed * blend
        final_rgb = np.clip(final_rgb01 * 255.0, 0, 255).astype(np.uint8)
        alpha = np.clip(alpha_mask * 255.0, 0, 255).astype(np.uint8)
        rgba = np.dstack([final_rgb, alpha])
        img = Image.fromarray(rgba, mode="RGBA")
        dest_path = dest_dir / f"{state}.png"
        img.save(dest_path, "PNG")
        results.append((state, dest_path))
    return results


def main():
    base = Image.open(BASE_PATH).convert("RGB")
    all_results = []
    for territory, bounds in STATE_ART_BOUNDS.items():
        results = generate_territory(territory, bounds, base)
        for state, path in results:
            print(f"generated {territory}/{state} -> {path}")
            all_results.append({"territory": territory, "state": state, "path": str(path)})
    print(f"Generated {len(all_results)} derived state images across {len(STATE_ART_BOUNDS)} territories.")


if __name__ == "__main__":
    main()
