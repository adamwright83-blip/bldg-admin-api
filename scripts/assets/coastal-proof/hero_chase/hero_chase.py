"""The Rook chase hero sequence: build, choreograph, bake and render (Blender 5.2, EEVEE).

    /Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/assets/coastal-proof/hero_chase/hero_chase.py -- \
        [--preview] [--res 1080x1920] [--samples 48] [--frames 1-445] [--out DIR] [--blend FILE] [--no-sim]

Not --factory-startup: the VRM add-on (installed in the user's Blender) imports Trailblazer.
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

# ====================================================================== Trailblazer path
tb = C.TrailblazerPath(sh, d_start=85.0)
tb.clip_speed = clips.ground_speed("Sprint_Loop") * rt.scale
log("sprint ground speed", round(tb.clip_speed, 2), "m/s at 1x")


def tb_lateral(t):
    p, tq, land, w = sh.at(tb.d(t))
    x = -0.35 + 0.55 * (1 - smooth(1.6, 2.4, t))          # centred on the middle sheet for the burst
    x += 1.05 * smooth(5.45, 5.85, t) * (1 - smooth(6.05, 6.55, t))
    x += 1.55 * smooth(3.7, 4.35, t) * (1 - smooth(5.1, 5.6, t))           # under the swinging sign
    edge = -(w / 2 - 0.75)
    x = x + (edge - x) * smooth(9.95, 11.0, t)
    return x


tb.lateral = tb_lateral
for tt in (1.0, 1.29, 4.45, 5.25, 5.95, 9.4, 9.85, 11.3, 18.0):
    log(f"TB t={tt}: d={tb.d(tt):.1f}")


def tb_pos(t):
    return tb.position(t)[0]


def tb_head(t):
    return tb_pos(t) + Vector((0, 0, 1.52))


# ====================================================================== Rook track
R = C.RookTrack()
line_pt = l_rope.rest(0.5)
p76, tq76, land76, _ = sh.at(76.0)
R.add(0.0, 0.34, "hop", p0=line_pt + land76 * 1.2 + tq76 * 0.8 + Vector((0, 0, 3.2)), p1=line_pt, apex=0.2)
R.add(0.34, 1.08, "perch", p=line_pt)
A1 = awning_top("A1")
R.add(1.08, 1.74, "hop", p0=line_pt, p1=A1, apex=1.25)
R.add(1.74, 1.94, "perch", p=A1)
R1 = r1.rest(0.42)
R.add(1.94, 2.44, "hop", p0=A1, p1=R1, apex=1.0)
R.add(2.44, 2.74, "perch", p=R1)
A2 = awning_top("A2")
R.add(2.74, 3.2, "hop", p0=R1, p1=A2, apex=0.55)
R.add(3.2, 3.42, "perch", p=A2)
R.add(3.42, 4.0, "hop", p0=A2, p1=sign1_bar, apex=0.9)
R.add(4.0, 4.45, "perch", p=sign1_bar)
R.add(4.45, 4.95, "hop", p0=sign1_bar, p1=roof[0], apex=0.9)
# rooftops: runs with hops wherever the roofline steps
runs = []
cur = [roof[0]]
for a, b in zip(roof, roof[1:]):
    if abs(b.z - a.z) > 0.35 or (b - a).xy.length > 1.2:
        runs.append(("run", cur))
        runs.append(("hop", [a, b]))
        cur = [b]
    else:
        cur.append(b)
runs.append(("run", cur))
lengths = [sum((q - p).length for p, q in zip(pts, pts[1:])) if len(pts) > 1 else 0.0 for _, pts in runs]
t_roof0, t_roof1 = 4.95, 9.08
total = sum(L if k == "run" else L * 1.15 + 0.4 for (k, _), L in zip(runs, lengths)) or 1.0
tcur = t_roof0
for (kind, pts), L in zip(runs, lengths):
    dur = (t_roof1 - t_roof0) * ((L if kind == "run" else L * 1.15 + 0.4) / total)
    if dur <= 1e-3:
        continue
    if kind == "run" and len(pts) > 1:
        R.add(tcur, tcur + dur, "run", pts=pts)
    elif kind == "hop":
        R.add(tcur, tcur + dur, "hop", p0=pts[0], p1=pts[1], apex=0.45)
    tcur += dur
rope3_start = r3.rest(0.1)
R.add(9.08, 9.36, "hop", p0=roof[-1], p1=rope3_start, apex=0.35)
R.add(9.36, 9.96, "surf", pts=[r3.rest(u) for u in [0.1 + 0.87 * i / 12 for i in range(13)]])
pole = r3.rest(0.97)
R.add(9.96, 10.62, "hop", p0=pole, p1=RAIL, apex=1.1)
climb_pts = [RAIL.lerp(TOP, k) for k in (0.0, 0.26, 0.52, 0.78, 1.0)]
tc = 10.62
for a, b in zip(climb_pts, climb_pts[1:]):
    R.add(tc, tc + 0.62, "hop", p0=a, p1=b, apex=0.55)
    tc += 0.62
R.add(tc, 18.6, "perch", p=TOP)
T_TOP = tc
log("rook reaches the top at", round(T_TOP, 2))

# facing: along travel; at the top toward her
_, _, land13, _ = sh.at(13.0)


def rook_facing(t):
    t0, t1, kind, data = R.at(t)
    if kind == "perch":
        # face the way he is about to go, or at her once he is at the top
        if t >= T_TOP:
            v = tb_pos(t) - TOP
            v.z = 0
            return v.normalized()
        nxt = R.at(t1 + 1e-3)
        if nxt[2] == "hop":
            v = nxt[3]["p1"] - nxt[3]["p0"]
        else:
            v = -land76
        v.z = 0
        return v.normalized() if v.length > 1e-3 else Vector((0, -1, 0))
    a = R.position(t)
    b = R.position(min(t1 - 1e-3, t + 0.05))
    v = b - a
    v.z = 0
    if v.length < 1e-4:
        v = R.position(t1 - 1e-3) - R.position(t0)
        v.z = 0
    return v.normalized() if v.length > 1e-4 else Vector((0, -1, 0))


def yaw_of(v):
    return math.atan2(v.x, -v.y)


# ====================================================================== bake Trailblazer
log("baking Trailblazer")
prev_heading = None
tb_arm.animation_data_create()
for f in FRAMES:
    t = C.frame_time(f)
    samples = []
    for name, ct, w in tb.clip(t):
        loop = name.endswith("Loop")
        samples.append((clips.sample(name, ct, loop=loop), w))
    s = samples[0][0]
    acc = samples[0][1]
    for smp, w in samples[1:]:
        if acc + w <= 0:
            continue
        s = ch.blend_samples(s, smp, w / (acc + w))
        acc += w
    extra = {}
    # the swipe at Rook as he surfs overhead: right arm up, reaching
    k = smooth(9.38, 9.55, t) * (1 - smooth(9.75, 10.05, t))
    if k > 0:
        pos = tb_pos(t)
        h = rook_facing(t)
        extra["J_Bip_R_UpperArm"] = Quaternion(Vector((0, 1, 0)), -2.2 * k) @ Quaternion(Vector((1, 0, 0)), 0.6 * k)
        extra["J_Bip_R_LowerArm"] = Quaternion(Vector((0, 1, 0)), -0.5 * k)
    # after the stop: look up at him, chest heaving
    kl = smooth(10.6, 11.6, t)
    if kl > 0:
        extra["J_Bip_C_Neck"] = Quaternion(Vector((1, 0, 0)), 0.35 * kl)
        extra["J_Bip_C_Head"] = Quaternion(Vector((1, 0, 0)), 0.45 * kl)
        extra["J_Bip_C_UpperChest"] = Quaternion(Vector((1, 0, 0)), 0.1 * kl + 0.04 * math.sin(t * 5.5) * kl)
    rt.apply(s, f, extra=extra or None)
    # root
    pos = tb_pos(t)
    h = tb.heading(t)
    if t > 10.4:
        v = TOP - pos
        v.z = 0
        want = v.normalized()
        k2 = smooth(10.4, 11.4, t)
        h = (h or want).lerp(want, k2).normalized() if h else want
    if h is None:
        h = prev_heading or Vector((0, 1, 0))
    prev_heading = h
    tb_root.location = pos
    tb_root.rotation_euler = (0, 0, yaw_of(h))
    tb_root.keyframe_insert("location", frame=f)
    tb_root.keyframe_insert("rotation_euler", frame=f)
log("Trailblazer body keyed")
springs = ch.VrmSprings(tb_arm)
for f in FRAMES:
    sc.frame_set(f)
    springs.step(f)
springs.write()
log("Trailblazer springs keyed")

# ====================================================================== bake Rook


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
    if kind == "perch":
        amused = 1.0 if (0.5 < t < 1.05 or 4.05 < t < 4.45 or t > T_TOP + 0.6) else 0.0
        tilt = 16 * math.sin(t * 2.2) if amused else 5.0
        if t >= T_TOP:
            ksal = smooth(T_TOP + 0.7, T_TOP + 1.1, t) * (1 - smooth(T_TOP + 2.2, T_TOP + 2.7, t))
            base = pose_dict(lambda: rp.salute(t, ksal)) if ksal > 0 else pose_dict(lambda: rp.perch(t, look_yaw=ly, look_pitch=-28, tilt=tilt, amused=amused))
        else:
            base = pose_dict(lambda: rp.perch(t, look_yaw=ly, look_pitch=-6, tilt=tilt, amused=amused, lean=6 if amused else 0))
        # land absorb after a hop, crouch before one
        prev = R.at(t0 - 1e-3)
        if prev[2] == "hop" and t - t0 < 0.2:
            k = 1 - ease((t - t0) / 0.2)
            base = blend(base, pose_dict(lambda: rp.land(1.0, ly)), k)
        nxt = R.at(t1 + 1e-3)
        if nxt[2] == "hop" and t1 - t < 0.16:
            k = ease(1 - (t1 - t) / 0.16)
            base = blend(base, pose_dict(lambda: rp.crouch(1.0, ly * 0.5)), k)
        return base
    if kind == "hop":
        u = (t - t0) / max(1e-3, t1 - t0)
        lp = pose_dict(lambda: rp.leap(1.0, t))
        tk = pose_dict(lambda: rp.tuck(1.0, t))
        ld = pose_dict(lambda: rp.land(0.7))
        if u < 0.3:
            return blend(lp, tk, ease(u / 0.3))
        if u < 0.75:
            return tk
        return blend(tk, ld, ease((u - 0.75) / 0.25))
    if kind == "run":
        return pose_dict(lambda: rp.scurry(t, speed=1.25, look_yaw=max(-60, min(60, ly)) * 0.6))
    if kind == "surf":
        return pose_dict(lambda: rp.surf(t))
    return pose_dict(lambda: rp.perch(t))


log("baking Rook")
for pb in rk_arm.pose.bones:
    pb.rotation_mode = "XYZ"
for f in FRAMES:
    t = C.frame_time(f)
    pose = rook_pose(t)
    for name, (loc, rot) in pose.items():
        pb = rk_arm.pose.bones[name]
        pb.location = loc
        pb.rotation_euler = rot
        pb.keyframe_insert("location", frame=f)
        pb.keyframe_insert("rotation_euler", frame=f)
    pos = R.position(t)
    fac = rook_facing(t)
    rk_root.location = pos
    # a little lean into the travel on runs, a pitch through the hops
    t0, t1, kind, data = R.at(t)
    pitch = 0.0
    if kind == "hop":
        u = (t - t0) / max(1e-3, t1 - t0)
        pitch = math.radians(-18 * math.sin(math.pi * u))
    rk_root.rotation_euler = (pitch, 0, yaw_of(fac))
    rk_root.keyframe_insert("location", frame=f)
    rk_root.keyframe_insert("rotation_euler", frame=f)
log("Rook keyed")


def seg_u(t, a, b):
    return max(0.0, min(1.0, (t - a) / (b - a)))


# ====================================================================== environment reactions
# ropes under Rook
l_rope.load(0.34, 1.08, lambda t: 0.5, 0.2)
r1.load(2.44, 2.74, lambda t: 0.42, 0.24)
r3.load(9.36, 9.96, lambda t: 0.1 + 0.87 * seg_u(t, 9.36, 9.96), 0.34)
for rope in (l_rope, r1, r2, r3):
    rope.bake(FRAMES)
# the laundry sheets ride the line
for ob, (t0_, t1_) in zip(laundry["sheets"], laundry["spans"]):
    um = (t0_ + t1_) / 2
    base = ob.location.copy()
    for f in FRAMES:
        t = C.frame_time(f)
        ob.location = base + Vector((0, 0, l_rope.offset(um, t)))
        ob.keyframe_insert("location", frame=f)
# lanterns on the ropes
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
# Trailblazer passing under lantern rope 2 brushes nothing; her swipe under rope 3 flicks one
pends[-2].kick(9.62, 3.5, 1.5)
# the sign: a nudge as he lands, a hard kick as he leaves (swinging it down into her path)
_, tq52, land52, _ = sh.at(51.8)
sp = fx.Pendulum(sign1, 0.62, land52, tq52, damping=0.45, wind=0.2, seed=7)
sp.kick(4.0, 1.2)
sp.kick(4.5, -6.5)
pends.append(sp)
sp2 = fx.Pendulum(S["signs"]["S2"], 0.55, sh.at(38.5)[2], sh.at(38.5)[1], damping=0.8, wind=0.35, seed=9)
pends.append(sp2)
for pd in pends:
    pd.bake(FRAMES)
log("ropes, lanterns and signs keyed")

# gulls: off the roofs as he runs through them, off the yards when he arrives
roof_birds = [roof[i] + Vector((0, 0, 0.02)) for i in range(12, min(len(roof), 26), 2)]
fx.flock("hero_gulls_roof", roof_birds, 6.25, -sh.at(42.0)[2] + Vector((0, 0, 0.3)), FRAMES, climb=4.5, speed=8.0,
         circle=(road(30.0, -18.0, 10.0), 16.0))
yard_pts = [TOP + ax * (k - 3) * 1.6 + Vector((0, 0, 3.5 + (k % 3) * 2.2)) for k in range(8)]
fx.flock("hero_gulls_ship", yard_pts, T_TOP + 0.15, -sh.at(13.0)[2] + ax * 0.4, FRAMES, climb=6.0, speed=7.0,
         circle=(TOP + Vector((0, 0, 4.0)), 14.0))
log("gulls keyed")

# the ship rides the swell
for f in FRAMES:
    t = C.frame_time(f)
    ship_root.location.z = 0.12 * math.sin(t * 0.8)
    ship_root.rotation_euler.x = math.radians(0.9 * math.sin(t * 0.63 + 0.4))
    ship_root.rotation_euler.y = math.radians(0.5 * math.sin(t * 0.8 + 1.1))
    ship_root.keyframe_insert("location", frame=f)
    ship_root.keyframe_insert("rotation_euler", frame=f)

# fruit: she clips the crate
table, crates, fruit = S["stall"]
_, tq45, land45, _ = sh.at(44.8)
if not NO_SIM:
    k_fruit = [o for o in fruit if "_f1_" in o.name] + [o for o in fruit if "_f2_" in o.name][:6]
    fx.fruit_spill(k_fruit, crates[1], 5.95, (tq45 - land45 * 0.6).normalized(), sh.at(44.8)[0].z + 0.03, FRAMES)

# awnings: Rook's landings dent the canvas; every awning breathes in the wind
fx.awning_motion(S["awnings"]["A1"][0], FRAMES, [(A1, 1.74, 1.98)], seed=1, gust=1.0)
fx.awning_motion(S["awnings"]["A2"][0], FRAMES, [(A2, 3.2, 3.46)], seed=2, gust=0.9)
fx.awning_motion(S["awnings"]["A3"][0], FRAMES, [], seed=3, gust=1.1)
fx.awning_motion(S["awnings"]["A4"][0], FRAMES, [], seed=4, gust=0.8)
# Rook sinks into the canvas with it
for f in FRAMES:
    t = C.frame_time(f)
    for (c, tl, tv) in ((A1, 1.74, 1.98), (A2, 3.2, 3.46)):
        if tl <= t < tv:
            e = t - tl
            rk_root.location = R.position(t) - Vector((0, 0, 0.26 * min(1.0, e / 0.07) * (1.0 + 0.3 * math.exp(-e * 10) * math.sin(e * 45))))
            rk_root.keyframe_insert("location", frame=f)

# cloth: wind, Rook's feet on the awnings, Trailblazer through the sheets
wind = fx.wind_field(road(80.0, -8.0, 3.0), (sh.at(60.0)[2] + Vector((0, 0, 0.1))).normalized(), strength=5.5, noise=2.6)
feet = fx.collider_sphere("hero_rook_feet", 0.2)
for f in FRAMES:
    t = C.frame_time(f)
    t0, t1, kind, data = R.at(t)
    on_cloth = kind == "perch" and data["p"] in (A1, A2)
    p = R.position(t)
    feet.location = p + Vector((0, 0, 0.1)) if on_cloth or (kind == "hop" and (data["p1"] in (A1, A2) and (t1 - t) < 0.08)) else Vector((0, 0, -50))
    feet.keyframe_insert("location", frame=f)
body = next(o for o in tb_meshes if o.name == "Body")
bc = body.modifiers.new("collision", "COLLISION")
body.collision.thickness_outer = 0.03
body.collision.cloth_friction = 2.0
if NO_SIM:
    for o in bpy.data.objects:
        for md in list(getattr(o, "modifiers", [])):
            if md.type == "CLOTH":
                o.modifiers.remove(md)

# ====================================================================== camera
cam = bpy.data.objects.new("hero_cam", bpy.data.cameras.new("hero_cam"))
common.link(cam)
sc.camera = cam
cam.data.sensor_fit = "AUTO"
cam.data.clip_start = 0.08
cam.data.dof.use_dof = True
cam.data.dof.aperture_fstop = 2.2
cam.rotation_mode = "QUATERNION"


def rook_pos(t):
    return R.position(t) + Vector((0, 0, 0.55))


# each rig: t -> (position, target, lens, focus point)
def rig_open(t):
    p = road(71.2, -0.9, 1.25)
    tgt = line_pt + Vector((0, 0, -0.9))
    return p, tgt, 20.0, line_pt


def rig_whip(t):
    p = road(71.2, -0.7, 1.35 + 0.5 * smooth(1.0, 1.9, t))
    return p, rook_pos(t), 20.0, rook_pos(t)


def rig_chase(t):
    d = tb.d(t)
    p = road(d + 3.1, -1.05, 1.75)
    tgt = tb_head(t).lerp(rook_pos(t), 0.5)
    return p, tgt, 25.0, tb_head(t).lerp(rook_pos(t), 0.3)


def rig_slide(t):
    # low, on her line, far enough back that the swinging board crosses the frame as she goes under
    d = tb.d(t)
    p = road(d + 3.4, 0.7, 0.75)
    tgt = road(d - 3.5, 1.1, 1.55)
    return p, tgt, 20.0, tb_head(t)


def rig_profile(t):
    d = tb.d(t)
    p = road(d - 1.6, -5.4, 1.9)
    tgt = (tb_pos(t) + Vector((0, 0, 1.0))).lerp(rook_pos(t), 0.36)
    return p, tgt, 21.0, tb_head(t)


def rig_rope(t):
    p = road(19.6, -3.9, 3.2)
    return p, rook_pos(t), 20.0, rook_pos(t)


_land13 = sh.at(13.0)[2]


def rig_ship(t):
    # a crane alongside the climb from the quay side: he is backlit against the sails and the sky
    off = _land13 * 4.2 - ax * 2.2 + Vector((0, 0, -0.5))
    p = rook_pos(t) + off
    p.z = min(max(p.z, road(13.0).z + 1.4), road(13.0).z + 5.0)
    return p, rook_pos(t) + Vector((0, 0, 0.2)), 22.0, rook_pos(t)


REVEAL_CAM = road(7.2, -2.3, 1.45)


def rig_top(t):
    # telephoto on him at the top against the backlit sails; after the salute the lens tilts down
    # and opens out to find her on the quay edge beneath him, looking up
    k = smooth(T_TOP + 2.5, T_TOP + 4.6, t)
    p = REVEAL_CAM + Vector((0, 0, 0.35 * k))
    rook_h = TOP + Vector((0, 0, 0.62))
    tgt = rook_h.lerp(rook_h.lerp(tb_pos(t) + Vector((0, 0, 0.6)), 0.52), k)
    lens = 85.0 + (22.0 - 85.0) * k
    fp = rook_h.lerp(tb_pos(t) + Vector((0, 0, 1.4)), smooth(T_TOP + 3.0, T_TOP + 4.2, t) * 0.5)
    return p, tgt, lens, fp


SCHEDULE = [   # (start, rig, blend seconds)
    (0.0, rig_open, 0.0),
    (1.02, rig_whip, 0.25),
    (1.85, rig_chase, 0.55),
    (4.3, rig_slide, 0.45),
    (5.35, rig_profile, 0.9),
    (9.05, rig_rope, 0.5),
    (10.2, rig_ship, 0.7),
    (T_TOP - 0.35, rig_top, 0.8),
]


def camera_at(t):
    cur = None
    for i, (ts, rig, bl) in enumerate(SCHEDULE):
        if t >= ts:
            cur = i
    ts, rig, bl = SCHEDULE[cur]
    p, tg, lens, fp = rig(t)
    if cur > 0 and bl > 0 and t < ts + bl:
        pp, ptg, plens, pfp = SCHEDULE[cur - 1][1](t)
        k = ease((t - ts) / bl)
        p, tg, lens, fp = pp.lerp(p, k), ptg.lerp(tg, k), plens + (lens - plens) * k, pfp.lerp(fp, k)
    return p, tg, lens, fp


# critically damped follow smooths the rig switches; a light handheld on top
cp = ct = None
vcp = Vector()
vct = Vector()
for f in FRAMES:
    t = C.frame_time(f)
    p, tg, lens, fp = camera_at(t)
    if cp is None:
        cp, ct = p.copy(), tg.copy()
    stiff = 60.0 if t < 1.0 else 90.0
    dt = 1.0 / FPS
    for _ in range(4):
        h = dt / 4
        acc = (p - cp) * stiff - vcp * 2 * math.sqrt(stiff)
        vcp += acc * h
        cp += vcp * h
        acc = (tg - ct) * stiff * 1.6 - vct * 2 * math.sqrt(stiff * 1.6)
        vct += acc * h
        ct += vct * h
    shake = Vector((math.sin(t * 7.1) * 0.012 + math.sin(t * 13.3) * 0.006, math.sin(t * 6.3 + 1) * 0.012, math.sin(t * 9.7 + 2) * 0.01))
    cam.location = cp + shake
    common.look_at(cam, ct, roll=0.03 * math.sin(t * 1.9) + (-0.06 * smooth(5.6, 6.4, t) * (1 - smooth(8.6, 9.2, t))))
    cam.data.lens = lens
    cam.data.dof.focus_distance = max(0.5, (fp - cam.location).length)
    cam.keyframe_insert("location", frame=f)
    cam.keyframe_insert("rotation_quaternion", frame=f)
    cam.data.keyframe_insert("lens", frame=f)
    cam.data.dof.keyframe_insert("focus_distance", frame=f)
log("camera keyed")

# ====================================================================== sims, render
env.render_settings(res=RES, samples=SAMPLES, preview=PREVIEW)
if not NO_SIM:
    sc.frame_set(1)
    with bpy.context.temp_override(scene=sc):
        bpy.ops.ptcache.bake_all(bake=True)
    log("sims baked")
if BLEND:
    bpy.ops.wm.save_as_mainfile(filepath=BLEND)
    log("saved", BLEND)
os.makedirs(OUT, exist_ok=True)
sc.render.image_settings.file_format = "PNG"
for f in range(F0, F1 + 1, STEP):
    sc.frame_set(f)
    sc.render.filepath = os.path.join(OUT, f"f{f:04d}.png")
    bpy.ops.render.render(write_still=True)
    if f % 24 == 0 or f == F0:
        log("rendered", f)
log("done")
