import { describe, expect, it } from "vitest";
import { planForDate } from "./missionDirectorService";
import { explainMissionPlan } from "./explainPlan";
import { ENV } from "../_core/env";

describe("Mission Director — fails closed without a database", () => {
  it("returns a no_plan outcome instead of throwing when the database is unavailable", async () => {
    // No DATABASE_URL is set in this test environment, so getDb() returns
    // null. planForDate must degrade gracefully rather than propagate
    // getFieldToday's hard throw.
    const plan = await planForDate({
      tenantId: "default",
      operatorId: "test-operator",
      businessDate: "2026-09-13",
    });
    expect(plan.outcome.status).toBe("no_plan");
    if (plan.outcome.status === "no_plan") {
      expect(plan.outcome.reason).toBe("SCHEDULE_DATA_INSUFFICIENT");
    }
  });
});

describe("Mission Director — intelligence boundary (§5 invariant)", () => {
  const savedKey = ENV.anthropicApiKey;

  it("explainMissionPlan never returns anything but explanation/intelligence — it cannot alter a selection", async () => {
    ENV.anthropicApiKey = "";
    const outcome = {
      status: "planned" as const,
      primary: {
        campaignId: "referral-ask",
        title: "Referral Ask",
        objective: "obj",
        completionCondition: "cond",
        pocket: {
          startsAt: null,
          endsAt: null,
          minutes: null,
          kind: "open_ended" as const,
          boundedBy: { before: null, after: null },
          travelReserveMinutes: 15,
          usableMinutes: null,
          confidence: "low" as const,
          warnings: [],
        },
        isFallbackVariant: false,
      },
      fallback: {
        campaignId: "review-request",
        title: "Review Request",
        objective: "obj2",
        completionCondition: "cond2",
        pocket: {
          startsAt: null,
          endsAt: null,
          minutes: null,
          kind: "open_ended" as const,
          boundedBy: { before: null, after: null },
          travelReserveMinutes: 15,
          usableMinutes: null,
          confidence: "low" as const,
          warnings: [],
        },
        isFallbackVariant: false,
      },
      explanation: "",
      intelligence: "deterministic" as const,
    };
    const result = await explainMissionPlan({ tenantId: "default", outcome });
    expect(Object.keys(result).sort()).toEqual(["explanation", "intelligence"]);
    expect(result.intelligence).toBe("deterministic_fallback");
    expect(result.explanation).toContain("Referral Ask");
    ENV.anthropicApiKey = savedKey;
  });
});
