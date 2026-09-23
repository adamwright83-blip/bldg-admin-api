"""Trim rendered frames and pack each state into a Pixi spritesheet (JSON hash + WebP)."""
import sys, os, json
from PIL import Image

def pack(render_dir, out_dir, prefix, anchor_y, quality=82, max_w=2048, pad=2):
    idx = json.load(open(os.path.join(render_dir, "render-index.json")))
    os.makedirs(out_dir, exist_ok=True)
    manifest = {"states": {}}
    total = 0
    for state, facings in idx.items():
        frames = []
        for facing, files in facings.items():
            for i, f in enumerate(files):
                im = Image.open(os.path.join(render_dir, f)).convert("RGBA")
                bbox = im.getchannel("A").point(lambda a: 255 if a > 6 else 0).getbbox() or (0, 0, 1, 1)
                frames.append((f"{prefix}-{state}-{facing}-{i + 1:02d}", im.crop(bbox), bbox, im.size, facing))
        # shelf pack, tallest first
        order = sorted(range(len(frames)), key=lambda k: -frames[k][1].size[1])
        x = y = shelf_h = 0; width = 0; placed = {}
        for k in order:
            w, h = frames[k][1].size
            if x + w + pad > max_w:
                x = 0; y += shelf_h + pad; shelf_h = 0
            placed[k] = (x, y); x += w + pad; shelf_h = max(shelf_h, h); width = max(width, x)
        height = y + shelf_h
        sheet = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        meta_frames = {}; animations = {}
        for k, (name, crop, bbox, size, facing) in enumerate(frames):
            px, py = placed[k]
            sheet.alpha_composite(crop, (px, py))
            meta_frames[name] = {"frame": {"x": px, "y": py, "w": crop.size[0], "h": crop.size[1]}, "rotated": False,
                                 "trimmed": True,
                                 "spriteSourceSize": {"x": bbox[0], "y": bbox[1], "w": crop.size[0], "h": crop.size[1]},
                                 "sourceSize": {"w": size[0], "h": size[1]}}
            animations.setdefault(f"{state}-{facing}", []).append(name)
        image_name = f"{prefix}-{state}.webp"
        sheet.save(os.path.join(out_dir, image_name), "WEBP", quality=quality, method=6)
        json.dump({"frames": meta_frames, "animations": animations,
                   "meta": {"image": image_name, "format": "RGBA8888", "size": {"w": width, "h": height}, "scale": "1"}},
                  open(os.path.join(out_dir, f"{prefix}-{state}.json"), "w"), separators=(",", ":"))
        kb = os.path.getsize(os.path.join(out_dir, image_name)) / 1024
        total += kb
        manifest["states"][state] = {"sheet": f"{prefix}-{state}.json", "facings": list(facings.keys()),
                                     "frames": len(next(iter(facings.values()))), "size": [width, height]}
        print(f"{state:8s} {len(frames):3d} frames  {width}x{height}  {kb:.0f} KB")
    first = Image.open(os.path.join(render_dir, next(iter(next(iter(idx.values())).values()))[0]))
    manifest["frameSize"] = list(first.size)
    manifest["anchor"] = [0.5, anchor_y / first.size[1]]
    json.dump(manifest, open(os.path.join(out_dir, f"{prefix}.manifest.json"), "w"), indent=1)
    print(f"TOTAL {total:.0f} KB")

if __name__ == "__main__":
    pack(sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4]))
