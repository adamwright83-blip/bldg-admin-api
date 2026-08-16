import { describe, expect, it } from "vitest";
import {
  PLAN_LATERAL_UNITS,
  projectCorridorPoint,
  projectNormalizedCorridorPoint,
} from "./corridorCoupling";
import { TRAVERSAL_Z, worldActorZ } from "../world/worldActorDepth";
import {
  EXPEDITION_START_PROGRESS,
  planInCorridorSpace,
  planPickupExpedition,
} from "./expeditionPlan";
import { ExpeditionLayer } from "./ExpeditionLayer";

const WIDTH = 393;
const HEIGHT = 852;

/**
 * A curved stretch of the authored Gold Line. The whole point of these
 * tests is that routeCenter is NOT 0.5 here — a hardcoded centreline was
 * exactly the bug, and it would pass every assertion written against a
 * straight lane.
 */
const CURVED_ROUTE_CENTER = 0.38;

describe("one projection for every world actor", () => {
  it("places Trailblazer and a civilian on the same curved lane", () => {
    // Civilians arrive in normalised runtime lateral; guardians and props in
    // authored plan units. Same position must land on the same pixel.
    const civilian = projectNormalizedCorridorPoint({
      progress: 0.42,
      lateral: 0.25,
      routeCenter: CURVED_ROUTE_CENTER,
      width: WIDTH,
      height: HEIGHT,
    });
    const guardian = projectCorridorPoint({
      progress: 0.42,
      lateral: 0.25 * PLAN_LATERAL_UNITS,
      routeCenter: CURVED_ROUTE_CENTER,
      width: WIDTH,
      height: HEIGHT,
    });

    expect(civilian.x).toBeCloseTo(guardian.x, 10);
    expect(civilian.y).toBeCloseTo(guardian.y, 10);
    expect(civilian.scale).toBeCloseTo(guardian.scale, 10);
  });

  it("fails a hardcoded 0.5 centreline", () => {
    // The exact implementation PopulationSystem used to carry.
    const hardcodedX = WIDTH * (0.5 + 0.25 * 0.22);
    const shared = projectNormalizedCorridorPoint({
      progress: 0.42,
      lateral: 0.25,
      routeCenter: CURVED_ROUTE_CENTER,
      width: WIDTH,
      height: HEIGHT,
    });

    // On a curved lane these genuinely disagree — which is why civilians
    // and combat actors appeared to walk different roads.
    expect(Math.abs(shared.x - hardcodedX)).toBeGreaterThan(20);
  });

  it("agrees with the straight lane only where the lane is straight", () => {
    const straight = projectNormalizedCorridorPoint({
      progress: 0.42,
      lateral: 0.25,
      routeCenter: 0.5,
      width: WIDTH,
      height: HEIGHT,
    });
    expect(straight.x).toBeCloseTo(WIDTH * (0.5 + 0.25 * 0.22), 10);
  });
});

describe("world actors interleave by screen depth", () => {
  it("orders far guardian, civilian, Trailblazer, near guardian", () => {
    const guardianFar = worldActorZ(300, "ruinbound:hunter_first");
    const civilianMid = worldActorZ(400, "civilian:7");
    const trailblazer = worldActorZ(500, "trailblazer");
    const guardianNear = worldActorZ(600, "ruinbound:slinger_first");

    expect(guardianFar).toBeLessThan(civilianMid);
    expect(civilianMid).toBeLessThan(trailblazer);
    expect(trailblazer).toBeLessThan(guardianNear);
  });

  it("keeps every actor above static world and below overlays", () => {
    // Includes a tablet-sized screen: the actor band scales with groundY,
    // so the overlay bands must clear the tallest supported viewport.
    for (const y of [0, 300, 852, 1366, 2048]) {
      const z = worldActorZ(y, "any");
      expect(z).toBeGreaterThan(TRAVERSAL_Z.FORTRESS);
      expect(z).toBeLessThan(TRAVERSAL_Z.PARTICLES);
      expect(z).toBeLessThan(TRAVERSAL_Z.GAMEPLAY_OVERLAY);
    }
  });

  it("breaks exact ties deterministically, never at random", () => {
    const a = worldActorZ(400, "civilian:1");
    const b = worldActorZ(400, "ruinbound:x");
    expect(a).not.toBe(b);
    // Stable across calls — no flicker between frames.
    for (let i = 0; i < 20; i += 1) {
      expect(worldActorZ(400, "civilian:1")).toBe(a);
      expect(worldActorZ(400, "ruinbound:x")).toBe(b);
    }
  });

  it("lets ground Y dominate the tie-breaker", () => {
    // A one-pixel depth difference must outrank any id hash.
    const nearer = worldActorZ(401, "aaaaaaaa");
    const further = worldActorZ(400, "zzzzzzzz");
    expect(nearer).toBeGreaterThan(further);
  });
});

describe("route change must not re-map an already-mapped plan", () => {
  const raw = planPickupExpedition({ orderId: 630031 });
  const mapped = planInCorridorSpace(raw);

  function beat(layer: ExpeditionLayer, id: string): number {
    const plan = (layer as unknown as { plan: typeof mapped }).plan;
    return (
      plan.hostiles.find(h => h.id === id)?.progress ??
      plan.environment.find(e => e.id === id)!.progress
    );
  }

  it("keeps route-independent beats at identical corridor positions", () => {
    const layer = new ExpeditionLayer();
    layer.load(raw);

    const before = {
      hunter: beat(layer, "hunter_first"),
      hazard: beat(layer, "hazard_suspended_cargo"),
      climax: beat(layer, "shieldbearer_climax"),
      fork: (layer as unknown as { plan: typeof mapped }).plan.fork.start,
      destination: (layer as unknown as { plan: typeof mapped }).plan
        .destination,
    };

    layer.setRoute("upper");

    // Double-mapping would drag every one of these back toward the start.
    expect(beat(layer, "hunter_first")).toBe(before.hunter);
    expect(beat(layer, "hazard_suspended_cargo")).toBe(before.hazard);
    expect(beat(layer, "shieldbearer_climax")).toBe(before.climax);
    expect(
      (layer as unknown as { plan: typeof mapped }).plan.fork.start
    ).toBe(before.fork);
    expect(
      (layer as unknown as { plan: typeof mapped }).plan.destination
    ).toBe(before.destination);
  });

  it("still matches a freshly mapped plan after several route changes", () => {
    const layer = new ExpeditionLayer();
    layer.load(raw);
    layer.setRoute("upper");
    layer.setRoute("safe");

    expect(beat(layer, "shieldbearer_climax")).toBe(
      mapped.hostiles.find(h => h.kind === "shieldbearer")!.progress
    );
  });
});

describe("there is exactly one route truth", () => {
  it("records a physical route choice on the run", () => {
    const layer = new ExpeditionLayer();
    layer.load(planPickupExpedition({ orderId: 630031 }));

    expect(layer.run.route).toBe("unchosen");
    layer.setRoute("safe");
    expect(layer.run.route).toBe("safe");
  });

  it("moves to the Scarred Route through the same field", () => {
    const layer = new ExpeditionLayer();
    layer.load(planPickupExpedition({ orderId: 630031 }));
    layer.setRoute("upper");
    layer.pressOn();

    expect(layer.run.route).toBe("scarred");
    expect(layer.run.scarred).toBe(true);
  });

  it("removes mandatory hostiles on the Scarred Route", () => {
    const layer = new ExpeditionLayer();
    layer.load(planPickupExpedition({ orderId: 630031 }));
    const before = (layer as unknown as { hostiles: unknown[] }).hostiles.length;
    expect(before).toBeGreaterThan(0);

    layer.pressOn();
    expect((layer as unknown as { hostiles: unknown[] }).hostiles).toHaveLength(0);
  });

  it("refuses to re-route once scarred", () => {
    const layer = new ExpeditionLayer();
    layer.load(planPickupExpedition({ orderId: 630031 }));
    layer.pressOn();
    layer.setRoute("upper");
    expect(layer.run.route).toBe("scarred");
  });
});

describe("waystones come from the mapped plan", () => {
  it("seeds the threshold waystone in corridor space at load", () => {
    const layer = new ExpeditionLayer();
    layer.load(planPickupExpedition({ orderId: 630031 }));

    const stone = layer.run.lastWaystone;
    expect(stone).not.toBeNull();
    // Corridor space, not raw expedition T=0.
    expect(stone!.progress).toBeCloseTo(EXPEDITION_START_PROGRESS, 10);
  });

  it("redeploys to a corridor position, never a raw expedition value", () => {
    const layer = new ExpeditionLayer();
    layer.load(planPickupExpedition({ orderId: 630031 }));
    const restored = layer.redeploy();

    expect(restored).toBeCloseTo(EXPEDITION_START_PROGRESS, 10);
    expect(layer.run.outcome).toBe("running");
  });
});
