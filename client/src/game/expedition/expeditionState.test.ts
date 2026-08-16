import { describe, expect, it } from "vitest";
import { EXPEDITION, ExpeditionRun, RELICS } from "./expeditionState";
import * as expeditionStateModule from "./expeditionState";

describe("business-truth firewall (§5/§31)", () => {
  it("imports nothing that could touch business state", () => {
    // Structural: this module must stay free of tRPC, order types, and any
    // business surface. If someone wires a mutation in here, this fails.
    const exported = Object.keys(expeditionStateModule).sort();
    expect(exported).toEqual(["EXPEDITION", "ExpeditionRun", "RELICS"]);
  });

  it("exposes no method that could complete, cancel or alter an order", () => {
    const surface = Object.getOwnPropertyNames(ExpeditionRun.prototype);
    for (const forbidden of [
      "collect",
      "complete",
      "completeOrder",
      "collectOrder",
      "markCollected",
      "deliver",
      "chargeCustomer",
    ]) {
      expect(surface).not.toContain(forbidden);
    }
  });

  it("survives a full defeat/redeploy/press-on cycle with no business call", () => {
    // The whole fictional lifecycle runs on a plain object with no I/O.
    const run = new ExpeditionRun();
    run.takeDamage(EXPEDITION.maxHp);
    expect(run.outcome).toBe("down");
    run.redeploy();
    run.takeDamage(EXPEDITION.maxHp);
    run.pressOn();
    expect(run.outcome).toBe("running");
  });
});

describe("HP and defeat", () => {
  it("takes damage and goes down at zero", () => {
    const run = new ExpeditionRun();
    run.takeDamage(40);
    expect(run.hp).toBe(60);
    expect(run.outcome).toBe("running");

    run.step(1);
    run.takeDamage(60);
    expect(run.hp).toBe(0);
    expect(run.outcome).toBe("down");
  });

  it("grants brief invulnerability after a hit", () => {
    const run = new ExpeditionRun();
    run.takeDamage(10);
    expect(run.takeDamage(10)).toBe(0);
    expect(run.hp).toBe(90);

    run.step(1);
    expect(run.takeDamage(10)).toBe(10);
  });

  it("lets a hazard bypass i-frames when it should always connect", () => {
    const run = new ExpeditionRun();
    run.takeDamage(10);
    expect(run.takeDamage(10, { ignoreIFrames: true })).toBe(10);
  });

  it("takes no further damage once down", () => {
    const run = new ExpeditionRun();
    run.takeDamage(EXPEDITION.maxHp);
    expect(run.takeDamage(10)).toBe(0);
  });
});

describe("Relic changes a verb, not a number (§27)", () => {
  it("offers exactly three, each with a physical promise", () => {
    expect(RELICS).toHaveLength(3);
    for (const relic of RELICS) {
      expect(relic.promise).not.toMatch(/%|\+\d/);
    }
  });

  it("Brass Guard absorbs the first blow of a clash entirely", () => {
    const run = new ExpeditionRun();
    run.chooseRelic("brass_guard");

    expect(run.takeDamage(30)).toBe(0);
    expect(run.hp).toBe(EXPEDITION.maxHp);
    expect(run.guardAbsorbedThisFrame).toBe(true);

    // The second blow of the same clash lands.
    run.step(1);
    expect(run.takeDamage(30)).toBe(30);
  });

  it("recharges Brass Guard when the clash genuinely ends", () => {
    const run = new ExpeditionRun();
    run.chooseRelic("brass_guard");
    run.takeDamage(30);
    run.step(1);
    run.takeDamage(30);

    run.clashEnded();
    run.step(1);
    expect(run.takeDamage(30)).toBe(0);
  });

  it("does not absorb for a player who chose a different relic", () => {
    const run = new ExpeditionRun();
    run.chooseRelic("sunstep");
    expect(run.takeDamage(30)).toBe(30);
  });

  it("is expedition-only — a fresh run carries nothing over", () => {
    const first = new ExpeditionRun();
    first.chooseRelic("echo_thread");
    expect(new ExpeditionRun().relic).toBeNull();
  });
});

describe("Momentum", () => {
  it("accumulates from mastery and caps", () => {
    const run = new ExpeditionRun();
    run.addMomentum(EXPEDITION.momentum.hostileDefeated);
    expect(run.momentum).toBe(EXPEDITION.momentum.hostileDefeated);

    run.addMomentum(1000);
    expect(run.momentum).toBe(EXPEDITION.maxMomentum);
  });

  it("buys recovery as a real trade", () => {
    const run = new ExpeditionRun();
    run.takeDamage(50);
    expect(run.spendMomentumForRecovery()).toBe(false);

    run.addMomentum(EXPEDITION.momentum.recoveryCost);
    expect(run.spendMomentumForRecovery()).toBe(true);
    expect(run.hp).toBe(50 + EXPEDITION.momentum.recoveryHeal);
    expect(run.momentum).toBe(0);
  });

  it("refuses recovery at full health", () => {
    const run = new ExpeditionRun();
    run.addMomentum(EXPEDITION.maxMomentum);
    expect(run.spendMomentumForRecovery()).toBe(false);
  });
});

describe("Redeploy (§33)", () => {
  it("restores to the last waystone with expedition-level loss only", () => {
    const run = new ExpeditionRun();
    run.setWaystone({ id: "waystone_2", progress: 0.42 });
    run.addMomentum(80);
    run.takeDamage(EXPEDITION.maxHp);
    expect(run.outcome).toBe("down");

    const { restoredProgress } = run.redeploy();
    expect(restoredProgress).toBe(0.42);
    expect(run.hp).toBe(EXPEDITION.maxHp);
    expect(run.momentum).toBe(40);
    expect(run.outcome).toBe("running");
  });

  it("restores to the start when no waystone was reached", () => {
    const run = new ExpeditionRun();
    run.takeDamage(EXPEDITION.maxHp);
    expect(run.redeploy().restoredProgress).toBe(0);
  });
});

describe("Press On is a compromise, not a skip (§34)", () => {
  it("enters the Scarred Route and forfeits optional content", () => {
    const run = new ExpeditionRun();
    run.takeDamage(EXPEDITION.maxHp);
    run.pressOn();

    expect(run.scarred).toBe(true);
    expect(run.route).toBe("scarred");
    expect(run.optionalRewardsAvailable).toBe(false);
    expect(run.outcome).toBe("running");
    // Still alive and still traversing — not teleported to the pickup.
    expect(run.hp).toBeGreaterThan(0);
  });

  it("forfeits expedition rank", () => {
    const run = new ExpeditionRun();
    run.addMomentum(EXPEDITION.maxMomentum);
    expect(run.expeditionRank()).toBe("gold");

    run.pressOn();
    expect(run.expeditionRank()).toBe("none");
  });

  it("locks out further route choice once scarred", () => {
    const run = new ExpeditionRun();
    run.pressOn();
    run.chooseRoute("upper");
    expect(run.route).toBe("scarred");
  });
});

describe("Route choice is fiction only (§28)", () => {
  it("records the physical route without any business effect", () => {
    const run = new ExpeditionRun();
    run.chooseRoute("upper");
    expect(run.route).toBe("upper");

    run.chooseRoute("safe");
    expect(run.route).toBe("safe");
  });
});
