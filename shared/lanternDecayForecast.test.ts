import { describe, expect, it } from "vitest";
import { decayForecastLine, forecastTerritoryDecay } from "./lanternDecayForecast";
import type { CustomerCadence } from "./lanternCity";

const measured = (daysSince: number, expected = 7): CustomerCadence => {
  const ratio = daysSince / expected;
  return {
    state: ratio <= 1.25 ? "active" : ratio <= 2.5 ? "dimming" : "dark",
    confidence: "measured",
    expectedCadenceDays: expected,
    daysSinceLastOrder: daysSince,
    expectedNextOrder: null,
    cyclesMissed: null,
  };
};
const sparse = (state: CustomerCadence["state"]): CustomerCadence => ({
  state,
  confidence: "sparse",
  expectedCadenceDays: null,
  daysSinceLastOrder: 0,
  expectedNextOrder: null,
  cyclesMissed: null,
});
const held = { guarded: false, conquered: true, pressureReturned: false };

describe("forecastTerritoryDecay", () => {
  it("names the day a healthy territory first reads worse, and the customer who can hold it", () => {
    const f = forecastTerritoryDecay({
      territoryId: "silver-lake",
      occupancy: held,
      customers: [
        { identityKey: "a", cadence: measured(2) },
        { identityKey: "b", cadence: measured(3) },
        { identityKey: "c", cadence: measured(7) },
        { identityKey: "d", cadence: measured(8) },
        { identityKey: "e", cadence: measured(1) },
      ],
    });
    expect(f.currentState).toBe("healthy");
    expect(f.nextState).toBe("at_risk");
    expect(f.daysUntil).toBe(1);
    expect(f.ordersToHold).toBe(1);
    expect(f.holdCandidates[0]).toBe("d");
    expect(decayForecastLine(f)).toBe("Goes quiet in 1 day unless one order lands.");
  });

  it("never forecasts from sparse cadence", () => {
    const f = forecastTerritoryDecay({
      territoryId: "x",
      occupancy: held,
      customers: [
        { identityKey: "a", cadence: sparse("active") },
        { identityKey: "b", cadence: sparse("active") },
        { identityKey: "c", cadence: sparse("dimming") },
      ],
    });
    expect(f.nextState).toBeNull();
    expect(f.daysUntil).toBeNull();
    expect(f.holdCandidates).toEqual([]);
    expect(decayForecastLine(f)).toBeNull();
  });

  it("says nothing beyond the horizon", () => {
    const f = forecastTerritoryDecay({
      territoryId: "x",
      occupancy: held,
      horizonDays: 10,
      customers: [
        { identityKey: "a", cadence: measured(0, 60) },
        { identityKey: "b", cadence: measured(0, 60) },
      ],
    });
    expect(f.nextState).toBeNull();
  });

  it("one dormant customer cannot forecast a neighborhood into infestation", () => {
    const f = forecastTerritoryDecay({
      territoryId: "x",
      occupancy: held,
      customers: [{ identityKey: "only", cadence: measured(30) }],
    });
    expect(f.currentState).toBe("at_risk");
    expect(f.nextState).toBeNull();
  });

  it("is monotone: the forecast state is strictly worse than today", () => {
    const f = forecastTerritoryDecay({
      territoryId: "x",
      occupancy: held,
      customers: [
        { identityKey: "a", cadence: measured(20) },
        { identityKey: "b", cadence: measured(20) },
        { identityKey: "c", cadence: measured(9) },
        { identityKey: "d", cadence: measured(9) },
      ],
    });
    expect(f.currentState).toBe("overgrown");
    expect(f.nextState).not.toBeNull();
    expect(["infested", "closed_construction"]).toContain(f.nextState);
  });
});
