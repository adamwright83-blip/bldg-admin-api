import { describe, expect, it } from "vitest";
import {
  CLASH_ENGAGEMENT_RADIUS,
  CLASH_QUIET_SECONDS,
  ECHO_THREAD_RADIUS,
  ExpeditionLayer,
  RELIC_PLINTH_LATERAL,
  RELIC_TAKE_RADIUS,
  SUNSTEP_RADIUS,
} from "./ExpeditionLayer";
import { projectCorridorPoint } from "./corridorCoupling";
import { planInCorridorSpace, planPickupExpedition } from "./expeditionPlan";
import { RELICS, type RelicId } from "./expeditionState";
import {
  Hunter,
  LATERAL_TO_PROGRESS,
  RUINBOUND_TUNING,
  Shieldbearer,
  type Ruinbound,
} from "./ruinbound";

/**
 * The three relics, as MECHANICS rather than promises.
 *
 * §27 says the player must FEEL which relic they picked without reading a
 * stat screen — each changes a verb, not a number. Before this pass, all
 * three existed only as `RELICS` copy and a `hasRelic()` lookup that
 * nothing in the layer consulted: Echo Thread and Sunstep had no
 * implementation at all, and Brass Guard's `clashEnded()` recharge was
 * never called by anything, so the guard absorbed exactly one blow per
 * expedition and then silently stopped being a relic.
 *
 * These tests drive the real layer, not a re-implementation.
 */

const WIDTH = 393;
const HEIGHT = 852;
const FRAME = 1 / 60;
const ORDER_ID = 630031;

const project = (progress: number, lateral: number) =>
  projectCorridorPoint({
    progress,
    lateral,
    routeCenter: 0.5,
    width: WIDTH,
    height: HEIGHT,
  });

function loadedLayer() {
  const layer = new ExpeditionLayer();
  layer.load(planPickupExpedition({ orderId: ORDER_ID }));
  return layer;
}

/** The layer's private hostile list — the real instances, not a copy. */
function hostilesOf(layer: ExpeditionLayer): Ruinbound[] {
  return (layer as unknown as { hostiles: Ruinbound[] }).hostiles;
}

/** Replaces the roster so a test can state exactly what stands where. */
function setHostiles(layer: ExpeditionLayer, hostiles: Ruinbound[]) {
  (layer as unknown as { hostiles: Ruinbound[] }).hostiles = hostiles;
}

function step(
  layer: ExpeditionLayer,
  progress: number,
  lateral: number,
  seconds = FRAME
) {
  layer.setPlayerCorridor(progress, lateral);
  layer.update(seconds, progress, lateral, project, WIDTH);
}

const mapped = planInCorridorSpace(planPickupExpedition({ orderId: ORDER_ID }));

describe("relics are taken physically, never from a picker", () => {
  it("takes the relic whose plinth the player actually walks to", () => {
    for (const relic of RELICS) {
      const layer = loadedLayer();
      expect(layer.getSnapshot().relic).toBeNull();

      step(layer, mapped.relicPlinths, RELIC_PLINTH_LATERAL[relic.id]);
      expect(layer.getSnapshot().relic).toBe(relic.id);
    }
  });

  it("takes nothing while the player is merely passing the relic point", () => {
    const layer = loadedLayer();
    // Dead centre of the lane is Sunstep's plinth, so step off it: walking
    // the relic row must not hand out a relic by accident.
    const between =
      (RELIC_PLINTH_LATERAL.sunstep + RELIC_PLINTH_LATERAL.brass_guard) / 2;
    step(layer, mapped.relicPlinths, between);
    expect(layer.getSnapshot().relic).toBeNull();
  });

  it("keeps the plinths far enough apart that two can never both be in range", () => {
    const laterals = RELICS.map(r => RELIC_PLINTH_LATERAL[r.id]).sort(
      (a, b) => a - b
    );
    for (let i = 0; i < laterals.length - 1; i += 1) {
      const gap = (laterals[i + 1] - laterals[i]) * LATERAL_TO_PROGRESS;
      expect(gap).toBeGreaterThan(RELIC_TAKE_RADIUS * 2);
    }
  });

  it("is a one-time choice — a second plinth cannot overwrite the first", () => {
    const layer = loadedLayer();
    step(layer, mapped.relicPlinths, RELIC_PLINTH_LATERAL.sunstep);
    expect(layer.getSnapshot().relic).toBe("sunstep");

    step(layer, mapped.relicPlinths, RELIC_PLINTH_LATERAL.brass_guard);
    expect(layer.getSnapshot().relic).toBe("sunstep");
  });

  it("forfeits the relics on the Scarred Route (§34)", () => {
    const layer = loadedLayer();
    layer.pressOn();
    step(layer, mapped.relicPlinths, RELIC_PLINTH_LATERAL.echo_thread);
    expect(layer.getSnapshot().relic).toBeNull();
  });

  it("reports the relic the player took to the caller", () => {
    const taken: RelicId[] = [];
    const layer = new ExpeditionLayer({ onRelicTaken: id => taken.push(id) });
    layer.load(planPickupExpedition({ orderId: ORDER_ID }));

    step(layer, mapped.relicPlinths, RELIC_PLINTH_LATERAL.echo_thread);
    step(layer, mapped.relicPlinths, RELIC_PLINTH_LATERAL.echo_thread);

    expect(taken).toEqual(["echo_thread"]);
  });
});

describe("ECHO THREAD — the lash leaps onward to a second guardian", () => {
  /** Two hunters side by side, well inside the leap radius. */
  function pair(layer: ExpeditionLayer) {
    const primary = new Hunter("primary", { x: 0.4, y: 0 });
    const secondary = new Hunter("secondary", { x: 0.42, y: 10 });
    setHostiles(layer, [primary, secondary]);
    return { primary, secondary };
  }

  it("does nothing without the relic", () => {
    const layer = loadedLayer();
    const { primary, secondary } = pair(layer);
    const before = secondary.hp;

    layer.setPlayerCorridor(0.4, 0);
    expect(layer.tryBasicLash(0.4, 0, false)).toBe(true);

    expect(primary.hp).toBeLessThan(3);
    expect(secondary.hp).toBe(before);
  });

  it("leaps exactly once from a landed lash", () => {
    const layer = loadedLayer();
    layer.run.chooseRelic("echo_thread");
    const { primary, secondary } = pair(layer);

    layer.setPlayerCorridor(0.4, 0);
    layer.tryBasicLash(0.4, 0, false);

    expect(primary.hp).toBe(2);
    // ONE point of echo damage, not a chain that ran back and forth.
    expect(secondary.hp).toBe(2);
  });

  it("leaps from a Line latch too", () => {
    const layer = loadedLayer();
    layer.run.chooseRelic("echo_thread");
    const { primary, secondary } = pair(layer);

    layer.setPlayerCorridor(0.4, 0);
    layer.resolveLatch("primary");

    expect(primary.hp).toBe(2);
    expect(secondary.hp).toBe(2);
  });

  it("never chains — a third guardian is untouched", () => {
    const layer = loadedLayer();
    layer.run.chooseRelic("echo_thread");
    const primary = new Hunter("primary", { x: 0.4, y: 0 });
    const secondary = new Hunter("secondary", { x: 0.42, y: 10 });
    const third = new Hunter("third", { x: 0.44, y: 20 });
    setHostiles(layer, [primary, secondary, third]);

    layer.setPlayerCorridor(0.4, 0);
    layer.tryBasicLash(0.4, 0, false);

    expect(primary.hp).toBe(2);
    expect(secondary.hp).toBe(2);
    expect(third.hp).toBe(3);
  });

  it("cannot leap to a guardian beyond the relic's reach", () => {
    const layer = loadedLayer();
    layer.run.chooseRelic("echo_thread");
    const primary = new Hunter("primary", { x: 0.4, y: 0 });
    const far = new Hunter("far", { x: 0.4 + ECHO_THREAD_RADIUS * 2, y: 0 });
    setHostiles(layer, [primary, far]);

    layer.setPlayerCorridor(0.4, 0);
    layer.tryBasicLash(0.4, 0, false);

    expect(primary.hp).toBe(2);
    expect(far.hp).toBe(3);
  });

  it("does not leap from a blow the Shieldbearer's guard ate", () => {
    // The relic must add REACH, never a way around the one enemy whose
    // entire reason to exist is that the basic lash does not work on it.
    const layer = loadedLayer();
    layer.run.chooseRelic("echo_thread");
    const guard = new Shieldbearer("guard", { x: 0.42, y: 0 });
    // Outside the lash's own radius, inside the leap's — so if an echo
    // happened at all, this is what it would hit.
    const behind = new Hunter("behind", { x: 0.48, y: 0 });
    setHostiles(layer, [guard, behind]);

    layer.setPlayerCorridor(0.4, 0);
    expect(layer.tryBasicLash(0.4, 0, false)).toBe(true);

    // Guard ate it: no damage applied, so nothing leaps onward.
    expect(guard.hp).toBe(RUINBOUND_TUNING.shieldbearer.maxHp);
    expect(behind.hp).toBe(3);
  });

  it("still leaps when the Line bypasses that same guard", () => {
    const layer = loadedLayer();
    layer.run.chooseRelic("echo_thread");
    const guard = new Shieldbearer("guard", { x: 0.42, y: 0 });
    const behind = new Hunter("behind", { x: 0.48, y: 0 });
    setHostiles(layer, [guard, behind]);

    layer.setPlayerCorridor(0.4, 0);
    layer.resolveLatch("guard");

    expect(guard.hp).toBeLessThan(RUINBOUND_TUNING.shieldbearer.maxHp);
    expect(behind.hp).toBe(2);
  });
});

describe("SUNSTEP — one burst per dodge", () => {
  it("bursts once when the dodge begins, not once per i-frame", () => {
    const layer = loadedLayer();
    layer.run.chooseRelic("sunstep");
    const near = new Hunter("near", { x: 0.4, y: 0 });
    setHostiles(layer, [near]);

    // Rising edge: the dodge starts.
    layer.setPlayerInvulnerable(true);
    step(layer, 0.4, 0);
    expect(near.hp).toBe(2);

    // Still invulnerable across several frames — no further bursts.
    for (let i = 0; i < 10; i += 1) {
      layer.setPlayerInvulnerable(true);
      step(layer, 0.4, 0);
    }
    expect(near.hp).toBe(2);
  });

  it("bursts again on the NEXT dodge", () => {
    const layer = loadedLayer();
    layer.run.chooseRelic("sunstep");
    const near = new Hunter("near", { x: 0.4, y: 0 });
    setHostiles(layer, [near]);

    layer.setPlayerInvulnerable(true);
    step(layer, 0.4, 0);
    layer.setPlayerInvulnerable(false);
    step(layer, 0.4, 0);
    layer.setPlayerInvulnerable(true);
    step(layer, 0.4, 0);

    expect(near.hp).toBe(1);
  });

  it("does nothing without the relic", () => {
    const layer = loadedLayer();
    const near = new Hunter("near", { x: 0.4, y: 0 });
    setHostiles(layer, [near]);

    layer.setPlayerInvulnerable(true);
    step(layer, 0.4, 0);

    expect(near.hp).toBe(3);
  });

  it("strikes ONE nearby guardian, never everything in range", () => {
    const layer = loadedLayer();
    layer.run.chooseRelic("sunstep");
    const a = new Hunter("a", { x: 0.4, y: 0 });
    const b = new Hunter("b", { x: 0.41, y: 6 });
    setHostiles(layer, [a, b]);

    layer.setPlayerInvulnerable(true);
    step(layer, 0.4, 0);

    const damaged = [a, b].filter(h => h.hp < 3);
    expect(damaged).toHaveLength(1);
  });

  it("reaches nothing outside its radius", () => {
    const layer = loadedLayer();
    layer.run.chooseRelic("sunstep");
    const far = new Hunter("far", { x: 0.4 + SUNSTEP_RADIUS * 2, y: 0 });
    setHostiles(layer, [far]);

    layer.setPlayerInvulnerable(true);
    step(layer, 0.4, 0);

    expect(far.hp).toBe(3);
  });
});

describe("BRASS GUARD — re-arms at a real clash boundary, not on a timer", () => {
  it("absorbs the first blow of a clash", () => {
    const layer = loadedLayer();
    layer.run.chooseRelic("brass_guard");

    expect(layer.run.takeDamage(20)).toBe(0);
    expect(layer.run.hp).toBe(100);
  });

  it("stays spent while the clash is still live", () => {
    const layer = loadedLayer();
    layer.run.chooseRelic("brass_guard");
    layer.run.takeDamage(20);

    // A guardian well inside engagement range: this is still one clash.
    const pressing = new Hunter("pressing", { x: 0.4, y: 0 });
    setHostiles(layer, [pressing]);

    for (let i = 0; i < Math.ceil((CLASH_QUIET_SECONDS * 3) / FRAME); i += 1) {
      step(layer, 0.4, 0);
    }

    // Re-arming here would have made "the first blow of each clash" into a
    // blow absorbed every second of the SAME clash.
    expect(layer.run.guardCharged).toBe(false);
  });

  it("re-arms once the fight genuinely lets up", () => {
    const layer = loadedLayer();
    layer.run.chooseRelic("brass_guard");
    layer.run.takeDamage(20);
    expect(layer.run.guardCharged).toBe(false);

    // Nothing alive in range, nothing in the air.
    setHostiles(layer, []);
    for (let i = 0; i < Math.ceil((CLASH_QUIET_SECONDS + 0.2) / FRAME); i += 1) {
      step(layer, 0.4, 0);
    }

    expect(layer.run.guardCharged).toBe(true);
  });

  it("does not re-arm before the quiet has actually been held", () => {
    const layer = loadedLayer();
    layer.run.chooseRelic("brass_guard");
    layer.run.takeDamage(20);
    setHostiles(layer, []);

    for (let i = 0; i < Math.floor((CLASH_QUIET_SECONDS * 0.5) / FRAME); i += 1) {
      step(layer, 0.4, 0);
    }

    expect(layer.run.guardCharged).toBe(false);
  });

  it("treats a guardian at the edge of engagement range as still in clash", () => {
    const layer = loadedLayer();
    layer.run.chooseRelic("brass_guard");
    layer.run.takeDamage(20);

    const edge = new Hunter("edge", {
      x: 0.4 + CLASH_ENGAGEMENT_RADIUS * 0.9,
      y: 0,
    });
    setHostiles(layer, [edge]);

    for (let i = 0; i < Math.ceil((CLASH_QUIET_SECONDS + 0.2) / FRAME); i += 1) {
      step(layer, 0.4, 0);
    }

    expect(layer.run.guardCharged).toBe(false);
  });

  it("counts a dead guardian as quiet — a corpse is not pressure", () => {
    const layer = loadedLayer();
    layer.run.chooseRelic("brass_guard");
    layer.run.takeDamage(20);

    const dead = new Hunter("dead", { x: 0.4, y: 0 });
    dead.hp = 0;
    setHostiles(layer, [dead]);

    for (let i = 0; i < Math.ceil((CLASH_QUIET_SECONDS + 0.2) / FRAME); i += 1) {
      step(layer, 0.4, 0);
    }

    expect(layer.run.guardCharged).toBe(true);
  });
});

describe("relics never touch business truth", () => {
  it("resolves all three without any authoritative surface", () => {
    // The whole point of §5's firewall: the fiction can be played to its
    // limit and the real order is exactly as pending as it started.
    const layer = loadedLayer();
    layer.run.chooseRelic("echo_thread");
    const roster = hostilesOf(layer);
    expect(roster.length).toBeGreaterThan(0);

    layer.setPlayerInvulnerable(true);
    step(layer, mapped.relicPlinths, 0);

    // No order id, status, or business call is reachable from the layer.
    expect(Object.keys(layer.getSnapshot()).sort()).toEqual([
      "hp",
      "momentum",
      "outcome",
      "relic",
      "route",
    ]);
  });
});
