import { describe, expect, it } from "vitest";
import {
  CANON_ATTACK_NAMES,
  LEGENDS,
  MAX_HANG_MS,
  MAX_PROJECTILES,
  MIN_HANG_MS,
  distinguishableAtAGlance,
  hangMsFor,
  legendFor,
  planClockheadAttack,
  type ChurnPressure,
} from "./clockheadReadability";

function pressure(over: Partial<ChurnPressure> = {}): ChurnPressure {
  return { dormantCount: 1, worstDaysOverdue: 30, buildingSilent: false, ...over };
}

describe("three silhouettes, read before any text", () => {
  it("one drifting customer is a single hanging bolt", () => {
    const plan = planClockheadAttack(pressure({ dormantCount: 1 }));
    expect(plan.kind).toBe("aimed");
    expect(plan.canonName).toBe("Aimed Bolt");
    expect(plan.projectileCount).toBe(1);
  });

  it("several lapsing together is a staggered fan", () => {
    const plan = planClockheadAttack(pressure({ dormantCount: 4 }));
    expect(plan.kind).toBe("fan");
    expect(plan.canonName).toBe("Clock Fan");
    expect(plan.projectileCount).toBe(4);
  });

  /*
    A silent building is categorically different from any number of individuals,
    so it must not be expressed as merely a bigger fan — the player has to feel
    that something else entirely has happened.
  */
  it("a silent building is an arc, not a bigger fan", () => {
    const plan = planClockheadAttack(pressure({ dormantCount: 9, buildingSilent: true }));
    expect(plan.kind).toBe("sweep");
    expect(plan.canonName).toBe("Second Hand");
  });

  it("the three silhouettes are mutually distinguishable at a glance", () => {
    const one = planClockheadAttack(pressure({ dormantCount: 1 }));
    const few = planClockheadAttack(pressure({ dormantCount: 4 }));
    const silent = planClockheadAttack(pressure({ dormantCount: 9, buildingSilent: true }));
    expect(distinguishableAtAGlance(one, few)).toBe(true);
    expect(distinguishableAtAGlance(few, silent)).toBe(true);
    expect(distinguishableAtAGlance(one, silent)).toBe(true);
  });

  /*
    Guards against expressing "more dormancy" as one extra projectile nobody can
    perceive. People do not count past about four under pressure.
  */
  it("does not claim two nearly identical fans can be told apart", () => {
    const four = planClockheadAttack(pressure({ dormantCount: 4 }));
    const five = planClockheadAttack(pressure({ dormantCount: 5 }));
    expect(distinguishableAtAGlance(four, five)).toBe(false);
  });
});

describe("fair difficulty", () => {
  it("never exceeds the legible projectile ceiling, however bad churn gets", () => {
    for (const dormantCount of [6, 12, 40, 500]) {
      const plan = planClockheadAttack(pressure({ dormantCount }));
      expect(plan.projectileCount).toBeLessThanOrEqual(MAX_PROJECTILES);
    }
  });

  /*
    The ceiling must not quietly become a lie about the business. When the count
    stops being literal the plan says so and still carries the true number.
  */
  it("says when the count has stopped being literal, and keeps the real one", () => {
    const plan = planClockheadAttack(pressure({ dormantCount: 40 }));
    expect(plan.aggregated).toBe(true);
    expect(plan.representsCustomers).toBe(40);
    expect(plan.projectileCount).toBe(MAX_PROJECTILES);
  });

  it("keeps the hang inside a reactable range at every lateness", () => {
    for (const days of [0, 10, 60, 180, 900, 10_000]) {
      const hang = hangMsFor(days);
      expect(hang).toBeGreaterThanOrEqual(MIN_HANG_MS);
      expect(hang).toBeLessThanOrEqual(MAX_HANG_MS);
    }
  });

  it("holds the shot longer the longer the customer has been meaning to order", () => {
    expect(hangMsFor(150)).toBeGreaterThan(hangMsFor(10));
  });
});

describe("missing evidence still fights", () => {
  /*
    A boss who stops attacking because a query came back empty reads as a broken
    game, not an honest one. Absent evidence falls to the mildest legible attack.
  */
  it("with nothing known, produces a playable attack rather than none", () => {
    const plan = planClockheadAttack({
      dormantCount: 0,
      worstDaysOverdue: null,
      buildingSilent: false,
    });
    expect(plan.kind).toBe("aimed");
    expect(plan.projectileCount).toBe(1);
    expect(plan.representsCustomers).toBe(0);
  });

  it("labels unknown lateness as PENDING rather than guessing a severity", () => {
    expect(legendFor(null)).toBe("PENDING");
    expect(hangMsFor(null)).toBe(MIN_HANG_MS);
  });

  it("survives nonsense counts without inventing an attack", () => {
    const plan = planClockheadAttack(pressure({ dormantCount: -5 }));
    expect(plan.projectileCount).toBeGreaterThanOrEqual(1);
    expect(plan.representsCustomers).toBe(0);
  });
});

describe("the legend escalates with real lateness", () => {
  it("moves through the bible's deferral vocabulary as lateness grows", () => {
    expect(legendFor(3)).toBe("SOON");
    expect(legendFor(30)).toBe("PENDING");
    expect(legendFor(60)).toBe("AFTER REVIEW");
    expect(legendFor(120)).toBe("NEXT WEEK");
    expect(legendFor(400)).toBe("NOT YET");
  });

  it("never escalates backwards", () => {
    const days = [0, 13, 14, 44, 45, 89, 90, 179, 180, 900];
    const indices = days.map(d => LEGENDS.indexOf(legendFor(d)));
    for (let i = 1; i < indices.length; i += 1) {
      expect(indices[i]).toBeGreaterThanOrEqual(indices[i - 1]);
    }
  });

  it("uses only vocabulary the World Bible gives Clockhead's clocks", () => {
    for (const legend of LEGENDS) {
      expect(["SOON", "PENDING", "AFTER REVIEW", "NEXT WEEK", "NOT YET"]).toContain(legend);
    }
  });
});

describe("the plan matches what combat can actually render", () => {
  /*
    `colosseumCombat.ts` implements exactly aimed | fan | sweep. A plan naming an
    attack the engine cannot spawn would be a design document pretending to be a
    specification.
  */
  it("only ever names attacks the engine implements", () => {
    const implemented = ["aimed", "fan", "sweep"];
    for (const p of [
      pressure({ dormantCount: 0 }),
      pressure({ dormantCount: 1 }),
      pressure({ dormantCount: 3 }),
      pressure({ dormantCount: 99 }),
      pressure({ buildingSilent: true }),
    ]) {
      expect(implemented).toContain(planClockheadAttack(p).kind);
    }
  });

  it("carries the canon name for every implemented kind", () => {
    expect(CANON_ATTACK_NAMES).toEqual({
      aimed: "Aimed Bolt",
      fan: "Clock Fan",
      sweep: "Second Hand",
    });
  });

  it("describes a tell for every plan, in words a designer can act on", () => {
    for (const p of [pressure({ dormantCount: 1 }), pressure({ dormantCount: 4 }), pressure({ buildingSilent: true })]) {
      expect(planClockheadAttack(p).tell.length).toBeGreaterThan(20);
    }
  });
});
