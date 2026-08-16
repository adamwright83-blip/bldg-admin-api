import { describe, expect, it } from "vitest";
import {
  activeEnvironment,
  activeHostiles,
  isInFork,
  planPickupExpedition,
  waystoneFor,
} from "./expeditionPlan";

describe("deterministic authored composition (§25/§49)", () => {
  it("produces an identical plan for the same real order, every time", () => {
    const a = planPickupExpedition({ orderId: 630031 });
    const b = planPickupExpedition({ orderId: 630031 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("uses no randomness — repeated planning never drifts", () => {
    const plans = Array.from({ length: 25 }, () =>
      JSON.stringify(planPickupExpedition({ orderId: 42 }))
    );
    expect(new Set(plans).size).toBe(1);
  });

  it("binds to the real order id as identity only", () => {
    expect(planPickupExpedition({ orderId: 987 }).orderId).toBe(987);
  });

  it("keeps difficulty identical across orders — only dressing varies", () => {
    const a = planPickupExpedition({ orderId: 1 });
    const b = planPickupExpedition({ orderId: 2 });

    expect(a.hostiles.map(h => h.kind)).toEqual(b.hostiles.map(h => h.kind));
    expect(a.hostiles.map(h => h.progress)).toEqual(b.hostiles.map(h => h.progress));
    expect(a.destination).toBe(b.destination);
  });
});

describe("expedition grammar (§26)", () => {
  const plan = planPickupExpedition({ orderId: 630031 });

  it("teaches with a safe Line target before the first threat", () => {
    const firstArch = plan.environment
      .filter(e => e.kind === "architecture")
      .sort((a, b) => a.progress - b.progress)[0];
    const firstHostile = [...plan.hostiles].sort(
      (a, b) => a.progress - b.progress
    )[0];

    expect(firstArch.progress).toBeLessThan(firstHostile.progress);
  });

  it("orders the beats: pressure, relic, fork, hazard, climax, destination", () => {
    const climax = plan.hostiles.find(h => h.kind === "shieldbearer")!;
    const hazard = plan.environment.find(e => e.kind === "hazard")!;

    expect(plan.relicPlinths).toBeLessThan(plan.fork.start);
    expect(plan.fork.end).toBeLessThan(hazard.progress);
    expect(hazard.progress).toBeLessThan(climax.progress);
    expect(climax.progress).toBeLessThan(plan.destination);
  });

  it("places exactly one hazard and one climax elite", () => {
    expect(plan.environment.filter(e => e.kind === "hazard")).toHaveLength(1);
    expect(plan.hostiles.filter(h => h.kind === "shieldbearer")).toHaveLength(1);
  });

  it("uses only the three specified enemy behaviours", () => {
    expect(new Set(plan.hostiles.map(h => h.kind))).toEqual(
      new Set(["hunter", "slinger", "shieldbearer"])
    );
  });
});

describe("routes differ materially (§28/§29)", () => {
  const plan = planPickupExpedition({ orderId: 630031 });

  it("gives Upper more hostile pressure than Safe", () => {
    const safe = activeHostiles(plan, "safe");
    const upper = activeHostiles(plan, "upper");
    expect(upper.length).toBeGreaterThan(safe.length);
  });

  it("gives Upper genuine grapple traversal Safe does not have", () => {
    const safeArch = activeEnvironment(plan, "safe").filter(
      e => e.kind === "architecture"
    );
    const upperArch = activeEnvironment(plan, "upper").filter(
      e => e.kind === "architecture"
    );
    expect(upperArch.length).toBeGreaterThan(safeArch.length);
  });

  it("routes both back through the same hazard and climax", () => {
    for (const route of ["safe", "upper"] as const) {
      expect(
        activeEnvironment(plan, route).some(e => e.kind === "hazard")
      ).toBe(true);
      expect(
        activeHostiles(plan, route).some(h => h.kind === "shieldbearer")
      ).toBe(true);
    }
  });

  it("opens and closes the fork as a physical stretch of corridor", () => {
    expect(isInFork(plan, plan.fork.start + 0.01)).toBe(true);
    expect(isInFork(plan, plan.fork.start - 0.05)).toBe(false);
    expect(isInFork(plan, plan.fork.end + 0.05)).toBe(false);
  });
});

describe("Scarred Route is a compromise, not a skip (§34)", () => {
  const plan = planPickupExpedition({ orderId: 630031 });

  it("lifts mandatory combat pressure", () => {
    expect(activeHostiles(plan, "scarred")).toHaveLength(0);
  });

  it("still requires physical traversal to the destination", () => {
    const scarred = activeEnvironment(plan, "scarred");
    expect(scarred.length).toBeGreaterThan(0);
    expect(scarred.some(e => e.kind === "architecture")).toBe(true);
  });

  it("does not move the destination closer", () => {
    expect(plan.destination).toBe(planPickupExpedition({ orderId: 630031 }).destination);
  });
});

describe("waystones", () => {
  const plan = planPickupExpedition({ orderId: 630031 });

  it("returns the most recent waystone behind the player", () => {
    expect(waystoneFor(plan, 0.5)?.id).toBe("waystone_prefork");
    expect(waystoneFor(plan, 0.8)?.id).toBe("waystone_preclimax");
  });

  it("returns null before the first waystone", () => {
    expect(waystoneFor(plan, 0.01)).toBeNull();
  });

  it("places one before the climax so defeat there is recoverable", () => {
    const climax = plan.hostiles.find(h => h.kind === "shieldbearer")!;
    const stone = waystoneFor(plan, climax.progress);
    expect(stone).not.toBeNull();
    expect(stone!.progress).toBeLessThan(climax.progress);
  });
});
