import { describe, expect, it, vi } from "vitest";
import { ExpeditionLayer } from "./ExpeditionLayer";
import {
  corridorDeltaFromScreenImpulse,
  projectCorridorPoint,
} from "./corridorCoupling";
import { planInCorridorSpace, planPickupExpedition } from "./expeditionPlan";

/**
 * Proves the tether moves the REAL Trailblazer, not a private body.
 *
 * The defect this file exists to prevent: ExpeditionLayer used to overwrite
 * `body.x/y` from the projection every frame, so Linehook wrote velocity
 * into a body that was reset before it could ever influence the corridor.
 * The rope passed its unit tests and did nothing in the game.
 *
 * This harness runs the SAME loop GoldlineGame.update runs — project, step
 * the layer, consume the impulse, convert through the shared coupling, apply
 * to corridor progress/lateral — using the very functions the production
 * runtime imports. `corridorCoupling.ts` exists precisely so this test
 * cannot drift into testing a re-implementation.
 */

const WIDTH = 393;
const HEIGHT = 852;
const FRAME = 1 / 60;

/** Stands in for GoldlineGame: it owns progress/lateral, nothing else does. */
class CorridorOwner {
  progress = 0.06;
  lateral = 0;
  velocity = 0;
  drivingByExpedition = false;

  project = (progress: number, lateral: number) =>
    projectCorridorPoint({
      progress,
      lateral,
      // Flat centreline keeps the assertions about the coupling itself.
      routeCenter: 0.5,
      width: WIDTH,
      height: HEIGHT,
    });

  /** Mirrors GoldlineGame.update's expedition block exactly. */
  step(layer: ExpeditionLayer, dt: number) {
    layer.setPlayerCorridor(this.progress, this.lateral * 140);
    layer.update(dt, this.progress, this.lateral * 140, this.project, WIDTH);

    const impulse = layer.consumeMovementImpulse();
    if (impulse.dx !== 0 || impulse.dy !== 0) {
      const { deltaProgress, deltaLateral } = corridorDeltaFromScreenImpulse({
        dx: impulse.dx,
        dy: impulse.dy,
        width: WIDTH,
        height: HEIGHT,
      });
      this.progress = Math.max(0.035, Math.min(0.82, this.progress + deltaProgress));
      this.lateral = Math.max(-0.72, Math.min(0.72, this.lateral + deltaLateral));
    }

    const handoff = layer.consumeHandoffSpeed();
    if (handoff > 0) this.velocity = Math.min(0.22, handoff / (HEIGHT * 0.61));
    this.drivingByExpedition = layer.isDrivingMovement();
  }
}

function scenario(callbacks = {}) {
  const layer = new ExpeditionLayer(callbacks);
  layer.load(planPickupExpedition({ orderId: 630031 }));
  const owner = new CorridorOwner();
  return { layer, owner };
}

/**
 * Runs one frame before aiming. The registry is rebuilt inside update(), so
 * the live runtime always has a frame of world state before it can process
 * input — the test mirrors that rather than reaching in early.
 */
function prime(layer: ExpeditionLayer, owner: CorridorOwner) {
  owner.step(layer, FRAME);
}

/**
 * Reads beat positions from the CORRIDOR-space plan — the same projection
 * ExpeditionLayer.load performs — so the test aims where the guardian
 * actually is rather than at its authored expedition-space coordinate.
 */
function beatPosition(targetId: string) {
  const plan = planInCorridorSpace(planPickupExpedition({ orderId: 630031 }));
  const env = plan.environment.find(e => e.id === targetId);
  if (env) return { progress: env.progress, lateral: env.lateral };
  const hostile = plan.hostiles.find(h => h.id === targetId)!;
  return { progress: hostile.progress, lateral: hostile.lateral };
}

function aimAt(layer: ExpeditionLayer, owner: CorridorOwner, targetId: string) {
  const beat = beatPosition(targetId);
  const at = owner.project(beat.progress, beat.lateral);
  const from = owner.project(owner.progress, owner.lateral * 140);
  layer.beginAim();
  layer.setAimRadians(Math.atan2(at.y - from.y, at.x - from.x));
}

/** Places the player just short of a beat so it is inside Line range. */
function standNear(owner: CorridorOwner, targetId: string, back = 0.03) {
  owner.progress = Math.max(0.035, beatPosition(targetId).progress - back);
}

describe("coupling is an exact inverse", () => {
  it("round-trips a screen delta back to the corridor delta that made it", () => {
    const a = projectCorridorPoint({
      progress: 0.3,
      lateral: 0,
      routeCenter: 0.5,
      width: WIDTH,
      height: HEIGHT,
    });
    const b = projectCorridorPoint({
      progress: 0.5,
      lateral: 28,
      routeCenter: 0.5,
      width: WIDTH,
      height: HEIGHT,
    });

    const { deltaProgress, deltaLateral } = corridorDeltaFromScreenImpulse({
      dx: b.x - a.x,
      dy: b.y - a.y,
      width: WIDTH,
      height: HEIGHT,
    });

    expect(deltaProgress).toBeCloseTo(0.2, 10);
    expect(deltaLateral).toBeCloseTo(28 / 140, 10);
  });

  it("treats upward screen motion as forward corridor progress", () => {
    const { deltaProgress } = corridorDeltaFromScreenImpulse({
      dx: 0,
      dy: -100,
      width: WIDTH,
      height: HEIGHT,
    });
    expect(deltaProgress).toBeGreaterThan(0);
  });
});

describe("architectural grapple moves the REAL corridor position", () => {
  it("changes the owner's progress, not just the layer's body", () => {
    const { layer, owner } = scenario();
    // The threshold beam sits ahead of the player at progress 0.1.
    prime(layer, owner);
    aimAt(layer, owner, "arch_threshold_beam");
    expect(layer.fireLine(owner.project)).toBe(true);

    const startProgress = owner.progress;
    for (let i = 0; i < 90; i += 1) owner.step(layer, FRAME);

    expect(owner.progress).toBeGreaterThan(startProgress);
  });

  it("does not move the player while the cable is still travelling", () => {
    const { layer, owner } = scenario();
    prime(layer, owner);
    aimAt(layer, owner, "arch_threshold_beam");
    layer.fireLine(owner.project);

    const startProgress = owner.progress;
    // One frame: the cable has barely left her hand.
    owner.step(layer, FRAME);
    expect(owner.progress).toBeCloseTo(startProgress, 6);
  });

  it("hands movement back after release with real momentum, not a dead stop", () => {
    const { layer, owner } = scenario();
    prime(layer, owner);
    aimAt(layer, owner, "arch_threshold_beam");
    layer.fireLine(owner.project);

    // Watch the whole swing rather than guessing a frame number: the tether
    // must take control at some point, then give it back.
    let everDriven = false;
    for (let i = 0; i < 360; i += 1) {
      owner.step(layer, FRAME);
      if (owner.drivingByExpedition) everDriven = true;
    }

    expect(everDriven).toBe(true);
    expect(owner.drivingByExpedition).toBe(false);
    // Momentum survived the release into ordinary locomotion.
    expect(owner.velocity).toBeGreaterThan(0);
  });

  it("keeps the corridor position inside its real clamps", () => {
    const { layer, owner } = scenario();
    prime(layer, owner);
    aimAt(layer, owner, "arch_threshold_beam");
    layer.fireLine(owner.project);
    for (let i = 0; i < 400; i += 1) owner.step(layer, FRAME);

    expect(owner.progress).toBeGreaterThanOrEqual(0.035);
    expect(owner.progress).toBeLessThanOrEqual(0.82);
    expect(owner.lateral).toBeGreaterThanOrEqual(-0.72);
    expect(owner.lateral).toBeLessThanOrEqual(0.72);
  });

  it("leaves the player still when no Line was ever fired", () => {
    const { layer, owner } = scenario();
    const startProgress = owner.progress;
    for (let i = 0; i < 120; i += 1) owner.step(layer, FRAME);
    expect(owner.progress).toBe(startProgress);
    expect(owner.drivingByExpedition).toBe(false);
  });
});

describe("latch resolves automatically on the connecting frame", () => {
  it("exposes the Shieldbearer without any external resolveLatch call", () => {
    const onLineLatched = vi.fn();
    const { layer, owner } = scenario({ onLineLatched });
    standNear(owner, "shieldbearer_climax");
    owner.lateral = 0;

    prime(layer, owner);
    aimAt(layer, owner, "shieldbearer_climax");
    expect(layer.fireLine(owner.project)).toBe(true);

    for (let i = 0; i < 60; i += 1) owner.step(layer, FRAME);

    expect(onLineLatched).toHaveBeenCalledTimes(1);
    expect(onLineLatched.mock.calls[0][0].id).toBe("shieldbearer_climax");
  });

  it("resolves exactly once, never again on later frames", () => {
    const onLineLatched = vi.fn();
    const { layer, owner } = scenario({ onLineLatched });
    standNear(owner, "shieldbearer_climax");

    prime(layer, owner);
    aimAt(layer, owner, "shieldbearer_climax");
    layer.fireLine(owner.project);
    for (let i = 0; i < 240; i += 1) owner.step(layer, FRAME);

    expect(onLineLatched).toHaveBeenCalledTimes(1);
  });

  it("triggers the environmental hazard on contact", () => {
    const onHazardTriggered = vi.fn();
    const { layer, owner } = scenario({ onHazardTriggered });
    standNear(owner, "hazard_suspended_cargo");

    prime(layer, owner);
    aimAt(layer, owner, "hazard_suspended_cargo");
    expect(layer.fireLine(owner.project)).toBe(true);

    for (let i = 0; i < 60; i += 1) owner.step(layer, FRAME);

    expect(onHazardTriggered).toHaveBeenCalledTimes(1);
  });

  it("does not re-trigger a spent hazard", () => {
    const onHazardTriggered = vi.fn();
    const { layer, owner } = scenario({ onHazardTriggered });
    standNear(owner, "hazard_suspended_cargo");

    prime(layer, owner);
    aimAt(layer, owner, "hazard_suspended_cargo");
    layer.fireLine(owner.project);
    for (let i = 0; i < 120; i += 1) owner.step(layer, FRAME);

    // A spent hazard is inactive, so it cannot even be selected again.
    prime(layer, owner);
    aimAt(layer, owner, "hazard_suspended_cargo");
    layer.fireLine(owner.project);
    for (let i = 0; i < 120; i += 1) owner.step(layer, FRAME);

    expect(onHazardTriggered).toHaveBeenCalledTimes(1);
  });

  it("does not haul the player toward a hostile control latch", () => {
    const { layer, owner } = scenario();
    standNear(owner, "shieldbearer_climax");
    const startProgress = owner.progress;

    prime(layer, owner);
    aimAt(layer, owner, "shieldbearer_climax");
    layer.fireLine(owner.project);
    for (let i = 0; i < 90; i += 1) owner.step(layer, FRAME);

    // A hostile latch staggers and lets go — it is not a traversal.
    expect(owner.progress).toBeCloseTo(startProgress, 4);
  });
});
