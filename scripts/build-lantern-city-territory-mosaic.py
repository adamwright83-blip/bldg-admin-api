#!/usr/bin/env python3
"""Cut the continuous vector-fantasy Lantern City master into exact territory plates.

The geographic surface is rendered upstream by MapLibre from real vector data.
This script never invents geography: it validates the art-direction gate, crops
one continuous master, and applies the already-exported authoritative masks.
"""
from __future__ import annotations

import json
import os
import pathlib
import shutil
from datetime import datetime, timezone

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter

ROOT = pathlib.Path(__file__).resolve().parents[1]
INPUTS = ROOT / "artifacts" / "lantern-city-territory-art-inputs"
TERRITORY_INDEX = INPUTS / "_qa" / "territory-index.json"
OUT = ROOT / "client" / "public" / "assets" / "admin" / "control-room" / "world" / "territories-v2"
QA = ROOT / "screenshots" / "lantern-city-v2"
MASTER_DIR = ROOT / "artifacts" / "lantern-city-territory-mosaic"
DEFAULT_MASTER_PATH = MASTER_DIR / "lantern-city-hd-master.png"
MASTER_PATH = pathlib.Path(os.environ.get("LANTERN_MASTER_INPUT", str(DEFAULT_MASTER_PATH)))
MASTER_W = int(os.environ.get("LANTERN_MASTER_WIDTH", "7680"))
MASTER_H = int(os.environ.get("LANTERN_MASTER_HEIGHT", "4320"))
ATTRIBUTION = os.environ.get(
    "LANTERN_MASTER_ATTRIBUTION",
    "OpenMapTiles Data from OpenStreetMap · rendered with OpenFreeMap vector tiles",
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


def pct_crop(bbox: dict) -> tuple[int, int, int, int]:
    left = round(float(bbox["left"]) / 100 * MASTER_W)
    top = round(float(bbox["top"]) / 100 * MASTER_H)
    right = round((float(bbox["left"]) + float(bbox["width"])) / 100 * MASTER_W)
    bottom = round((float(bbox["top"]) + float(bbox["height"])) / 100 * MASTER_H)
    return max(0, left), max(0, top), min(MASTER_W, right), min(MASTER_H, bottom)


def save_preview(image: Image.Image, path: pathlib.Path) -> None:
    preview = image.copy()
    preview.thumbnail((1920, 1080), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (1920, 1080), (236, 220, 178))
    canvas.paste(preview, ((1920 - preview.width) // 2, (1080 - preview.height) // 2))
    path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(path, "JPEG", quality=92, optimize=True)


def save_zoom_previews(master: Image.Image) -> None:
    # Static art-direction crops. Runtime/browser zoom is verified separately.
    for label, factor in (("200", 2.0), ("300", 3.0)):
        crop_w = round(master.width / factor)
        crop_h = round(master.height / factor)
        # Centre the crop slightly east of centre so Koreatown/Silver Lake and
        # the densest canal crossings are represented together.
        cx = round(master.width * 0.57)
        cy = round(master.height * 0.52)
        left = max(0, min(master.width - crop_w, cx - crop_w // 2))
        top = max(0, min(master.height - crop_h, cy - crop_h // 2))
        crop = master.crop((left, top, left + crop_w, top + crop_h))
        crop = crop.resize((1920, 1080), Image.Resampling.LANCZOS)
        crop.save(QA / f"territory-mosaic-zoom-{label}.jpg", "JPEG", quality=93, optimize=True)


def art_direction_metrics(master: Image.Image) -> dict:
    """Cheap deterministic guard against shipping another green/satellite-looking world."""
    sample = master.resize((960, 540), Image.Resampling.BILINEAR).convert("RGB")
    arr = np.asarray(sample).astype(np.float32) / 255.0
    r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]

    cyan = (b > 0.52) & (g > 0.43) & (r < 0.45) & ((b - r) > 0.18)
    green = (g > 0.34) & (g > r * 1.10) & (g > b * 0.92) & ((g - r) > 0.045)
    warm = (r > 0.52) & (g > 0.42) & (r > b * 1.06) & (g > b * 1.02)
    purple = (b > 0.38) & (r > 0.31) & (b > g * 1.13) & (r > g * 1.10)
    near_black = ((r + g + b) / 3.0) < 0.12

    metrics = {
        "cyanPct": round(float(cyan.mean() * 100), 2),
        "greenPct": round(float(green.mean() * 100), 2),
        "warmPct": round(float(warm.mean() * 100), 2),
        "purplePct": round(float(purple.mean() * 100), 2),
        "nearBlackPct": round(float(near_black.mean() * 100), 2),
    }

    failures: list[str] = []
    if metrics["cyanPct"] < 1.8:
        failures.append(f"turquoise waterways are not visually prominent enough ({metrics['cyanPct']}%)")
    if metrics["greenPct"] > 28.0:
        failures.append(f"green dominates the city again ({metrics['greenPct']}%)")
    if metrics["warmPct"] < 15.0:
        failures.append(f"warm ivory/cream/terracotta city mass is too weak ({metrics['warmPct']}%)")
    if metrics["purplePct"] > 2.0:
        failures.append(f"broad purple contamination returned ({metrics['purplePct']}%)")
    if metrics["nearBlackPct"] > 7.0:
        failures.append(f"the light-mode city contains too much near-black surface ({metrics['nearBlackPct']}%)")

    metrics["passed"] = not failures
    metrics["failures"] = failures
    return metrics


def assemble_preview(entries: list[dict], master: Image.Image) -> Image.Image:
    # Use the new fantasy master itself as the safety plate; this makes the QA
    # image equivalent to production's intended underlay rather than quietly
    # reintroducing the old v4 painting at polygon antialiasing edges.
    result = master.resize((1920, 1080), Image.Resampling.LANCZOS).convert("RGBA")
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
        territories.append(
            {
                "territoryId": territory_id,
                "name": meta.get("name") or entry.get("name") or territory_id,
                "meta": meta,
                "maskPath": mask_path,
            }
        )
    if not projection:
        raise SystemExit("No projection found in exported territory metadata")
    return territories, projection


def main() -> None:
    territories, projection = load_exported_territories()
    MASTER_DIR.mkdir(parents=True, exist_ok=True)
    QA.mkdir(parents=True, exist_ok=True)

    if not MASTER_PATH.exists():
        raise SystemExit(
            f"Missing vector-fantasy master at {MASTER_PATH}. "
            "Run scripts/render-lantern-city-vector-master.mjs first. Satellite fallback is intentionally forbidden."
        )

    master = Image.open(MASTER_PATH).convert("RGB")
    if master.size != (MASTER_W, MASTER_H):
        raise SystemExit(f"Expected master {MASTER_W}x{MASTER_H}, got {master.size[0]}x{master.size[1]}")

    # Tiny finishing pass only; all geographic content already exists as vector
    # geometry. This is equivalent to final-game color grading, not repainting.
    master = ImageEnhance.Color(master).enhance(1.04)
    master = ImageEnhance.Contrast(master).enhance(1.025)
    master = master.filter(ImageFilter.UnsharpMask(radius=0.7, percent=70, threshold=2))
    master.save(DEFAULT_MASTER_PATH, "PNG", optimize=True)

    art_metrics = art_direction_metrics(master)
    if not art_metrics["passed"]:
        raise SystemExit("Art-direction gate failed: " + "; ".join(art_metrics["failures"]))

    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True, exist_ok=True)

    save_preview(master, QA / "territory-mosaic-master-preview.jpg")
    save_zoom_previews(master)

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
        crop.save(OUT / filename, "WEBP", quality=94, method=6, exact=True)
        entries.append(
            {
                "territoryId": territory_id,
                "name": territory["name"],
                "src": f"/assets/admin/control-room/world/territories-v2/{filename}",
                "atlasBBoxPct": bbox,
                "naturalWidth": crop.width,
                "naturalHeight": crop.height,
            }
        )
        if territory_id in FIRST_GATE:
            gate_seen.add(territory_id)

    missing_gate = sorted(FIRST_GATE - gate_seen)
    if missing_gate:
        raise SystemExit(f"Ten-territory geography gate missing: {', '.join(missing_gate)}")

    out_manifest = {
        "version": 3,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": "one continuous OpenStreetMap/OpenMapTiles vector master with deterministic Lantern City styling; no satellite imagery; no generative geography",
        "attribution": ATTRIBUTION,
        "projection": projection,
        "master": {"width": MASTER_W, "height": MASTER_H},
        "fantasyPresentation": {
            "waterways": "/assets/admin/control-room/world/fantasy-waterways-v1.geojson",
            "businessTruthRole": "none",
            "protectedGeography": "real roads and buildings render above fantasy waterways; crossings preserve the real road alignment as bridges",
        },
        "territories": entries,
    }
    (OUT / "manifest.json").write_text(json.dumps(out_manifest, indent=2) + "\n")

    assembled = assemble_preview(entries, master)
    assembled.convert("RGB").save(
        QA / "territory-mosaic-assembled-preview.jpg", "JPEG", quality=93, optimize=True
    )

    qa = {
        "territoryCount": len(entries),
        "gateCount": len(gate_seen),
        "missingGate": missing_gate,
        "master": [MASTER_W, MASTER_H],
        "method": "real vector geography -> one continuous Lantern City fantasy master -> authoritative polygon cuts",
        "satelliteImagery": False,
        "generativeGeography": False,
        "geographyDriftRisk": "structurally excluded: vector features and Goldline projection are never repainted",
        "artDirection": art_metrics,
    }
    (MASTER_DIR / "qa.json").write_text(json.dumps(qa, indent=2) + "\n")
    print(json.dumps(qa, indent=2))


if __name__ == "__main__":
    main()
