import { describe, expect, it } from "vitest";
import { LineCandidateRegistry } from "./lineCandidateRegistry";

/**
 * The registry is the semantic boundary the brand alone cannot provide.
 * These tests assert what the API makes POSSIBLE, not just what a given
 * call site happens to do — the registry has no bulk-add, no
 * collection-filtering constructor, and no adapter for population,
 * order, or business entities.
 */

const registry = () => new LineCandidateRegistry();

function withHunter(r: LineCandidateRegistry, id = "ruin_hunter_1") {
  r.registerHostile({
    id,
    hostile: "hunter",
    x: 100,
    y: 0,
    alive: true,
    onScreen: true,
    guardFacing: null,
  });
  return r;
}

describe("registry admits only fictional hostiles and authored scenery", () => {
  it("exposes no API that accepts a general world collection", () => {
    const r = registry();
    const surface = new Set([
      ...Object.getOwnPropertyNames(Object.getPrototypeOf(r)),
    ]);

    // If any of these ever appear, candidates could be derived by
    // filtering a population collection — the exact pattern §17 forbids.
    for (const forbidden of [
      "addAll",
      "fromPopulation",
      "fromEntities",
      "setCandidates",
      "adaptOrder",
      "adaptCivilian",
    ]) {
      expect(surface.has(forbidden)).toBe(false);
    }

    expect(surface.has("registerHostile")).toBe(true);
    expect(surface.has("registerEnvironment")).toBe(true);
  });

  it("starts empty — nothing is a candidate by default", () => {
    expect(registry().size()).toBe(0);
    expect(registry().candidateIds()).toEqual([]);
  });

  it("holds only what was explicitly registered", () => {
    const r = withHunter(registry());
    r.registerEnvironment({
      id: "hazard_cargo",
      environment: "hazard",
      x: 200,
      y: -40,
      armed: true,
      onScreen: true,
    });

    expect(r.candidateIds()).toEqual(["hazard_cargo", "ruin_hunter_1"]);
    expect(r.has("civilian_1")).toBe(false);
    expect(r.has("order:630031")).toBe(false);
  });
});

describe("civilians and real orders are absent even inside cone and range", () => {
  const aimAtEverything = {
    originX: 0,
    originY: 0,
    aimRadians: 0,
    maxRadius: 400,
  };

  it("never selects an unregistered civilian standing on the aim line", () => {
    const r = withHunter(registry());
    // A civilian at x=60 is nearer and perfectly aligned. It is simply not
    // in the registry, so it cannot be selected by any query.
    const selected = r.select(aimAtEverything);
    expect(selected?.id).toBe("ruin_hunter_1");
    expect(r.candidateIds()).not.toContain("civilian_1");
  });

  it("never selects the real pickup marker", () => {
    const r = withHunter(registry());
    expect(r.has("order:630031")).toBe(false);
    expect(r.rank(aimAtEverything).map(c => c.target.id)).not.toContain(
      "order:630031"
    );
  });

  it("yields nothing at all when only civilians exist in the world", () => {
    // The world is full of ambient life; none of it was registered.
    const r = registry();
    expect(r.select(aimAtEverything)).toBeNull();
    expect(r.size()).toBe(0);
  });
});

describe("registry projection", () => {
  const query = { originX: 0, originY: 0, aimRadians: 0, maxRadius: 400 };

  it("marks a defeated hostile inactive rather than leaving it targetable", () => {
    const r = registry();
    r.registerHostile({
      id: "h1",
      hostile: "hunter",
      x: 100,
      y: 0,
      alive: false,
      onScreen: true,
      guardFacing: null,
    });
    expect(r.select(query)).toBeNull();
  });

  it("marks an off-screen hostile unreadable", () => {
    const r = registry();
    r.registerHostile({
      id: "h1",
      hostile: "hunter",
      x: 100,
      y: 0,
      alive: true,
      onScreen: false,
      guardFacing: null,
    });
    expect(r.select(query)).toBeNull();
  });

  it("marks a spent hazard inactive", () => {
    const r = registry();
    r.registerEnvironment({
      id: "hazard",
      environment: "hazard",
      x: 100,
      y: 0,
      armed: false,
      onScreen: true,
    });
    expect(r.select(query)).toBeNull();
  });

  it("carries the shieldbearer guard facing through to the target", () => {
    const r = registry();
    r.registerHostile({
      id: "sb",
      hostile: "shieldbearer",
      x: 120,
      y: 0,
      alive: true,
      onScreen: true,
      guardFacing: Math.PI,
    });
    const target = r.select(query);
    expect(target?.kind).toBe("hostile");
    expect(target && target.kind === "hostile" && target.guardFacing).toBe(Math.PI);
  });

  it("drops unregistered hostiles immediately", () => {
    const r = withHunter(registry());
    r.unregisterHostile("ruin_hunter_1");
    expect(r.select(query)).toBeNull();
    expect(r.size()).toBe(0);
  });

  it("produces a deterministic, order-independent projection", () => {
    const a = registry();
    withHunter(a, "b_hunter");
    a.registerEnvironment({
      id: "a_arch",
      environment: "architecture",
      x: 150,
      y: 0,
      armed: true,
      onScreen: true,
    });

    expect(a.targets().map(t => t.id)).toEqual(["a_arch", "b_hunter"]);
    expect(a.targets().map(t => t.id)).toEqual(a.targets().map(t => t.id));
  });
});
