"""Coastal Market proof: ship Trailblazer's VRoid Studio export at phone size.

    python3 scripts/assets/coastal-proof/prep_trailblazer_vrm.py [--src ~/Desktop/coastal-proof-sources/vroid/trailblazer.vrm] [--max 1024]

The source is the VRM 1.0 that VRoid Studio 2.14 exports from `trailblazer.vroid`: pixiv's
AvatarSample_X reworked into Trailblazer (body, face, hair, outfit chosen in VRoid). The VRM is a GLB
with VRM extensions (humanoid, spring bones, MToon materials, expressions), which generic glTF tools
drop, so this rewrites the GLB directly:

- every texture larger than --max is downscaled to it (PNG, alpha kept);
- the embedded 2048 px thumbnail becomes 64 px (nothing in the game shows it);
- the avatar name loses the stray tab typed into VRoid's export form.

Everything else (geometry, skin, morph targets, VRM/MToon/spring-bone extensions) is copied byte for byte.
Output: client/public/assets/goldline/coastal-market-three-proof/trailblazer-vrm.glb
"""

import io
import json
import os
import struct
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT = os.path.join(REPO, "client", "public", "assets", "goldline", "coastal-market-three-proof", "trailblazer-vrm.glb")
argv = sys.argv[1:]
SRC = os.path.expanduser(argv[argv.index("--src") + 1]) if "--src" in argv else os.path.expanduser("~/Desktop/coastal-proof-sources/vroid/trailblazer.vrm")
MAX = int(argv[argv.index("--max") + 1]) if "--max" in argv else 1024


def read_glb(path):
    b = open(path, "rb").read()
    magic, version, _ = struct.unpack("<III", b[:12])
    assert magic == 0x46546C67 and version == 2, "not a GLB v2"
    jlen, jtype = struct.unpack("<II", b[12:20])
    doc = json.loads(b[20:20 + jlen])
    off = 20 + jlen
    blen, btype = struct.unpack("<II", b[off:off + 8])
    return doc, b[off + 8:off + 8 + blen]


def write_glb(path, doc, bin_):
    j = json.dumps(doc, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    j += b" " * (-len(j) % 4)
    bin_ += b"\0" * (-len(bin_) % 4)
    total = 12 + 8 + len(j) + 8 + len(bin_)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(j), 0x4E4F534A))
        f.write(j)
        f.write(struct.pack("<II", len(bin_), 0x004E4942))
        f.write(bin_)


def shrink(data, name, limit):
    im = Image.open(io.BytesIO(data))
    w, h = im.size
    if name == "Thumbnail":
        limit = 64
    if max(w, h) <= limit:
        return data
    k = limit / max(w, h)
    im = im.resize((max(1, round(w * k)), max(1, round(h * k))), Image.LANCZOS)
    out = io.BytesIO()
    im.save(out, "PNG", optimize=True)
    return out.getvalue()


def main():
    doc, bin_ = read_glb(SRC)
    views = doc["bufferViews"]
    replaced = {}
    for im in doc.get("images", []):
        bv = views[im["bufferView"]]
        start = bv.get("byteOffset", 0)
        data = bin_[start:start + bv["byteLength"]]
        replaced[im["bufferView"]] = shrink(data, im.get("name", ""), MAX)
    # rebuild the binary chunk view by view (4-byte aligned), with the new image bytes
    out = bytearray()
    for i, bv in enumerate(views):
        start = bv.get("byteOffset", 0)
        data = replaced.get(i, bin_[start:start + bv["byteLength"]])
        out += b"\0" * (-len(out) % 4)
        bv["byteOffset"] = len(out)
        bv["byteLength"] = len(data)
        out += data
    doc["buffers"][0]["byteLength"] = len(out)
    meta = doc.get("extensions", {}).get("VRMC_vrm", {}).get("meta", {})
    if "name" in meta:
        meta["name"] = meta["name"].strip()
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    write_glb(OUT, doc, bytes(out))
    print(f"[vrm] {os.path.getsize(SRC) // 1024} KB -> {os.path.getsize(OUT) // 1024} KB ({os.path.relpath(OUT, REPO)})")


main()
