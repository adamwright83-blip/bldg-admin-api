import { Container } from "pixi.js";
import { describe, expect, it } from "vitest";
import { ExpeditionLayer, SEAL_FRACTURE_SECONDS } from "./ExpeditionLayer";
import { projectCorridorPoint } from "./corridorCoupling";
import { planInCorridorSpace, planPickupExpedition } from "./expeditionPlan";
import { TRAVERSAL_Z, worldActorZ } from "../world/worldActorDepth";
import type { Ruinbound } from "./ruinbound";

/**
 * The expedition's physical objects must be WORLD ACTORS, not overlays.
 *
 * The climax seal used to be drawn into ExpeditionLayer's own container,
 * which sits in the GAMEPLAY_OVERLAY band — so it painted over absolutely
 * everything, including a Trailblazer standing right at it. A wall you are
 * physically in front of that still covers you is not a physical object; it
 * is a HUD element wearing a wall's clothes.
 *
 * The same rule applies to the relic plinths and the destination cache.
 * These tests assert the depth CONTRACT, not the artwork.
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

const mapped = planInCorridorSpace(planPickupExpedition({ orderId: ORDER_ID }));

/** A layer with a real world-actor host, exactly as GoldlineGame wires it. */
function hostedLayer(callbacks = {}) {
  const host = new Container();
  host.sortableChildren = true;
  const layer = new ExpeditionLayer(callbacks);
  layer.setActorHost(host);
  layer.load(planPickupExpedition({ orderId: ORDER_ID }));
  return { layer, host };
}

function step(layer: ExpeditionLayer, progress: number, lateral = 0) {
  layer.setPlayerCorridor(progress, lateral);
  layer.update(FRAME, progress, lateral, project, WIDTH);
}

function childByLabel(host: Container, label: string) {
  return host.children.find(c => c.label === label) ?? null;
}

function hostilesOf(layer: ExpeditionLayer): Ruinbound[] {
  return (layer as unknown as { hostiles: Ruinbound[] }).hostiles;
}

describe("the climax seal is a world actor, not an overlay", () => {
  it("parents the seal to the shared world-actor host", () => {
    const { layer, host } = hostedLayer();
    step(layer, 0.4);

    const seal = childByLabel(host, "expedition:climax_seal");
    expect(seal).not.toBeNull();
    // NOT in the layer's own overlay container.
    expect(layer.container.children).not.toContain(seal);
  });

  it("sorts the seal in the actor band, below every overlay", () => {
    const { layer, host } = hostedLayer();
    step(layer, 0.4);

    const seal = childByLabel(host, "expedition:climax_seal")!;
    expect(seal.zIndex).toBeGreaterThan(TRAVERSAL_Z.FORTRESS);
    expect(seal.zIndex).toBeLessThan(TRAVERSAL_Z.GAMEPLAY_OVERLAY);
    expect(seal.zIndex).toBeLessThan(TRAVERSAL_Z.PARTICLES);
  });

  it("lets a nearer Trailblazer render IN FRONT of the seal", () => {
    // This is the whole point of the move. The seal stands at the barrier's
    // ground line; anyone closer to the camera outranks it.
    const { layer, host } = hostedLayer();
    step(layer, 0.4);

    const seal = childByLabel(host, "expedition:climax_seal")!;
    const barrierGroundY = project(mapped.environment.find(
      e => e.id === "arch_climax_span"
    )!.progress, 0).y;

    // Trailblazer standing short of the seal is LOWER on the plate.
    const nearerY = project(0.4, 0).y;
    expect(nearerY).toBeGreaterThan(barrierGroundY);
    expect(worldActorZ(nearerY, "trailblazer")).toBeGreaterThan(seal.zIndex);
  });

  it("lets a guardian further up the corridor render BEHIND the seal", () => {
    const { layer, host } = hostedLayer();
    step(layer, 0.4);

    const seal = childByLabel(host, "expedition:climax_seal")!;
    const furtherY = project(mapped.destination, 0).y;
    expect(worldActorZ(furtherY, "ruinbound:x")).toBeLessThan(seal.zIndex);
  });
});

describe("the seal releases the instant the Shieldbearer dies", () => {
  it("opens movement on the SAME frame, without waiting for the fade", () => {
    const { layer } = hostedLayer();
    const barrier = mapped.environment.find(e => e.id === "arch_climax_span")!;

    expect(layer.isClimaxBarrierUp()).toBe(true);
    expect(layer.getGameplayForwardCeiling(1)).toBeLessThan(barrier.progress);

    const shield = hostilesOf(layer).find(h => h.id === "shieldbearer_climax")!;
    shield.hp = 0;

    // No frame has been stepped and no animation has played. Movement is
    // already open: the ceiling reads the barrier predicate directly.
    expect(layer.isClimaxBarrierUp()).toBe(false);
    expect(layer.getGameplayForwardCeiling(1)).toBe(1);
  });

  it("announces the fracture exactly once", () => {
    let fractures = 0;
    const { layer } = hostedLayer({ onSealFractured: () => (fractures += 1) });
    step(layer, 0.4);
    expect(fractures).toBe(0);

    hostilesOf(layer).find(h => h.id === "shieldbearer_climax")!.hp = 0;
    step(layer, 0.4);
    expect(fractures).toBe(1);

    for (let i = 0; i < 30; i += 1) step(layer, 0.4);
    expect(fractures).toBe(1);
  });

  it("removes the seal actor once the short release has finished", () => {
    const { layer, host } = hostedLayer();
    step(layer, 0.4);
    expect(childByLabel(host, "expedition:climax_seal")).not.toBeNull();

    hostilesOf(layer).find(h => h.id === "shieldbearer_climax")!.hp = 0;

    const frames = Math.ceil(SEAL_FRACTURE_SECONDS / FRAME) + 4;
    for (let i = 0; i < frames; i += 1) step(layer, 0.4);

    expect(childByLabel(host, "expedition:climax_seal")).toBeNull();
  });

  it("never re-announces a fracture the Scarred Route bypassed twice", () => {
    let fractures = 0;
    const { layer } = hostedLayer({ onSealFractured: () => (fractures += 1) });
    step(layer, 0.4);

    layer.pressOn();
    step(layer, 0.4);
    for (let i = 0; i < 40; i += 1) step(layer, 0.4);

    expect(fractures).toBe(1);
  });
});

describe("relic plinths stand in the world", () => {
  it("gives each relic its own depth-sorted actor", () => {
    const { layer, host } = hostedLayer();
    step(layer, 0.4);

    for (const id of ["echo_thread", "sunstep", "brass_guard"]) {
      const plinth = childByLabel(host, `relic:${id}`);
      expect(plinth).not.toBeNull();
      expect(plinth!.zIndex).toBeGreaterThan(TRAVERSAL_Z.WORLD_ACTOR_BASE);
      expect(plinth!.zIndex).toBeLessThan(TRAVERSAL_Z.GAMEPLAY_OVERLAY);
    }
  });

  it("removes the plinths entirely on the Scarred Route", () => {
    const { layer, host } = hostedLayer();
    step(layer, 0.4);
    expect(childByLabel(host, "relic:sunstep")).not.toBeNull();

    layer.pressOn();
    step(layer, 0.4);

    for (const id of ["echo_thread", "sunstep", "brass_guard"]) {
      expect(childByLabel(host, `relic:${id}`)).toBeNull();
    }
  });
});

describe("the destination cache is a physical place, not a Line target", () => {
  it("renders as its own depth-sorted world actor", () => {
    const { layer, host } = hostedLayer();
    step(layer, 0.4);

    const cache = childByLabel(host, "expedition:destination_cache");
    expect(cache).not.toBeNull();
    expect(cache!.zIndex).toBeGreaterThan(TRAVERSAL_Z.WORLD_ACTOR_BASE);
    expect(cache!.zIndex).toBeLessThan(TRAVERSAL_Z.GAMEPLAY_OVERLAY);
  });

  it("is NOT an environment node", () => {
    const { layer } = hostedLayer();
    const env = (layer as unknown as { env: Array<{ id: string }> }).env;
    expect(env.some(e => e.id.includes("cache"))).toBe(false);
    expect(env.some(e => e.id.includes("destination"))).toBe(false);
  });

  it("is NOT a Line candidate — the destination cannot be grappled", () => {
    const { layer } = hostedLayer();
    step(layer, 0.4);

    const ids = layer.registry.targets().map(t => t.id);
    expect(ids.some(id => id.includes("cache"))).toBe(false);
    expect(ids.some(id => id.includes("destination"))).toBe(false);
  });

  it("sits at the plan's mapped destination", () => {
    const { layer, host } = hostedLayer();
    step(layer, 0.4);

    const cache = childByLabel(host, "expedition:destination_cache")!;
    const expected = project(mapped.destination, 0);
    expect(cache.y).toBeCloseTo(expected.y, 6);
    expect(cache.x).toBeCloseTo(expected.x, 6);
  });

  it("does not settle the run merely by existing", () => {
    // Arrival is a physical act plus a cleared climax — never a side effect
    // of the objective being drawn.
    const { layer } = hostedLayer();
    step(layer, 0.4);
    expect(layer.getSnapshot().outcome).toBe("running");
  });
});

describe("ground paint stays under every actor", () => {
  it("pins the route branches and landing pool below the actor band", () => {
    const { layer, host } = hostedLayer();
    step(layer, 0.4);

    const ground = childByLabel(host, "expedition:ground");
    expect(ground).not.toBeNull();
    expect(ground!.zIndex).toBeLessThan(TRAVERSAL_Z.WORLD_ACTOR_BASE);
    // Still above the static painted world it is laid on top of.
    expect(ground!.zIndex).toBeGreaterThan(TRAVERSAL_Z.FORTRESS);
  });

  it("keeps Trailblazer above the paint she walks on", () => {
    const { layer, host } = hostedLayer();
    step(layer, 0.4);

    const ground = childByLabel(host, "expedition:ground")!;
    const trailblazer = worldActorZ(project(0.4, 0).y, "trailblazer");
    expect(trailblazer).toBeGreaterThan(ground.zIndex);
  });
});

describe("teardown leaves nothing behind in the host", () => {
  it("removes every expedition actor it created", () => {
    const { layer, host } = hostedLayer();
    step(layer, 0.4);
    expect(host.children.length).toBeGreaterThan(0);

    layer.destroy();
    expect(host.children).toHaveLength(0);
  });
});
