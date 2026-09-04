import { describe, expect, it } from "vitest";
import {
  DORMANT_SCORE_FLOOR,
  RIBBON_WINDOW_MS,
  msUntilNextChange,
  projectBuildingVitality,
  projectCustomerVitality,
  ribbonExpiryFor,
  type CustomerVitalityInput,
} from "./lanternVitality";

const NOW = new Date("2026-09-03T12:00:00Z");

function customer(over: Partial<CustomerVitalityInput> = {}): CustomerVitalityInput {
  return {
    customerId: "c1",
    activeOrderCount: 0,
    score: 10,
    daysSinceLastOrder: 7,
    contactedAt: null,
    ...over,
  };
}

describe("warmth means active, not recovered", () => {
  /*
    The correction that reshaped this module. A loyal customer who never lapsed
    must be warm on their own evidence — requiring a recovery they never needed
    would show a healthy city as a broken one.
  */
  it("an ordinary never-lapsed customer is warm with no recovery anywhere", () => {
    const state = projectCustomerVitality(
      customer({ score: 5, daysSinceLastOrder: 6, contactedAt: null }),
      NOW
    );
    expect(state.vitality).toBe("warm");
    expect(state.ribbonActive).toBe(false);
  });

  it("an in-flight order outranks a stale scan that called them dormant", () => {
    const state = projectCustomerVitality(
      customer({ activeOrderCount: 1, score: 95 }),
      NOW
    );
    expect(state.vitality).toBe("warm");
    expect(state.statusLine).toBe("Active · 1 order in progress");
  });

  it("a customer at or above the dormancy floor is quiet", () => {
    expect(projectCustomerVitality(customer({ score: DORMANT_SCORE_FLOOR }), NOW).vitality).toBe("quiet");
    expect(projectCustomerVitality(customer({ score: DORMANT_SCORE_FLOOR - 1 }), NOW).vitality).toBe("warm");
  });

  /*
    Recovery is not a state, so there is no residue to go stale. A customer who
    reordered and later lapsed again is simply quiet again.
  */
  it("a customer who recovered and lapsed again is quiet again, with no residue", () => {
    const relapsed = projectCustomerVitality(
      customer({
        score: 88,
        activeOrderCount: 0,
        daysSinceLastOrder: 120,
        contactedAt: new Date(NOW.getTime() - 200 * 24 * 3_600_000),
      }),
      NOW
    );
    expect(relapsed.vitality).toBe("quiet");
    expect(relapsed.ribbonActive).toBe(false);
  });
});

describe("the firewall: outreach alone never produces warmth", () => {
  it("a fresh outreach leaves a dormant customer quiet", () => {
    const state = projectCustomerVitality(
      customer({ score: 80, contactedAt: new Date(NOW.getTime() - 60_000) }),
      NOW
    );
    expect(state.vitality).toBe("quiet");
    expect(state.ribbonActive).toBe(true);
  });

  it("no amount or recency of outreach can flip vitality to warm", () => {
    for (const minutesAgo of [0, 1, 30, 120, 359]) {
      const state = projectCustomerVitality(
        customer({ score: 80, contactedAt: new Date(NOW.getTime() - minutesAgo * 60_000) }),
        NOW
      );
      expect(state.vitality).toBe("quiet");
    }
  });

  it("says outreach and dormancy in the same breath, so neither can be read alone", () => {
    const state = projectCustomerVitality(
      customer({ score: 80, daysSinceLastOrder: 74, contactedAt: new Date(NOW.getTime() - 2 * 3_600_000) }),
      NOW
    );
    expect(state.statusLine).toBe("Quiet · 74d since last order · reached out 2h ago, no order yet");
  });
});

describe("the ribbon is anchored to the real event", () => {
  /*
    The anti-restart property. Expiry is a fixed instant derived from the
    outreach itself, so remounting, refetching or navigating back cannot make a
    ribbon burn twice — which would claim an outreach happened now that actually
    happened hours ago.
  */
  it("expiry is contactedAt + window, identical across repeated projections", () => {
    const contactedAt = new Date(NOW.getTime() - 3 * 3_600_000);
    const first = projectCustomerVitality(customer({ score: 80, contactedAt }), NOW);
    const laterMount = projectCustomerVitality(
      customer({ score: 80, contactedAt }),
      new Date(NOW.getTime() + 90 * 60_000)
    );
    expect(first.ribbonExpiresAt?.toISOString()).toBe(
      new Date(contactedAt.getTime() + RIBBON_WINDOW_MS).toISOString()
    );
    expect(laterMount.ribbonExpiresAt?.toISOString()).toBe(first.ribbonExpiresAt?.toISOString());
  });

  it("expires once the window has passed, however recently the page loaded", () => {
    const contactedAt = new Date(NOW.getTime() - RIBBON_WINDOW_MS - 1000);
    const state = projectCustomerVitality(customer({ score: 80, contactedAt }), NOW);
    expect(state.ribbonActive).toBe(false);
    expect(state.ribbonExpiresAt).toBeNull();
    expect(state.statusLine).not.toMatch(/reached out/);
  });

  it("ribbonExpiryFor is null when no outreach was ever recorded", () => {
    expect(ribbonExpiryFor(null)).toBeNull();
  });
});

describe("unknown is not quiet", () => {
  it("an unscored customer is unknown, not dormant", () => {
    const state = projectCustomerVitality(customer({ score: null, activeOrderCount: 0 }), NOW);
    expect(state.vitality).toBe("unknown");
    expect(state.statusLine).toBe("No order history recorded");
  });

  it("unknown customers are excluded from the lit fraction, not counted as quiet", () => {
    const states = [
      projectCustomerVitality(customer({ customerId: "a", score: 5 }), NOW),
      projectCustomerVitality(customer({ customerId: "b", score: null }), NOW),
      projectCustomerVitality(customer({ customerId: "c", score: null }), NOW),
    ];
    const building = projectBuildingVitality("opus_la", states);
    expect(building.litFraction).toBe(1);
    expect(building.unknownCount).toBe(2);
    expect(building.statusLine).toBe("1 of 1 active · 2 without history");
  });

  it("a building with nothing known has a null lit fraction, not zero", () => {
    const building = projectBuildingVitality("opus_la", [
      projectCustomerVitality(customer({ score: null }), NOW),
    ]);
    expect(building.litFraction).toBeNull();
    expect(building.statusLine).toBe("1 customer here, no order history recorded");
  });
});

describe("mixed buildings light proportionally", () => {
  /*
    One dormant resident must not darken a tower. Vitality is a proportion, not
    a verdict.
  */
  it("six active of eight reads as three quarters lit, not as a failure", () => {
    const states = [
      ...Array.from({ length: 6 }, (_, i) =>
        projectCustomerVitality(customer({ customerId: `w${i}`, score: 5 }), NOW)
      ),
      ...Array.from({ length: 2 }, (_, i) =>
        projectCustomerVitality(customer({ customerId: `q${i}`, score: 80 }), NOW)
      ),
    ];
    const building = projectBuildingVitality("opus_la", states);
    expect(building.litFraction).toBe(0.75);
    expect(building.statusLine).toBe("6 of 8 active · 2 quiet");
  });

  it("a single ribbon anywhere marks the building, without changing the ratio", () => {
    const building = projectBuildingVitality("opus_la", [
      projectCustomerVitality(customer({ customerId: "a", score: 5 }), NOW),
      projectCustomerVitality(
        customer({ customerId: "b", score: 80, contactedAt: new Date(NOW.getTime() - 60_000) }),
        NOW
      ),
    ]);
    expect(building.ribbonActive).toBe(true);
    expect(building.litFraction).toBe(0.5);
    expect(building.statusLine).toBe("1 of 2 active · 1 quiet · outreach sent today");
  });

  it("an empty building says so rather than reading as dark", () => {
    const building = projectBuildingVitality("opus_la", []);
    expect(building.litFraction).toBeNull();
    expect(building.statusLine).toBe("No customers placed here yet");
  });
});

describe("a mounted page expires its own ribbon", () => {
  it("reports the soonest expiry so one timer can be scheduled", () => {
    const building = projectBuildingVitality("opus_la", [
      projectCustomerVitality(
        customer({ customerId: "a", score: 80, contactedAt: new Date(NOW.getTime() - 5 * 3_600_000) }),
        NOW
      ),
      projectCustomerVitality(
        customer({ customerId: "b", score: 80, contactedAt: new Date(NOW.getTime() - 1 * 3_600_000) }),
        NOW
      ),
    ]);
    // The 5h-old outreach expires first: 1 hour from now.
    expect(msUntilNextChange(building, NOW)).toBe(3_600_000);
  });

  it("has nothing to schedule when no ribbon is live", () => {
    const building = projectBuildingVitality("opus_la", [
      projectCustomerVitality(customer({ score: 5 }), NOW),
    ]);
    expect(msUntilNextChange(building, NOW)).toBeNull();
  });

  it("never schedules a negative delay", () => {
    const building = projectBuildingVitality("opus_la", [
      projectCustomerVitality(
        customer({ score: 80, contactedAt: new Date(NOW.getTime() - 60_000) }),
        NOW
      ),
    ]);
    expect(msUntilNextChange(building, new Date(NOW.getTime() + 10 * 3_600_000))).toBe(0);
  });
});
