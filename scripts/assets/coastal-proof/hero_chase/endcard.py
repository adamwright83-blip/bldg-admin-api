"""End card for the trailer, in Joystick's brand colours (docs/goldline/JOYSTICK_BRAND_CANON.md):
Deep Charcoal #0B0F14, Amber #FF8A00, Gold #FFC84D, White #F8F9FA.

    python3 scripts/assets/coastal-proof/hero_chase/endcard.py OUT_DIR
"""

import os
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

CHARCOAL = (11, 15, 20)
AMBER = (255, 138, 0)
GOLD = (255, 200, 77)
WHITE = (248, 249, 250)
IMPACT = "/System/Library/Fonts/Supplemental/Impact.ttf"
DIN = "/System/Library/Fonts/Supplemental/DIN Condensed Bold.ttf"


def card(w, h, path):
    im = Image.new("RGB", (w, h), CHARCOAL)
    # a warm glow low in the frame, like the sunset the chase ended in
    glow = Image.new("L", (w, h), 0)
    gd = ImageDraw.Draw(glow)
    r = int(max(w, h) * 0.55)
    gd.ellipse((w / 2 - r, h * 0.78 - r * 0.6, w / 2 + r, h * 0.78 + r * 0.6), fill=90)
    glow = glow.filter(ImageFilter.GaussianBlur(max(w, h) // 8))
    warm = Image.new("RGB", (w, h), (120, 60, 10))
    im = Image.composite(warm, im, glow)
    d = ImageDraw.Draw(im)
    portrait = h > w
    head = ImageFont.truetype(IMPACT, int(w * (0.2 if portrait else 0.075)))
    lines = ["PLAY THE", "WORK YOU", "HATE"] if portrait else ["PLAY THE WORK", "YOU HATE"]
    lh = head.size * 1.02
    total = lh * len(lines)
    y = h * (0.4 if portrait else 0.34) - total / 2
    for line in lines:
        tw = d.textlength(line, font=head)
        d.text(((w - tw) / 2, y), line, font=head, fill=WHITE)
        y += lh
    # wordmark
    mark = ImageFont.truetype(IMPACT, int(w * (0.12 if portrait else 0.05)))
    word = "JOYSTICK"
    tw = d.textlength(word, font=mark)
    yw = y + head.size * (0.55 if portrait else 0.45)
    orb = mark.size * 0.36
    gap = mark.size * 0.3
    x0 = (w - (tw + orb * 2 + gap)) / 2
    d.ellipse((x0, yw + mark.size * 0.22, x0 + orb * 2, yw + mark.size * 0.22 + orb * 2), fill=AMBER)
    d.text((x0 + orb * 2 + gap, yw), word, font=mark, fill=AMBER)
    tag = ImageFont.truetype(DIN, int(w * (0.06 if portrait else 0.026)))
    t = "REAL WORK. PLAYABLE."
    tw = d.textlength(t, font=tag)
    d.text(((w - tw) / 2, yw + mark.size * 1.35), t, font=tag, fill=GOLD)
    im.save(path)
    print("[endcard]", path)


if __name__ == "__main__":
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    card(1080, 1920, os.path.join(out, "endcard_916.png"))
    card(1920, 1080, os.path.join(out, "endcard_169.png"))
