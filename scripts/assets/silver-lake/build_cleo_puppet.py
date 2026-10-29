"""
Cleo's puppet parts for Rook's airmail course, cut from her existing Silver Lake card (cards/cat.png). Nothing is
redrawn: the body is her card with the painted tail lifted off (a live tail replaces it in the game) and her eyes
lifted out (so she can sleep, open one eye, or glare). The card's white fur was partly see-through (left over from a
background removal); everything inside her outline is made opaque.

    python3 scripts/assets/silver-lake/build_cleo_puppet.py

Writes client/public/assets/goldline/silver-lake-3d/cards/cleo-body.png, cleo-eye-0.png, cleo-eye-1.png, cleo.json.
"""
import json, os
from collections import deque
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
CARDS = os.path.abspath(os.path.join(HERE, "../../../client/public/assets/goldline/silver-lake-3d/cards"))
src = Image.open(os.path.join(CARDS, "cat.png")).convert("RGBA")
W, H = src.size
px = src.load()
FUR = (247, 241, 236)

# ---- inside vs outside: flood the background from the border through anything not clearly opaque
outside = [[False] * H for _ in range(W)]
q = deque([(x, y) for x in range(W) for y in (0, H - 1)] + [(x, y) for x in (0, W - 1) for y in range(H)])
while q:
    x, y = q.popleft()
    if x < 0 or y < 0 or x >= W or y >= H or outside[x][y]:
        continue
    if px[x, y][3] > 200:
        continue
    outside[x][y] = True
    q.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))

body = Image.new("RGBA", (W, H), (0, 0, 0, 0))
bp = body.load()
for x in range(W):
    for y in range(H):
        r, g, b, a = px[x, y]
        if outside[x][y]:
            # keep the soft edge of the outline, nothing else
            bp[x, y] = (r, g, b, a if a > 120 else 0)
            continue
        k = a / 255
        bp[x, y] = (round(r * k + FUR[0] * (1 - k)), round(g * k + FUR[1] * (1 - k)), round(b * k + FUR[2] * (1 - k)), 255)

# ---- lift the painted tail off: it curls up on her left, apart from the body above row 216, joining at the haunch
def tail_pixel(x, y):
    if y < 216:
        return x < 49
    if y < 246:
        return x < 45 - (y - 216) * 0.05
    return False
for x in range(W):
    for y in range(H):
        if tail_pixel(x, y):
            bp[x, y] = (0, 0, 0, 0)

# ---- eyes: the two dark blobs in the face
def dark(c):
    return c[3] > 200 and c[0] < 70 and c[1] < 50 and c[2] < 50
seen = set()
blobs = []
for x in range(110, 200):
    for y in range(85, 135):
        if (x, y) in seen or not dark(bp[x, y]):
            continue
        blob = []
        dq = deque([(x, y)])
        while dq:
            cx, cy = dq.popleft()
            if (cx, cy) in seen or not (110 <= cx < 200 and 85 <= cy < 135) or not dark(bp[cx, cy]):
                continue
            seen.add((cx, cy))
            blob.append((cx, cy))
            dq.extend(((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)))
        if 40 < len(blob) < 400:
            xs = [p[0] for p in blob]
            ys = [p[1] for p in blob]
            # an eye is taller than wide; whisker strokes are long and thin
            if 8 <= (max(ys) - min(ys)) <= 22 and (max(xs) - min(xs)) <= 16:
                blobs.append(blob)
blobs.sort(key=lambda b: min(p[0] for p in b))
assert len(blobs) == 2, f"expected two eyes, found {len(blobs)}"

eyes = []
for i, blob in enumerate(blobs):
    xs = [p[0] for p in blob]
    ys = [p[1] for p in blob]
    x0, x1, y0, y1 = min(xs) - 2, max(xs) + 2, min(ys) - 2, max(ys) + 2
    crop = Image.new("RGBA", (x1 - x0 + 1, y1 - y0 + 1), (0, 0, 0, 0))
    cp = crop.load()
    # the fur colour around this eye
    ring = []
    for x in range(x0 - 3, x1 + 4):
        for y in range(y0 - 3, y1 + 4):
            if 0 <= x < W and 0 <= y < H and not (x0 <= x <= x1 and y0 <= y <= y1):
                c = bp[x, y]
                if c[3] == 255 and sum(c[:3]) > 300:
                    ring.append(c)
    ring.sort(key=lambda c: sum(c[:3]))
    fur = ring[len(ring) // 2] if ring else (*FUR, 255)
    # the eye (with its highlight) is the ellipse inside its box; the fur under it is blended across each row
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    rx, ry = (x1 - x0) / 2 + 0.5, (y1 - y0) / 2 + 0.5
    for y in range(y0, y1 + 1):
        left = bp[x0 - 2, y]
        right = bp[x1 + 2, y]
        for x in range(x0, x1 + 1):
            if ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 > 1.0:
                continue
            cp[x - x0, y - y0] = bp[x, y]
            k = (x - (x0 - 2)) / ((x1 + 2) - (x0 - 2))
            bp[x, y] = tuple(round(left[i] * (1 - k) + right[i] * k) for i in range(3)) + (255,)
    crop.save(os.path.join(CARDS, f"cleo-eye-{i}.png"))
    eyes.append({"x": x0, "y": y0, "w": x1 - x0 + 1, "h": y1 - y0 + 1, "fur": list(fur[:3])})

body.save(os.path.join(CARDS, "cleo-body.png"))
json.dump(
    {
        "size": [W, H],
        "eyes": eyes,
        # where the live tail leaves her body, in card pixels (top-left origin)
        "tailRoot": [47, 236],
        "outline": [74, 46, 34],
        "fur": {"white": list(FUR), "orange": [233, 146, 68], "brown": [122, 98, 86]},
    },
    open(os.path.join(CARDS, "cleo.json"), "w"),
    indent=1,
)
print("eyes", eyes)


# ---- Bella, on her balcony: her four existing poses, kept to the bunny alone (no painted caption, no slice of the
# neighbour below) with her white fur made opaque the same way.
POSES = {"idle": "bunny-idle.png", "wave": "bunny-wave.png", "selected": "bunny-selected.png", "happy": "bunny-acknowledged.png"}
VILLAGERS = os.path.abspath(os.path.join(HERE, "../../../client/public/assets/lantern-villager-outreach/villagers/animations"))


def largest_component(im):
    p = im.load()
    w, h = im.size
    seen = [[False] * h for _ in range(w)]
    best = []
    for sx in range(w):
        for sy in range(h):
            if seen[sx][sy] or p[sx, sy][3] < 60:
                continue
            comp = []
            dq = deque([(sx, sy)])
            while dq:
                x, y = dq.popleft()
                if x < 0 or y < 0 or x >= w or y >= h or seen[x][y] or p[x, y][3] < 60:
                    continue
                seen[x][y] = True
                comp.append((x, y))
                dq.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
            if len(comp) > len(best):
                best = comp
    return set(best)


def solid_card(path, out):
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    p = im.load()
    keep = largest_component(im)
    xs = [x for x, _ in keep]
    ys = [y for _, y in keep]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    # outside = flood from the border of the bunny's box through anything not clearly opaque
    outside = set()
    dq = deque([(x, y) for x in range(x0 - 1, x1 + 2) for y in (y0 - 1, y1 + 1)] + [(x, y) for x in (x0 - 1, x1 + 1) for y in range(y0 - 1, y1 + 2)])
    while dq:
        x, y = dq.popleft()
        if (x, y) in outside or x < x0 - 1 or y < y0 - 1 or x > x1 + 1 or y > y1 + 1:
            continue
        if 0 <= x < w and 0 <= y < h and p[x, y][3] > 200 and (x, y) in keep:
            continue
        outside.add((x, y))
        dq.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
    res = Image.new("RGBA", (x1 - x0 + 1, y1 - y0 + 1), (0, 0, 0, 0))
    rp = res.load()
    for x in range(x0, x1 + 1):
        for y in range(y0, y1 + 1):
            r, g, b, a = p[x, y]
            if (x, y) in outside:
                if (x, y) in keep and a > 120:
                    rp[x - x0, y - y0] = (r, g, b, a)
                continue
            k = a / 255
            rp[x - x0, y - y0] = (round(r * k + FUR[0] * (1 - k)), round(g * k + FUR[1] * (1 - k)), round(b * k + FUR[2] * (1 - k)), 255)
    res.save(out)
    return res.size


bella = {}
for name, file in POSES.items():
    bella[name] = solid_card(os.path.join(VILLAGERS, file), os.path.join(CARDS, f"bella-{name}.png"))
json.dump({"poses": {k: list(v) for k, v in bella.items()}}, open(os.path.join(CARDS, "bella.json"), "w"), indent=1)
print("bella", bella)
