import { describe, expect, it } from "vitest";
import {
  EXPEDITION_CORRIDOR_END,
  EXPEDITION_CORRIDOR_START,
  EXPEDITION_START_PROGRESS,
  corridorToExpedition,
  expeditionToCorridor,
  planInCorridorSpace,
  planPickupExpedition,
} from "./expeditionPlan";
import { RUINBOUND_TUNING } from "./ruinbound";

/**
 * Every authored beat must be somewhere the player can physically stand.
 *
 * The bug this file prevents: the plan authored its climax at 0.86 and its
 * destination at 0.96, while GoldlineGame clamps real movement to 0.82 in
 * all three movement paths (joystick, dodge, tether impulse). The
 * Shieldbearer and the pickup were therefore unreachable — the expedition
 * could never be finished by any input the player could produce.
 *
 * The corridor ceiling used here is 0.78 rather than 0.82 on purpose: it
 * keeps every beat below the ordinary corridor-exit trigger at 0.77 too, so
 * reachability holds even if transition suppression were ever broken. Two
 * independent guarantees rather than one.
 */

/** The real clamp in GoldlineGame's movement, dodge and impulse paths. */
const RUNTIME_MAX_PROGRESS = 0.82;
const RUNTIME_MIN_PROGRESS = 0.035;
/** Where ordinary corridor-exit logic arms. */
const CORRIDOR_EXIT_TRIGGER = 0.77;

const plan = planPickupExpedition({ orderId: 630031 });
const mapped = planInCorridorSpace(plan);

describe("the mapping itself", () => {
  it("puts the start at the expedition threshold", () => {
    expect(expeditionToCorridor(0)).toBe(EXPEDITION_CORRIDOR_START);
    expect(EXPEDITION_START_PROGRESS).toBe(EXPEDITION_CORRIDOR_START);
  });

  it("puts the far end at the playable ceiling", () => {
    expect(expeditionToCorridor(1)).toBe(EXPEDITION_CORRIDOR_END);
  });

  it("is monotonic, so ordering of beats is preserved", () => {
    let previous = -Infinity;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const p = expeditionToCorridor(t);
      expect(p).toBeGreaterThan(previous);
      previous = p;
    }
  });

  it("clamps out-of-range input rather than escaping the corridor", () => {
    expect(expeditionToCorridor(-5)).toBe(EXPEDITION_CORRIDOR_START);
    expect(expeditionToCorridor(99)).toBe(EXPEDITION_CORRIDOR_END);
  });

  it("round-trips through its inverse", () => {
    for (const t of [0, 0.18, 0.42, 0.5, 0.86, 0.96, 1]) {
      expect(corridorToExpedition(expeditionToCorridor(t))).toBeCloseTo(t, 10);
    }
  });

  it("is deterministic", () => {
    const a = JSON.stringify(planInCorridorSpace(plan));
    const b = JSON.stringify(planInCorridorSpace(plan));
    expect(a).toBe(b);
  });

  it("is a pure coordinate transform — it touches no business state", () => {
    // Identity is carried through untouched; nothing else about the order
    // is reachable from the mapping at all.
    expect(mapped.orderId).toBe(plan.orderId);
    expect(Object.keys(mapped).sort()).toEqual(Object.keys(plan).sort());
  });
});

describe("every beat is physically reachable", () => {
  const allProgress = [
    ...mapped.hostiles.map(h => ({ id: h.id, p: h.progress })),
    ...mapped.environment.map(e => ({ id: e.id, p: e.progress })),
    ...mapped.waystones.map(w => ({ id: w.id, p: w.progress })),
    { id: "fork.start", p: mapped.fork.start },
    { id: "fork.end", p: mapped.fork.end },
    { id: "relicPlinths", p: mapped.relicPlinths },
    { id: "destination", p: mapped.destination },
  ];

  it("places nothing beyond the runtime movement clamp", () => {
    for (const beat of allProgress) {
      expect(
        beat.p,
        `${beat.id} at ${beat.p} is past the ${RUNTIME_MAX_PROGRESS} clamp`
      ).toBeLessThanOrEqual(RUNTIME_MAX_PROGRESS);
      expect(beat.p).toBeGreaterThanOrEqual(RUNTIME_MIN_PROGRESS);
    }
  });

  it("keeps every beat below the ordinary corridor-exit trigger", () => {
    for (const beat of allProgress) {
      expect(
        beat.p,
        `${beat.id} at ${beat.p} sits past the ${CORRIDOR_EXIT_TRIGGER} exit trigger`
      ).toBeLessThan(CORRIDOR_EXIT_TRIGGER);
    }
  });

  it("makes the Shieldbearer climax reachable", () => {
    const climax = mapped.hostiles.find(h => h.kind === "shieldbearer")!;
    expect(climax.progress).toBeLessThan(RUNTIME_MAX_PROGRESS);
    expect(climax.progress).toBeGreaterThan(EXPEDITION_START_PROGRESS);
  });

  it("makes the pickup destination reachable", () => {
    expect(mapped.destination).toBeLessThan(RUNTIME_MAX_PROGRESS);
    // And it is still the furthest point of the journey.
    const furthestHostile = Math.max(...mapped.hostiles.map(h => h.progress));
    expect(mapped.destination).toBeGreaterThan(furthestHostile);
  });
});

describe("mapping preserves the authored grammar", () => {
  it("keeps the beat order intact", () => {
    const climax = mapped.hostiles.find(h => h.kind === "shieldbearer")!;
    const hazard = mapped.environment.find(e => e.kind === "hazard")!;
    const firstHostile = [...mapped.hostiles].sort(
      (a, b) => a.progress - b.progress
    )[0];
    const firstArch = mapped.environment
      .filter(e => e.kind === "architecture")
      .sort((a, b) => a.progress - b.progress)[0];

    expect(EXPEDITION_START_PROGRESS).toBeLessThan(firstArch.progress);
    expect(firstArch.progress).toBeLessThan(firstHostile.progress);
    expect(mapped.relicPlinths).toBeLessThan(mapped.fork.start);
    expect(mapped.fork.end).toBeLessThan(hazard.progress);
    expect(hazard.progress).toBeLessThan(climax.progress);
    expect(climax.progress).toBeLessThan(mapped.destination);
  });

  it("does not compress the opening below the safe-opening requirement", () => {
    // Compression shrinks gaps by ~0.72x, so the safe opening has to be
    // re-checked in the mapped space, not just the authored space.
    for (const spawn of mapped.hostiles) {
      const radius =
        RUINBOUND_TUNING[spawn.kind as keyof typeof RUINBOUND_TUNING]
          .aggroRadius;
      expect(
        spawn.progress - EXPEDITION_START_PROGRESS,
        `${spawn.id} can reach back into the teaching window`
      ).toBeGreaterThan(radius);
    }
  });

  it("leaves room to walk between the tutorial target and the first threat", () => {
    const firstArch = mapped.environment
      .filter(e => e.kind === "architecture")
      .sort((a, b) => a.progress - b.progress)[0];
    const firstHostile = [...mapped.hostiles].sort(
      (a, b) => a.progress - b.progress
    )[0];
    expect(firstHostile.progress - firstArch.progress).toBeGreaterThan(0.03);
  });
});

describe("the teaching target itself is safe to stand on", () => {
  it("keeps every guardian outside aggro range of the tutorial grapple", () => {
    // The invariant originally missing. Clearance was only checked from the
    // expedition START, but the player is meant to STAND at the tutorial
    // target for several seconds practising hold/aim/release. After the
    // mapping compressed every gap by ~0.72x, the first Hunter could reach
    // that spot and kill an idle learner.
    const tutorial = mapped.environment
      .filter(e => e.kind === "architecture")
      .sort((a, b) => a.progress - b.progress)[0];

    for (const spawn of mapped.hostiles) {
      const radius =
        RUINBOUND_TUNING[spawn.kind as keyof typeof RUINBOUND_TUNING]
          .aggroRadius;
      expect(
        spawn.progress - tutorial.progress,
        `${spawn.id} can reach the tutorial target at ${tutorial.progress}`
      ).toBeGreaterThan(radius);
    }
  });
});
