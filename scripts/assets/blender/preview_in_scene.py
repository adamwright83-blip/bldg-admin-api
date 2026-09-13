#!/usr/bin/env python3
"""
Composite a baked companion frame into a real chapter room at ground-plane scale.

A render on a flat grey card says nothing about whether a character belongs in
the game. This puts the frame into the actual painted room, at the depth-correct
size from groundPlane.ts, with the same dual contact shadow the chapter draws,
so the verdict is made in context.

    python3 preview_in_scene.py frame.png --room arrival --out preview.png
"""
import argparse
from PIL import Image, ImageDraw, ImageFilter

BG = "client/public/assets/goldline/chapters/the-last-valet/backgrounds/{}.png"
GAME_W, GAME_H = 960, 640
# Mirrors GROUND_PLANES in client/src/game/chapters/firstChapter/groundPlane.ts
PLANES = {
    "arrival": dict(yFar=116, yNear=534, scaleFar=0.60, exponent=1.15),
    "garden":  dict(yFar=116, yNear=534, scaleFar=0.62, exponent=1.15),
    "gallery": dict(yFar=116, yNear=534, scaleFar=0.64, exponent=1.10),
}
HERO_NEAR_H = 86  # heroine height in game px at the near edge; companions sized against her

def scale_at(p, y):
    t = max(0.0, min(1.0, (y - p["yFar"]) / (p["yNear"] - p["yFar"])))
    return p["scaleFar"] + (1 - p["scaleFar"]) * t ** p["exponent"]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("frame")
    ap.add_argument("--room", default="arrival")
    ap.add_argument("--out", required=True)
    # Defaults sit on the tiled floor of Arrival Court. The floor there is a diamond
    # seen at three-quarters, with the parapet running diagonally from lower-left,
    # so a spot near the lower-left corner (the old 300,470) lands on the parapet
    # and vines — the same clipping failure as the live chapter. Checked by eye on
    # the 2x composite, not assumed.
    ap.add_argument("--spots", default="560,430;760,330;600,270", help="x,y foot positions in game px")
    ap.add_argument("--height-ratio", type=float, default=0.72, help="companion height vs heroine")
    ap.add_argument("--upscale", type=int, default=2)
    a = ap.parse_args()

    plane = PLANES[a.room]
    U = a.upscale
    bg = Image.open(BG.format({"arrival": "arrival-court", "garden": "turntable-garden", "gallery": "departure-gallery"}[a.room]))
    canvas = bg.convert("RGBA").resize((GAME_W * U, GAME_H * U), Image.LANCZOS)
    src = Image.open(a.frame).convert("RGBA")
    src = src.crop(src.getbbox())

    shadows = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadows)
    placements = []
    for spot in a.spots.split(";"):
        x, y = (float(v) for v in spot.split(","))
        s = scale_at(plane, y)
        h = HERO_NEAR_H * a.height_ratio * s * U
        w = src.width * h / src.height
        foot_w = w * 0.34
        # dual contact shadow, same model as ChapterScene.shadow()
        sd.ellipse([x*U - foot_w*1.85, y*U + 4*s*U - foot_w*0.62, x*U + foot_w*1.85, y*U + 4*s*U + foot_w*0.62],
                   fill=(23, 60, 53, int(255 * (0.07 + 0.13 * s))))
        sd.ellipse([x*U - foot_w*0.9, y*U + 2*s*U - foot_w*0.3, x*U + foot_w*0.9, y*U + 2*s*U + foot_w*0.3],
                   fill=(13, 36, 31, int(255 * (0.34 + 0.30 * s))))
        placements.append((x*U, y*U, w, h))
    canvas.alpha_composite(shadows.filter(ImageFilter.GaussianBlur(1.2 * U)))
    for (x, y, w, h) in sorted(placements, key=lambda p: p[1]):   # depth sort by foot y
        sprite = src.resize((max(1, int(w)), max(1, int(h))), Image.LANCZOS)
        canvas.alpha_composite(sprite, (int(x - w / 2), int(y - h)))
    canvas.convert("RGB").save(a.out)
    print("PREVIEW", a.out, canvas.size)

if __name__ == "__main__":
    main()
