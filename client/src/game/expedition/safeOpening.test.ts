import { describe, expect, it } from "vitest";
import { ExpeditionLayer } from "./ExpeditionLayer";
import { projectCorridorPoint } from "./corridorCoupling";
import {
  EXPEDITION_START_PROGRESS,
  activeHostiles,
  planInCorridorSpace,
  planPickupExpedition,
} from "./expeditionPlan";
import { EXPEDITION } from "./expeditionState";
import { RUINBOUND_TUNING } from "./ruinbound";

/**
 * §24's safe opening, as an acceptance test.
 *
 * The player must get roughly fifteen seconds to understand movement and
 * practise the Line on a safe architectural target BEFORE any hostile can
 * reach them. This is enforced by authored spacing plus spatially-bounded
 * activation, NOT by a global invulnerability flag — a blanket "no damage
 * for 15s" would also protect a player who ran straight into the Hunter,
 * which is not the design.
 *
 * This test is the reason the Ruinbound tuning had to move out of pixel
 * units: `aggroRadius: 300` compared against corridor progress (0..1) meant
 * every guardian aggroed from anywhere on the map and landed a hit within
 * a second of entry.
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

function startedExpedition() {
  const layer = new ExpeditionLayer();
  layer.load(planPickupExpedition({ orderId: ORDER_ID }));
  return layer;
}

/** Runs the expedition at a fixed corridor position for N seconds. */
function holdAt(layer: ExpeditionLayer, progress: number, seconds: number) {
  const frames = Math.round(seconds / FRAME);
  for (let i = 0; i < frames; i += 1) {
    layer.setPlayerCorridor(progress, 0);
    layer.update(FRAME, progress, 0, project, WIDTH);
  }
}

/** Walks forward at a plausible player pace. */
function walkFrom(
  layer: ExpeditionLayer,
  from: number,
  to: number,
  progressPerSecond = 0.06
) {
  let p = from;
  let guard = 0;
  while (p < to && guard < 60 * 120) {
    p = Math.min(to, p + progressPerSecond * FRAME);
    layer.setPlayerCorridor(p, 0);
    layer.update(FRAME, p, 0, project, WIDTH);
    guard += 1;
  }
  return p;
}

/**
 * Corridor-space plan — the space the layer registers and the player moves
 * in. Asserting against raw authored (expedition-space) values would only
 * pass by coincidence once the mapping compressed everything by ~0.72x.
 */
const mapped = planInCorridorSpace(planPickupExpedition({ orderId: ORDER_ID }));

/** Corridor position of an authored beat. */
function beatAt(id: string): number {
  return (
    mapped.hostiles.find(h => h.id === id)?.progress ??
    mapped.environment.find(e => e.id === id)!.progress
  );
}

describe("authored spacing creates the opening", () => {
  const plan = mapped;

  it("puts a safe Line target before the first guardian", () => {
    const firstArch = plan.environment
      .filter(e => e.kind === "architecture")
      .sort((a, b) => a.progress - b.progress)[0];
    const firstHostile = [...plan.hostiles].sort(
      (a, b) => a.progress - b.progress
    )[0];

    expect(firstArch.progress).toBeLessThan(firstHostile.progress);
  });

  it("keeps the first guardian outside aggro range of the start", () => {
    // The expedition threshold. Nothing may reach back into it.
    const start = EXPEDITION_START_PROGRESS;
    for (const spawn of activeHostiles(plan, "unchosen")) {
      const radius =
        RUINBOUND_TUNING[spawn.kind as keyof typeof RUINBOUND_TUNING]
          .aggroRadius;
      const gap = spawn.progress - start;
      expect(gap).toBeGreaterThan(radius);
    }
  });
});

describe("no hostile damage during the opening", () => {
  it("leaves HP untouched while the player learns at the threshold", () => {
    const layer = startedExpedition();
    // Twenty seconds is well past the 0-15s teaching window.
    holdAt(layer, EXPEDITION_START_PROGRESS, 20);
    expect(layer.run.hp).toBe(EXPEDITION.maxHp);
  });

  it("leaves HP untouched while practising on the first Line target", () => {
    const layer = startedExpedition();
    holdAt(layer, beatAt("arch_threshold_beam"), 15);
    expect(layer.run.hp).toBe(EXPEDITION.maxHp);
  });

  it("survives a slow walk across the whole teaching stretch", () => {
    const layer = startedExpedition();
    walkFrom(layer, EXPEDITION_START_PROGRESS, beatAt("arch_threshold_beam") + 0.01);
    expect(layer.run.hp).toBe(EXPEDITION.maxHp);
  });

  it("does not let a projectile cross the opening", () => {
    const layer = startedExpedition();
    holdAt(layer, EXPEDITION_START_PROGRESS, 20);
    // The Slinger is authored at 0.29; nothing it throws may reach 0.06.
    expect(layer.run.hp).toBe(EXPEDITION.maxHp);
  });
});

describe("pressure does begin once the player advances", () => {
  it("is not global invulnerability — walking into the Hunter still hurts", () => {
    const layer = startedExpedition();
    // Walk right onto hunter_first's mapped position and wait.
    const hunter = beatAt("hunter_first");
    walkFrom(layer, EXPEDITION_START_PROGRESS, hunter);
    holdAt(layer, hunter, 6);

    expect(layer.run.hp).toBeLessThan(EXPEDITION.maxHp);
  });

  it("activates guardians deterministically by position, not by clock", () => {
    // Two identical runs that advance identically must agree exactly.
    const a = startedExpedition();
    const b = startedExpedition();
    const hunter = beatAt("hunter_first");
    for (const layer of [a, b]) {
      walkFrom(layer, EXPEDITION_START_PROGRESS, hunter);
      holdAt(layer, hunter, 6);
    }
    expect(a.run.hp).toBe(b.run.hp);
  });
});

describe("expedition start coordinate", () => {
  const plan = mapped;

  it("sits before every authored beat", () => {
    // Entering used to inherit the ordinary corridor position — observed at
    // 0.78 on corridor_02 — which put the player past the fork and most of
    // the way to the destination before the expedition had begun.
    for (const spawn of plan.hostiles) {
      expect(spawn.progress).toBeGreaterThan(EXPEDITION_START_PROGRESS);
    }
    for (const spawn of plan.environment) {
      expect(spawn.progress).toBeGreaterThan(EXPEDITION_START_PROGRESS);
    }
    expect(plan.relicPlinths).toBeGreaterThan(EXPEDITION_START_PROGRESS);
    expect(plan.fork.start).toBeGreaterThan(EXPEDITION_START_PROGRESS);
    expect(plan.destination).toBeGreaterThan(EXPEDITION_START_PROGRESS);
  });

  it("is inside the corridor's own clamps", () => {
    expect(EXPEDITION_START_PROGRESS).toBeGreaterThanOrEqual(0.035);
    expect(EXPEDITION_START_PROGRESS).toBeLessThanOrEqual(0.82);
  });

  it("has a waystone at or before it so redeploy always resolves", () => {
    const earliest = Math.min(...plan.waystones.map(w => w.progress));
    expect(earliest).toBeLessThanOrEqual(EXPEDITION_START_PROGRESS);
  });
});
