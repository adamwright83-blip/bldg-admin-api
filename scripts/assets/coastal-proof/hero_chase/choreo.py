"""The chase: who is where, doing what, every frame.

Beats (seconds):
  0.0  Rook drops onto the laundry line; the sheets glow in the backlight; he looks back, amused.
  1.1  He springs over the lens as Trailblazer bursts through the sheets.
  1.8  Awning (snaps under him) -> lantern rope (dips, lanterns swing) -> awning -> the sign bracket.
  4.1  On the sign he turns and waits for her. At the last moment he kicks off it to the roof; the
       board swings down across her path and she slides under it (the board wipes the lens).
  5.3  Rooftops: he runs the eaves above her while she runs the quay; she clips a fruit crate;
       gulls burst off the roofs.
  9.1  He drops onto a lantern rope and surfs it down across the road over her head; she swipes
       and misses; he springs off the pole onto the moored ship.
  10.6 He goes up the shrouds to the main top; she skids to the quay edge beneath him.
  13.5 At the top he turns, touches his hat brim and laughs; the gulls go up off the yards.
  18.5 End.
"""

import math

import bpy
from mathutils import Quaternion, Vector

from common import FPS, Shore, ease, smooth

DURATION = 18.5
N_FRAMES = int(round(DURATION * FPS)) + 1


def frame_time(f):
    return (f - 1) / FPS


def lerp(a, b, t):
    return a + (b - a) * t


def parabola(p0, p1, apex, u):
    """Point at u in [0,1] on a ballistic hop from p0 to p1 rising `apex` metres above the higher end."""
    p = p0.lerp(p1, u)
    top = max(p0.z, p1.z) + apex
    # a parabola through (0, p0.z), (1, p1.z) with its highest point `top`
    # solve z(u) = a u^2 + b u + c
    c = p0.z
    # choose the apex position so the curve peaks at `top`
    d0, d1 = top - p0.z, top - p1.z
    s = math.sqrt(max(d0, 1e-6)) / (math.sqrt(max(d0, 1e-6)) + math.sqrt(max(d1, 1e-6)))
    a = -d0 / (s * s)
    z = p0.z + a * (u - s) ** 2 + d0
    p.z = z
    return p


# ------------------------------------------------------------------ Trailblazer

class TrailblazerPath:
    """Her distance along the shore road over time (integrated from a speed profile), her lateral
    offset, and which clip plays."""

    SPRINT = 7.0

    def __init__(self, sh: Shore, d_start=85.0):
        self.sh = sh
        self.samples = []
        d = d_start
        dt = 1.0 / (FPS * 4)
        t = 0.0
        while t <= DURATION + 0.1:
            self.samples.append((t, d))
            d -= self.speed(t) * dt
            t += dt

    def speed(self, t):
        v = self.SPRINT
        if 4.45 <= t < 5.25:                       # the slide: momentum bleeding off
            v = lerp(6.8, 3.8, (t - 4.45) / 0.8)
        elif 5.25 <= t < 5.75:
            v = lerp(3.8, self.SPRINT, ease((t - 5.25) / 0.5))
        elif 5.85 <= t < 6.25:                     # clipping the crate
            v = self.SPRINT - 1.2 * math.sin(math.pi * (t - 5.85) / 0.4)
        elif t >= 9.85:                            # the skid to the quay edge
            v = self.SPRINT * max(0.0, 1.0 - ease((t - 9.85) / 1.35))
        return v

    def d(self, t):
        i = min(len(self.samples) - 1, max(0, int(t * FPS * 4)))
        return self.samples[i][1]

    def lateral(self, t):
        """+ toward the houses (land), - toward the sea edge."""
        x = -0.35
        x += 1.0 * smooth(5.4, 5.85, t) * (1 - smooth(6.1, 6.6, t))       # toward the fruit stall and away
        x += -1.2 * smooth(9.9, 11.0, t)                                  # to the quay edge under the ship
        return x

    def position(self, t):
        p, tq, land, w = self.sh.at(self.d(t))
        q = p + land * self.lateral(t)
        q.z = p.z + 0.03
        return q, tq, land

    def heading(self, t):
        """Direction she faces (unit, horizontal)."""
        q0, tq, land = self.position(t)
        q1, _, _ = self.position(t + 0.08)
        v = q1 - q0
        v.z = 0
        if v.length < 1e-3:
            return None
        return v.normalized()

    def clip(self, t):
        """[(clip name, clip time, weight)]"""
        run_t = self.run_phase(t)
        out = []
        if t < 4.45:
            out = [("Sprint_Loop", run_t, 1.0)]
        elif t < 5.4:
            u = t - 4.45
            if u < 0.25:
                w = ease(u / 0.12)
                out = [("Sprint_Loop", run_t, 1 - w), ("Slide_Start", u, w)]
            elif u < 0.75:
                out = [("Slide_Loop", u - 0.25, 1.0)]
            else:
                k = ease((u - 0.75) / 0.2)
                out = [("Slide_Exit", u - 0.75, 1.0 - k * 0.0), ("Sprint_Loop", run_t, k)]
        elif t < 9.85:
            out = [("Sprint_Loop", run_t, 1.0)]
        else:
            k = ease((t - 9.9) / 0.9)
            out = [("Sprint_Loop", run_t, 1 - k), ("Idle_Loop", t - 9.9, k)]
        return out

    def run_phase(self, t):
        """Sprint clip time: advances with distance so the feet stay planted."""
        # clip ground speed (m/s at playback 1) is set by the director after measuring the clip
        return (self.samples[0][1] - self.d(t)) / self.clip_speed

    clip_speed = 9.0


# ------------------------------------------------------------------ Rook

class RookTrack:
    """A list of segments; each gives Rook's feet position, facing and pose name at time t."""

    def __init__(self):
        self.segs = []   # (t0, t1, kind, data)

    def add(self, t0, t1, kind, **data):
        self.segs.append((t0, t1, kind, data))

    def at(self, t):
        for t0, t1, kind, data in self.segs:
            if t0 <= t < t1:
                return t0, t1, kind, data
        return self.segs[-1]

    def position(self, t):
        t0, t1, kind, data = self.at(t)
        u = 0.0 if t1 <= t0 else max(0.0, min(1.0, (t - t0) / (t1 - t0)))
        if kind in ("perch", "salute"):
            return data["p"].copy()
        if kind == "hop":
            return parabola(data["p0"], data["p1"], data.get("apex", 0.8), u)
        if kind in ("run", "surf", "climb"):
            pts = data["pts"]
            return along(pts, u)
        return data.get("p", Vector()).copy()


def along(pts, u):
    """Point at fraction u of a polyline's length."""
    L = [0.0]
    for a, b in zip(pts, pts[1:]):
        L.append(L[-1] + (b - a).length)
    s = u * L[-1]
    for i in range(len(pts) - 1):
        if L[i + 1] >= s:
            k = (s - L[i]) / max(1e-6, L[i + 1] - L[i])
            return pts[i].lerp(pts[i + 1], k)
    return pts[-1].copy()
