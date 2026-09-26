"""Shared helpers for the Rook-chase hero sequence (Blender 5.2).

The hero sequence plays on the harbour shore road of the Coastal Market level: the stretch of the
coast spine that runs on past the quay, where the lower town's houses stand on the shore ledge
(build_level.py, build_settlement "lower town at the harbour"). The spine nodes below are copied
from build_level.py so the hero set sits exactly on the game's geography; keep them in step.

Distances along the chase are metres from the quay node, measured along the shore road (d = 0 at
the quay, growing south-west). The chase runs toward the quay: d decreases with time.
"""

import math
import os

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
ASSETS = os.path.join(REPO, "client", "public", "assets", "goldline", "coastal-market-three-proof")
SOURCES = os.path.expanduser(os.environ.get("COASTAL_SOURCES", "~/Desktop/lantern-city-commercial-game/coastal-proof-sources"))
POLYHAVEN = os.path.join(SOURCES, "polyhaven")
FPS = 24

# (x, y, z, width, kind, zTop) from build_level.py, the quay onward
SHORE_NODES = [
    (-44.5, -0.5, 7.0, 3.2),
    (-54.0, 2.0, 2.4, 10.0),     # quay
    (-66.0, -1.5, 2.3, 7.0),
    (-76.0, -11.0, 2.2, 6.0),
    (-83.0, -27.0, 2.2, 6.0),
    (-97.0, -41.0, 2.4, 6.0),
    (-119.0, -47.0, 2.6, 6.0),
    (-154.0, -51.0, 3.0, 6.0),
    (-199.0, -53.0, 4.0, 6.0),
]
# level.json sunDirection (three) -> blender (x, -z, y): direction TO the sun
SUN_DIR = Vector((-0.927, 0.301, 0.225)).normalized()


def catmull(p0, p1, p2, p3, t):
    t2, t3 = t * t, t * t * t
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)


class Shore:
    """The shore road as an arclength-parameterised curve from the quay outward."""

    def __init__(self, step=0.25):
        nodes = SHORE_NODES
        pts = [Vector((n[0], n[1], n[2])) for n in nodes]
        self.samples = []
        s = 0.0
        prev = None
        for i in range(1, len(pts) - 1):
            p0, p1, p2 = pts[i - 1], pts[i], pts[i + 1]
            p3 = pts[min(i + 2, len(pts) - 1)]
            n = max(2, int((p2 - p1).length / step))
            for k in range(n):
                t = k / n
                p = catmull(p0, p1, p2, p3, t)
                w = nodes[i][3] + (nodes[i + 1][3] - nodes[i][3]) * t
                if prev is not None:
                    s += (p.xy - prev.xy).length
                self.samples.append((s, p, w))
                prev = p
        self.length = s

    def at(self, d):
        """(point on the road centre, tangent toward the quay, land-side normal, road width) at d."""
        d = max(0.0, min(self.length - 0.01, d))
        lo, hi = 0, len(self.samples) - 1
        while hi - lo > 1:
            mid = (lo + hi) // 2
            if self.samples[mid][0] <= d:
                lo = mid
            else:
                hi = mid
        s0, p0, w0 = self.samples[lo]
        s1, p1, w1 = self.samples[hi]
        t = (d - s0) / max(1e-6, s1 - s0)
        p = p0.lerp(p1, t)
        away = (p1 - p0)
        away.z = 0
        away.normalize()
        toward_quay = -away
        # the spine's left (land side) for travel away from the quay
        land = Vector((-away.y, away.x, 0.0))
        return p, toward_quay, land, w0 + (w1 - w0) * t


def look_at(obj, target, roll=0.0):
    d = Vector(target) - obj.location
    q = d.to_track_quat("-Z", "Y")
    if roll:
        from mathutils import Quaternion
        q = q @ Quaternion((0, 0, 1), roll)
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = q


def ease(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def smooth(e0, e1, x):
    return ease((x - e0) / (e1 - e0))


def link(obj, coll=None):
    (coll or bpy.context.scene.collection).objects.link(obj)
    return obj


def collection(name):
    c = bpy.data.collections.get(name)
    if not c:
        c = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(c)
    return c


def sec(t):
    """Seconds to frames (1-based, FPS)."""
    return 1 + round(t * FPS)
