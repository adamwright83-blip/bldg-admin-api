"""Temp sound design and score for the Rook chase trailer, synthesized and synced to events.json.

    python3 scripts/assets/coastal-proof/hero_chase/sound.py tmp/hero/ev/events.json tmp/hero/trailer.wav [--tail 3.2]

Everything is generated here (owned outright): harbour wash and wind, footsteps, Rook's hops and
landings, canvas, sign, slide, crate and fruit, gulls, the rope zip, the bell on Rook's hat, and a
driving percussion score that lands on the end card. It is a temp track: a real score and recorded
foley are the upgrade.
"""

import json
import math
import sys

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, sosfilt

SR = 48000
rng = np.random.default_rng(7)


def bp(x, lo, hi, order=2):
    sos = butter(order, [lo, hi], btype="band", fs=SR, output="sos")
    return sosfilt(sos, x)


def lp(x, f, order=2):
    return sosfilt(butter(order, f, btype="low", fs=SR, output="sos"), x)


def hp(x, f, order=2):
    return sosfilt(butter(order, f, btype="high", fs=SR, output="sos"), x)


def noise(n):
    return rng.standard_normal(n)


def env(n, a, d, shape=1.0):
    t = np.arange(n) / SR
    e = np.minimum(1.0, t / max(a, 1e-4)) * np.exp(-np.maximum(0, t - a) / max(d, 1e-4))
    return e ** shape


class Track:
    def __init__(self, seconds):
        self.buf = np.zeros((int(seconds * SR) + SR, 2))

    def add(self, t, sig, gain=1.0, pan=0.0):
        i = int(t * SR)
        if i >= len(self.buf) or i + len(sig) <= 0:
            return
        if i < 0:
            sig = sig[-i:]
            i = 0
        n = min(len(sig), len(self.buf) - i)
        l = math.cos((pan + 1) * math.pi / 4)
        r = math.sin((pan + 1) * math.pi / 4)
        self.buf[i:i + n, 0] += sig[:n] * gain * l
        self.buf[i:i + n, 1] += sig[:n] * gain * r


# ------------------------------------------------------------------ sounds

def footstep(heavy=1.0):
    n = int(0.18 * SR)
    thump = np.sin(2 * math.pi * np.cumsum(np.linspace(110, 55, n)) / SR) * env(n, 0.002, 0.04)
    grit = bp(noise(n), 400, 3500) * env(n, 0.001, 0.025)
    return (thump * 0.9 * heavy + grit * 0.5)


def whoosh(dur=0.45, lo=300, hi=2600, rise=True):
    n = int(dur * SR)
    x = noise(n)
    out = np.zeros(n)
    steps = 12
    for k in range(steps):
        a, b = k * n // steps, (k + 1) * n // steps
        u = k / steps if rise else 1 - k / steps
        f0 = lo * (hi / lo) ** u
        out[a:b] = bp(x[a:b], f0 * 0.7, min(f0 * 1.4, SR / 2 - 100))
    shape = np.sin(np.linspace(0, math.pi, n)) ** 1.5
    return out * shape


def flutter(dur=0.25):
    n = int(dur * SR)
    am = 0.5 + 0.5 * np.sign(np.sin(2 * math.pi * 26 * np.arange(n) / SR))
    return bp(noise(n), 500, 4000) * am * env(n, 0.005, dur / 3)


def soft_land():
    n = int(0.25 * SR)
    return lp(noise(n), 900) * env(n, 0.002, 0.05) * 1.4 + flutter(0.18)[:n] * 0.4 if False else \
        np.concatenate([lp(noise(n), 900) * env(n, 0.002, 0.05) * 1.4])


def canvas_thump():
    n = int(0.6 * SR)
    body = lp(noise(n), 260) * env(n, 0.003, 0.09) * 3.0
    flap = bp(noise(n), 250, 1600) * env(n, 0.01, 0.15) * (0.5 + 0.5 * np.sin(2 * math.pi * 11 * np.arange(n) / SR))
    return body + flap * 0.8


def wood_knock(f=180):
    n = int(0.3 * SR)
    t = np.arange(n) / SR
    tone = (np.sin(2 * math.pi * f * t) + 0.5 * np.sin(2 * math.pi * f * 2.7 * t)) * env(n, 0.001, 0.05)
    return tone + bp(noise(n), 800, 5000) * env(n, 0.0005, 0.01) * 0.6


def chain_rattle(dur=0.7):
    n = int(dur * SR)
    out = np.zeros(n)
    for k in range(14):
        i = int(rng.uniform(0, 0.8) * n)
        m = int(0.05 * SR)
        t = np.arange(m) / SR
        f = rng.uniform(2200, 4200)
        click = np.sin(2 * math.pi * f * t) * env(m, 0.0005, 0.012)
        out[i:i + m] += click[:max(0, min(m, n - i))] * rng.uniform(0.3, 0.8) * (1 - i / n)
    return out


def scrape(dur):
    n = int(dur * SR)
    x = bp(noise(n), 900, 5200) * (0.7 + 0.3 * np.sin(2 * math.pi * 7 * np.arange(n) / SR))
    return x * env(n, 0.03, dur * 0.5) + lp(noise(n), 300) * env(n, 0.02, dur * 0.5) * 0.8


def crate_hit():
    n = int(0.5 * SR)
    crack = hp(noise(n), 1200) * env(n, 0.0005, 0.02) * 1.2
    body = wood_knock(140)
    out = np.zeros(n)
    out[:len(body)] += body
    return out + crack


def fruit_tumble(t0, track, count=14):
    for k in range(count):
        t = t0 + 0.08 + rng.uniform(0, 1.1) ** 1.5
        n = int(0.12 * SR)
        f = rng.uniform(120, 260)
        tt = np.arange(n) / SR
        s = np.sin(2 * math.pi * f * tt) * env(n, 0.001, 0.02) + lp(noise(n), 1500) * env(n, 0.001, 0.015) * 0.5
        track.add(t, s, gain=rng.uniform(0.15, 0.35), pan=rng.uniform(-0.6, 0.6))


def gull_call(n_notes=3):
    out = []
    for k in range(n_notes):
        dur = rng.uniform(0.16, 0.26)
        n = int(dur * SR)
        t = np.arange(n) / SR
        f0 = rng.uniform(1100, 1500)
        sweep = f0 * (1 + 0.8 * np.sin(np.pi * t / dur)) * (1 - 0.25 * t / dur)
        ph = 2 * np.pi * np.cumsum(sweep) / SR
        s = (np.sin(ph) + 0.45 * np.sin(2 * ph) + 0.2 * np.sin(3 * ph)) * env(n, 0.01, dur * 0.4)
        s += bp(noise(n), 1500, 4000) * env(n, 0.005, dur * 0.3) * 0.25
        out.append(s)
        out.append(np.zeros(int(rng.uniform(0.04, 0.1) * SR)))
    return np.concatenate(out)


def zip_line(dur):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = 380 + 900 * (t / dur) ** 1.3
    ph = 2 * np.pi * np.cumsum(f) / SR
    saw = 2 * ((ph / (2 * np.pi)) % 1.0) - 1
    return bp(saw, 300, 3000) * np.sin(np.pi * t / dur) ** 0.6 * 0.5 + scrape(dur) * 0.4


def bell():
    n = int(2.2 * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for ratio, amp, dec in ((1, 0.6, 0.9), (2.76, 0.3, 0.5), (5.4, 0.15, 0.25), (8.93, 0.07, 0.12)):
        out += amp * np.sin(2 * np.pi * 1560 * ratio * t) * np.exp(-t / dec)
    return out * env(n, 0.001, 1.5)


def taiko(f0=62, dur=0.9, gain=1.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = f0 * (1.6 * np.exp(-t * 30) + 1.0)
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t / 0.22)
    slap = lp(noise(n), 1800) * np.exp(-t / 0.02) * 0.5
    return (body + slap) * gain


def hat(dur=0.06, open_=False):
    n = int((0.22 if open_ else dur) * SR)
    return hp(noise(n), 7000) * env(n, 0.0005, 0.08 if open_ else 0.018)


def bass_pulse(freq, dur):
    n = int(dur * SR)
    t = np.arange(n) / SR
    saw = 2 * ((freq * t) % 1.0) - 1
    return lp(saw, 380) * env(n, 0.005, dur * 0.6)


def boom():
    n = int(4.0 * SR)
    t = np.arange(n) / SR
    sub = np.sin(2 * np.pi * np.cumsum(38 + 60 * np.exp(-t * 8)) / SR) * np.exp(-t / 1.4)
    air = lp(noise(n), 700) * np.exp(-t / 0.5) * 0.4
    return sub + air


def riser(dur):
    n = int(dur * SR)
    return whoosh(dur, 200, 6000, True) * (np.arange(n) / n) ** 1.5 * 1.4


# ------------------------------------------------------------------ mix

def build(events, out_path, tail=3.2):
    D = events["duration"] + tail
    amb = Track(D)
    sfx = Track(D)
    mus = Track(D)
    n = int(D * SR)
    t = np.arange(n) / SR
    # harbour wash: slow swells of low noise, and wind that gusts
    wash = lp(noise(n), 520) * (0.55 + 0.45 * np.sin(2 * np.pi * t / 6.3) ** 2)
    wind = bp(noise(n), 280, 1400) * (0.35 + 0.35 * np.sin(2 * np.pi * t / 3.7 + 1.0) ** 2 + 0.2 * np.sin(2 * np.pi * t / 1.3) ** 2)
    amb.add(0, wash * 0.16, pan=-0.2)
    amb.add(0, wind * 0.09, pan=0.25)
    # far gulls through the whole piece
    for k in range(9):
        amb.add(rng.uniform(0.5, D - 2), gull_call(rng.integers(2, 4)), gain=0.05, pan=rng.uniform(-0.8, 0.8))

    # footsteps: the detected contacts are one foot's; the other lands half a stride later
    fs = sorted(events["footsteps"])
    steps = list(fs)
    for a, b in zip(fs, fs[1:]):
        if b - a < 1.2:
            steps.append((a + b) / 2)
    for i, s in enumerate(sorted(steps)):
        if events["slide"][0] <= s < events["slide"][1]:
            continue
        sfx.add(s, footstep(1.0), gain=0.32, pan=-0.1 if i % 2 else 0.1)
    # Rook: a whoosh off every hop, a soft landing and a feather flutter at the other end
    for t0, t1 in zip(events["rook_hops"], events["rook_lands"]):
        sfx.add(t0, whoosh(min(0.5, t1 - t0 + 0.1), 400, 3000), gain=0.18, pan=0.3)
        sfx.add(t1, flutter(0.2), gain=0.2, pan=0.3)
    for a in events["awning"]:
        sfx.add(a, canvas_thump(), gain=0.55, pan=0.35)
    sfx.add(events["laundry_burst"], whoosh(0.5, 180, 1400) + 0, gain=0.5)
    sfx.add(events["laundry_burst"] + 0.02, canvas_thump(), gain=0.35)
    k = events["sign_kick"]
    sfx.add(k, wood_knock(150), gain=0.55, pan=0.25)
    sfx.add(k + 0.05, chain_rattle(), gain=0.35, pan=0.25)
    sfx.add(k + 0.35, whoosh(0.5, 150, 900), gain=0.4)
    sfx.add(events["slide"][0], scrape(events["slide"][1] - events["slide"][0]), gain=0.45)
    sfx.add(events["crate"], crate_hit(), gain=0.6, pan=0.3)
    fruit_tumble(events["crate"], sfx)
    for g in events["gulls"]:
        for b in range(7):
            sfx.add(g + rng.uniform(0, 0.8), gull_call(rng.integers(1, 3)), gain=rng.uniform(0.07, 0.14), pan=rng.uniform(-0.9, 0.9))
            sfx.add(g + rng.uniform(0, 0.5), flutter(0.3), gain=0.12, pan=rng.uniform(-0.9, 0.9))
    if "rope_surf" in events:
        r0, r1 = events["rope_surf"]
        sfx.add(r0, zip_line(r1 - r0 + 0.15), gain=0.6, pan=0.2)
    if "swipe" in events:
        sfx.add(events["swipe"], whoosh(0.3, 500, 3500), gain=0.4, pan=-0.2)
    if "steal" in events:
        # the snatch: a dive, a flutter at her hip, the compass chain
        sfx.add(events["steal"] - 0.45, whoosh(0.5, 300, 3200), gain=0.35, pan=-0.3)
        sfx.add(events["steal"], flutter(0.3), gain=0.35)
        sfx.add(events["steal"] + 0.02, chain_rattle(0.4), gain=0.45)
    if "plant" in events:
        # the vault: the pole bites the stones, a long rising air, the world slows and booms at the top
        sfx.add(events["plant"], wood_knock(110), gain=0.7)
        sfx.add(events["plant"] + 0.02, crate_hit(), gain=0.25)
        a0, a1 = events["slow"]
        sfx.add(events["plant"] + 0.05, whoosh(a0 - events["plant"] + 0.3, 150, 2200), gain=0.45)
        sfx.add(a0, boom(), gain=0.45)
        sfx.add(a0 + 0.1, whoosh(a1 - a0, 120, 900, rise=False), gain=0.35)
        sfx.add(events["apex"] + 0.05, flutter(0.45), gain=0.4, pan=0.2)
        sfx.add(events["land"], footstep(1.8), gain=0.6)
        sfx.add(events["land"] + 0.05, lp(noise(int(0.3 * SR)), 400) * env(int(0.3 * SR), 0.002, 0.08), gain=0.6)
        sfx.add(events["roll"], scrape(0.7), gain=0.35)
    sfx.add(events["skid"][0], scrape(1.0), gain=0.5)
    sfx.add(events["salute"], bell(), gain=0.35, pan=0.15)

    # score: 124 bpm, taiko and bass driving the chase; drops out for the salute; a boom for the card
    bpm = 124.0
    beat = 60.0 / bpm
    end_music = events["salute"] - 0.1
    b = 0
    tb = 0.35
    slow = events.get("slow", [-1, -1])
    while tb < end_music:
        if slow[0] - 0.1 <= tb < slow[1] + 0.2:
            tb += beat
            b += 1
            continue
        bar_pos = b % 8
        build = min(1.0, tb / end_music + 0.3)
        if bar_pos in (0, 3, 6):
            mus.add(tb, taiko(58, gain=0.9 * build))
        if bar_pos in (4,):
            mus.add(tb, taiko(74, 0.6, gain=0.6 * build))
        if b % 2 == 0:
            mus.add(tb, bass_pulse(41.2 if (b // 16) % 2 == 0 else 46.25, beat * 1.8), gain=0.35 * build)
        mus.add(tb + beat / 2, hat(open_=(b % 4 == 3)), gain=0.1 * build, pan=0.3)
        if tb > end_music - 2.2 and b % 1 == 0:
            mus.add(tb + beat / 2, taiko(88, 0.35, gain=0.35))
        tb += beat
        b += 1
    mus.add(end_music - 1.6, riser(1.6), gain=0.25)
    # after the hit: a held low drone and the harbour opening up under the final two-shot
    hold = events["duration"] - end_music - 0.2
    nh = int(hold * SR)
    th = np.arange(nh) / SR
    drone = sum(np.sin(2 * np.pi * f * th + ph) for f, ph in ((55.0, 0), (82.4, 1.1), (110.4, 2.3), (164.8, 0.7))) / 4
    drone = lp(drone, 900) * np.minimum(1.0, th / 1.2) * (0.8 + 0.2 * np.sin(2 * np.pi * th / 2.1))
    mus.add(end_music + 0.2, drone, gain=0.22)
    amb.add(end_music + 0.3, lp(noise(nh), 600) * np.sin(np.pi * th / hold) ** 0.5, gain=0.12, pan=-0.1)
    for k in range(3):
        amb.add(end_music + 0.8 + k * 1.3, gull_call(2), gain=0.08, pan=rng.uniform(-0.6, 0.6))
    mus.add(end_music, taiko(52, 1.4, gain=1.1))
    card = events["duration"] - 0.05
    mus.add(card, boom(), gain=0.9)
    mus.add(card, bell(), gain=0.2)

    mix = amb.buf * 0.9 + sfx.buf * 1.0 + mus.buf * 0.8
    # duck the ambience a little under the score's hits: gentle, not pumping
    mix = np.tanh(mix * 1.1) * 0.85
    mix = mix[: int(D * SR)]
    peak = np.max(np.abs(mix))
    mix = mix / max(peak, 1e-6) * 0.89
    wavfile.write(out_path, SR, (mix * 32767).astype(np.int16))
    print(f"[sound] {out_path}: {D:.1f} s, {len(sorted(steps))} footsteps")


if __name__ == "__main__":
    ev = json.load(open(sys.argv[1]))
    tail = float(sys.argv[sys.argv.index("--tail") + 1]) if "--tail" in sys.argv else 3.2
    build(ev, sys.argv[2], tail)
