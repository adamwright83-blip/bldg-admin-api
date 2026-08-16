import { describe, expect, it } from "vitest";
import { ExpeditionLayer, FORK_BRANCH_LATERAL } from "./ExpeditionLayer";
import { projectCorridorPoint, PLAN_LATERAL_UNITS } from "./corridorCoupling";
import { planInCorridorSpace, planPickupExpedition } from "./expeditionPlan";

/**
 * The Safe / Upper fork has to be a PLACE.
 *
 * The commitment mechanic already existed — tryChooseRoute commits on the
 * player's lateral position inside the mapped fork window — but nothing in
 * the world drew the two branches, so the player was being asked to commit
 * to a choice they could not see. Painting them is only honest if the
 * painted roads and the commitment rule agree, which is what these tests
 * pin down.
 *
 * §37's rule: no buttons, no cards. The fork is walked, not clicked.
 */

const WIDTH = 393;
const HEIGHT = 852;
const FRAME = 1 / 60;
const ORDER_ID = 630031;

/** GoldlineGame's own clamp on normalised lateral. */
const RUNTIME_LATERAL_CLAMP = 0.72;
/** tryChooseRoute's commitment threshold, in normalised lateral. */
const COMMIT_THRESHOLD = 0.28;

const project = (progress: number, lateral: number) =>
  projectCorridorPoint({
    progress,
    lateral,
    routeCenter: 0.5,
    width: WIDTH,
    height: HEIGHT,
  });

const mapped = planInCorridorSpace(planPickupExpedition({ orderId: ORDER_ID }));

function loadedLayer() {
  const layer = new ExpeditionLayer();
  layer.load(planPickupExpedition({ orderId: ORDER_ID }));
  return layer;
}

function step(layer: ExpeditionLayer, progress: number, lateral = 0) {
  layer.setPlayerCorridor(progress, lateral);
  layer.update(FRAME, progress, lateral, project, WIDTH);
}

describe("the painted branches match the sides the runtime commits on", () => {
  it("runs UPPER to negative lateral and SAFE to positive", () => {
    expect(FORK_BRANCH_LATERAL.upper).toBeLessThan(0);
    expect(FORK_BRANCH_LATERAL.safe).toBeGreaterThan(0);
  });

  it("keeps both branches inside the lateral range the player can reach", () => {
    // A road painted outside the runtime's clamp is a road the world will
    // not actually let the player stand on.
    for (const lateral of Object.values(FORK_BRANCH_LATERAL)) {
      const normalised = Math.abs(lateral) / PLAN_LATERAL_UNITS;
      expect(normalised).toBeLessThan(RUNTIME_LATERAL_CLAMP);
    }
  });

  it("carries each branch past its own commitment threshold", () => {
    // Following a painted branch must actually commit the route, or the
    // world would show two roads and honour neither.
    for (const lateral of Object.values(FORK_BRANCH_LATERAL)) {
      const normalised = Math.abs(lateral) / PLAN_LATERAL_UNITS;
      expect(normalised).toBeGreaterThan(COMMIT_THRESHOLD);
    }
  });

  it("commits UPPER when the player walks the negative branch", () => {
    const layer = loadedLayer();
    const mid = (mapped.fork.start + mapped.fork.end) / 2;
    const chosen = layer.tryChooseRoute(
      mid,
      FORK_BRANCH_LATERAL.upper / PLAN_LATERAL_UNITS
    );
    expect(chosen).toBe("upper");
    expect(layer.getSnapshot().route).toBe("upper");
  });

  it("commits SAFE when the player walks the positive branch", () => {
    const layer = loadedLayer();
    const mid = (mapped.fork.start + mapped.fork.end) / 2;
    const chosen = layer.tryChooseRoute(
      mid,
      FORK_BRANCH_LATERAL.safe / PLAN_LATERAL_UNITS
    );
    expect(chosen).toBe("safe");
    expect(layer.getSnapshot().route).toBe("safe");
  });

  it("commits nothing while the player is still between the branches", () => {
    const layer = loadedLayer();
    const mid = (mapped.fork.start + mapped.fork.end) / 2;
    expect(layer.tryChooseRoute(mid, 0)).toBeNull();
    expect(layer.getSnapshot().route).toBe("unchosen");
  });

  it("commits nothing before the fork actually opens", () => {
    const layer = loadedLayer();
    const beforeFork = mapped.fork.start - 0.05;
    expect(
      layer.tryChooseRoute(
        beforeFork,
        FORK_BRANCH_LATERAL.upper / PLAN_LATERAL_UNITS
      )
    ).toBeNull();
    expect(layer.getSnapshot().route).toBe("unchosen");
  });
});

describe("the fork is drawn without any interruption surface", () => {
  it("keeps playing through the whole fork window", () => {
    // No modal, no pause, no card: the run stays live from mouth to rejoin.
    const layer = loadedLayer();
    let p = mapped.fork.start - 0.02;
    while (p < mapped.fork.end + 0.02) {
      p += 0.004;
      step(layer, p, 0);
      expect(layer.getSnapshot().outcome).toBe("running");
    }
  });

  it("records the route on the run, with no second route truth", () => {
    const layer = loadedLayer();
    const mid = (mapped.fork.start + mapped.fork.end) / 2;
    layer.tryChooseRoute(mid, FORK_BRANCH_LATERAL.safe / PLAN_LATERAL_UNITS);

    expect(layer.run.route).toBe("safe");
    expect(layer.getSnapshot().route).toBe("safe");
  });

  it("cannot be re-chosen once the player has committed", () => {
    const layer = loadedLayer();
    const mid = (mapped.fork.start + mapped.fork.end) / 2;
    layer.tryChooseRoute(mid, FORK_BRANCH_LATERAL.safe / PLAN_LATERAL_UNITS);
    const again = layer.tryChooseRoute(
      mid,
      FORK_BRANCH_LATERAL.upper / PLAN_LATERAL_UNITS
    );

    expect(again).toBeNull();
    expect(layer.getSnapshot().route).toBe("safe");
  });
});
