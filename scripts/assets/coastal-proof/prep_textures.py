"""Coastal Market proof: texture + sky prep (plain Python 3, Pillow + numpy).

    python3 scripts/assets/coastal-proof/prep_textures.py [--sources ~/Desktop/coastal-proof-sources]

Inputs are CC0 Poly Haven downloads (see PROVENANCE.md). Outputs go to
client/public/assets/goldline/coastal-market-three-proof/tex/:

    <material>_albedo.webp   1024^2 sRGB
    <material>_normal.webp   512^2 OpenGL tangent-space
    sky.webp                 2048x568 equirect of the upper sky: an authored sunset gradient
                             carrying the cloud detail of belfast_sunset_puresky
    water_normal.webp        512^2 tileable ripple normal map, generated here
    sky.json                 sun + fog colours sampled from the graded sky
"""

import json
import math
import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT = os.path.join(REPO, "client", "public", "assets", "goldline", "coastal-market-three-proof", "tex")
argv = sys.argv[1:]
SRC = os.path.expanduser(argv[argv.index("--sources") + 1]) if "--sources" in argv else os.path.expanduser("~/Desktop/coastal-proof-sources")
PH = os.path.join(SRC, "polyhaven")

SUN_AZIMUTH_DEG = 162.0   # must match build_level.py
SUN_ELEVATION_DEG = 13.0

# proof material -> Poly Haven texture set
MATERIALS = {
    "rock": "rock_face_03",
    "cobble": "cobblestone_floor_04",
    "stone": "monastery_stone_floor",
    "plaster": "painted_plaster_wall",
    "wood": "weathered_brown_planks",
    "wood_dark": "wood_planks_dirt",
    "roof": "ceramic_roof_01",
    "sand": "coast_sand_rocks_02",
}


def save_webp(img, path, quality):
    img.save(path, "WEBP", quality=quality, method=6)
    print(f"[tex] {os.path.relpath(path, REPO)} {os.path.getsize(path) // 1024} KB")


def prep_materials():
    for mat, name in MATERIALS.items():
        base = os.path.join(PH, "textures", name)
        diff = Image.open(os.path.join(base, f"{name}_diff_2k.jpg")).convert("RGB").resize((1024, 1024), Image.LANCZOS)
        save_webp(diff, os.path.join(OUT, f"{mat}_albedo.webp"), 78)
        nor = Image.open(os.path.join(base, f"{name}_nor_gl_2k.jpg")).convert("RGB").resize((512, 512), Image.LANCZOS)
        save_webp(nor, os.path.join(OUT, f"{mat}_normal.webp"), 85)


def read_hdr(path):
    """Minimal Radiance RGBE reader (new-style RLE scanlines)."""
    with open(path, "rb") as f:
        data = f.read()
    i = data.index(b"\n\n") + 2
    j = data.index(b"\n", i)
    dims = data[i:j].decode().split()
    h, w = int(dims[1]), int(dims[3])
    p = j + 1
    img = np.zeros((h, w, 4), np.uint8)
    for y in range(h):
        p += 4
        for c in range(4):
            x = 0
            while x < w:
                n = data[p]
                p += 1
                if n > 128:
                    n -= 128
                    img[y, x:x + n, c] = data[p]
                    p += 1
                else:
                    img[y, x:x + n, c] = np.frombuffer(data[p:p + n], np.uint8)
                    p += n
                x += n
    e = img[..., 3].astype(np.int32)
    scale = np.where(e > 0, np.ldexp(1.0, e - 136), 0.0)
    return img[..., :3].astype(np.float32) * scale[..., None]


def box_blur(a, r, axis):
    c = np.cumsum(np.pad(a, [(r + 1, r) if i == axis else (0, 0) for i in range(a.ndim)], mode="edge"), axis=axis)
    hi = np.take(c, np.arange(2 * r + 1, c.shape[axis]), axis=axis)
    lo = np.take(c, np.arange(0, c.shape[axis] - 2 * r - 1), axis=axis)
    return (hi - lo) / (2 * r + 1)


def blur(a, r):
    for _ in range(3):
        a = box_blur(a, r, 0)
        a = box_blur(a, r, 1)
    return a


def prep_sky():
    """Composite sunset sky: an authored gradient (so the palette is controlled) carrying the
    cloud detail of a CC0 Poly Haven sky as local contrast."""
    hdr = read_hdr(os.path.join(PH, "hdri", "belfast_sunset_puresky_2k.hdr"))
    h, w, _ = hdr.shape
    lum = hdr.mean(-1)
    sy, sx = np.unravel_index(np.argmax(lum), lum.shape)
    detail = np.log(np.maximum(lum, 1e-4))
    detail = detail - blur(detail, 40)
    detail = np.clip(detail * 1.6, -0.9, 0.9)
    # rotate so the photographed glow sits near the proof's sun azimuth
    az = math.radians(SUN_AZIMUTH_DEG)
    tx, tz = math.cos(az), -math.sin(az)
    dst_u = (math.atan2(tz, tx) / (2 * math.pi) + 0.5) % 1.0
    detail = np.roll(detail, int(round((dst_u - sx / w) * w)), axis=1)

    elev = 90 - (np.arange(h) + 0.5) / h * 180
    u = (np.arange(w) + 0.5) / w
    el = np.radians(elev)[:, None]
    dirx = np.cos(el) * np.cos((u - 0.5) * 2 * math.pi)[None, :]
    diry = np.sin(el) * np.ones((1, w))
    dirz = np.cos(el) * np.sin((u - 0.5) * 2 * math.pi)[None, :]
    sel = math.radians(SUN_ELEVATION_DEG)
    sdir = np.array([math.cos(sel) * tx, math.sin(sel), math.cos(sel) * tz])
    cosang = np.clip(dirx * sdir[0] + diry * sdir[1] + dirz * sdir[2], -1, 1)
    toward = np.clip(cosang, 0, 1)
    # horizontal-only sun proximity sets the horizon colour all the way round
    hcos = np.clip((dirx * sdir[0] + dirz * sdir[2]) / np.maximum(np.cos(el), 1e-3) / math.cos(sel), -1, 1)
    hs = (hcos * 0.5 + 0.5) ** 2.2

    zenith = np.array([0.23, 0.36, 0.58])
    mid = np.array([0.52, 0.58, 0.68])
    hz_away = np.array([0.72, 0.58, 0.62])
    hz_sun = np.array([1.0, 0.64, 0.34])
    hz = hz_away[None, None, :] * (1 - hs[..., None]) + hz_sun[None, None, :] * hs[..., None]
    t = np.clip(elev / 90.0, 0, 1)[:, None, None]
    t_mid = np.clip(t / 0.22, 0, 1)
    col = hz * (1 - t_mid) + mid * t_mid
    col = col * (1 - np.clip((t - 0.22) / 0.6, 0, 1)) + zenith * np.clip((t - 0.22) / 0.6, 0, 1)
    # glow around the sun (the shader draws the disc itself)
    col = col + (toward ** 7)[..., None] * np.array([1.0, 0.52, 0.2]) * 0.55 + (toward ** 70)[..., None] * np.array([1.0, 0.82, 0.55]) * 0.55
    # clouds: brighter/darker than their surroundings, warmer toward the sun, fading out at the horizon
    cloud_amt = np.clip(elev / 6.0, 0, 1)[:, None] * 0.55
    d = detail * cloud_amt
    warm_clouds = (toward ** 3)[..., None] * np.array([0.25, 0.08, -0.08])
    col = col * np.exp(d)[..., None] + np.maximum(d, 0)[..., None] * warm_clouds
    ldr = np.clip(col, 0, 1) ** (1 / 2.2)
    top = 0
    bottom = int(h * (0.5 + 10 / 180))
    crop = (ldr[top:bottom] * 255).astype(np.uint8)
    img = Image.fromarray(crop).resize((2048, int(2048 * crop.shape[0] / w)), Image.LANCZOS)
    save_webp(img, os.path.join(OUT, "sky.webp"), 82)

    def sample(az_deg, el_deg):
        a = math.radians(az_deg)
        x, z = math.cos(a), -math.sin(a)
        uu = (math.atan2(z, x) / (2 * math.pi) + 0.5) % 1.0
        vv = (90 - el_deg) / 180
        py = min(crop.shape[0] - 1, int(vv * h))
        px = int(uu * w) % w
        patch = ldr[max(0, py - 6):py + 6, max(0, px - 12):px + 12]
        return [round(float(c), 4) for c in patch.reshape(-1, 3).mean(0)]

    meta = {
        "sunAzimuthDeg": SUN_AZIMUTH_DEG,
        "sunElevationDeg": SUN_ELEVATION_DEG,
        "horizonSun": sample(SUN_AZIMUTH_DEG, 1.5),
        "horizonAway": sample(SUN_AZIMUTH_DEG + 180, 1.5),
        "horizonSide": sample(SUN_AZIMUTH_DEG + 90, 1.5),
        "zenith": sample(SUN_AZIMUTH_DEG, 80),
        "skyVFraction": bottom / h,
    }
    with open(os.path.join(OUT, "sky.json"), "w") as f:
        json.dump(meta, f, indent=1)
    print("[tex] sky.json", meta)


def prep_water_normal(size=512, waves=48, seed=3):
    """Tileable ripple normals: sum of integer-wavevector sines (so the tile wraps)."""
    rng = np.random.default_rng(seed)
    y, x = np.mgrid[0:size, 0:size] / size
    dhdx = np.zeros((size, size), np.float64)
    dhdy = np.zeros((size, size), np.float64)
    for _ in range(waves):
        k = rng.integers(2, 26)
        ang = rng.uniform(0, 2 * math.pi)
        kx, ky = int(round(k * math.cos(ang))), int(round(k * math.sin(ang)))
        if kx == 0 and ky == 0:
            continue
        amp = 1.0 / (kx * kx + ky * ky) ** 0.62
        ph = rng.uniform(0, 2 * math.pi)
        arg = 2 * math.pi * (kx * x + ky * y) + ph
        # sharpened crests
        c = np.cos(arg)
        dhdx += amp * kx * c * (1 + 0.35 * np.sin(arg))
        dhdy += amp * ky * c * (1 + 0.35 * np.sin(arg))
    s = 0.9 / max(np.abs(dhdx).max(), np.abs(dhdy).max())
    n = np.stack([-dhdx * s, -dhdy * s, np.ones_like(dhdx)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    rgb = ((n * 0.5 + 0.5) * 255).astype(np.uint8)
    save_webp(Image.fromarray(rgb), os.path.join(OUT, "water_normal.webp"), 90)


os.makedirs(OUT, exist_ok=True)
prep_materials()
prep_sky()
prep_water_normal()
