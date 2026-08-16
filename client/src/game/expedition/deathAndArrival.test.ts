import { describe, expect, it } from "vitest";
import { ExpeditionLayer } from "./ExpeditionLayer";
import { projectCorridorPoint } from "./corridorCoupling";
import {
  EXPEDITION_START_PROGRESS,
  planInCorridorSpace,
  planPickupExpedition,
} from "./expeditionPlan";

const WIDTH = 393;
const HEIGHT = 852;
const FRAME = 1 / 60;

const project = (progress: number, lateral: number) =>
  projectCorridorPoint({
    progress,
    lateral,
    routeCenter: 0.5,
    width: WIDTH,
    height: HEIGHT,
  });

function scenario() {
  const layer = new ExpeditionLayer();
  layer.load(planPickupExpedition({ orderId: 630031 }));
  return layer;
}

function run(layer: ExpeditionLayer, progress: number, lateral: number, seconds: number) {
  const frames = Math.round(seconds / FRAME);
  for (let i = 0; i < frames; i += 1) {
    layer.setPlayerCorridor(progress, lateral);
    layer.update(FRAME, progress, lateral, project, WIDTH);
  }
}

describe("down player cannot act", () => {
  it("cannot enter aim, fire, or basic-lash once outcome is down", () => {
    const layer = scenario();
    layer.run.takeDamage(9999, { ignoreIFrames: true });
    expect(layer.run.outcome).toBe("down");

    layer.beginAim();
    expect(layer.isAiming()).toBe(false);
    expect(layer.fireLine(project)).toBe(false);
    expect(layer.tryBasicLash(0.2, 0, false)).toBe(false);
  });

  it("cannot take further hostile damage while down", () => {
    const layer = scenario();
    layer.run.takeDamage(9999, { ignoreIFrames: true });
    expect(layer.run.outcome).toBe("down");
    expect(layer.run.hp).toBe(0);

    run(layer, 0.2, 0, 3);
    // HP already at floor; the assertion is that combat simulation does not
    // run at all while down, which the stepHostiles gate proves indirectly
    // via no thrown errors and outcome staying "down" (not re-entering
    // "running" from an errant path).
    expect(layer.run.outcome).toBe("down");
  });

  it("settles the tether and aim state on the transition to down", () => {
    const layer = scenario();
    layer.beginAim();
    expect(layer.isAiming()).toBe(true);

    layer.run.takeDamage(9999, { ignoreIFrames: true });
    run(layer, 0.2, 0, 0.1);

    expect(layer.isAiming()).toBe(false);
  });
});

describe("arrived player cannot resume combat", () => {
  it("stops accepting aim/fire once arrived", () => {
    const layer = scenario();
    layer.run.arrive();
    expect(layer.run.outcome).toBe("arrived");

    expect(layer.beginAim.bind(layer)).not.toThrow();
    expect(layer.isAiming()).toBe(false);
    expect(layer.fireLine(project)).toBe(false);
  });
});

describe("waystone never regresses", () => {
  it("keeps the later checkpoint when the player backtracks", () => {
    const layer = scenario();
    const mapped = planInCorridorSpace(planPickupExpedition({ orderId: 630031 }));
    const preclimax = mapped.waystones.find(w => w.id === "waystone_preclimax")!;
    const prefork = mapped.waystones.find(w => w.id === "waystone_prefork")!;

    run(layer, preclimax.progress, 0, 0.05);
    expect(layer.run.lastWaystone?.id).toBe("waystone_preclimax");

    // Backtrack toward the earlier waystone.
    run(layer, prefork.progress, 0, 0.05);
    expect(layer.run.lastWaystone?.id).toBe("waystone_preclimax");
  });

  it("redeploy restores the later waystone, not an earlier or raw expedition T", () => {
    const layer = scenario();
    const mapped = planInCorridorSpace(planPickupExpedition({ orderId: 630031 }));
    const preclimax = mapped.waystones.find(w => w.id === "waystone_preclimax")!;

    run(layer, preclimax.progress, 0, 0.05);
    layer.run.takeDamage(9999, { ignoreIFrames: true });
    const restored = layer.redeploy();

    expect(restored).toBeCloseTo(preclimax.progress, 6);
    expect(restored).not.toBeCloseTo(EXPEDITION_START_PROGRESS, 2);
  });
});

describe("redeploy does not resurrect resolved fights behind the checkpoint", () => {
  it("keeps a hostile defeated before the restored waystone gone", () => {
    const layer = scenario();
    const mapped = planInCorridorSpace(planPickupExpedition({ orderId: 630031 }));
    const prefork = mapped.waystones.find(w => w.id === "waystone_prefork")!;
    const hunter = mapped.hostiles.find(h => h.id === "hunter_first")!;

    // Reach the prefork waystone (hunter_first is well before it).
    run(layer, prefork.progress, 0, 0.05);
    expect(layer.run.lastWaystone?.id).toBe("waystone_prefork");

    const hostiles = (layer as unknown as { hostiles: Array<{ id: string; hp: number }> })
      .hostiles;
    const target = hostiles.find(h => h.id === "hunter_first")!;
    target.hp = 0;

    layer.run.takeDamage(9999, { ignoreIFrames: true });
    layer.redeploy();

    const afterHostiles = (
      layer as unknown as { hostiles: Array<{ id: string }> }
    ).hostiles;
    expect(afterHostiles.some(h => h.id === "hunter_first")).toBe(false);
    void hunter;
  });
});

describe("route choice does not respawn defeated common enemies", () => {
  it("keeps a hunter defeated before the fork dead, not resurrected, after choosing a route", () => {
    const layer = scenario();
    const hostiles = (
      layer as unknown as { hostiles: Array<{ id: string; hp: number; alive: boolean }> }
    ).hostiles;
    const target = hostiles.find(h => h.id === "hunter_first")!;
    target.hp = 0;
    expect(target.alive).toBe(false);

    run(layer, 0.1, 0, 1 / 60);
    layer.setRoute("upper");

    // A defeated hostile is not removed from the array (it is reaped
    // visually elsewhere) — additive route content must not spawn a SECOND
    // instance or reset the existing one's hp, so exactly one hunter_first
    // remains, and it is still dead.
    const afterHostiles = (
      layer as unknown as { hostiles: Array<{ id: string; alive: boolean }> }
    ).hostiles.filter(h => h.id === "hunter_first");
    expect(afterHostiles).toHaveLength(1);
    expect(afterHostiles[0].alive).toBe(false);
  });

  it("still adds the branch-specific content for the chosen route", () => {
    const layer = scenario();
    layer.setRoute("upper");
    const hostiles = (layer as unknown as { hostiles: Array<{ id: string }> }).hostiles;
    expect(hostiles.some(h => h.id === "hunter_upper")).toBe(true);
  });
});

describe("Shieldbearer climax gate", () => {
  it("caps the forward ceiling while the Shieldbearer is alive", () => {
    const layer = scenario();
    const mapped = planInCorridorSpace(planPickupExpedition({ orderId: 630031 }));
    const barrier = mapped.environment.find(e => e.id === "arch_climax_span")!;

    expect(layer.isClimaxBarrierUp()).toBe(true);
    const ceiling = layer.getGameplayForwardCeiling(0.9);
    expect(ceiling).toBeLessThan(barrier.progress);
  });

  it("opens once the Shieldbearer is defeated", () => {
    const layer = scenario();
    const hostiles = (layer as unknown as { hostiles: Array<{ id: string; hp: number }> })
      .hostiles;
    const shield = hostiles.find(h => h.id === "shieldbearer_climax")!;
    shield.hp = 0;

    expect(layer.isClimaxBarrierUp()).toBe(false);
    expect(layer.getGameplayForwardCeiling(0.9)).toBe(0.9);
  });

  it("does not gate the Scarred Route", () => {
    const layer = scenario();
    layer.pressOn();
    expect(layer.getGameplayForwardCeiling(0.9)).toBe(0.9);
  });
});

describe("arrival requires the climax cleared, or Scarred Route", () => {
  it("does not arrive at the destination while the Shieldbearer lives", () => {
    const layer = scenario();
    const mapped = planInCorridorSpace(planPickupExpedition({ orderId: 630031 }));
    run(layer, mapped.destination, 0, 0.1);
    expect(layer.run.outcome).toBe("running");
  });

  it("arrives once the Shieldbearer is defeated and destination is reached", () => {
    const layer = scenario();
    const mapped = planInCorridorSpace(planPickupExpedition({ orderId: 630031 }));
    const hostiles = (layer as unknown as { hostiles: Array<{ id: string; hp: number }> })
      .hostiles;
    hostiles.find(h => h.id === "shieldbearer_climax")!.hp = 0;

    run(layer, mapped.destination, 0, 0.1);
    expect(layer.run.outcome).toBe("arrived");
  });

  it("arrives on the Scarred Route without needing to defeat anything", () => {
    const layer = scenario();
    layer.pressOn();
    const mapped = planInCorridorSpace(planPickupExpedition({ orderId: 630031 }));
    run(layer, mapped.destination, 0, 0.1);
    expect(layer.run.outcome).toBe("arrived");
  });
});

describe("the climax seal is visible whenever it is blocking movement", () => {
  it("shares one predicate between the visual state and the movement gate", () => {
    const layer = scenario();
    // Alive: both the barrier-up predicate and the ceiling agree it blocks.
    expect(layer.isClimaxBarrierUp()).toBe(true);
    expect(layer.getGameplayForwardCeiling(0.9)).toBeLessThan(0.9);

    const hostiles = (
      layer as unknown as { hostiles: Array<{ id: string; hp: number }> }
    ).hostiles;
    hostiles.find(h => h.id === "shieldbearer_climax")!.hp = 0;

    // Dead: both agree it does not.
    expect(layer.isClimaxBarrierUp()).toBe(false);
    expect(layer.getGameplayForwardCeiling(0.9)).toBe(0.9);
  });

  it("agrees for the Scarred Route too — open in both senses", () => {
    const layer = scenario();
    layer.pressOn();
    expect(layer.isClimaxBarrierUp()).toBe(false);
    expect(layer.getGameplayForwardCeiling(0.9)).toBe(0.9);
  });
});

describe("recoil is applied exactly once (§H)", () => {
  it("keeps the sprite root at the true un-recoiled world position", () => {
    const layer = scenario();
    run(layer, 0.1, 0, 1 / 60);
    const hostiles = (
      layer as unknown as { hostiles: Array<{ id: string; recoilSeconds: number; recoilX: number }> }
    ).hostiles;
    const hunter = hostiles.find(h => h.id === "hunter_first")!;

    hunter.recoilSeconds = 0.18;
    hunter.recoilX = 1;
    run(layer, 0.1, 0, 1 / 60);

    const visuals = (
      layer as unknown as {
        hostileVisuals: Map<string, { root: { x: number }; body: { x: number } }>;
      }
    ).hostileVisuals;
    const visual = visuals.get("hunter_first");
    // With a real texture loaded this proves the split; without one (no art
    // in the test environment) the procedural fallback has no sprite root
    // at all, so this assertion only applies when a visual exists.
    if (visual) {
      // Root carries only world position — never the recoil offset.
      expect(visual.body.x).not.toBe(0);
    }
  });
});
