import { describe, expect, it } from "vitest";
import { TOWER_WARS_ATTACK_THRESHOLD_CENTS } from "./goldlineGameConfig";
import { compileTowerWarsState, type TowerWarsBusinessEvent } from "./towerWars";
import {
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

describe("revenue is never destroyed at the day boundary", () => {
  it("carries unspent value across midnight instead of resetting it", () => {
    // Two sub-threshold orders on different days must still combine into one
    // attack. Folding each day independently would lose both.
    const events = [
      event("2026-08-28", "opus_la", THRESHOLD - 100),
      event("2026-08-29", "opus_la", 100),
    ];
    const settlement = settleTowerWars({
      events,
      todayBusinessDate: "2026-08-29",
    });
    expect(settlement.cumulative.attacks).toHaveLength(1);
    // The attack is attributed to the day whose order actually triggered it.
    expect(
      settlement.buildings.century_park_east.today.incomingAttacks
    ).toBe(1);
    expect(settlement.buildings.century_park_east.settledScars).toBe(0);
  });

  it("stays identical to the live compiler over the same events", () => {
    const events = [
      event("2026-08-27", "opus_la", THRESHOLD * 2),
      event("2026-08-28", "century_park_east", THRESHOLD),
      event("2026-08-29", "opus_la", THRESHOLD + 40),
    ];
    const settlement = settleTowerWars({
      events,
      todayBusinessDate: "2026-08-29",
    });
    const live = compileTowerWarsState(events);
    expect(settlement.cumulative.attacks.length).toBe(live.attacks.length);
    expect(settlement.cumulative.buildings.opus_la.revenueCents).toBe(
      live.buildings.opus_la.revenueCents
    );
    expect(settlement.cumulative.buildings.opus_la.unspentValueCents).toBe(
      live.buildings.opus_la.unspentValueCents
    );
  });
});

describe("today is a fresh, legible match", () => {
  it("reflects only today's attacks, not accumulated history", () => {
    const events = [
      // Four prior days of heavy attacks on Century Park East.
      event("2026-08-25", "opus_la", THRESHOLD),
      event("2026-08-26", "opus_la", THRESHOLD),
      event("2026-08-27", "opus_la", THRESHOLD),
      event("2026-08-28", "opus_la", THRESHOLD),
      // Today: a single hit.
      event("2026-08-29", "opus_la", THRESHOLD),
    ];
    const settlement = settleTowerWars({
      events,
      todayBusinessDate: "2026-08-29",
    });
    const cpe = settlement.buildings.century_park_east;

    // Under the old monotonic rule this building would be permanently
    // "critical" and stay there forever. Today's match reads honestly.
    expect(cpe.today.incomingAttacks).toBe(1);
    expect(cpe.today.damage).toBe("chipped");
    // And the history is still fully present underneath.
    expect(cpe.settledScars).toBe(4);
    expect(lifetimeIncomingAttacks(cpe)).toBe(5);
  });

  it("gives a building with no activity today a pristine match", () => {
    const settlement = settleTowerWars({
      events: [event("2026-08-25", "opus_la", THRESHOLD)],
      todayBusinessDate: "2026-08-29",
    });
    const cpe = settlement.buildings.century_park_east;
    expect(cpe.today.incomingAttacks).toBe(0);
    expect(cpe.today.damage).toBe("pristine");
    expect(cpe.settledScars).toBe(1);
  });
});

describe("strata are permanent and positioned in time", () => {
  it("records one stratum per day the building was actually hit, oldest first", () => {
    const events = [
      event("2026-08-25", "opus_la", THRESHOLD),
      event("2026-08-27", "opus_la", THRESHOLD * 3),
      event("2026-08-29", "opus_la", THRESHOLD),
    ];
    const settlement = settleTowerWars({
      events,
      todayBusinessDate: "2026-08-29",
    });
    const strata = settlement.buildings.century_park_east.strata;
    expect(strata.map(s => s.businessDate)).toEqual([
      "2026-08-25",
      "2026-08-27",
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
    // Opus was only hit on the 26th; the 25th must not appear on its facade.
    expect(
      settlement.buildings.opus_la.strata.map(s => s.businessDate)
    ).toEqual(["2026-08-26"]);
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
    expect(previous).toBe(3);
  });
});

describe("a settlement never depends on the future", () => {
  it("ignores events dated after the settlement date", () => {
    const events = [
      event("2026-08-25", "opus_la", THRESHOLD),
      event("2026-09-15", "opus_la", THRESHOLD * 5),
    ];
    const settlement = settleTowerWars({
      events,
      todayBusinessDate: "2026-08-26",
    });
    expect(settlement.cumulative.attacks).toHaveLength(1);
    expect(settlement.buildings.century_park_east.settledScars).toBe(1);
    expect(settlement.buildings.century_park_east.today.incomingAttacks).toBe(0);
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
