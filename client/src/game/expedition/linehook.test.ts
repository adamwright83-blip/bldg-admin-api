import { describe, expect, it } from "vitest";
import { LINEHOOK, Linehook, type PlayerBody } from "./linehook";

const FRAME = 1 / 60;

function body(over: Partial<PlayerBody> = {}): PlayerBody {
  return { x: 0, y: 0, vx: 0, vy: 0, ...over };
}

/**
 * Mirrors the real game loop: the Linehook writes VELOCITY only, and the
 * loop integrates position from it. That split is what makes momentum
 * survive a release — the hook never owns the player's position.
 */
function drive(hook: Linehook, b: PlayerBody, seconds: number) {
  const frames = Math.round(seconds / FRAME);
  const events = { latched: false, arrived: false };
  for (let i = 0; i < frames; i += 1) {
    const r = hook.update(FRAME, b);
    b.x += b.vx * FRAME;
    b.y += b.vy * FRAME;
    if (r.latched) events.latched = true;
    if (r.arrived) events.arrived = true;
  }
  return events;
}

/** Real seconds for the cable to reach an anchor, plus a little pull time. */
function flightSeconds(from: PlayerBody, anchor: { x: number; y: number }) {
  return Math.hypot(anchor.x - from.x, anchor.y - from.y) / LINEHOOK.flySpeed;
}

const architecture = { id: "arch_1", x: 400, y: -200, pulls: true };
const hostile = { id: "ruin_1", x: 200, y: 0, pulls: false };

describe("the Line is never a teleport", () => {
  it("does not move the player on fire", () => {
    const hook = new Linehook();
    const b = body();
    hook.fire(b, architecture);

    expect(b.x).toBe(0);
    expect(b.y).toBe(0);
    expect(hook.phase).toBe("flying");
  });

  it("travels the cable tip toward the anchor over time", () => {
    const hook = new Linehook();
    const b = body();
    hook.fire(b, architecture);

    hook.update(FRAME, b);
    const firstTip = { x: hook.tipX, y: hook.tipY };
    expect(firstTip.x).toBeGreaterThan(0);
    expect(firstTip.x).toBeLessThan(architecture.x);

    hook.update(FRAME, b);
    expect(hook.tipX).toBeGreaterThan(firstTip.x);
  });

  it("accelerates the player rather than snapping them to the anchor", () => {
    const hook = new Linehook();
    const b = body();
    hook.fire(b, architecture);
    // Long enough for the cable to actually connect, then pull briefly.
    drive(hook, b, flightSeconds(body(), architecture) + 0.15);

    // Moving toward the anchor, but nowhere near arrived.
    expect(b.vx).toBeGreaterThan(0);
    expect(b.vy).toBeLessThan(0);
    expect(Math.hypot(architecture.x - b.x, architecture.y - b.y)).toBeGreaterThan(
      LINEHOOK.arriveRadius
    );
  });

  it("caps pull acceleration so the haul reads as weight", () => {
    const hook = new Linehook();
    const b = body();
    hook.fire(b, { id: "far", x: 100_000, y: 0, pulls: true });
    drive(hook, b, 1.5);
    expect(Math.hypot(b.vx, b.vy)).toBeLessThanOrEqual(LINEHOOK.maxSpeed + 1e-6);
  });
});

describe("momentum is preserved on release", () => {
  it("never zeroes velocity on detach", () => {
    const hook = new Linehook();
    const b = body();
    hook.fire(b, architecture);
    drive(hook, b, flightSeconds(body(), architecture) + 0.2);

    const speedBefore = Math.hypot(b.vx, b.vy);
    expect(speedBefore).toBeGreaterThan(0);

    hook.release(b);
    const speedAfter = Math.hypot(b.vx, b.vy);

    expect(speedAfter).toBeGreaterThan(0);
    expect(speedAfter).toBeGreaterThanOrEqual(speedBefore);
  });

  it("does not reposition the player on release", () => {
    const hook = new Linehook();
    const b = body();
    hook.fire(b, architecture);
    drive(hook, b, flightSeconds(body(), architecture) + 0.2);

    const at = { x: b.x, y: b.y };
    hook.release(b);
    expect(b.x).toBe(at.x);
    expect(b.y).toBe(at.y);
  });

  it("keeps the swing direction through the release", () => {
    const hook = new Linehook();
    const b = body({ vy: -180 });
    hook.fire(b, architecture);
    drive(hook, b, flightSeconds(body(), architecture) + 0.15);

    const heading = Math.atan2(b.vy, b.vx);
    hook.release(b);
    expect(Math.atan2(b.vy, b.vx)).toBeCloseTo(heading, 6);
  });

  it("respects the speed ceiling even with the release boost", () => {
    const hook = new Linehook();
    const b = body({ vx: LINEHOOK.maxSpeed, vy: 0 });
    hook.fire(b, architecture);
    drive(hook, b, flightSeconds(body(), architecture) + 0.1);
    hook.release(b);
    expect(Math.hypot(b.vx, b.vy)).toBeLessThanOrEqual(LINEHOOK.maxSpeed + 1e-6);
  });
});

describe("swing preserves tangential motion", () => {
  it("retains cross-cable velocity so the player arcs", () => {
    const hook = new Linehook();
    // Anchor directly above; player moving sideways should swing, not stop.
    const b = body({ x: 0, y: 0, vx: 220, vy: 0 });
    hook.fire(b, { id: "above", x: 0, y: -300, pulls: true });
    drive(hook, b, 300 / LINEHOOK.flySpeed + 0.2);

    expect(b.vx).toBeGreaterThan(60);
    expect(b.vy).toBeLessThan(0);
  });
});

describe("latch semantics", () => {
  it("reports latched exactly once", () => {
    const hook = new Linehook();
    const b = body();
    hook.fire(b, architecture);

    let latchCount = 0;
    for (let i = 0; i < 120; i += 1) {
      if (hook.update(FRAME, b).latched) latchCount += 1;
    }
    expect(latchCount).toBe(1);
  });

  it("does not haul the player toward a hostile control latch", () => {
    const hook = new Linehook();
    const b = body();
    hook.fire(b, hostile);
    drive(hook, b, 0.5);

    // A hostile latch staggers and lets go; it must not drag Trailblazer in.
    expect(b.x).toBe(0);
    expect(b.vx).toBe(0);
  });

  it("arrives and releases near the anchor instead of colliding", () => {
    const hook = new Linehook();
    const b = body();
    hook.fire(b, { id: "close", x: 150, y: 0, pulls: true });
    const events = drive(hook, b, 3);

    expect(events.latched).toBe(true);
    expect(events.arrived).toBe(true);
    expect(Math.hypot(b.vx, b.vy)).toBeGreaterThan(0);
  });

  it("retracts back to idle after release", () => {
    const hook = new Linehook();
    const b = body();
    hook.fire(b, architecture);
    drive(hook, b, flightSeconds(body(), architecture) + 0.15);
    hook.release(b);
    expect(hook.phase).toBe("retracting");

    drive(hook, b, 2);
    expect(hook.phase).toBe("idle");
    expect(hook.isEngaged()).toBe(false);
  });

  it("reports tension while latched for the cable renderer", () => {
    const hook = new Linehook();
    const b = body();
    hook.fire(b, architecture);
    drive(hook, b, flightSeconds(body(), architecture) + 0.05);
    expect(hook.phase).toBe("latched");
    expect(hook.tension).toBeGreaterThan(0);
    expect(hook.tension).toBeLessThanOrEqual(1);
  });
});
