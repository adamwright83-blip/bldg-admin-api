import { describe, expect, it } from "vitest";
import { TOWER_WARS_ATTACK_THRESHOLD_CENTS } from "./goldlineGameConfig";
import type { TowerWarsBusinessEvent } from "./towerWars";
import { rivalrySeasonId, rivalrySeasonWindow } from "./towerWarsSeasons";
import {
  compileDailyMatch,
  lifetimeIncomingAttacks,
  settleTowerWars,
} from "./towerWarsSettlement";

const THRESHOLD = TOWER_WARS_ATTACK_THRESHOLD_CENTS;

let sequence = 0;
function event(
  businessDate: string,
  buildingId: TowerWarsBusinessEvent["buildingId"],
  cents: number,
  hour = 12
): TowerWarsBusinessEvent {
  sequence += 1;
  return {
    eventId: `event:${sequence}`,
    occurredAt: `${businessDate}T${String(hour).padStart(2, "0")}:00:00.000Z`,
    businessDate,
    buildingId,
    buildingDisplayName: buildingId,
    orderId: sequence,
    customerIdentity: `customer:${sequence}`,
    customerDisplayName: null,
    customerPhone: null,
    revenueSource: "stripe",
    realOrderValueCents: cents,
    sourceEvidence: { economicEventKey: `event:${sequence}` },
  };
}

describe("the threshold is the one in config", () => {
  it("is 5000 cents", () => {
    expect(THRESHOLD).toBe(5000);
  });
});

describe("weekly combat carries charge across days", () => {
  it("lets yesterday's unspent charge fire today's shot within the same season", () => {
    const events = [
      event("2026-08-28", "opus_la", 4000),
      event("2026-08-29", "opus_la", 1000),
    ];
    const settlement = settleTowerWars({
      events,
      todayBusinessDate: "2026-08-29",
    });
    const cpe = settlement.buildings.century_park_east;

    expect(cpe.today.incomingAttacks).toBe(1);
    expect(cpe.today.damage).toBe("chipped");
    expect(cpe.settledScars).toBe(0);
    expect(cpe.strata).toHaveLength(0);
  });

  it("retains the season accumulator across days", () => {
    const settlement = settleTowerWars({
      events: [
        event("2026-08-28", "opus_la", THRESHOLD - 1),
        event("2026-08-29", "opus_la", 1),
      ],
      todayBusinessDate: "2026-08-29",
    });
    expect(settlement.buildings.opus_la.today.unspentValueCents).toBe(0);
    expect(
      settlement.buildings.century_park_east.today.incomingAttacks
    ).toBe(1);
  });

  it("fires only when a single day's own orders cross the threshold", () => {
    const settlement = settleTowerWars({
      events: [
        event("2026-08-29", "opus_la", 3000),
        event("2026-08-29", "opus_la", 2000),
      ],
      todayBusinessDate: "2026-08-29",
    });
    expect(
      settlement.buildings.century_park_east.today.incomingAttacks
    ).toBe(1);
    expect(settlement.buildings.opus_la.today.outgoingAttacks).toBe(1);
    expect(settlement.buildings.opus_la.today.unspentValueCents).toBe(0);
  });
});

describe("replaying one rivalry season in isolation", () => {
  const history = [
    event("2026-08-27", "opus_la", 4900),
    event("2026-08-28", "opus_la", 4900),
    event("2026-08-29", "opus_la", THRESHOLD * 2 + 1200),
    event("2026-08-29", "century_park_east", 5100),
  ];

  it("reproduces the season prefix independent of unrelated seasons", () => {
    for (const date of ["2026-08-27", "2026-08-28", "2026-08-29"]) {
      const isolated = compileDailyMatch({
        businessDate: date,
        events: history.filter(e => rivalrySeasonId(e.businessDate) === rivalrySeasonId(date)),
      });
      const fromFullHistory = settleTowerWars({
        events: history,
        todayBusinessDate: date,
      });
      for (const building of ["opus_la", "century_park_east"] as const) {
        expect(fromFullHistory.buildings[building].today.incomingAttacks).toBe(
          isolated[building].incomingAttacks
        );
        expect(fromFullHistory.buildings[building].today.damage).toBe(
          isolated[building].damage
        );
        expect(
          fromFullHistory.buildings[building].today.unspentValueCents
        ).toBe(isolated[building].unspentValueCents);
      }
    }
  });

  it("combines two near-miss days into a strike", () => {
    const settlement = settleTowerWars({
      events: history.slice(0, 2),
      todayBusinessDate: "2026-08-28",
    });
    expect(settlement.buildings.century_park_east.settledScars).toBe(0);
    expect(
      settlement.buildings.century_park_east.today.incomingAttacks
    ).toBe(1);
  });
});

describe("the current season is a fresh match at Monday", () => {
  it("reflects all current-season attacks, not earlier seasons", () => {
    const events = [
      event("2026-08-25", "opus_la", THRESHOLD),
      event("2026-08-26", "opus_la", THRESHOLD),
      event("2026-08-27", "opus_la", THRESHOLD),
      event("2026-08-28", "opus_la", THRESHOLD),
      event("2026-08-29", "opus_la", THRESHOLD),
    ];
    const cpe = settleTowerWars({
      events,
      todayBusinessDate: "2026-08-29",
    }).buildings.century_park_east;

    expect(cpe.today.incomingAttacks).toBe(5);
    expect(cpe.today.damage).toBe("critical");
    expect(cpe.settledScars).toBe(0);
    expect(lifetimeIncomingAttacks(cpe)).toBe(5);
  });

  it("preserves earlier activity within the current season", () => {
    const cpe = settleTowerWars({
      events: [event("2026-08-25", "opus_la", THRESHOLD)],
      todayBusinessDate: "2026-08-29",
    }).buildings.century_park_east;
    expect(cpe.today.incomingAttacks).toBe(1);
    expect(cpe.today.damage).toBe("chipped");
    expect(cpe.settledScars).toBe(0);
  });
});

describe("revenue survives every combat reset", () => {
  it("keeps sub-threshold revenue as business truth even though it never fired", () => {
    const settlement = settleTowerWars({
      events: [
        event("2026-08-28", "opus_la", 4000),
        event("2026-08-29", "opus_la", 1000),
      ],
      todayBusinessDate: "2026-08-29",
    });
    const opus = settlement.buildings.opus_la;
    // No attack was ever emitted, and not one cent went missing.
    expect(opus.lifetime.revenueCents).toBe(5000);
    expect(opus.lifetime.orderCount).toBe(2);
    expect(settlement.buildings.century_park_east.settledScars).toBe(0);
  });

  it("counts revenue across every day in range, not just today", () => {
    const opus = settleTowerWars({
      events: [
        event("2026-08-20", "opus_la", 12_345),
        event("2026-08-25", "opus_la", 500),
        event("2026-08-29", "opus_la", 99),
      ],
      todayBusinessDate: "2026-08-29",
    }).buildings.opus_la;
    expect(opus.lifetime.revenueCents).toBe(12_944);
    expect(opus.lifetime.orderCount).toBe(3);
    expect(opus.today.revenueCents).toBe(599);
  });
});

describe("strata are permanent and positioned in time", () => {
  it("records one stratum per closed season, oldest first", () => {
    const settlement = settleTowerWars({
      events: [
        event("2026-08-11", "opus_la", THRESHOLD),
        event("2026-08-18", "opus_la", THRESHOLD * 3),
        event("2026-08-29", "opus_la", THRESHOLD),
      ],
      todayBusinessDate: "2026-08-29",
    });
    const strata = settlement.buildings.century_park_east.strata;
    expect(strata.map(s => s.businessDate)).toEqual([
      "2026-08-10",
      "2026-08-17",
    ]);
    expect(strata.map(s => s.incomingAttacks)).toEqual([1, 3]);
    expect(strata[1]!.damageAtSettlement).toBe("heavily-damaged");
  });

  it("leaves no mark on a day the building absorbed nothing", () => {
    const settlement = settleTowerWars({
      events: [
        event("2026-08-25", "opus_la", THRESHOLD),
        event("2026-08-26", "century_park_east", THRESHOLD),
      ],
      todayBusinessDate: "2026-08-29",
    });
    expect(
      settlement.buildings.opus_la.strata.map(s => s.businessDate)
    ).toEqual([]);
  });

  it("never lets settled scars decrease as history grows", () => {
    const events = [
      event("2026-08-25", "opus_la", THRESHOLD),
      event("2026-08-26", "opus_la", THRESHOLD),
      event("2026-08-27", "opus_la", THRESHOLD),
    ];
    let previous = 0;
    for (const today of ["2026-08-26", "2026-08-27", "2026-08-28"]) {
      const settled = settleTowerWars({ events, todayBusinessDate: today })
        .buildings.century_park_east.settledScars;
      expect(settled).toBeGreaterThanOrEqual(previous);
      previous = settled;
    }
    expect(previous).toBe(0);
  });
});

describe("a settlement never depends on the future", () => {
  it("ignores events dated after the settlement date", () => {
    const settlement = settleTowerWars({
      events: [
        event("2026-08-25", "opus_la", THRESHOLD),
        event("2026-09-15", "opus_la", THRESHOLD * 5),
      ],
      todayBusinessDate: "2026-08-26",
    });
    expect(settlement.buildings.century_park_east.settledScars).toBe(0);
    expect(
      settlement.buildings.century_park_east.today.incomingAttacks
    ).toBe(1);
    // The future order's revenue must not leak into lifetime either.
    expect(settlement.buildings.opus_la.lifetime.revenueCents).toBe(THRESHOLD);
  });

  it("is deterministic regardless of input event order", () => {
    const events = [
      event("2026-08-25", "opus_la", THRESHOLD),
      event("2026-08-26", "century_park_east", THRESHOLD * 2),
      event("2026-08-27", "opus_la", THRESHOLD),
    ];
    const forward = settleTowerWars({ events, todayBusinessDate: "2026-08-28" });
    const reversed = settleTowerWars({
      events: [...events].reverse(),
      todayBusinessDate: "2026-08-28",
    });
    expect(reversed.buildings).toEqual(forward.buildings);
  });
});
