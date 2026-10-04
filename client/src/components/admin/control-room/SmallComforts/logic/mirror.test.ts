import { describe, expect, it } from "vitest";
import { MIRROR, alignedTiltRange, beamFloorPoint, tiltFromPointerZ, traceMirror } from "./mirror";
import { completeStay, emptyEpisode, installFixture, normalizeEpisode } from "./episode";

describe("signal mirror optics", () => {
  it("has a forgiving but real aligned window at the middle of the beam", () => {
    const w = alignedTiltRange(1.0);
    expect(w).not.toBeNull();
    const width = w!.hi - w!.lo;
    expect(width).toBeGreaterThan(8);   // forgiving enough to find by hand
    expect(width).toBeLessThan(45);     // not "anything works"
  });
  it("outside the beam the light passes by: miss", () => {
    expect(traceMirror({ x: -1.5, tiltDeg: 40 }).outcome).toBe("miss");
    expect(traceMirror({ x: 2.4, tiltDeg: 40 }).outcome).toBe("miss");
  });
  it("a button lying too flat lets the beam slide over it: miss, light still visible on the floor", () => {
    expect(traceMirror({ x: 1, tiltDeg: 10 }).outcome).toBe("miss");
  });
  it("in the beam but the wrong lean: a legible glance that bounces somewhere else, on both sides of the right angle", () => {
    const low = traceMirror({ x: 1, tiltDeg: 32 });
    const high = traceMirror({ x: 1, tiltDeg: 72 });
    for (const t of [low, high]) {
      expect(t.outcome).toBe("glance");
      expect(t.hit).toBeDefined();
      expect(t.end).toBeDefined();
    }
    // the two wrong bounces go in clearly different directions, so the player can tell which way to correct
    const a = low.reflected!, b = high.reflected!;
    const angle = (Math.acos(a.x * b.x + a.y * b.y + a.z * b.z) * 180) / Math.PI;
    expect(angle).toBeGreaterThan(25);
  });
  it("aligned means the bounce lands on the lid lining", () => {
    const mid = alignedTiltRange(1.0)!.mid;
    const t = traceMirror({ x: 1, tiltDeg: mid });
    expect(t.outcome).toBe("aligned");
    expect(t.end!.z).toBeCloseTo(-2.6, 3);
  });
  it("any x inside the beam can be aligned, so there is no single pixel to find", () => {
    for (const x of [0.3, 0.7, 1.0, 1.4, 1.8]) expect(alignedTiltRange(x), `x=${x}`).not.toBeNull();
  });
  it("the aligned lean is reachable by dragging within the floor", () => {
    const mid = alignedTiltRange(1.0)!.mid;
    // find the pointer depth for it and make sure that depth is on the floor of the suitcase
    let pz = -1.7;
    while (tiltFromPointerZ(pz) < mid && pz < 3) pz += 0.01;
    expect(pz).toBeGreaterThan(-1.7);
    expect(pz).toBeLessThan(1.5);
  });
  it("poses are clamped, never NaN", () => {
    const t = traceMirror({ x: Number.NaN, tiltDeg: Number.NaN } as never);
    expect(["miss", "glance", "aligned"]).toContain(t.outcome);
    expect(MIRROR.minTilt).toBeLessThan(MIRROR.maxTilt);
    expect(beamFloorPoint(1).z).toBeGreaterThan(-1.95);
  });
});

describe("placement persists", () => {
  it("is stored with the fixture and survives normalize; absent for timer fixtures", () => {
    const start = completeStay(emptyEpisode(), "conductor", "t");
    const a = installFixture(start, "signal_mirror", { x: 1.2, tilt: 41 }).state;
    expect(normalizeEpisode(JSON.parse(JSON.stringify(a))).placements.signal_mirror).toEqual({ x: 1.2, tilt: 41 });
    const b = installFixture(start, "thimble_stove").state;
    expect(b.placements.thimble_stove).toBeUndefined();
  });
  it("old saves load with no placements, bad placements are dropped", () => {
    expect(normalizeEpisode({ residents: [], keepsakes: [], projects: [], arrivals: 0 }).placements).toEqual({});
    const bad = normalizeEpisode({ fixtures: ["signal_mirror"], placements: { signal_mirror: { x: "zz", tilt: null } } } as never);
    expect(bad.placements.signal_mirror).toBeUndefined();
  });
});
