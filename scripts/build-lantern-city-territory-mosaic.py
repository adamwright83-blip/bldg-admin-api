#!/usr/bin/env python3
"""Build one continuous geography-registered HD Lantern City surface, then cut it into territory assets."""
from __future__ import annotations

import json
import math
import os
import pathlib
import shutil
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter, ImageOps

ROOT = pathlib.Path(__file__).resolve().parents[1]
INPUTS = ROOT / "artifacts" / "lantern-city-territory-art-inputs"
TERRITORY_INDEX = INPUTS / "_qa" / "territory-index.json"
OUT = ROOT / "client" / "public" / "assets" / "admin" / "control-room" / "world" / "territories-v2"
QA = ROOT / "screenshots" / "lantern-city-v2"
MASTER_DIR = ROOT / "artifacts" / "lantern-city-territory-mosaic"
MASTER_PATH = MASTER_DIR / "lantern-city-hd-master.png"

MASTER_W = int(os.environ.get("LANTERN_MASTER_WIDTH", "7680"))
MASTER_H = int(os.environ.get("LANTERN_MASTER_HEIGHT", "4320"))
GRID_X = int(os.environ.get("LANTERN_MASTER_GRID_X", "4"))
GRID_Y = int(os.environ.get("LANTERN_MASTER_GRID_Y", "4"))
ARCGIS_SERVICE = os.environ.get(
    "LANTERN_MASTER_SERVICE",
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer",
)

FIRST_GATE = {
    "century-city",
    "beverly-hills",
    "west-hollywood",
    "hollywood",
    "east-hollywood",
    "koreatown",
    "los-feliz",
    "silver-lake",
    "echo-park",
    "arts-district",
}


def merc_x(lon: float) -> float:
    return 6378137.0 * math.radians(lon)


def merc_y(lat: float) -> float:
    lat = max(min(lat, 85.05112878), -85.05112878)
    return 6378137.0 * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))


def request_bytes(url: str, attempts: int = 4) -> bytes:
    last: Exception | None = None
    for attempt in range(attempts):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Goldline-LanternCity-Renderer/1.0"})
            with urllib.request.urlopen(req, timeout=120) as response:
                return response.read()
        except Exception as exc:
            last = exc
            if attempt + 1 < attempts:
                time.sleep(2 ** attempt)
    raise RuntimeError(f"Failed to fetch {url}: {last}")


def service_attribution() -> str:
    try:
        payload = json.loads(request_bytes(f"{ARCGIS_SERVICE}?f=pjson").decode("utf-8"))
        return str(payload.get("copyrightText") or "Basemap imagery © Esri")
    except Exception:
        return "Basemap imagery © Esri"


def fetch_master(projection: dict) -> Image.Image:
    west = merc_x(float(projection["west"]))
    east = merc_x(float(projection["east"]))
    south = merc_y(float(projection["south"]))
    north = merc_y(float(projection["north"]))
    master = Image.new("RGB", (MASTER_W, MASTER_H))

    for row in range(GRID_Y):
        y_top = north - (north - south) * row / GRID_Y
        y_bottom = north - (north - south) * (row + 1) / GRID_Y
        py0 = round(MASTER_H * row / GRID_Y)
        py1 = round(MASTER_H * (row + 1) / GRID_Y)
        tile_h = py1 - py0
        for col in range(GRID_X):
            x_left = west + (east - west) * col / GRID_X
            x_right = west + (east - west) * (col + 1) / GRID_X
            px0 = round(MASTER_W * col / GRID_X)
            px1 = round(MASTER_W * (col + 1) / GRID_X)
            tile_w = px1 - px0
            params = urllib.parse.urlencode(
                {
                    "bbox": f"{x_left},{y_bottom},{x_right},{y_top}",
                    "bboxSR": "3857",
                    "imageSR": "3857",
                    "size": f"{tile_w},{tile_h}",
                    "format": "png32",
                    "transparent": "false",
                    "f": "image",
                }
            )
            data = request_bytes(f"{ARCGIS_SERVICE}/export?{params}")
            import io
            tile = Image.open(io.BytesIO(data)).convert("RGB")
            if tile.size != (tile_w, tile_h):
                tile = tile.resize((tile_w, tile_h), Image.Resampling.LANCZOS)
            master.paste(tile, (px0, py0))
            print(f"master tile {row * GRID_X + col + 1}/{GRID_X * GRID_Y}")
    return master


def stylize(master: Image.Image) -> Image.Image:
    """Deterministic art direction only. Never resamples or synthesizes geography."""
    base = ImageOps.autocontrast(master, cutoff=(0.2, 0.2))
    base = ImageEnhance.Color(base).enhance(1.32)
    base = ImageEnhance.Contrast(base).enhance(1.10)
    base = ImageEnhance.Brightness(base).enhance(1.04)

    arr = np.asarray(base).astype(np.float32) / 255.0
    r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
    water = (b > r * 1.10) & (b > g * 1.02) & ((b - r) > 0.045)
    foliage = (g > r * 1.06) & (g > b * 0.92) & ((g - r) > 0.025)
    neutral = (np.abs(r - g) < 0.07) & (np.abs(g - b) < 0.08) & (((r + g + b) / 3) > 0.35)

    water_target = np.array([0.035, 0.58, 0.88], dtype=np.float32)
    green_target = np.array([0.20, 0.52, 0.20], dtype=np.float32)
    warm_target = np.array([0.78, 0.70, 0.56], dtype=np.float32)
    arr[water] = arr[water] * 0.48 + water_target * 0.52
    arr[foliage] = arr[foliage] * 0.74 + green_target * 0.26
    arr[neutral] = arr[neutral] * 0.90 + warm_target * 0.10
    arr = np.clip(arr, 0, 1) ** 0.94

    styled = Image.fromarray(np.uint8(arr * 255), "RGB")
    poster = ImageOps.posterize(styled, 6)
    styled = Image.blend(styled, poster, 0.10)
    return styled.filter(ImageFilter.UnsharpMask(radius=1.2, percent=115, threshold=3))


def pct_crop(bbox: dict) -> tuple[int, int, int, int]:
    left = round(float(bbox["left"]) / 100 * MASTER_W)
    top = round(float(bbox["top"]) / 100 * MASTER_H)
    right = round((float(bbox["left"]) + float(bbox["width"])) / 100 * MASTER_W)
    bottom = round((float(bbox["top"]) + float(bbox["height"])) / 100 * MASTER_H)
    return max(0, left), max(0, top), min(MASTER_W, right), min(MASTER_H, bottom)


def save_preview(image: Image.Image, path: pathlib.Path) -> None:
    preview = image.copy()
    preview.thumbnail((1920, 1080), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (1920, 1080), (245, 243, 235))
    canvas.paste(preview, ((1920 - preview.width) // 2, (1080 - preview.height) // 2))
    path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(path, "JPEG", quality=90, optimize=True)


def assemble_preview(entries: list[dict]) -> Image.Image:
    fallback_path = ROOT / "client" / "public" / "assets" / "admin" / "control-room" / "world" / "lantern-city-atlas-v4.png"
    if fallback_path.exists():
        result = Image.open(fallback_path).convert("RGBA").resize((1920, 1080), Image.Resampling.LANCZOS)
    else:
        result = Image.new("RGBA", (1920, 1080), (245, 243, 235, 255))
    for entry in entries:
        src = ROOT / "client" / "public" / entry["src"].lstrip("/")
        if not src.exists():
            continue
        piece = Image.open(src).convert("RGBA")
        box = entry["atlasBBoxPct"]
        x = round(float(box["left"]) / 100 * 1920)
        y = round(float(box["top"]) / 100 * 1080)
        w = max(1, round(float(box["width"]) / 100 * 1920))
        h = max(1, round(float(box["height"]) / 100 * 1080))
        piece = piece.resize((w, h), Image.Resampling.LANCZOS)
        result.alpha_composite(piece, (x, y))
    return result


def load_exported_territories() -> tuple[list[dict], dict]:
    if not TERRITORY_INDEX.exists():
        raise SystemExit(
            "Missing artifacts/lantern-city-territory-art-inputs/_qa/territory-index.json. "
            "Run `pnpm goldline:territory-art:export` first."
        )
    index_doc = json.loads(TERRITORY_INDEX.read_text())
    index_entries = index_doc.get("territories") or []
    if len(index_entries) != 61:
        raise SystemExit(f"Expected 61 exported territories, got {len(index_entries)}")

    territories: list[dict] = []
    projection = None
    for entry in index_entries:
        territory_id = entry["territoryId"]
        meta_path = INPUTS / territory_id / "metadata.json"
        mask_path = INPUTS / territory_id / "mask.png"
        if not meta_path.exists() or not mask_path.exists():
            raise SystemExit(f"Missing exported geometry package for {territory_id}")
        meta = json.loads(meta_path.read_text())
        projection = projection or meta.get("projection")
        territories.append({
            "territoryId": territory_id,
            "name": meta.get("name") or entry.get("name") or territory_id,
            "meta": meta,
            "maskPath": mask_path,
        })
    if not projection:
        raise SystemExit("No projection found in exported territory metadata")
    return territories, projection


def main() -> None:
    territories, projection = load_exported_territories()

    MASTER_DIR.mkdir(parents=True, exist_ok=True)
    QA.mkdir(parents=True, exist_ok=True)
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True, exist_ok=True)

    raw = fetch_master(projection)
    master = stylize(raw)
    master.save(MASTER_PATH, "PNG", optimize=True)
    save_preview(master, QA / "territory-mosaic-master-preview.jpg")

    entries: list[dict] = []
    gate_seen: set[str] = set()
    for territory in territories:
        territory_id = territory["territoryId"]
        meta = territory["meta"]
        bbox = meta["atlasBBoxPct"]
        crop = master.crop(pct_crop(bbox)).convert("RGBA")
        mask = Image.open(territory["maskPath"]).convert("L").resize(crop.size, Image.Resampling.LANCZOS)
        crop.putalpha(mask)
        filename = f"{territory_id}.webp"
        crop.save(OUT / filename, "WEBP", quality=92, method=6, exact=True)
        entries.append({
            "territoryId": territory_id,
            "name": territory["name"],
            "src": f"/assets/admin/control-room/world/territories-v2/{filename}",
            "atlasBBoxPct": bbox,
            "naturalWidth": crop.width,
            "naturalHeight": crop.height,
        })
        if territory_id in FIRST_GATE:
            gate_seen.add(territory_id)

    missing_gate = sorted(FIRST_GATE - gate_seen)
    if missing_gate:
        raise SystemExit(f"Ten-territory gate missing: {', '.join(missing_gate)}")

    out_manifest = {
        "version": 2,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": "single continuous geography-registered master; territory alpha from authoritative Goldline masks",
        "attribution": service_attribution(),
        "projection": projection,
        "master": {"width": MASTER_W, "height": MASTER_H},
        "territories": entries,
    }
    (OUT / "manifest.json").write_text(json.dumps(out_manifest, indent=2) + "\n")

    assembled = assemble_preview(entries)
    assembled.convert("RGB").save(QA / "territory-mosaic-assembled-preview.jpg", "JPEG", quality=91, optimize=True)
    qa = {
        "territoryCount": len(entries),
        "gateCount": len(gate_seen),
        "missingGate": missing_gate,
        "master": [MASTER_W, MASTER_H],
        "method": "one continuous master then authoritative polygon cuts",
        "geographyDriftRisk": "none from image generation; no generative geography step exists",
    }
    (MASTER_DIR / "qa.json").write_text(json.dumps(qa, indent=2) + "\n")
    print(json.dumps(qa, indent=2))


if __name__ == "__main__":
    main()
