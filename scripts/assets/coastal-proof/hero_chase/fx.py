"""Environment reactions, baked to keyframes (or cached sims) so the sequence is deterministic.

- Ropes dip under whoever is on them and ring afterwards (a damped string mode).
- Lanterns and signs are pendulums driven by those rope motions, by kicks, and by a gusty wind.
- Fruit is rigid-body, thrown from its crate when Trailblazer clips it.
- Gulls are instanced low-poly birds with a flap cycle, flying procedural escape paths.
- Awnings and laundry are cloth (set_dressing) pushed by a proxy under Rook's feet and by
  Trailblazer's own body, plus a wind field.
"""

import math
import random

import bmesh
import bpy
from mathutils import Matrix, Quaternion, Vector

from common import FPS, collection, link

rng = random.Random(77)


# ------------------------------------------------------------------ ropes

class RopeFx:
    """A rope strung a -> b with rest sag. Loads (a weight at a point along it) add a V-shaped dip;
    when a load leaves, the rope rings on as a damped oscillation of the same shape."""

    def __init__(self, obj, a, b, sag, n=24):
        self.obj = obj
        self.a = a.copy()
        self.b = b.copy()
        self.sag = sag
        self.n = n
        self.events = []   # (t0, t1, u_fn(t) -> position along rope 0..1, depth)
        sp = obj.data.splines[0]
        if len(sp.points) != n + 1:
            obj.data.splines.clear()
            sp = obj.data.splines.new("POLY")
            sp.points.add(n)
        self.sp = sp

    def rest(self, u):
        return self.a.lerp(self.b, u) - Vector((0, 0, self.sag * 4 * u * (1 - u)))

    def load(self, t0, t1, u_fn, depth):
        self.events.append((t0, t1, u_fn, depth))

    def offset(self, u, t):
        dz = 0.0
        for t0, t1, u_fn, depth in self.events:
            if t < t0:
                continue
            if t <= t1:
                uc = u_fn(t)
                k = 1 - min(1.0, abs(u - uc) / max(uc, 1 - uc, 1e-3)) if 0 <= uc <= 1 else 0
                shape = (u / uc if u < uc else (1 - u) / (1 - uc)) if 0 < uc < 1 else 0
                # settle in quickly after the load arrives
                arrive = min(1.0, (t - t0) / 0.08)
                bounce = 1.0 + 0.25 * math.exp(-(t - t0) * 9) * math.sin((t - t0) * 40)
                dz -= depth * shape * arrive * bounce
            else:
                uc = u_fn(t1)
                shape = (u / uc if u < uc else (1 - u) / (1 - uc)) if 0 < uc < 1 else 0
                e = t - t1
                dz -= depth * shape * math.exp(-e * 4.5) * math.cos(e * 19.0)
        return dz

    def point(self, u, t):
        return self.rest(u) + Vector((0, 0, self.offset(u, t)))

    def bake(self, frames):
        for f in frames:
            t = (f - 1) / FPS
            for i, pt in enumerate(self.sp.points):
                u = i / self.n
                q = self.point(u, t)
                pt.co = (q.x, q.y, q.z, 1)
                pt.keyframe_insert("co", frame=f)


# ------------------------------------------------------------------ pendulums

class Pendulum:
    """A hanging object on a pivot: two swing angles, gravity, damping, kicks and wind."""

    def __init__(self, pivot, length, axis_a, axis_b, damping=0.9, wind=0.35, seed=0):
        self.pivot = pivot
        self.length = length
        self.axis_a = axis_a.normalized()     # world axis of the first swing
        self.axis_b = axis_b.normalized()
        self.damping = damping
        self.wind = wind
        self.kicks = []    # (t, dvel_a, dvel_b)
        self.base = pivot.rotation_quaternion.copy() if pivot.rotation_mode == "QUATERNION" else pivot.rotation_euler.to_quaternion()
        self.seed = seed
        self.follow = None   # callable t -> pivot world position (a pivot riding a moving rope)

    def kick(self, t, a, b=0.0):
        self.kicks.append((t, a, b))

    def bake(self, frames):
        g = 9.81
        w0 = math.sqrt(g / max(0.1, self.length))
        th = [0.0, 0.0]
        om = [0.0, 0.0]
        sub = 8
        dt = 1.0 / (FPS * sub)
        t = 0.0
        prev_pos = None
        prev_vel = None
        piv = self.pivot
        piv.rotation_mode = "QUATERNION"
        kicks = sorted(self.kicks)
        ki = 0
        for f in frames:
            tf = (f - 1) / FPS
            while t < tf - 1e-9:
                while ki < len(kicks) and kicks[ki][0] <= t:
                    om[0] += kicks[ki][1]
                    om[1] += kicks[ki][2]
                    ki += 1
                # support acceleration (a pivot riding a rope) drives the swing like a kick
                acc = Vector()
                if self.follow:
                    pos = self.follow(t)
                    if prev_pos is not None:
                        vel = (pos - prev_pos) / dt
                        if prev_vel is not None:
                            acc = (vel - prev_vel) / dt
                        prev_vel = vel
                    prev_pos = pos
                wind = self.wind * (math.sin(t * 1.3 + self.seed) * 0.6 + math.sin(t * 3.1 + self.seed * 2.3) * 0.4)
                for i, ax in enumerate((self.axis_a, self.axis_b)):
                    # horizontal acceleration perpendicular to the axis tips the pendulum
                    perp = ax.cross(Vector((0, 0, 1)))
                    a_ext = -acc.dot(perp) / self.length * 0.6
                    alpha = -w0 * w0 * math.sin(th[i]) - self.damping * om[i] + a_ext + wind * (0.8 if i == 0 else 0.4)
                    om[i] += alpha * dt
                    th[i] += om[i] * dt
                t += dt
            q = Quaternion(self.axis_a, th[0]) @ Quaternion(self.axis_b, th[1]) @ self.base
            piv.rotation_quaternion = q
            piv.keyframe_insert("rotation_quaternion", frame=f)
            if self.follow:
                piv.location = self.follow(tf)
                piv.keyframe_insert("location", frame=f)


# ------------------------------------------------------------------ gulls

def gull_mesh():
    """A gull: body, head, tail and two jointed wings; shape keys 'up' and 'down' for the flap."""
    me = bpy.data.meshes.get("hero_gull")
    if me:
        return me
    bm = bmesh.new()
    # body: a stretched octahedron-ish spindle along +Y
    body = bmesh.ops.create_uvsphere(bm, u_segments=8, v_segments=6, radius=0.09)
    bmesh.ops.scale(bm, vec=(0.85, 2.4, 0.8), verts=body["verts"])
    head = bmesh.ops.create_uvsphere(bm, u_segments=6, v_segments=4, radius=0.055)
    bmesh.ops.translate(bm, vec=(0, 0.22, 0.04), verts=head["verts"])
    beak = bmesh.ops.create_cone(bm, segments=4, radius1=0.018, radius2=0.0, depth=0.07, cap_ends=True,
                                 matrix=Matrix.Translation((0, 0.3, 0.035)) @ Matrix.Rotation(-math.pi / 2, 4, "X"))
    # wings: each a two-segment plane (inner, outer) with a swept tip
    wing_verts = {}
    for s in (1, -1):
        v0 = bm.verts.new((s * 0.05, 0.06, 0.02))
        v1 = bm.verts.new((s * 0.05, -0.06, 0.02))
        v2 = bm.verts.new((s * 0.32, 0.03, 0.02))
        v3 = bm.verts.new((s * 0.32, -0.09, 0.02))
        v4 = bm.verts.new((s * 0.62, -0.12, 0.02))
        bm.faces.new((v0, v2, v3, v1) if s > 0 else (v1, v3, v2, v0))
        bm.faces.new((v2, v4, v3) if s > 0 else (v3, v4, v2))
        wing_verts[s] = (v2, v3, v4)
    tail = [bm.verts.new(p) for p in ((0.05, -0.2, 0.01), (-0.05, -0.2, 0.01), (0.0, -0.36, 0.0))]
    bm.faces.new(tail)
    bm.verts.index_update()
    idx = {s: [v.index for v in vs] for s, vs in wing_verts.items()}
    me = bpy.data.meshes.new("hero_gull")
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new("hero_gull_proto", me)
    link(ob, collection("hero_protos"))
    ob.shape_key_add(name="basis")
    for name, (inner, outer) in (("up", (0.16, 0.34)), ("down", (-0.12, -0.28))):
        k = ob.shape_key_add(name=name)
        for s, ids in idx.items():
            for j, vi in enumerate(ids):
                co = me.vertices[vi].co.copy()
                lift = inner if j < 2 else outer
                k.data[vi].co = (co.x, co.y, co.z + lift * abs(co.x) / 0.5)
    mat = bpy.data.materials.new("hero_gull_mat")
    mat.use_nodes = True
    b = mat.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.82, 0.82, 0.8, 1)
    b.inputs["Roughness"].default_value = 0.7
    b.inputs["Subsurface Weight"].default_value = 0.2
    me.materials.append(mat)
    mat.use_backface_culling = False
    return me


def flock(name, origin_pts, t_start, away, frames, climb=3.0, speed=7.0, spread=0.35, circle=None):
    """Birds sitting at origin_pts until t_start (+ a startle stagger), then bursting away in
    direction `away` (rising), optionally curving into a circle around `circle` (center, radius)."""
    me = gull_mesh()
    coll = collection("hero_gulls")
    birds = []
    for i, p0 in enumerate(origin_pts):
        ob = bpy.data.objects.new(f"{name}_{i}", me.copy())
        link(ob, coll)
        ob.data.shape_keys.name = ob.name + "_keys"
        ob.rotation_mode = "XYZ"
        sc = 0.85 + rng.random() * 0.3
        ob.scale = (sc, sc, sc)
        t0 = t_start + rng.random() * 0.45
        dirv = (away + Vector(((rng.random() - 0.5) * spread, (rng.random() - 0.5) * spread, 0))).normalized()
        flap_rate = 7.5 + rng.random() * 2.0
        phase = rng.random() * 6.28
        spd = speed * (0.8 + rng.random() * 0.4)
        yaw0 = rng.random() * 6.28
        keys = ob.data.shape_keys.key_blocks
        for f in frames:
            t = (f - 1) / FPS
            if t < t0:
                pos = p0.copy()
                yaw = yaw0
                pitch = 0.0
                flap_up, flap_dn = 0.0, 0.25     # wings folded (down key a little)
            else:
                e = t - t0
                # takeoff: a jump up, then a climbing escape, optionally bending into a circle
                up = climb * (1 - math.exp(-e * 1.2)) + 0.6 * min(1.0, e * 4)
                fwd = spd * (e - (1 - math.exp(-e * 3)) / 3)
                pos = p0 + dirv * fwd + Vector((0, 0, up))
                if circle and e > 1.2:
                    c, r = circle
                    ang = (e - 1.2) * spd / r + i
                    circ = c + Vector((math.cos(ang) * r, math.sin(ang) * r, 3.0 + (i % 5) * 1.3))
                    k = min(1.0, (e - 1.2) / 1.5)
                    pos = pos.lerp(circ, k)
                fut = p0 + dirv * (spd * ((e + 0.1) - (1 - math.exp(-(e + 0.1) * 3)) / 3)) + Vector((0, 0, climb * (1 - math.exp(-(e + 0.1) * 1.2)) + 0.6))
                d = fut - pos
                yaw = math.atan2(-d.x, d.y)
                pitch = math.atan2(d.z, max(0.01, d.xy.length)) * 0.5
                ph = e * flap_rate * math.tau + phase
                glide = 0.0 if e < 1.4 else 0.5 + 0.5 * math.sin(e * 0.9 + i)
                amp = 1.0 - 0.7 * glide
                s_ = math.sin(ph)
                flap_up = max(0.0, s_) * amp
                flap_dn = max(0.0, -s_) * amp
            ob.location = pos
            ob.rotation_euler = (pitch, 0.0, yaw)
            ob.keyframe_insert("location", frame=f)
            ob.keyframe_insert("rotation_euler", frame=f)
            keys["up"].value = flap_up
            keys["down"].value = flap_dn
            keys["up"].keyframe_insert("value", frame=f)
            keys["down"].keyframe_insert("value", frame=f)
        birds.append(ob)
    return birds


# ------------------------------------------------------------------ rigid fruit

def fruit_spill(fruit, crate, t_hit, push_dir, ground_z, frames):
    """Fruit rests in its crate until t_hit, when the crate is knocked: the fruit leaves with the
    crate's jolt and a spread, then falls, bounces and rolls on a ground plane (rigid body)."""
    sc = bpy.context.scene
    if not sc.rigidbody_world:
        bpy.ops.rigidbody.world_add()
    rbw = sc.rigidbody_world
    rbw.point_cache.frame_start = frames[0]
    rbw.point_cache.frame_end = frames[-1]
    rbw.substeps_per_frame = 20
    rbw.solver_iterations = 20
    rbw.collection = collection("hero_rb")
    # the ground
    bpy.ops.mesh.primitive_plane_add(size=16, location=(crate.matrix_world.translation.x, crate.matrix_world.translation.y, ground_z))
    gnd = bpy.context.object
    gnd.name = "hero_rb_ground"
    gnd.hide_render = True
    for c in gnd.users_collection:
        c.objects.unlink(gnd)
    collection("hero_rb").objects.link(gnd)
    bpy.context.view_layer.objects.active = gnd
    bpy.ops.rigidbody.object_add(type="PASSIVE")
    gnd.rigid_body.friction = 0.6
    gnd.rigid_body.restitution = 0.35
    f_hit = 1 + round(t_hit * FPS)
    for i, ob in enumerate(fruit):
        for c in list(ob.users_collection):
            if c.name != "hero_rb":
                pass
        collection("hero_rb").objects.link(ob) if ob.name not in collection("hero_rb").objects else None
        bpy.context.view_layer.objects.active = ob
        bpy.ops.rigidbody.object_add(type="ACTIVE")
        rb = ob.rigid_body
        rb.collision_shape = "SPHERE"
        rb.mass = 0.2
        rb.friction = 0.5
        rb.restitution = 0.45
        rb.linear_damping = 0.08
        rb.angular_damping = 0.1
        # animated (held) until the hit, then thrown: the two frames before release carry the throw
        # velocity, which the solver inherits when 'animated' turns off
        base = ob.location.copy()
        v = push_dir * (1.6 + rng.random() * 1.6) + Vector(((rng.random() - 0.5) * 1.4, (rng.random() - 0.5) * 1.4, 1.2 + rng.random() * 1.6))
        rb.kinematic = True
        ob.keyframe_insert("location", frame=frames[0])
        rb.keyframe_insert("kinematic", frame=frames[0])
        ob.keyframe_insert("location", frame=f_hit - 1)
        ob.location = base + v / FPS
        ob.keyframe_insert("location", frame=f_hit)
        rb.keyframe_insert("kinematic", frame=f_hit)
        rb.kinematic = False
        rb.keyframe_insert("kinematic", frame=f_hit + 1)
        ob.location = base
    # the crate itself jolts
    crate.keyframe_insert("location", frame=f_hit - 1)
    loc = crate.location.copy()
    crate.location = loc + push_dir * 0.12 + Vector((0, 0, 0.04))
    crate.keyframe_insert("location", frame=f_hit + 2)
    crate.rotation_euler.z += 0.18
    crate.keyframe_insert("rotation_euler", frame=f_hit + 2)
    crate.location = loc


# ------------------------------------------------------------------ wind and colliders

def wind_field(loc, direction, strength=3.0, noise=1.5):
    bpy.ops.object.effector_add(type="WIND", location=loc)
    w = bpy.context.object
    w.name = "hero_wind"
    w.rotation_euler = direction.to_track_quat("Z", "Y").to_euler()
    w.field.strength = strength
    w.field.noise = noise
    w.field.flow = 0.5
    return w


def collider_sphere(name, radius=0.22):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=radius)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    link(ob, collection("hero_fx"))
    ob.hide_render = True
    ob.display_type = "WIRE"
    md = ob.modifiers.new("collision", "COLLISION")
    ob.collision.thickness_outer = 0.02
    ob.collision.cloth_friction = 5.0
    return ob


# ------------------------------------------------------------------ awnings (directed canvas)

def awning_motion(ob, frames, landings=(), seed=0, gust=1.0):
    """Canvas that reacts like canvas without a solver: a dent that snaps in under a landing and
    rebounds when the weight leaves, and a gusty belly + flapping valance. landings: (center, t_land,
    t_leave). Shape keys are cheap everywhere, including the phone."""
    cols, rows, vrows = ob["grid"]
    me = ob.data
    if not me.shape_keys:
        ob.shape_key_add(name="basis")
    n_main = (rows + 1) * (cols + 1)
    def uv(i):
        if i < n_main:
            return (i % (cols + 1)) / cols, (i // (cols + 1)) / rows, 0
        k = i - n_main
        return (k % (cols + 1)) / cols, 1.0, 1 + k // (cols + 1)
    # belly: the canvas breathes up and down between its bars; the valance swings out and back
    belly = ob.shape_key_add(name="belly")
    for i, v in enumerate(me.vertices):
        u, w, val = uv(i)
        lift = 0.13 * math.sin(math.pi * w) * math.sin(math.pi * u) ** 0.5 if not val else 0.0
        out = 0.0
        if val:
            out = 0.05 * val
        co = v.co.copy()
        belly.data[i].co = (co.x, co.y, co.z + lift + out)
    belly.slider_min = -1.0
    dents = []
    for k, (center, t_land, t_leave) in enumerate(landings):
        key = ob.shape_key_add(name=f"dent{k}")
        key.slider_min = -1.0
        key.slider_max = 1.5
        for i, v in enumerate(me.vertices):
            u, w, val = uv(i)
            r = (v.co - center).xy.length
            fall = math.exp(-(r / 0.75) ** 2) * math.sin(math.pi * min(1.0, w)) ** 0.7
            if val:
                fall = 0.35 * math.exp(-(r / 1.0) ** 2)
            key.data[i].co = (v.co.x, v.co.y, v.co.z - 0.3 * fall)
        dents.append((key, t_land, t_leave))
    for f in frames:
        t = (f - 1) / FPS
        g = gust * (0.55 * math.sin(t * 2.1 + seed) + 0.3 * math.sin(t * 5.3 + seed * 1.7) + 0.15 * math.sin(t * 11.0 + seed))
        belly.value = g
        belly.keyframe_insert("value", frame=f)
        for key, t_land, t_leave in dents:
            if t < t_land:
                val = 0.0
            elif t < t_leave:
                e = t - t_land
                val = min(1.0, e / 0.07) * (1.0 + 0.3 * math.exp(-e * 10) * math.sin(e * 45))
            else:
                e = t - t_leave
                # the weight leaves: the canvas snaps back up past rest and rings out
                val = math.exp(-e * 4.0) * math.cos(e * 21.0) * (1.0 if e > 0.02 else 1.0)
            key.value = val
            key.keyframe_insert("value", frame=f)
