import { describe, expect, it } from "vitest";
import { RallyEngine } from "./rallyEngine";
import { RALLY_CONFIG } from "./rallyConfig";

function crossing(side: "spark" | "clockhead", scorerScore = 0) {
  const engine = new RallyEngine({ controlMode: "flight", scoringMode: "portal" });
  engine.start();
  engine.state.serveAt = null;
  engine.state.clockheadScore = side === "spark" ? scorerScore : 0;
  engine.state.sparkScore = side === "clockhead" ? scorerScore : 0;
  engine.state.excuse.inPlay = true;
  engine.state.excuse.y = 330;
  engine.state.excuse.prevY = 330;
  if (side === "spark") {
    engine.state.excuse.x = 5;
    engine.state.excuse.prevX = 5;
    engine.state.excuse.vx = -RALLY_CONFIG.excuse.maxSpeed;
  } else {
    engine.state.excuse.x = RALLY_CONFIG.arena.width - 5;
    engine.state.excuse.prevX = RALLY_CONFIG.arena.width - 5;
    engine.state.excuse.vx = RALLY_CONFIG.excuse.maxSpeed;
  }
  engine.state.excuse.vy = 0;
  return engine;
}

const impactAt = RALLY_CONFIG.ceremony.ingestionMs + RALLY_CONFIG.ceremony.hitStopMs;
const ceremonyTotal =
  RALLY_CONFIG.ceremony.ingestionMs +
  RALLY_CONFIG.ceremony.hitStopMs +
  RALLY_CONFIG.ceremony.reactionMs +
  RALLY_CONFIG.ceremony.bannerMs +
  RALLY_CONFIG.ceremony.beatMs +
  RALLY_CONFIG.ceremony.serveTelegraphMs;

function reachImpact(engine: RallyEngine) {
  engine.advanceFrame(impactAt);
}

function finishCeremony(engine: RallyEngine) {
  engine.advanceFrame(ceremonyTotal + 1);
}

describe("RallyEngine scoring", () => {
  it("lets a first-timer score by tracking the scroll and holding Fire Breath", () => {
    const engine = new RallyEngine({ controlMode: "flight", seed: 23, scoringMode: "buttHybrid" });
    engine.start();
    engine.setAim(RALLY_CONFIG.arena.width, 340);
    engine.setBreath(true);
    const thirtyFiveSeconds = RALLY_CONFIG.simulation.fixedHz * 35;
    for (let step = 0; step < thirtyFiveSeconds && !engine.state.ceremony; step += 1) {
      engine.setMovement(0, Math.sign(engine.state.excuse.y - engine.state.spark.y));
      engine.setAim(RALLY_CONFIG.arena.width, 340);
      engine.advanceFixedSteps(1);
    }
    expect(engine.state.ceremony).not.toBeNull();
    reachImpact(engine);
    expect(engine.state.sparkScore).toBeGreaterThan(0);
  });

  it("scores a swept gate-plane crossing at the 980 px/s cap", () => {
    const engine = crossing("clockhead");
    engine.advanceFixedSteps(1);
    expect(engine.state.ceremony?.snapshot.x).toBe(RALLY_CONFIG.arena.width);
    expect(engine.state.sparkScore).toBe(0);
    reachImpact(engine);
    expect(engine.state.sparkScore).toBe(1);
    expect(engine.state.excuse.inPlay).toBe(true);
    expect(engine.consumeEvents().some(event => event.type === "gate_score_for")).toBe(true);
    finishCeremony(engine);
    expect(engine.state.excuse.inPlay).toBe(false);
  });

  it("does not score when the center crosses outside the gate opening", () => {
    const engine = crossing("spark");
    engine.state.excuse.y = 150;
    engine.state.excuse.prevY = 150;
    engine.advanceFixedSteps(1);
    expect(engine.state.clockheadScore).toBe(0);
    expect(engine.state.excuse.vx).toBeGreaterThan(0);
  });

  it("keeps an ignited gate score at one point", () => {
    const engine = crossing("clockhead");
    engine.state.excuse.ignitedUntil = 9999;
    engine.advanceFixedSteps(1);
    reachImpact(engine);
    expect(engine.state.sparkScore).toBe(1);
  });

  it("reaches victory and defeat at five points", () => {
    const victory = crossing("clockhead", 4);
    victory.advanceFixedSteps(1);
    reachImpact(victory);
    expect(victory.state.status).toBe("playing");
    finishCeremony(victory);
    expect(victory.state.status).toBe("victory");

    const defeat = crossing("spark", 4);
    defeat.advanceFixedSteps(1);
    reachImpact(defeat);
    finishCeremony(defeat);
    expect(defeat.state.status).toBe("defeat");
  });

  it("commits a sealed score once across a frame-drop spike", () => {
    const engine = crossing("clockhead");
    engine.advanceFixedSteps(1);
    expect(engine.state.ceremony?.committed).toBe(false);
    engine.advanceFrame(ceremonyTotal * 3);
    expect(engine.state.sparkScore).toBe(1);
    expect(engine.state.ceremony).toBeNull();
    engine.advanceFrame(ceremonyTotal * 3);
    expect(engine.state.sparkScore).toBe(1);
  });

  it("keeps an open mission interactive while a score ceremony runs", () => {
    const engine = crossing("clockhead");
    engine.state.mission.status = "ready";
    engine.state.mission.readyAt = 0;
    engine.state.mission.acceptDeadline = 20_000;
    engine.advanceFixedSteps(1);
    expect(engine.state.ceremony).not.toBeNull();
    expect(engine.acceptRescue()).toBe(true);
    expect(engine.state.mission.status).toBe("accepted");
  });
});
