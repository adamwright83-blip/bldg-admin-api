"""Pack every rendered state of one character into a single trimmed Pixi spritesheet."""
import sys, os, json
from PIL import Image

def pack(render_dir, out_dir, prefix, groups, quality=82, max_w=2048, pad=2):
    idx = json.load(open(os.path.join(render_dir, "render-index.json")))
    os.makedirs(out_dir, exist_ok=True)
    for group in groups:
        frames = []
        for state, facings in idx.items():
            if not state.startswith(group + "-"):
                continue
            for facing, files in facings.items():
                for i, f in enumerate(files):
                    im = Image.open(os.path.join(render_dir, f)).convert("RGBA")
                    bbox = im.getchannel("A").point(lambda a: 255 if a > 6 else 0).getbbox() or (0, 0, 1, 1)
                    frames.append((f"{state}-{facing}-{i + 1:02d}", f"{state}-{facing}", im.crop(bbox), bbox, im.size))
        order = sorted(range(len(frames)), key=lambda k: -frames[k][2].size[1])
        x = y = shelf = width = 0
        placed = {}
        for k in order:
            w, h = frames[k][2].size
            if x + w + pad > max_w:
                x = 0; y += shelf + pad; shelf = 0
            placed[k] = (x, y); x += w + pad; shelf = max(shelf, h); width = max(width, x)
        height = y + shelf
        sheet = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        meta, anims = {}, {}
        for k, (name, anim, crop, bbox, size) in enumerate(frames):
            px, py = placed[k]
            sheet.alpha_composite(crop, (px, py))
            meta[name] = {"frame": {"x": px, "y": py, "w": crop.size[0], "h": crop.size[1]}, "rotated": False, "trimmed": True,
                          "spriteSourceSize": {"x": bbox[0], "y": bbox[1], "w": crop.size[0], "h": crop.size[1]},
                          "sourceSize": {"w": size[0], "h": size[1]}}
            anims.setdefault(anim, []).append(name)
        for key in anims:
            anims[key].sort()
        image = f"{prefix}-{group}.webp"
        sheet.save(os.path.join(out_dir, image), "WEBP", quality=quality, method=6)
        json.dump({"frames": meta, "animations": anims, "meta": {"image": image, "format": "RGBA8888", "size": {"w": width, "h": height}, "scale": "1"}},
                  open(os.path.join(out_dir, f"{prefix}-{group}.json"), "w"), separators=(",", ":"))
        print(group, len(frames), "frames", width, "x", height, os.path.getsize(os.path.join(out_dir, image)) // 1024, "KB")

if __name__ == "__main__":
    pack(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4].split(","))
