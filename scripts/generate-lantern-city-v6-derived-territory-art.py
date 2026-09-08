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

SHAPE: the alpha is not a rounded rectangle. It is built from the real,
already-registered neighborhood silhouette mask committed at
client/public/assets/admin/control-room/world/territories-v2/masks/<id>.png
(a proper anti-aliased coverage mask, not a binary cutout — see
shared/territoryMaskPackage.ts). The mask is contain-fit (its own aspect
ratio preserved, never stretched) and centered inside the badge canvas, then
heavily blurred, so the plate reads as "this real neighborhood went dark"
rather than "a rectangle got pasted here."

Seam-safety: each state's transformed RGB is blended back toward the
UNTRANSFORMED base crop using a STEEPER falloff than the alpha channel
itself (blend = alpha_field ** BLEND_EXPONENT), so the interior fully
transforms, the RGB visibly relaxes toward the base well before the edge,
and only then does alpha finish fading to 0. At the very edge, both RGB and
alpha converge to "invisible" — not just alpha alone.

Usage: python3 scripts/generate-lantern-city-v6-derived-territory-art.py
"""
from pathlib import Path
from PIL import Image, ImageFilter
import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[1]
BASE_PATH = REPO_ROOT / "client/public/assets/goldline/lantern-city/v6/world-neutral.png"
DEST_ROOT = REPO_ROOT / "client/public/assets/goldline/lantern-city/v6/territories"
MASK_ROOT = REPO_ROOT / "client/public/assets/admin/control-room/world/territories-v2/masks"

WORLD_W, WORLD_H = 3840, 2160
TARGET_W, TARGET_H = 1536, 994
MASK_BLUR_FRAC = 0.045  # gaussian blur radius as a fraction of canvas width
BLEND_EXPONENT = 2.6  # blend (RGB relax) shrinks faster than alpha (visibility)
MASK_INSET_FRAC = 0.08  # shrink the contain-fit mask inward so its own edge
# never touches the canvas edge — guarantees room for the blur to fully
# resolve to 0 before the badge's own bounding box, matching the seam-safe
# lesson from Hollywood Locked V4.

# territory: stateArtBounds (x,y,width,height) percent of world stage —
# copied verbatim from territoryPresentation.ts's district() calls. This is
# the RENDER position/size (unchanged) — only the alpha SHAPE within it
# changes, from a rounded rectangle to the real neighborhood silhouette.
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
    # Hollywood was the worst-offending bespoke plate (a standalone painted
    # ruins scene with almost no feather, reading as a hard dark rectangle
    # on the board). Converting it to the same derived+masked method as
    # every other territory makes the whole board consistent.
    "hollywood": (40, 11, 20, 23),
}
STATES = ["healthy", "cooling", "infested", "locked"]


def load_real_mask(territory: str, canvas_w: int, canvas_h: int) -> np.ndarray:
    """The real, already-registered neighborhood silhouette (grayscale
    coverage mask, 0=outside .. 255=inside), COVER-fit into the badge
    canvas (scaled so it fully fills the inset frame, center-cropping
    whichever axis overflows) and centered, then inset so its own edge
    never touches the canvas boundary. Real neighborhoods span every
    aspect ratio from tall (downtown, arts-district) to wide (mid-city);
    contain-fit would shrink a tall mask to a thin sliver with mostly
    empty padding on a fixed-aspect badge, reading as "barely there" —
    cover-fit keeps every territory's badge consistently legible while
    still following that territory's own real local silhouette in the
    visible crop, not a rectangle."""
    mask_path = MASK_ROOT / f"{territory}.png"
    mask = Image.open(mask_path).convert("L")
    mw, mh = mask.size

    inset_w = canvas_w * (1 - 2 * MASK_INSET_FRAC)
    inset_h = canvas_h * (1 - 2 * MASK_INSET_FRAC)
    scale = max(inset_w / mw, inset_h / mh)
    fit_w = max(1, round(mw * scale))
    fit_h = max(1, round(mh * scale))
    resized = mask.resize((fit_w, fit_h), Image.LANCZOS)
    # center-crop the resized mask down to the inset frame
    crop_x = max(0, (fit_w - round(inset_w)) // 2)
    crop_y = max(0, (fit_h - round(inset_h)) // 2)
    resized = resized.crop((crop_x, crop_y, crop_x + round(inset_w), crop_y + round(inset_h)))

    canvas = Image.new("L", (canvas_w, canvas_h), 0)
    ox = (canvas_w - resized.size[0]) // 2
    oy = (canvas_h - resized.size[1]) // 2
    canvas.paste(resized, (ox, oy))
    return np.asarray(canvas, dtype=np.float64) / 255.0


def build_alpha_and_blend(territory: str, w: int, h: int):
    raw = load_real_mask(territory, w, h)
    blur_radius = w * MASK_BLUR_FRAC
    blurred = Image.fromarray((raw * 255).astype(np.uint8), mode="L").filter(
        ImageFilter.GaussianBlur(radius=blur_radius)
    )
    alpha_field = np.asarray(blurred, dtype=np.float64) / 255.0
    blend_field = alpha_field ** BLEND_EXPONENT
    return alpha_field, blend_field


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
    """Commercially-toned state grading — noticeably distinct from healthy,
    but roughly half the intensity of an earlier pass that read as a heavy
    dark field doing all the storytelling on its own. Detail (grime
    texture, beacons) carries more of the read than raw darkness now."""
    hsv = rgb_to_hsv_np(rgb01)
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    if state == "healthy":
        v = np.clip(v * 1.08 + 0.03, 0, 1)
        s = np.clip(s * 1.18, 0, 1)
        h = (h + 0.01) % 1.0  # nudge slightly warm
    elif state == "cooling":
        v = np.clip(v * 0.78, 0, 1)
        s = np.clip(s * 0.62, 0, 1)
        h = (h + 0.03) % 1.0  # amber/dusk nudge
    elif state == "infested":
        v = np.clip(v * 0.62, 0, 1)
        s = np.clip(s * 0.42, 0, 1)
        # olive/gray push: pull hue toward ~0.22 (olive).
        target = 0.22
        h = h + (target - h) * 0.32
        h = h % 1.0
    elif state == "locked":
        v = np.clip(v * 0.52, 0, 1)
        s = np.clip(s * 0.55, 0, 1)
        target = 0.62  # cool blue
        h = h + (target - h) * 0.32
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

    alpha_field, blend_field = build_alpha_and_blend(territory, TARGET_W, TARGET_H)

    dest_dir = DEST_ROOT / territory
    dest_dir.mkdir(parents=True, exist_ok=True)

    results = []
    for state in STATES:
        transformed = apply_state_transform(base_rgb01, state, seed=hash((territory, state, "grime")) & 0xFFFFFFFF)
        if state == "locked":
            transformed = add_locked_beacons(transformed, seed=hash((territory, state)) & 0xFFFFFFFF)
        blend = blend_field[..., None]
        final_rgb01 = base_rgb01 * (1 - blend) + transformed * blend
        final_rgb = np.clip(final_rgb01 * 255.0, 0, 255).astype(np.uint8)
        alpha = np.clip(alpha_field * 255.0, 0, 255).astype(np.uint8)
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
