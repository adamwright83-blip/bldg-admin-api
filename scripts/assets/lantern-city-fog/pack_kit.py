"""Packs the CC0 building kits (Kenney City Kit Suburban + Commercial, KayKit City Builder Bits)
into one compact kit file for the Lantern City page: every model's geometry normalised to sit on
y=0 centred in x/z, plus the three texture atlases.

    python3 pack_kit.py KIT_SOURCES_DIR kit.json

Sources (all CC0): kenney.nl/assets/city-kit-suburban, kenney.nl/assets/city-kit-commercial,
kaylousberg.itch.io/city-builder-bits.
"""
import base64, io, json, os, struct, sys
import numpy as np
from PIL import Image

SRC, OUT = sys.argv[1], sys.argv[2]
CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


def load(path):
    if path.endswith(".glb"):
        b = open(path, "rb").read()
        n = struct.unpack("<I", b[12:16])[0]
        j = json.loads(b[20:20 + n])
        o = 20 + n
        bl = struct.unpack("<I", b[o:o + 4])[0]
        bins = [b[o + 8:o + 8 + bl]]
    else:
        j = json.load(open(path))
        bins = [open(os.path.join(os.path.dirname(path), buf["uri"]), "rb").read() for buf in j["buffers"]]

    def acc(i):
        a = j["accessors"][i]
        bv = j["bufferViews"][a["bufferView"]]
        data = bins[bv.get("buffer", 0)]
        start = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
        n, dt = NC[a["type"]], CT[a["componentType"]]
        stride = bv.get("byteStride", 0)
        item = np.dtype(dt).itemsize * n
        if stride and stride != item:
            raw = np.frombuffer(data, np.uint8, count=stride * (a["count"] - 1) + item, offset=start)
            rows = np.stack([raw[k * stride:k * stride + item] for k in range(a["count"])])
            return rows.view(dt).reshape(a["count"], n)
        return np.frombuffer(data, dt, count=a["count"] * n, offset=start).reshape(a["count"], n)

    P, N, U, I = [], [], [], []
    base = 0

    def mat_of(node):
        from math import cos, sin
        M = np.eye(4)
        if "matrix" in node:
            M = np.array(node["matrix"]).reshape(4, 4).T
        else:
            T = np.eye(4)
            T[:3, 3] = node.get("translation", [0, 0, 0])
            x, y, z, w = node.get("rotation", [0, 0, 0, 1])
            R = np.eye(4)
            R[:3, :3] = [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                         [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                         [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]]
            S = np.diag(list(node.get("scale", [1, 1, 1])) + [1])
            M = T @ R @ S
        return M

    def walk(ni, parent):
        nonlocal base
        node = j["nodes"][ni]
        M = parent @ mat_of(node)
        if "mesh" in node:
            for pr in j["meshes"][node["mesh"]]["primitives"]:
                p = acc(pr["attributes"]["POSITION"]).astype(np.float64)
                p = (np.c_[p, np.ones(len(p))] @ M.T)[:, :3]
                nrm = acc(pr["attributes"]["NORMAL"]).astype(np.float64) @ np.linalg.inv(M[:3, :3])
                nrm /= np.linalg.norm(nrm, axis=1, keepdims=True) + 1e-9
                uv = acc(pr["attributes"]["TEXCOORD_0"]).astype(np.float64) if "TEXCOORD_0" in pr["attributes"] else np.zeros((len(p), 2))
                idx = acc(pr["indices"]).astype(np.int64).ravel() if "indices" in pr else np.arange(len(p))
                P.append(p); N.append(nrm); U.append(uv); I.append(idx + base)
                base += len(p)
        for c in node.get("children", []):
            walk(c, M)

    for ni in j["scenes"][j.get("scene", 0)]["nodes"]:
        walk(ni, np.eye(4))
    return np.concatenate(P), np.concatenate(N), np.concatenate(U), np.concatenate(I)


KITS = {
    "house": ("kenney_city-kit-suburban_20/Models/GLB format", [f"building-type-{c}.glb" for c in "abcdefghijklmnopqrstu"], 0),
    "mid": ("kenney_city-kit-commercial_2.1/Models/GLB format", [f"building-{c}.glb" for c in "abcdefghijklmn"], 1),
    "brick": ("kaykit_city_builder_bits/KayKit_City_Builder_Bits_1.0_FREE/Assets/gltf", [f"building_{c}_withoutBase.gltf" for c in "ABCDEFGH"], 2),
}
ATLAS = ["kenney_city-kit-suburban_20/Models/GLB format/Textures/colormap.png",
         "kenney_city-kit-commercial_2.1/Models/GLB format/Textures/colormap.png",
         "kaykit_city_builder_bits/KayKit_City_Builder_Bits_1.0_FREE/Assets/gltf/citybits_texture.png"]

models = []
blob = bytearray()
for cls, (folder, files, atlas) in KITS.items():
    for f in files:
        p, n, uv, idx = load(os.path.join(SRC, folder, f))
        lo, hi = p.min(0), p.max(0)
        c = (lo + hi) / 2
        p = p - np.array([c[0], lo[1], c[2]])
        size = (hi - lo).tolist()
        rec = {"name": f.split(".")[0], "cls": cls, "atlas": atlas, "size": [round(v, 4) for v in size], "nv": len(p), "ni": len(idx)}
        for key, arr, dt in (("p", p, np.float32), ("n", (n * 127).round(), np.int8), ("uv", uv, np.float32),
                             ("i", idx, np.uint16 if len(p) < 65536 else np.uint32)):
            while len(blob) % 4:
                blob.append(0)
            rec[key] = [len(blob), str(np.dtype(dt))]
            blob += np.ascontiguousarray(arr, dtype=dt).tobytes()
        models.append(rec)
        print(f"{cls:5s} {rec['name']:26s} {len(p):6d} verts  size {[round(v, 2) for v in size]}")

atlases = []
for a in ATLAS:
    im = Image.open(os.path.join(SRC, a)).convert("RGB")
    if im.width > 512:
        im = im.resize((512, 512), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "PNG", optimize=True)
    atlases.append("data:image/png;base64," + base64.b64encode(buf.getvalue()).decode())
json.dump({"models": models, "atlases": atlases, "blob": base64.b64encode(bytes(blob)).decode()}, open(OUT, "w"), separators=(",", ":"))
print(len(models), "models,", round(len(blob) / 1e6, 2), "MB geometry,", round(os.path.getsize(OUT) / 1e6, 2), "MB file")
