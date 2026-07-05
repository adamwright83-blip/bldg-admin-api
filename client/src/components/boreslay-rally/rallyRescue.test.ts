import { describe, expect, it } from "vitest";
import { BrowserLocalBoreslayDemoAdapter } from "../boreslay-demo/PublicBoreslayDemoAdapter";
import { RallyEngine } from "./rallyEngine";
import { RALLY_CONFIG } from "./rallyConfig";

describe("Rally rescue mission", () => {
  it("also surfaces at a one-life gate or a tier-three inbound", () => {
    const engine = new RallyEngine();
    engine.start();
    engine.state.serveAt = null;
    engine.state.sparkLives = 1;
    engine.state.excuse.inPlay = true;
    engine.state.excuse.x = 700;
    engine.state.excuse.y = 330;
    engine.state.excuse.vx = -600;
    engine.state.excuse.vy = 0;
    engine.advanceFixedSteps(1);
    expect(engine.state.mission.status).toBe("ready");
  });

  it("scripts the first freeze at rally five and opens the rescue beat", () => {
    const engine = new RallyEngine({ seed: 7 });
    engine.start();
    engine.state.serveAt = null;
    engine.state.excuse.inPlay = true;
    engine.state.excuse.rallyCount = 4;
    engine.state.excuse.x = engine.state.clockhead.x - 80;
    engine.state.excuse.y = engine.state.clockhead.y;
    engine.state.excuse.vx = 500;
    engine.state.excuse.vy = 0;
    engine.state.clockhead.telegraph = "swat";
    engine.state.clockhead.telegraphUntil = 0;
    engine.advanceFixedSteps(1);
    expect(engine.state.excuse.rallyCount).toBe(5);
    expect(engine.state.clockhead.telegraph).toBe("freeze");
    engine.advanceFixedSteps(Math.ceil(RALLY_CONFIG.clockhead.freezeTelegraphMs / (1000 / 120)) + 1);
    expect(engine.state.spark.frozenUntil).toBeGreaterThan(engine.state.timeMs);
    expect(engine.state.mission.status).toBe("ready");
    expect(engine.state.mission.acceptDeadline! - engine.state.mission.readyAt!).toBe(
      RALLY_CONFIG.rescue.acceptWindowMs
    );
  });

  it("accepts with one tap, breaks freeze, and returns with triple force", () => {
    const engine = new RallyEngine();
    engine.start();
    engine.state.serveAt = null;
    engine.state.spark.frozenUntil = 9999;
    engine.state.mission.status = "ready";
    engine.state.mission.readyAt = 0;
    engine.state.mission.acceptDeadline = 20000;
    engine.state.excuse.inPlay = true;
    engine.state.excuse.x = 390;
    engine.state.excuse.y = 330;
    engine.state.excuse.vx = -340;
    engine.state.excuse.vy = 0;
    expect(engine.acceptRescue()).toBe(true);
    expect(engine.state.mission.status).toBe("accepted");
    expect(engine.state.spark.frozenUntil).toBe(engine.state.timeMs);
    expect(engine.state.excuse.vx).toBeGreaterThan(0);
    expect(Math.hypot(engine.state.excuse.vx, engine.state.excuse.vy)).toBe(
      RALLY_CONFIG.excuse.maxSpeed
    );
  });

  it("treats twenty seconds as time to accept, not time to complete", () => {
    const engine = new RallyEngine();
    engine.start();
    engine.state.serveAt = null;
    engine.state.mission.status = "ready";
    engine.state.mission.readyAt = 0;
    engine.state.mission.acceptDeadline = 100;
    engine.advanceFixedSteps(20);
    expect(engine.acceptRescue()).toBe(false);
    expect(engine.state.mission.status).toBe("expired");
  });

  it("keeps the public adapter explicitly simulated and backward compatible", () => {
    const adapter = new BrowserLocalBoreslayDemoAdapter();
    const deployment = adapter.deployCrewMission(1000);
    expect(adapter.advanceCrewMission(deployment, 3499).stage).toBe(0);
    expect(adapter.advanceCrewMission(deployment, 3500).stage).toBe(1);
    expect(adapter.advanceCrewMission(deployment, 6000).stage).toBe(2);
    expect(adapter.advanceCrewMission(deployment, 8500).stage).toBe(3);
    const result = adapter.resolveCrewMission(deployment);
    expect(result.simulated).toBe(true);
    expect(result.combatRewards.bossDamage).toBe(20);
    expect(result.combatRewards.rallyEffects).toEqual({
      breakFreeze: true,
      returnForceMultiplier: 3,
    });
    expect(adapter.productionMutationsReachable).toBe(false);
  });
});
