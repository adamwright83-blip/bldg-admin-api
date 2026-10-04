"""The Rook chase trailer, second staging (Blender 5.2, EEVEE).

Beats: Rook steals her compass; he stays ahead of her down the street (never above her); she
nearly has him at the fruit stall; she grabs a pole and vaults to his height, fingers inches from
his tail (slow motion); he glides onto a ship that is actually sailing out; she stops at the quay
edge as he holds the compass up from the stern.

    /Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/assets/coastal-proof/hero_chase/trailer_v2.py -- \
        [--preview] [--res 1080x1920] [--samples 32] [--frames a-b] [--step n] [--out DIR] [--no-sim]

Frames are numbered in screen time (the slow motion is rendered from subframes of the story time).
"""

import math
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import bpy
from mathutils import Quaternion, Vector

import characters as ch
import choreo as C
C.DURATION = 17.6
C.N_FRAMES = int(round(C.DURATION * 24)) + 1
import common
import env
import fx
import set_dressing as sd
from common import FPS, ease, smooth

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


PREVIEW = "--preview" in argv
RES = tuple(int(v) for v in arg("--res", "540x960" if PREVIEW else "1080x1920").split("x"))
SAMPLES = int(arg("--samples", "8" if PREVIEW else "48"))
F0, F1 = (int(v) for v in arg("--frames", f"1-{C.N_FRAMES}").split("-"))
OUT = arg("--out", os.path.join(common.REPO, "tmp", "hero", "frames"))
BLEND = arg("--blend")
NO_SIM = "--no-sim" in argv
STEP = int(arg("--step", "1"))
FRAMES = list(range(1, C.N_FRAMES + 1))
T = time.time()


def log(*a):
    print(f"[hero {time.time() - T:6.1f}s]", *a, flush=True)


# ====================================================================== build
bpy.ops.wm.read_homefile(use_empty=True)
sc = bpy.context.scene
sc.frame_start, sc.frame_end = 1, C.N_FRAMES
sc.render.fps = FPS
env.import_level()
env.build_world()
env.build_haze(density=0.0013)
env.build_sun(energy=15.0)
env.compositor()
sea_near, sea_far = env.build_sea()
sh = common.Shore()
lv = sd.Level()
S = sd.build_all(sh, lv, (1, C.N_FRAMES))
log("set built")

rk_root, rk_arm, rk_mesh = ch.load_rook()
rp = ch.RookPose(rk_arm)
# approved colours, a touch richer for the sunset; no sheen haze on the feathers
m = rk_mesh.data.materials[0]
bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
bsdf.inputs["Sheen Weight"].default_value = 0.0
bsdf.inputs["Roughness"].default_value = 0.78
link_in = bsdf.inputs["Base Color"].links[0]
hsv = m.node_tree.nodes.new("ShaderNodeHueSaturation")
hsv.inputs["Saturation"].default_value = 1.25
hsv.inputs["Value"].default_value = 0.88
m.node_tree.links.new(link_in.from_socket, hsv.inputs["Color"])
m.node_tree.links.new(hsv.outputs["Color"], bsdf.inputs["Base Color"])

tb_root, tb_arm, tb_meshes = ch.load_trailblazer()
ch.restyle_trailblazer(tb_meshes)
clips = ch.ClipLibrary()
for c in ("Sprint_Loop", "Slide_Start", "Slide_Loop", "Slide_Exit", "Idle_Loop"):
    log("clip", c, round(clips.length(c), 3))
rt = ch.Retarget(clips.arm, tb_arm)
log("characters loaded")

# ====================================================================== geometry the chase uses


def road(d, across=0.0, up=0.0):
    p, tq, land, w = sh.at(d)
    return p + land * across + Vector((0, 0, up))


laundry = S["laundry"]
l_rope = fx.RopeFx(laundry["rope"], laundry["a"], laundry["b"], laundry["sag"])
lan1, lan2, lan3 = S["lanterns"]
r1 = fx.RopeFx(lan1["rope"], lan1["a"], lan1["b"], lan1["sag"])
r2 = fx.RopeFx(lan2["rope"], lan2["a"], lan2["b"], lan2["sag"])
r3 = fx.RopeFx(lan3["rope"], lan3["a"], lan3["b"], lan3["sag"])


def awning_top(key):
    ob, wall, front = S["awnings"][key]
    return wall.lerp(front, 0.45) + Vector((0, 0, -0.1))


sign1 = S["signs"]["S1"]
sign1_bar = sign1.location + Vector((0, 0, 0.05))

# the rooftop line Rook runs, from above the sign to above the surf rope
roof = []
d = 50.4
while d >= 22.0:
    p, tq, land, w = sh.at(d)
    front = lv.toward(p + Vector((0, 0, 1.5)), land, 14.0)
    if front is not None:
        q = front + land * 0.45
        hit = lv.down(q.x, q.y, 60.0)
        if hit is not None and p.z + 3.0 < hit.z < p.z + 9.0:
            roof.append(Vector((q.x, q.y, hit.z + 0.02)))
    d -= 0.5
clean = []
for i, v in enumerate(roof):
    nb = [roof[j].z for j in range(max(0, i - 2), min(len(roof), i + 3)) if j != i]
    nb.sort()
    if nb and abs(v.z - nb[len(nb) // 2]) > 1.6:
        continue
    clean.append(v)
roof = clean
log("roof samples", len(roof), "z", round(min(v.z for v in roof), 1), round(max(v.z for v in roof), 1))

# the ship: main-mast top platform and the quay-side rail
ship_root, ship_meshes, _ = S["ship"]
yaw = ship_root.rotation_euler.z
ax = Vector((-math.sin(yaw), math.cos(yaw), 0))
bmv = Vector((math.cos(yaw), math.sin(yaw), 0))
ship_tree_objs = ship_meshes
from mathutils.bvhtree import BVHTree
import bmesh as _bm

_b = _bm.new()
dg = bpy.context.evaluated_depsgraph_get()
for o in ship_meshes:
    me = o.evaluated_get(dg).to_mesh()
    me.transform(o.matrix_world)
    _b.from_mesh(me)
    o.evaluated_get(dg).to_mesh_clear()
ship_bvh = BVHTree.FromBMesh(_b)
_b.free()
mast = ship_root.location + ax * 1.7
# the fighting top: the flat ring around the mast between the course and topsail yards. Probe
# straight down around the mast from above and take the height where most probes land.
from collections import Counter
hits = []
for r_ in (0.7, 0.95, 1.2):
    for k_ in range(12):
        a_ = k_ / 12 * math.tau
        o_ = mast + Vector((math.cos(a_) * r_, math.sin(a_) * r_, 0))
        for z0 in (17.5, 16.5, 15.5, 14.5):
            h = ship_bvh.ray_cast(o_ + Vector((0, 0, z0)), Vector((0, 0, -1)), 3.0)
            if h[0] is not None and 12.2 < h[0].z < 17.5:
                hits.append(round(h[0].z, 1))
top_z = Counter(hits).most_common(1)[0][0] if hits else 14.0
log("fighting top candidates", Counter(hits).most_common(4))
TOP = mast + bmv * 1.05 + Vector((0, 0, top_z + 0.03))
rail_side = ship_bvh.ray_cast(road(15.2, -2.0, 4.2), -sh.at(15.2)[2], 12.0)[0]
if rail_side is None:
    rail_side = road(15.2, -5.0, 4.2)
rail_top = ship_bvh.ray_cast(rail_side - sh.at(15.2)[2] * 0.2 + Vector((0, 0, 4.0)), Vector((0, 0, -1)), 8.0)[0]
RAIL = (rail_top or rail_side) + Vector((0, 0, 0.02))
log("ship top", [round(v, 2) for v in TOP], "rail", [round(v, 2) for v in RAIL])

# ====================================================================== constants of the new staging
Z = Vector((0, 0, 1))
DT = 1.0 / (FPS * 4)
D0 = 80.0                  # where she stands when he takes the compass
T_GO = 0.95                # she starts after him
SPRINT = 7.0
G = 3.9                    # grip height along the pole
POLE_LEN = 4.4
TV = 0.8                   # pole rise, plant to apex
GRAV = 9.81

w_at = lambda d: sh.at(d)[3]
clip_speed = clips.ground_speed("Sprint_Loop") * rt.scale
for c in ("Jump_Loop", "Jump_Land", "Roll"):
    log("clip", c, round(clips.length(c), 3))
ROLL_T = clips.length("Roll")

# the vault is aimed at the middle of the second lantern string
r2_mid = r2.rest(0.5)
_best = min(range(0, 800), key=lambda i: (sh.at(30.0 + i * 0.025)[0].xy - r2_mid.xy).length)
P_D = 30.0 + _best * 0.025
_p, _tq, _land, _w = sh.at(P_D)
P_LAT = (r2_mid - _p).dot(_land)
P = _p + _land * P_LAT - _tq * 0.2
P.z = _p.z + 0.03
BACK = -_tq                # from the plant point back toward where she comes from
PLANT_AT = math.sqrt(G * G - 1.9 * 1.9)
log("vault plant", round(P_D, 2), "lateral", round(P_LAT, 2), "rope mid z", round(r2_mid.z - P.z, 2))

# the fruit stall she lunges at
table, crates, fruit = S["stall"]


def world_bbox(o):
    pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


_lo, _hi = world_bbox(crates[1])
CRATE_TOP = Vector(((_lo.x + _hi.x) / 2, (_lo.y + _hi.y) / 2, _hi.z + 0.02))
STALL_D = 44.8
STALL_LAT = w_at(STALL_D) / 2 - 2.05

# ====================================================================== Trailblazer: a state machine integrated in time


class Her:
    def __init__(self):
        self.s = []          # per sample: dict
        d, lat, t = D0, -0.35, 0.0
        state, t_state = "idle", 0.0
        self.marks = {}
        vault = None
        air = None
        v = 0.0
        while t <= C.DURATION + 0.2:
            u = t - t_state
            nxt = None
            target_lat = -0.35
            if state == "idle":
                v = 0.0
                if t >= T_GO:
                    nxt = "accel"
            elif state == "accel":
                v = SPRINT * ease(u / 0.65)
                if u >= 0.65:
                    nxt = "run"
            elif state == "run":
                v = SPRINT
                if "slide" not in self.marks and d <= 53.9:
                    nxt = "slide"
                elif "slide" in self.marks and d <= STALL_D + 1.45:
                    nxt = "lunge"
                if "slide" in self.marks:
                    target_lat = STALL_LAT
            elif state == "slide":
                v = 6.8 + (3.8 - 6.8) * min(1.0, u / 0.8)
                if u >= 0.8:
                    nxt = "recover"
            elif state == "recover":
                v = 3.8 + (SPRINT - 3.8) * ease(u / 0.5)
                target_lat = STALL_LAT
                if u >= 0.5:
                    nxt = "run"
            elif state == "lunge":
                v = SPRINT + (3.2 - SPRINT) * ease(u / 0.4)
                target_lat = STALL_LAT
                if u >= 0.4:
                    nxt = "stumble"
            elif state == "stumble":
                v = 3.2
                target_lat = STALL_LAT - 0.2
                if u >= 0.3:
                    nxt = "carry"
            elif state == "carry":
                v = 3.2 + (6.4 - 3.2) * ease(u / 0.55)
                target_lat = P_LAT
                if d <= P_D + PLANT_AT:
                    nxt = "vault"
            elif state == "vault":
                pass
            elif state == "air":
                pass
            elif state == "land":
                v = 3.2
                if u >= 0.2:
                    nxt = "roll"
            elif state == "roll":
                v = 4.3
                if u >= ROLL_T * 0.92:
                    nxt = "run2"
            elif state == "run2":
                v = 4.3 + (SPRINT - 4.3) * ease(u / 0.45)
                target_lat = -(w_at(d) / 2 - 0.7)
                if d <= 16.4:
                    nxt = "skid"
            elif state == "skid":
                v = SPRINT * max(0.0, 1.0 - ease(u / 1.0))
                target_lat = -(w_at(d) / 2 - 0.6)
                if u >= 1.0:
                    nxt = "stand"
            elif state == "stand":
                v = 0.0
                target_lat = -(w_at(d) / 2 - 0.6)

            p, tq, land, w = sh.at(d)
            if state == "vault":
                uu = min(1.0, u / TV)
                th = self.theta0 * (1 - (1 - (1 - uu) ** 2))
                hands = P + BACK * G * math.sin(th) + Z * G * math.cos(th)
                root = hands - Z * (1.9 + 0.12 * uu)
                pos = root
                if uu >= 1.0:
                    nxt = "air"
                    air = (root.copy(), -BACK * 1.3 + Z * 1.9, t)
            elif state == "air":
                r0, v0, ta = air
                s_ = t - ta
                pos = r0 + v0 * s_ - Z * 0.5 * GRAV * s_ * s_
                if pos.z <= P.z + 0.03 and s_ > 0.1:
                    pos.z = P.z + 0.03
                    nxt = "land"
                    # continue on the road from where she came down
                    dd = min(range(0, 400), key=lambda i: (sh.at(P_D - i * 0.02)[0].xy - pos.xy).length)
                    d = P_D - dd * 0.02
                    lat = (pos - sh.at(d)[0]).dot(sh.at(d)[2])
            else:
                if state != "stand":
                    d -= v * DT
                k = min(1.0, DT * (3.2 if state in ("carry", "run2", "skid", "stand") else 2.4))
                lat += (target_lat - lat) * k
                p, tq, land, w = sh.at(d)
                pos = p + land * lat
                pos.z = p.z + 0.03
            self.s.append({"t": t, "pos": pos.copy(), "d": d, "state": state, "u": u, "v": v, "lat": lat})
            t += DT
            if nxt:
                self.marks[nxt] = self.marks.get(nxt, t)
                if nxt == "vault":
                    hor = (P - pos)
                    hor.z = 0
                    self.theta0 = math.asin(min(0.99, hor.length / G))
                state, t_state = nxt, t
        # headings from motion
        prev = None
        for i, s in enumerate(self.s):
            j = min(len(self.s) - 1, i + 6)
            v_ = self.s[j]["pos"] - s["pos"]
            v_.z = 0
            if s["state"] in ("vault", "air"):
                h = -BACK.copy()
            elif v_.length > 0.02:
                h = v_.normalized()
            else:
                h = prev or sh.at(s["d"])[1]
            s["head"] = h
            prev = h

    def at(self, t):
        return self.s[max(0, min(len(self.s) - 1, int(round(t / DT))))]

    def t_at_d(self, d):
        for s in self.s:
            if s["d"] <= d:
                return s["t"]
        return self.s[-1]["t"]


her = Her()
M_ = her.marks
T_SLIDE, T_REC, T_LUNGE, T_CARRY = M_["slide"], M_["recover"], M_["lunge"], M_["carry"]
T_PLANT, T_APEX, T_LAND, T_ROLL, T_RUN2, T_SKID, T_STAND = (M_[k] for k in ("vault", "air", "land", "roll", "run2", "skid", "stand"))
T_GRAB = T_CARRY - 0.05
for k in ("accel", "slide", "lunge", "carry", "vault", "air", "land", "roll", "run2", "skid", "stand"):
    log(f"her {k:8s} t={M_[k]:.2f} d={her.at(M_[k])['d']:.1f}")


def tb_pos(t):
    return her.at(t)["pos"]


def tb_head(t):
    return tb_pos(t) + Z * 1.52


# ====================================================================== the ship casts off and sails
ship_root.rotation_mode = "XYZ"
M0 = ship_root.matrix_world.copy()
_, tq14, land14, w14 = sh.at(14.0)
MOVE = (-land14 * 0.82 + tq14 * 0.57).normalized()
T_SAIL = 6.5


def ship_dist(t):
    # accelerates from rest to 2.1 m/s over ~5 s
    if t <= T_SAIL:
        return 0.0
    s = 0.0
    n = 40
    for i in range(n):
        tt = T_SAIL + (t - T_SAIL) * (i + 0.5) / n
        s += 1.5 * ease((tt - T_SAIL) / 5.0) * (t - T_SAIL) / n
    return s


def ship_matrix(t):
    moving = smooth(T_SAIL, T_SAIL + 4.0, t)
    rx = math.radians(0.9 * math.sin(t * 0.63 + 0.4) + 1.6 * moving)
    ry = math.radians(0.5 * math.sin(t * 0.8 + 1.1))
    rz = math.radians(-5.0 * smooth(T_SAIL + 1.0, T_SAIL + 9.0, t))
    from mathutils import Euler, Matrix
    piv = M0.translation.copy()
    R_ = Euler((rx, ry, rz)).to_matrix().to_4x4()
    off = MOVE * ship_dist(t) + Z * 0.12 * math.sin(t * 0.8)
    return Matrix.Translation(piv + off) @ R_ @ Matrix.Translation(-piv) @ M0


# the stern castle: probe the deck from above at both ends and take the higher end's top rail
# on the quay side (sails and yards are above 8 m, so the probes start under them)
corners = [c for o in ship_meshes for c in world_bbox(o)]
proj = [(c - ship_root.location).dot(ax) for c in corners]
lo_p, hi_p = min(proj), max(proj)
quay_side = bmv if bmv.dot(land14) > 0 else -bmv


def end_top(sign):
    hits = []
    for i in range(0, 31):
        k = sign * i * 0.4
        for j in (0.0, 0.6, 1.2, 1.8, 2.4):
            o_ = ship_root.location + ax * k + quay_side * j + Z * 7.9
            h_ = ship_bvh.ray_cast(o_, Vector((0, 0, -1)), 7.9)
            if h_[0] is not None and 2.0 < h_[0].z < 5.7:
                hits.append((abs(k), j, h_[0].copy()))
    if not hits:
        return None
    kmax = max(h[0] for h in hits)
    near_end = [h for h in hits if kmax - 2.6 <= h[0] <= kmax - 0.7]
    best = max(near_end or hits, key=lambda h: h[2].z + 0.12 * h[1])
    return (best[2].z, best[2])


ends = [e for e in (end_top(1), end_top(-1)) if e]

STERN = (max(ends, key=lambda e: e[0])[1] if ends else RAIL.copy()) + Z * 0.02
STERN_L = M0.inverted() @ STERN
TOP_L = M0.inverted() @ TOP
log("stern castle", [round(v, 2) for v in STERN], "ends", [round(e[1].z, 2) for e in ends])


def ship_pt(local, t):
    return ship_matrix(t) @ local


# ====================================================================== Rook


class Track(C.RookTrack):
    def position(self, t):
        t0, t1, kind, data = self.at(t)
        if kind == "ride":
            return ship_pt(data["local"], t)
        return super().position(t)


R = Track()
h0 = her.at(0.0)
fwd0 = h0["head"]
right0 = fwd0.cross(Z)
S0 = h0["pos"] - fwd0 * 5.5 + Z * 5.2 + right0 * 0.8
GRAB = h0["pos"] + right0 * 0.42 + Z * 0.05
line_pt = l_rope.rest(0.5)
R.add(0.0, 0.6, "hop", p0=S0, p1=GRAB, apex=0.05)
R.add(0.6, 0.74, "snatch", p=GRAB)
R.add(0.74, 1.3, "hop", p0=GRAB, p1=line_pt, apex=0.55)
R.add(1.3, 1.62, "perch", p=line_pt, amused=True)
A1 = awning_top("A1")
A2 = awning_top("A2")
R1 = r1.rest(0.42)
t_a1 = her.t_at_d(67.0 + 6.3)
R.add(1.62, t_a1, "hop", p0=line_pt, p1=A1, apex=0.5)
R.add(t_a1, t_a1 + 0.15, "perch", p=A1)
t_r1 = her.t_at_d(62.0 + 6.0)
R.add(t_a1 + 0.15, t_r1, "hop", p0=A1, p1=R1, apex=0.45)
R.add(t_r1, t_r1 + 0.18, "perch", p=R1)
t_a2 = her.t_at_d(58.0 + 6.0)
R.add(t_r1 + 0.18, t_a2, "hop", p0=R1, p1=A2, apex=0.4)
R.add(t_a2, t_a2 + 0.15, "perch", p=A2)
t_s1 = her.t_at_d(51.8 + 7.2)
T_KICK = T_SLIDE - 0.05
R.add(t_a2 + 0.15, t_s1, "hop", p0=A2, p1=sign1_bar, apex=0.6)
R.add(t_s1, T_KICK, "perch", p=sign1_bar, amused=True)
t_crate = T_KICK + 0.7
R.add(T_KICK, t_crate, "hop", p0=sign1_bar, p1=CRATE_TOP, apex=0.3)
T_FLAP = T_LUNGE + 0.14
R.add(t_crate, T_FLAP, "perch", p=CRATE_TOP, amused=True)
t_rope2 = T_FLAP + 0.85
ROPE2 = r2.rest(0.5) + Z * 0.02
R.add(T_FLAP, t_rope2, "hop", p0=CRATE_TOP, p1=ROPE2, apex=0.7)
T_OFF = T_APEX + 0.03
R.add(t_rope2, T_OFF, "perch", p=ROPE2, amused=True)
T_SHIP = T_APEX + 2.5
R.add(T_OFF, T_SHIP, "hop", p0=ROPE2, p1=ship_pt(STERN_L, T_SHIP), apex=0.9)
R.add(T_SHIP, C.DURATION + 1, "ride", local=STERN_L, amused=True)
T_TROPHY = T_STAND + 1.2
T_SALUTE = T_TROPHY + 0.55
log("rook: a1", round(t_a1, 2), "r1", round(t_r1, 2), "a2", round(t_a2, 2), "sign", round(t_s1, 2), "crate", round(t_crate, 2),
    "flap", round(T_FLAP, 2), "rope2", round(t_rope2, 2), "off", round(T_OFF, 2), "ship", round(T_SHIP, 2))
for tt in (1.0, 2.0, 3.0, 4.0, 5.0, 6.0):
    log(f"gap t={tt}: {(R.position(tt) - tb_pos(tt)).xy.length:.1f} m, rook z {R.position(tt).z - tb_pos(tt).z:.1f}")


def rook_facing(t):
    t0, t1, kind, data = R.at(t)
    if kind in ("perch", "ride", "snatch"):
        if kind == "ride" or (kind == "perch" and data.get("amused")):
            v = tb_pos(t) - R.position(t)
            v.z = 0
            if v.length > 1e-3:
                return v.normalized()
        nxt = R.at(t1 + 1e-3)
        if nxt[2] == "hop":
            v = nxt[3]["p1"] - nxt[3]["p0"]
            v.z = 0
            if v.length > 1e-3:
                return v.normalized()
        return her.at(t)["head"]
    a = R.position(t)
    b = R.position(min(t1 - 1e-3, t + 0.05))
    v = b - a
    v.z = 0
    if v.length < 1e-4:
        v = R.position(t1 - 1e-3) - R.position(t0)
        v.z = 0
    return v.normalized() if v.length > 1e-4 else her.at(t)["head"]


def yaw_of(v):
    return math.atan2(v.x, -v.y)


# ====================================================================== Trailblazer bake (with aimed limbs)
bones = tb_arm.data.bones
REST_DIR = {b.name: (b.tail_local - b.head_local).normalized() for b in bones}


def apply_aimed(sample, frame, aims=None, extra=None):
    """Retarget.apply, plus aims: {bone: (armature-space direction, weight)} that swing a bone
    from wherever the clip put it toward a direction in her own frame (she faces -Y, up +Z)."""
    dst = rt.dst
    delta = {}
    for _, name in rt.order:
        b = bones[name]
        parent_delta = delta.get(b.parent.name, Quaternion()) if b.parent else Quaternion()
        src = rt.inv.get(name)
        d = sample[src][0] if src and src in sample else parent_delta
        if extra and name in extra:
            d = extra[name] @ d
        if aims and name in aims:
            want, k = aims[name]
            now = d @ REST_DIR[name]
            q = now.rotation_difference(want.normalized())
            d = Quaternion().slerp(q, max(0.0, min(1.0, k))) @ d
        delta[name] = d
        if not name.startswith("J_Bip"):
            continue
        rest = rt.rest[name]
        pb = dst.pose.bones[name]
        pb.rotation_quaternion = rest.inverted() @ parent_delta.inverted() @ d @ rest
        pb.keyframe_insert("rotation_quaternion", frame=frame)
    pel = sample["pelvis"][1]
    off = (pel - rt.src_rest["pelvis"].translation) * rt.scale
    off.x = 0.0
    off.y = 0.0
    hips = dst.pose.bones["J_Bip_C_Hips"]
    hips.location = rt.rest["J_Bip_C_Hips"].inverted() @ off
    hips.keyframe_insert("location", frame=frame)


V = Vector
UP, FWD, DOWN = V((0, 0, 1)), V((0, -1, 0)), V((0, 0, -1))
L_SIDE = V((1, 0, 0))    # her left in her own frame


def her_clips(t):
    s = her.at(t)
    st, u = s["state"], s["u"]
    run_t = (D0 - s["d"]) / clip_speed
    if st == "idle":
        return [("Idle_Loop", t, 1.0)]
    if st == "accel":
        k = ease(u / 0.35)
        return [("Idle_Loop", t, 1 - k), ("Sprint_Loop", run_t, k)]
    if st == "slide":
        if u < 0.25:
            w = ease(u / 0.12)
            return [("Sprint_Loop", run_t, 1 - w), ("Slide_Start", u, w)]
        if u < 0.72:
            return [("Slide_Loop", u - 0.25, 1.0)]
        return [("Slide_Exit", u - 0.72, 1.0)]
    if st == "recover":
        k = ease(u / 0.25)
        return [("Slide_Exit", 0.08 + u, 1 - k), ("Sprint_Loop", run_t, k)]
    if st in ("vault", "air"):
        return [("Jump_Loop", t, 1.0)]
    if st == "land":
        return [("Jump_Land", u, 1.0)]
    if st == "roll":
        return [("Roll", min(u, ROLL_T - 0.01), 1.0)]
    if st == "run2":
        k = ease(u / 0.2)
        return [("Roll", ROLL_T - 0.01, 1 - k), ("Sprint_Loop", run_t, k)]
    if st == "skid":
        k = ease((u - 0.05) / 0.8)
        return [("Sprint_Loop", run_t, 1 - k), ("Idle_Loop", u, k)]
    if st == "stand":
        return [("Idle_Loop", t, 1.0)]
    return [("Sprint_Loop", run_t, 1.0)]


def her_aims(t):
    s = her.at(t)
    st, u = s["state"], s["u"]
    aims, extra = {}, {}
    # the snatch: she flinches and looks down at her hip, then up after him
    k = smooth(0.6, 0.72, t) * (1 - smooth(0.95, 1.2, t))
    if k > 0:
        extra["J_Bip_C_Head"] = Quaternion(V((1, 0, 0)), -0.45 * k) @ Quaternion(V((0, 0, 1)), 0.5 * k)
        extra["J_Bip_C_UpperChest"] = Quaternion(V((0, 0, 1)), 0.35 * k)
    k = smooth(0.95, 1.15, t) * (1 - smooth(1.4, 1.7, t))
    if k > 0:
        extra["J_Bip_C_Head"] = Quaternion(V((1, 0, 0)), 0.3 * k)
    if st == "lunge":
        k = smooth(0.0, 0.18, u)
        reach = FWD * 1.0 + UP * 0.15
        aims["J_Bip_R_UpperArm"] = (reach - L_SIDE * 0.15, k)
        aims["J_Bip_R_LowerArm"] = (reach - L_SIDE * 0.1, k)
        aims["J_Bip_L_UpperArm"] = (reach + L_SIDE * 0.15, k)
        aims["J_Bip_L_LowerArm"] = (reach + L_SIDE * 0.1, k)
        extra["J_Bip_C_Spine"] = Quaternion(V((1, 0, 0)), -0.35 * k)
    if st == "stumble":
        k = 1 - smooth(0.1, 0.3, u)
        extra["J_Bip_C_Spine"] = Quaternion(V((1, 0, 0)), -0.3 * k)
    if st == "carry" or (st == "stumble" and u > 0.15):
        k = smooth(T_GRAB, T_GRAB + 0.15, t)
        raise_k = smooth(T_PLANT - 0.3, T_PLANT, t)
        low = FWD * 0.75 + DOWN * 0.65
        high = FWD * 0.35 + UP * 0.94
        aims["J_Bip_R_UpperArm"] = (low.lerp(high, raise_k) - L_SIDE * 0.1, k)
        aims["J_Bip_R_LowerArm"] = (low.lerp(high, raise_k) - L_SIDE * 0.05, k)
        aims["J_Bip_L_UpperArm"] = ((FWD * 0.9 + DOWN * 0.2 - L_SIDE * 0.35).lerp(high, raise_k), k)
        aims["J_Bip_L_LowerArm"] = ((FWD * 0.9 - L_SIDE * 0.6).lerp(high, raise_k), k)
    if st == "vault":
        over = UP * 1.0 + FWD * 0.12
        for b in ("J_Bip_R_UpperArm", "J_Bip_R_LowerArm", "J_Bip_L_UpperArm", "J_Bip_L_LowerArm"):
            aims[b] = (over + (L_SIDE if "_L_" in b else -L_SIDE) * 0.06, 1.0)
        # legs swing up and forward as the pole rights itself
        kl = smooth(0.2, 0.9, u / TV)
        aims["J_Bip_R_UpperLeg"] = (DOWN * 0.55 + FWD * 0.83, kl * 0.8)
        aims["J_Bip_L_UpperLeg"] = (DOWN * 0.7 + FWD * 0.7, kl * 0.8)
    if st == "air":
        # the reach: right hand straight up at his tail, then everything flails for the ground
        kr = 1 - smooth(0.32, 0.55, u)
        aims["J_Bip_R_UpperArm"] = (UP * 1.0 + FWD * 0.15, kr)
        aims["J_Bip_R_LowerArm"] = (UP * 1.0 + FWD * 0.2, kr)
        kl = 1 - smooth(0.05, 0.3, u)
        aims["J_Bip_L_UpperArm"] = ((UP * 0.2 + L_SIDE * 1.0).lerp(UP, kl), 0.9)
        extra["J_Bip_C_Head"] = Quaternion(V((1, 0, 0)), 0.45 * (1 - smooth(0.3, 0.6, u)))
        extra["J_Bip_C_UpperChest"] = Quaternion(V((1, 0, 0)), 0.2 * (1 - smooth(0.3, 0.6, u)))
    if st in ("skid", "stand"):
        kl = smooth(T_SKID + 0.4, T_SKID + 1.2, t)
        extra["J_Bip_C_Neck"] = Quaternion(V((1, 0, 0)), 0.18 * kl)
        extra["J_Bip_C_Head"] = Quaternion(V((1, 0, 0)), 0.22 * kl)
        extra["J_Bip_C_UpperChest"] = Quaternion(V((1, 0, 0)), 0.06 * kl + 0.05 * math.sin(t * 5.5) * kl)
    return aims, extra


log("baking Trailblazer")
tb_arm.animation_data_create()
for f in FRAMES:
    t = C.frame_time(f)
    samples = [(clips.sample(n, ct, loop=n.endswith("Loop")), w) for n, ct, w in her_clips(t)]
    s_, acc = samples[0]
    for smp, w in samples[1:]:
        if acc + w <= 0:
            continue
        s_ = ch.blend_samples(s_, smp, w / (acc + w))
        acc += w
    aims, extra = her_aims(t)
    apply_aimed(s_, f, aims, extra)
    st = her.at(t)
    h = st["head"]
    if st["state"] in ("skid", "stand"):
        # turn to face him on the stern as she stops
        v_ = R.position(t) - st["pos"]
        v_.z = 0
        h = h.lerp(v_.normalized(), smooth(T_SKID + 0.3, T_SKID + 1.1, t)).normalized()
    tb_root.location = st["pos"]
    # a lean back as she rides the pole up
    pitch = 0.0
    if st["state"] == "vault":
        pitch = math.radians(-14) * math.sin(math.pi * min(1.0, st["u"] / TV))
    tb_root.rotation_euler = (pitch, 0, yaw_of(h))
    tb_root.keyframe_insert("location", frame=f)
    tb_root.keyframe_insert("rotation_euler", frame=f)
log("Trailblazer body keyed")

# ====================================================================== Rook bake


def capture():
    return {pb.name: (pb.location.copy(), pb.rotation_euler.copy()) for pb in rk_arm.pose.bones}


def pose_dict(fn):
    rp.reset()
    fn()
    return capture()


def blend(a, b, k):
    out = {}
    for n in a:
        la, ra = a[n]
        lb, rb = b[n]
        out[n] = (la.lerp(lb, k), type(ra)((ra.x + (rb.x - ra.x) * k, ra.y + (rb.y - ra.y) * k, ra.z + (rb.z - ra.z) * k)))
    return out


def look_yaw(t, facing):
    to = tb_head(t) - R.position(t)
    to.z = 0
    if to.length < 1e-3:
        return 0.0
    a = math.degrees(math.atan2(facing.x * to.y - facing.y * to.x, facing.dot(to.normalized()) * to.length))
    return max(-110.0, min(110.0, a))


def rook_pose(t):
    t0, t1, kind, data = R.at(t)
    fac = rook_facing(t)
    ly = look_yaw(t, fac)
    if kind == "snatch":
        return pose_dict(lambda: (rp.crouch(0.9, ly), rp.head(ly, pitch=34, beak=28 * (1 - smooth(t0 + 0.06, t0 + 0.1, t)))))
    if kind in ("perch", "ride"):
        amused = 1.0 if data.get("amused") else 0.0
        tilt = 16 * math.sin(t * 2.2) if amused else 5.0
        if kind == "ride" and t >= T_TROPHY:
            ks = smooth(T_SALUTE, T_SALUTE + 0.35, t) * (1 - smooth(T_SALUTE + 1.6, T_SALUTE + 2.0, t))
            if ks > 0:
                base = pose_dict(lambda: rp.salute(t, ks))
            else:
                base = pose_dict(lambda: rp.perch(t, look_yaw=ly, look_pitch=18 * smooth(T_TROPHY, T_TROPHY + 0.3, t), tilt=tilt, amused=1.0, lean=-8))
        else:
            pitch = -22 if (kind == "perch" and data["p"] is ROPE2) else -6
            base = pose_dict(lambda: rp.perch(t, look_yaw=ly, look_pitch=pitch, tilt=tilt, amused=amused, lean=6 if amused else 0))
        prev = R.at(t0 - 1e-3)
        if prev[2] == "hop" and t - t0 < 0.2:
            base = blend(base, pose_dict(lambda: rp.land(1.0, ly)), 1 - ease((t - t0) / 0.2))
        nxt = R.at(t1 + 1e-3)
        if nxt[2] == "hop" and t1 - t < 0.16:
            base = blend(base, pose_dict(lambda: rp.crouch(1.0, ly * 0.5)), ease(1 - (t1 - t) / 0.16))
        return base
    if kind == "hop":
        u = (t - t0) / max(1e-3, t1 - t0)
        dur = t1 - t0
        lp = pose_dict(lambda: rp.leap(1.0, t))
        tk = pose_dict(lambda: rp.tuck(1.0, t))
        ld = pose_dict(lambda: rp.land(0.7))
        if dur > 1.1:
            # a long glide: wings wide and beating, legs tucked, landing gear down at the end
            glide = blend(lp, tk, 0.45)
            land_u = 1 - 0.3 / dur
            return glide if u < land_u else blend(glide, ld, ease((u - land_u) / (1 - land_u)))
        if u < 0.3:
            return blend(lp, tk, ease(u / 0.3))
        if u < 0.75:
            return tk
        return blend(tk, ld, ease((u - 0.75) / 0.25))
    return pose_dict(lambda: rp.perch(t))


log("baking Rook")
for pb in rk_arm.pose.bones:
    pb.rotation_mode = "XYZ"
for f in FRAMES:
    t = C.frame_time(f)
    for name, (loc, rot) in rook_pose(t).items():
        pb = rk_arm.pose.bones[name]
        pb.location = loc
        pb.rotation_euler = rot
        pb.keyframe_insert("location", frame=f)
        pb.keyframe_insert("rotation_euler", frame=f)
    rk_root.location = R.position(t)
    t0, t1, kind, data = R.at(t)
    pitch = 0.0
    if kind == "hop":
        u = (t - t0) / max(1e-3, t1 - t0)
        pitch = math.radians(-18 * math.sin(math.pi * u))
    rk_root.rotation_euler = (pitch, 0, yaw_of(rook_facing(t)))
    rk_root.keyframe_insert("location", frame=f)
    rk_root.keyframe_insert("rotation_euler", frame=f)
log("Rook keyed")


def seg_u(t, a, b):
    return max(0.0, min(1.0, (t - a) / (b - a)))


# ====================================================================== props: the compass and the pole
brass = env.simple_material("hero_brass", (0.85, 0.6, 0.22, 1), rough=0.4, metal=1.0, emission=(1.0, 0.72, 0.3, 1), strength=0.08)


def make_compass(name):
    import bmesh as bm_
    b = bm_.new()
    bm_.ops.create_cone(b, cap_ends=True, segments=24, radius1=0.075, radius2=0.075, depth=0.02)
    bm_.ops.rotate(b, verts=b.verts, cent=(0, 0, 0), matrix=__import__("mathutils").Matrix.Rotation(math.pi / 2, 3, "X"))
    me = bpy.data.meshes.new(name)
    b.to_mesh(me)
    b.free()
    ob = bpy.data.objects.new(name, me)
    common.link(ob)
    ob.data.materials.append(brass)
    return ob


comp_her = make_compass("hero_compass_her")
comp_rook = make_compass("hero_compass_rook")

import bmesh as _bmp
_b = _bmp.new()
_bmp.ops.create_cone(_b, cap_ends=True, segments=8, radius1=0.04, radius2=0.032, depth=POLE_LEN)
_bmp.ops.translate(_b, verts=_b.verts, vec=(0, 0, POLE_LEN / 2))
pole = sd.mesh_obj("hero_pole", _b, bpy.data.materials.get("hero_wood_dark") or bpy.data.materials.get("hero_wood"))
pole.rotation_mode = "QUATERNION"
g_state = her.at(T_GRAB)
_, tqg, landg, wg = sh.at(g_state["d"])
POLE_REST_TIP = g_state["pos"] + landg * 0.75 - tqg * 0.35
POLE_REST_TIP.z = g_state["pos"].z
POLE_REST_DIR = (Z * 0.96 + landg * 0.28).normalized()


def her_right(t):
    return her.at(t)["head"].cross(Z)


def pole_state(t):
    s = her.at(t)
    fwd = s["head"]
    grip = s["pos"] + Z * 1.02 + her_right(t) * 0.2
    carry_tip = grip + fwd * 3.85 - Z * 0.62
    if t < T_GRAB - 0.08:
        return POLE_REST_TIP, POLE_REST_DIR
    if t < T_GRAB + 0.12:
        k = ease((t - (T_GRAB - 0.08)) / 0.2)
        return POLE_REST_TIP.lerp(carry_tip, k), POLE_REST_DIR.lerp((grip - carry_tip).normalized(), k).normalized()
    if t < T_PLANT:
        k = smooth(T_PLANT - 0.3, T_PLANT, t)
        hands0 = P + BACK * G * math.sin(her.theta0) + Z * G * math.cos(her.theta0)
        tip = carry_tip.lerp(P, k)
        g_ = grip.lerp(hands0, k)
        return tip, (g_ - tip).normalized()
    if t < T_APEX:
        uu = min(1.0, (t - T_PLANT) / TV)
        th = her.theta0 * (1 - (1 - (1 - uu) ** 2))
        return P, (BACK * math.sin(th) + Z * math.cos(th)).normalized()
    # released: it carries on over and falls flat
    e = min(1.0, (t - T_APEX) / 1.05)
    th = -1.52 * e * e
    return P, (BACK * math.sin(th) + Z * math.cos(th)).normalized()


for f in FRAMES:
    t = C.frame_time(f)
    tip, dvec = pole_state(t)
    pole.location = tip
    pole.rotation_quaternion = Z.rotation_difference(dvec)
    pole.keyframe_insert("location", frame=f)
    pole.keyframe_insert("rotation_quaternion", frame=f)

# ropes, sign, lanterns
l_rope.load(1.3, 1.62, lambda t: 0.5, 0.2)
r1.load(t_r1, t_r1 + 0.18, lambda t: 0.42, 0.24)
r2.load(t_rope2, T_OFF, lambda t: 0.5, 0.3)
for rope in (l_rope, r1, r2, r3):
    rope.bake(FRAMES)
for ob, (t0_, t1_) in zip(laundry["sheets"], laundry["spans"]):
    um = (t0_ + t1_) / 2
    base = ob.location.copy()
    for f in FRAMES:
        t = C.frame_time(f)
        ob.location = base + Vector((0, 0, l_rope.offset(um, t)))
        ob.keyframe_insert("location", frame=f)
pends = []
for L, rope, seed in ((lan1, r1, 1), (lan2, r2, 2), (lan3, r3, 3)):
    along = (L["b"] - L["a"])
    along.z = 0
    along.normalize()
    across = along.cross(Vector((0, 0, 1)))
    for i, (piv, u) in enumerate(zip(L["pivots"], L["us"])):
        pd = fx.Pendulum(piv, 0.5, across, along, damping=1.1, wind=0.25, seed=seed * 3 + i)
        pd.follow = (lambda u_, rope_: (lambda tt: rope_.point(u_, tt)))(u, rope)
        pends.append(pd)
        if rope is r2:
            pd.kick(T_OFF, 2.6 * (1 if i % 2 else -1), 1.2)
_, tq52, land52, _ = sh.at(51.8)
sp = fx.Pendulum(sign1, 0.62, land52, tq52, damping=0.45, wind=0.2, seed=7)
sp.kick(t_s1, 1.2)
sp.kick(T_KICK, -6.5)
pends.append(sp)
pends.append(fx.Pendulum(S["signs"]["S2"], 0.55, sh.at(38.5)[2], sh.at(38.5)[1], damping=0.8, wind=0.35, seed=9))
for pd in pends:
    pd.bake(FRAMES)
log("ropes, lanterns and sign keyed")

# gulls: off the roofs when he bursts up from the stall; off the yards when he lands aboard
roof_birds = [roof[i] + Vector((0, 0, 0.02)) for i in range(4, min(len(roof), 18), 2)]
fx.flock("hero_gulls_roof", roof_birds, T_FLAP + 0.1, -sh.at(42.0)[2] + Vector((0, 0, 0.3)), FRAMES, climb=4.5, speed=8.0,
         circle=(road(30.0, -18.0, 10.0), 16.0))
Ms = ship_matrix(T_SHIP)
yard_pts = [Ms @ (TOP_L + (M0.inverted().to_3x3() @ ax) * (k - 3) * 1.6 + Vector((0, 0, 3.5 + (k % 3) * 2.2))) for k in range(8)]
fx.flock("hero_gulls_ship", yard_pts, T_SHIP + 0.1, -land14 + tq14 * 0.3, FRAMES, climb=6.0, speed=7.0,
         circle=(Ms @ TOP_L + Vector((0, 0, 4.0)), 14.0))

# the ship and its wake
for f in FRAMES:
    t = C.frame_time(f)
    ship_root.matrix_world = ship_matrix(t)
    ship_root.keyframe_insert("location", frame=f)
    ship_root.keyframe_insert("rotation_euler", frame=f)


def build_wake():
    import bmesh as bm_
    me = bpy.data.meshes.new("hero_wake")
    b = bm_.new()
    n_l, n_w = 24, 6
    L_, W_ = 22.0, 9.0
    grid = [[b.verts.new((-(j / n_l) * L_, (i / n_w - 0.5) * W_ * (0.45 + 0.55 * j / n_l), 0.0)) for i in range(n_w + 1)] for j in range(n_l + 1)]
    for j in range(n_l):
        for i in range(n_w):
            b.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
    uvl = b.loops.layers.uv.new()
    for fc in b.faces:
        for lp in fc.loops:
            lp[uvl].uv = (-lp.vert.co.x / L_, lp.vert.co.y / W_ + 0.5)
    b.to_mesh(me)
    b.free()
    ob = bpy.data.objects.new("hero_wake", me)
    common.link(ob)
    m = bpy.data.materials.new("hero_wake_mat")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    pr = nt.nodes.new("ShaderNodeBsdfPrincipled")
    pr.inputs["Base Color"].default_value = (0.92, 0.94, 0.95, 1)
    pr.inputs["Roughness"].default_value = 0.6
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    mix = nt.nodes.new("ShaderNodeMixShader")
    uvn = nt.nodes.new("ShaderNodeUVMap")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 9.0
    nz.inputs["Detail"].default_value = 8.0
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.52
    ramp.color_ramp.elements[1].position = 0.7
    info = nt.nodes.new("ShaderNodeObjectInfo")
    m1 = nt.nodes.new("ShaderNodeMath")
    m1.operation = "MULTIPLY"
    m2 = nt.nodes.new("ShaderNodeMath")
    m2.operation = "MULTIPLY"
    fade = nt.nodes.new("ShaderNodeMath")
    fade.operation = "SUBTRACT"
    fade.inputs[0].default_value = 1.0
    edge = nt.nodes.new("ShaderNodeMath")
    edge.operation = "PINGPONG"
    edge.inputs[1].default_value = 0.5
    m3 = nt.nodes.new("ShaderNodeMath")
    m3.operation = "MULTIPLY"
    lk = nt.links.new
    lk(uvn.outputs["UV"], nz.inputs["Vector"])
    lk(uvn.outputs["UV"], sep.inputs["Vector"])
    lk(nz.outputs["Fac"], ramp.inputs["Fac"])
    lk(sep.outputs["X"], fade.inputs[1])
    lk(sep.outputs["Y"], edge.inputs[0])
    lk(ramp.outputs["Color"], m1.inputs[0])
    lk(fade.outputs["Value"], m1.inputs[1])
    lk(m1.outputs["Value"], m3.inputs[0])
    lk(edge.outputs["Value"], m3.inputs[1])
    lk(m3.outputs["Value"], m2.inputs[0])
    lk(info.outputs["Alpha"], m2.inputs[1])
    lk(m2.outputs["Value"], mix.inputs["Fac"])
    lk(tr.outputs["BSDF"], mix.inputs[1])
    lk(pr.outputs["BSDF"], mix.inputs[2])
    lk(mix.outputs["Shader"], out.inputs["Surface"])
    if hasattr(m, "surface_render_method"):
        m.surface_render_method = "DITHERED"
    ob.data.materials.append(m)
    return ob


wake = build_wake()
wake.rotation_mode = "XYZ"
beam_c = sum((c for c in corners), Vector()) / len(corners)
for f in FRAMES:
    t = C.frame_time(f)
    Mt = ship_matrix(t)
    c = Mt @ (M0.inverted() @ Vector((beam_c.x, beam_c.y, 0.0)))
    wake.location = Vector((c.x, c.y, 0.06)) - MOVE * 2.0
    wake.rotation_euler = (0, 0, math.atan2(MOVE.y, MOVE.x))
    spd = 1.5 * ease((t - T_SAIL) / 5.0) if t > T_SAIL else 0.0
    wake.color = (1, 1, 1, min(1.0, spd / 1.2) * 0.95)
    wake.keyframe_insert("location", frame=f)
    wake.keyframe_insert("rotation_euler", frame=f)
    wake.keyframe_insert("color", frame=f)
log("ship and wake keyed")

# fruit: she hits the crate as she lunges
if not NO_SIM:
    k_fruit = [o for o in fruit if "_f1_" in o.name] + [o for o in fruit if "_f2_" in o.name][:6]
    _, tq45, land45, _ = sh.at(44.8)
    fx.fruit_spill(k_fruit, crates[1], T_LUNGE + 0.3, (tq45 + land45 * 0.5).normalized(), sh.at(44.8)[0].z + 0.03, FRAMES)

fx.awning_motion(S["awnings"]["A1"][0], FRAMES, [(A1, t_a1, t_a1 + 0.15)], seed=1, gust=1.0)
fx.awning_motion(S["awnings"]["A2"][0], FRAMES, [(A2, t_a2, t_a2 + 0.15)], seed=2, gust=0.9)
fx.awning_motion(S["awnings"]["A3"][0], FRAMES, [], seed=3, gust=1.1)
fx.awning_motion(S["awnings"]["A4"][0], FRAMES, [], seed=4, gust=0.8)
for f in FRAMES:
    t = C.frame_time(f)
    for (c, tl, tv) in ((A1, t_a1, t_a1 + 0.15), (A2, t_a2, t_a2 + 0.15)):
        if tl <= t < tv:
            e = t - tl
            rk_root.location = R.position(t) - Vector((0, 0, 0.26 * min(1.0, e / 0.07) * (1.0 + 0.3 * math.exp(-e * 10) * math.sin(e * 45))))
            rk_root.keyframe_insert("location", frame=f)

# cloth: wind down the street; she runs through the sheets
_tq76 = sh.at(76.0)[1]
wind = fx.wind_field(road(82.0, 0.0, 3.2), (_tq76 + Vector((0, 0, 0.12))).normalized(), strength=34.0, noise=6.0)
bpy.ops.object.effector_add(type="TURBULENCE", location=road(76.0, 0.0, 3.0))
turb = bpy.context.object
turb.field.strength = 14.0
turb.field.size = 0.9
turb.field.flow = 0.0
for o in bpy.data.objects:
    for md in getattr(o, "modifiers", []):
        if md.type == "CLOTH":
            md.point_cache.frame_start = -48
            md.settings.air_damping = 0.6
body = next(o for o in tb_meshes if o.name == "Body")
body.modifiers.new("collision", "COLLISION")
body.collision.thickness_outer = 0.03
body.collision.cloth_friction = 2.0
if NO_SIM:
    for o in bpy.data.objects:
        for md in list(getattr(o, "modifiers", [])):
            if md.type == "CLOTH":
                o.modifiers.remove(md)

# springs, then the compass rides her belt and then his beak (both need the evaluated rigs)
springs = ch.VrmSprings(tb_arm)
T_STEAL = 0.66
hips_pb = tb_arm.pose.bones["J_Bip_C_Hips"]
jaw_pb = rk_arm.pose.bones["jaw"]
head_pb = rk_arm.pose.bones["head"]
for f in FRAMES:
    sc.frame_set(f)
    springs.step(f)
    t = C.frame_time(f)
    hp = tb_arm.matrix_world @ hips_pb.head
    fwd = her.at(t)["head"]
    rgt = fwd.cross(Z)
    comp_her.location = hp + rgt * 0.19 + fwd * 0.04 - Z * 0.1
    comp_her.rotation_euler = (0, 0, yaw_of(fwd) + math.pi / 2)
    tip = rk_arm.matrix_world @ jaw_pb.tail
    jh = rk_arm.matrix_world @ jaw_pb.head
    comp_rook.location = jh.lerp(tip, 0.8) - Z * 0.06
    comp_rook.rotation_euler = (0.25 * math.sin(t * 7.0), 0, yaw_of(rook_facing(t)) + 0.4 * math.sin(t * 3.1))
    for ob in (comp_her, comp_rook):
        ob.keyframe_insert("location", frame=f)
        ob.keyframe_insert("rotation_euler", frame=f)
    for ob, vis in ((comp_her, t < T_STEAL), (comp_rook, t >= T_STEAL)):
        for o in [ob] + list(ob.children):
            o.hide_render = not vis
            o.keyframe_insert("hide_render", frame=f)
springs.write()
log("springs and compass keyed")

# ====================================================================== screen time: a slow-motion window at the apex
SLOW_A, SLOW_B, SLOW_K, RAMP = T_APEX - 0.33, T_APEX + 0.16, 0.3, 0.1


def story_rate(tau):
    if tau < SLOW_A - RAMP or tau > SLOW_B + RAMP:
        return 1.0
    k = smooth(SLOW_A - RAMP, SLOW_A, tau) * (1 - smooth(SLOW_B, SLOW_B + RAMP, tau))
    return 1.0 + (SLOW_K - 1.0) * k


screen_to_story = []
tau, s_ = 0.0, 0.0
ds = 1.0 / (FPS * 8)
while tau < C.DURATION:
    screen_to_story.append((s_, tau))
    tau += story_rate(tau) * ds
    s_ += ds
SCREEN_DUR = s_
N_OUT = int(SCREEN_DUR * FPS) + 1
log(f"screen length {SCREEN_DUR:.2f}s ({N_OUT} frames), story {C.DURATION}s")


def story_of_screen(s):
    i = max(0, min(len(screen_to_story) - 1, int(round(s / ds))))
    return screen_to_story[i][1]


def screen_of_story(tau):
    for s, tt in screen_to_story:
        if tt >= tau:
            return s
    return SCREEN_DUR


# ====================================================================== camera
cam = bpy.data.objects.new("hero_cam", bpy.data.cameras.new("hero_cam"))
common.link(cam)
sc.camera = cam
if RES[0] > RES[1]:
    cam.data.sensor_fit = "VERTICAL"
    cam.data.sensor_height = 36.0
else:
    cam.data.sensor_fit = "AUTO"
cam.data.clip_start = 0.08
cam.data.dof.use_dof = True
cam.data.dof.aperture_fstop = 3.2
cam.rotation_mode = "QUATERNION"


def rook_pos(t):
    return R.position(t) + Z * 0.55


def stern(t):
    return ship_pt(STERN_L, t)


def rig_steal(t):
    s = her.at(t)
    fwd = s["head"]
    rgt = fwd.cross(Z)
    p = s["pos"] + fwd * 0.6 + rgt * 2.5 + Z * 1.15
    tgt = s["pos"] + Z * 1.0 + rgt * 0.2 - fwd * 0.3
    return p, tgt, 30.0, s["pos"] + Z * 1.0 + rgt * 0.3


def rig_chase(t):
    s = her.at(t)
    fwd = s["head"]
    p = s["pos"] - fwd * 2.9 - fwd.cross(Z) * 0.75 + Z * 1.7
    tgt = tb_head(t).lerp(rook_pos(t), 0.62)
    return p, tgt, 27.0, tb_head(t).lerp(rook_pos(t), 0.5)


def rig_slide(t):
    d = her.at(t)["d"]
    p = road(d + 3.4, 0.7, 0.75)
    tgt = road(d - 3.5, 1.1, 1.55)
    return p, tgt, 20.0, tb_head(t)


def rig_stall(t):
    _, tqs, lands, ws = sh.at(STALL_D - 0.6)
    p = sh.at(STALL_D - 0.6)[0] - lands * (ws / 2 - 0.6) + Z * 1.45
    look = CRATE_TOP + Z * 0.3
    tgt = look.lerp(rook_pos(t), smooth(T_FLAP, T_FLAP + 0.5, t) * 0.8)
    return p, tgt, 21.0, CRATE_TOP


def rig_vault(t):
    side = -sh.at(P_D)[2]
    her_c = tb_pos(t) + Z * 1.1
    focus = her_c.lerp(rook_pos(t), 0.45)
    along_ = (focus - P).dot(BACK)
    p = P + BACK * (0.6 * along_ - 1.6) + side * 3.5 + Z * 1.8
    tgt = P + BACK * along_ + Z * max(1.6, focus.z - P.z)
    return p, tgt, 20.0, her_c


def rig_escape(t):
    s = her.at(t)
    to = stern(t) - s["pos"]
    to.z = 0
    to.normalize()
    p = s["pos"] - to * 3.3 + to.cross(Z) * 0.9 + Z * 2.0
    tgt = tb_head(t).lerp(rook_pos(t) if t < T_SHIP else stern(t) + Z * 0.8, 0.72)
    return p, tgt, 24.0, tb_head(t).lerp(stern(t), 0.6)


def rig_standoff(t):
    s = her.at(t)
    to = stern(t) - s["pos"]
    to.z = 0
    to.normalize()
    k = smooth(T_STAND, T_TROPHY, t)
    p = s["pos"] - to * (1.8 - 0.3 * k) - to.cross(Z) * 0.6 + Z * 1.55
    tgt = tb_head(t).lerp(stern(t) + Z * 0.7, 0.45)
    return p, tgt, 26.0, stern(t)


def rig_trophy(t):
    # low and in front of him, looking up: the compass held high against the sails
    r = rook_pos(t)
    hp = tb_head(t)
    to_her = hp - r
    to_her.z = 0
    to_her.normalize()
    side = to_her.cross(Z)
    p = r + to_her * 1.35 + side * 1.1 - Z * 0.45
    return p, r + Z * 0.25, 32.0, r + Z * 0.2


def rig_final(t):
    # wide from the quay: her at the edge, the ship and him going away into the sun
    s = her.at(t)
    to = stern(t) - s["pos"]
    to.z = 0
    to.normalize()
    k = smooth(T_TROPHY + 1.4, C.DURATION, t)
    p = s["pos"] - to * (4.2 + 1.2 * k) - to.cross(Z) * 1.5 + Z * (2.4 + 0.5 * k)
    return p, (s["pos"] + Z * 1.0).lerp(stern(t), 0.55), 24.0, stern(t)


SCHEDULE = [   # (start, rig, blend seconds; 0 = hard cut)
    (0.0, rig_steal, 0.0),
    (T_GO - 0.05, rig_chase, 0.0),
    (T_SLIDE - 0.15, rig_slide, 0.45),
    (T_REC + 0.3, rig_stall, 0.0),
    (T_FLAP + 0.55, rig_vault, 0.0),
    (T_LAND + 0.2, rig_escape, 0.0),
    (T_STAND - 0.4, rig_standoff, 0.8),
    (T_TROPHY, rig_trophy, 0.0),
    (T_TROPHY + 1.4, rig_final, 0.0),
]
for ts, rig, bl in SCHEDULE:
    log(f"shot {rig.__name__:13s} story {ts:5.2f}  screen {screen_of_story(ts):5.2f}")


def camera_at(t):
    cur = max(i for i, (ts, _, _) in enumerate(SCHEDULE) if t >= ts)
    ts, rig, bl = SCHEDULE[cur]
    p, tg, lens, fp = rig(t)
    if cur > 0 and bl > 0 and t < ts + bl:
        pp, ptg, plens, pfp = SCHEDULE[cur - 1][1](t)
        k = ease((t - ts) / bl)
        p, tg, lens, fp = pp.lerp(p, k), ptg.lerp(tg, k), plens + (lens - plens) * k, pfp.lerp(fp, k)
    return p, tg, lens, fp


cp = ct = None
vcp = Vector()
vct = Vector()
prev_idx = -1
for f in FRAMES:
    t = C.frame_time(f)
    p, tg, lens, fp = camera_at(t)
    idx = max(i for i, (ts, _, _) in enumerate(SCHEDULE) if t >= ts)
    cut = idx != prev_idx and SCHEDULE[idx][2] == 0.0
    prev_idx = idx
    if cp is None or cut:
        cp, ct = p.copy(), tg.copy()
        vcp, vct = Vector(), Vector()
    stiff = 90.0 if SCHEDULE[idx][1] in (rig_chase, rig_escape) else 140.0
    dt = 1.0 / FPS
    for _ in range(4):
        h = dt / 4
        acc = (p - cp) * stiff - vcp * 2 * math.sqrt(stiff)
        vcp += acc * h
        cp += vcp * h
        acc = (tg - ct) * stiff * 1.6 - vct * 2 * math.sqrt(stiff * 1.6)
        vct += acc * h
        ct += vct * h
    amp = 0.35 if SCHEDULE[idx][1] is rig_trophy else 1.0
    shake = Vector((math.sin(t * 7.1) * 0.012 + math.sin(t * 13.3) * 0.006, math.sin(t * 6.3 + 1) * 0.012, math.sin(t * 9.7 + 2) * 0.01)) * amp
    cam.location = cp + shake
    common.look_at(cam, ct, roll=0.02 * math.sin(t * 1.9))
    cam.data.lens = lens
    cam.data.dof.focus_distance = max(0.5, (fp - cam.location).length)
    cam.data.dof.aperture_fstop = {rig_trophy: 2.4, rig_final: 5.6}.get(SCHEDULE[idx][1], 3.2)
    for dp, ob in (("location", cam), ("rotation_quaternion", cam)):
        ob.keyframe_insert(dp, frame=f)
    cam.data.keyframe_insert("lens", frame=f)
    cam.data.dof.keyframe_insert("focus_distance", frame=f)
    cam.data.dof.keyframe_insert("aperture_fstop", frame=f)
log("camera keyed")
for tt in (T_SHIP, T_TROPHY, C.DURATION - 0.1):
    log(f"t={tt:.2f} rook {[round(v, 1) for v in R.position(tt)]} her {[round(v, 1) for v in tb_pos(tt)]} dist {(R.position(tt) - tb_pos(tt)).length:.1f} ship moved {ship_dist(tt):.1f}")

# ====================================================================== events (screen time) for the sound
import json as _json
S_ = screen_of_story
events = {"fps": FPS, "duration": SCREEN_DUR, "footsteps": [], "rook_hops": [], "rook_lands": [],
          "awning": [S_(t_a1), S_(t_a2)], "sign_kick": S_(T_KICK), "slide": [S_(T_SLIDE), S_(T_REC)], "crate": S_(T_LUNGE + 0.3),
          "gulls": [S_(T_FLAP + 0.1), S_(T_SHIP + 0.1)], "steal": S_(T_STEAL), "plant": S_(T_PLANT), "apex": S_(T_APEX),
          "slow": [S_(SLOW_A), S_(SLOW_B)], "land": S_(T_LAND), "roll": S_(T_ROLL), "skid": [S_(T_SKID), S_(T_STAND)],
          "salute": S_(T_SALUTE), "trophy": S_(T_TROPHY), "laundry_burst": S_(her.t_at_d(76.2)), "ship_sail": S_(T_SAIL),
          "cuts": [S_(ts) for ts, _, bl in SCHEDULE if bl == 0.0 and ts > 0]}
for t0, t1, kind, data in R.segs:
    if kind == "hop":
        events["rook_hops"].append(round(S_(t0), 3))
        events["rook_lands"].append(round(S_(t1), 3))
feet_bones = [tb_arm.pose.bones["J_Bip_L_ToeBase"], tb_arm.pose.bones["J_Bip_R_Foot"]]
low = [True, True]
for f in FRAMES:
    sc.frame_set(f)
    t = C.frame_time(f)
    st = her.at(t)
    for i, fb in enumerate(feet_bones):
        z = (tb_arm.matrix_world @ fb.head).z - st["pos"].z
        down = z < (0.07 if i == 0 else 0.13)
        if down and not low[i] and st["v"] > 1.0 and st["state"] in ("accel", "run", "recover", "carry", "run2", "skid", "lunge", "stumble"):
            events["footsteps"].append(round(S_(t), 3))
        low[i] = down
os.makedirs(OUT, exist_ok=True)
with open(os.path.join(OUT, "events.json"), "w") as fh:
    _json.dump(events, fh, indent=1)
log("events", len(events["footsteps"]), "footsteps")

# ====================================================================== sims, render (screen frames from story subframes)
env.render_settings(res=RES, samples=SAMPLES, preview=PREVIEW)
if not NO_SIM:
    sc.frame_set(1)
    with bpy.context.temp_override(scene=sc):
        bpy.ops.ptcache.bake_all(bake=True)
    log("sims baked")
if BLEND:
    bpy.ops.wm.save_as_mainfile(filepath=BLEND)
    log("saved", BLEND)
F0, F1 = (int(v) for v in arg("--frames", f"1-{N_OUT}").split("-"))
sc.render.image_settings.file_format = "PNG"
for fo in range(F0, min(F1, N_OUT) + 1, STEP):
    tau = story_of_screen((fo - 1) / FPS)
    fs = 1 + tau * FPS
    fi = int(math.floor(fs))
    sc.frame_set(fi, subframe=fs - fi)
    sc.render.filepath = os.path.join(OUT, f"f{fo:04d}.png")
    bpy.ops.render.render(write_still=True)
    if fo % 24 == 0 or fo == F0:
        log("rendered", fo, "story", round(tau, 2))
log("done")
