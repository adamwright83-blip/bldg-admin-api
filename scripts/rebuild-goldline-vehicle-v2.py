#!/usr/bin/env python3
"""Rebuild Goldline's v2 neutral vehicle PNG from the authoritative v1 layers.

The v1 artwork is black-matte JPEG source art intended for screen blending.
This script reproduces the original browser composition and turns the matte
into a stable RGBA asset without hollowing out the vehicle interior.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "client/public/assets/goldline/vehicle-cargo/v1"
OUTPUT = ROOT / "client/public/assets/goldline/vehicle-cargo/v2/car-topdown-neutral.png"

GLOW_OPACITY = 0.72
INTERIOR_OPACITY = 0.92
GLASS_SCREEN_OPACITY = 0.52


def load_rgb(name: str) -> np.ndarray:
    image = Image.open(SOURCE / name).convert("RGB")
    return np.asarray(image, dtype=np.float32) / 255.0


def screen(base: np.ndarray, layer: np.ndarray) -> np.ndarray:
    return 1.0 - (1.0 - base) * (1.0 - layer)


def largest_component(mask: np.ndarray) -> np.ndarray:
    labels, count = ndimage.label(mask)
    if count == 0:
        raise RuntimeError("Could not recover a vehicle silhouette from v1 art")
    sizes = ndimage.sum(mask, labels, range(1, count + 1))
    return labels == (int(np.argmax(sizes)) + 1)


def vehicle_alpha(interior: np.ndarray, glass: np.ndarray, composite: np.ndarray) -> np.ndarray:
    # The vehicle body is one connected dark object on a black JPEG matte.
    # Fill its enclosed cabin so dark upholstery remains opaque and readable.
    body_signal = np.maximum(interior.max(axis=2), glass.max(axis=2))
    body = largest_component(body_signal > (12.0 / 255.0))
    body = ndimage.binary_closing(body, iterations=3)
    body = ndimage.binary_fill_holes(body)
    body = ndimage.binary_dilation(body, iterations=1)
    body_edge = ndimage.gaussian_filter(body.astype(np.float32), sigma=1.0)

    # Outside the solid silhouette, alpha follows emitted light. Unpremultiply
    # those pixels below so compositing over the drawer reproduces the screen
    # blended glow instead of a black rectangle.
    emitted = np.clip(composite.max(axis=2) * 1.35, 0.0, 1.0)
    alpha = np.maximum(body_edge, emitted)
    # Suppress JPEG-matte chroma noise that otherwise becomes colored pinholes
    # after unpremultiplication. This threshold is far below visible body/glow.
    alpha[alpha < (12.0 / 255.0)] = 0.0
    return alpha


def rebuild(output: Path) -> tuple[int, int]:
    glow = load_rgb("car-inactive-glow-neutral.jpg")
    interior = load_rgb("car-interior-base.jpg")
    glass = load_rgb("car-topdown-glass-overlay.jpg")
    if glow.shape != interior.shape or glass.shape != interior.shape:
        raise RuntimeError("Goldline v1 vehicle layers no longer share dimensions")

    base = glow * GLOW_OPACITY
    base = interior * INTERIOR_OPACITY + base * (1.0 - INTERIOR_OPACITY)
    screened = screen(base, glass)
    composite = base + (screened - base) * GLASS_SCREEN_OPACITY

    alpha = vehicle_alpha(interior, glass, composite)
    straight_rgb = composite.copy()
    outside_body = alpha < 0.999
    straight_rgb[outside_body] = np.clip(
        composite[outside_body] / np.maximum(alpha[outside_body, None], 1.0 / 255.0),
        0.0,
        1.0,
    )
    faint_glow = outside_body & (alpha < 0.15)
    neutral = straight_rgb[faint_glow].max(axis=1, keepdims=True)
    straight_rgb[faint_glow] = neutral
    rgba = np.dstack((straight_rgb, alpha))
    encoded = Image.fromarray(np.rint(rgba * 255.0).astype(np.uint8), "RGBA")
    output.parent.mkdir(parents=True, exist_ok=True)
    encoded.save(output, format="PNG", optimize=True, compress_level=9)

    with Image.open(output) as check:
        check.load()
        if check.format != "PNG" or check.mode != "RGBA" or min(check.size) <= 0:
            raise RuntimeError("Rebuilt vehicle did not validate as a non-empty RGBA PNG")
        return check.size


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()
    width, height = rebuild(args.output.resolve())
    print(f"Rebuilt {args.output}: PNG RGBA {width}x{height}")


if __name__ == "__main__":
    main()
