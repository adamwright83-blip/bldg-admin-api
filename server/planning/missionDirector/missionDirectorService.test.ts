import { describe, expect, it } from "vitest";
import {
  computePlanningFingerprint,
  legacyCampaignCompatibilityCandidates,
  planForDate,
  planningExecutionConstraint,
} from "./missionDirectorService";
import { explainMissionPlan } from "./explainPlan";
import { ENV } from "../../_core/env";

describe("Mission Director — legacy campaign compatibility", () => {
  it("cannot introduce an alternate campaign outside the generic winner", () => {
    expect(
      legacyCampaignCompatibilityCandidates("campaign-b", [
        { campaignId: "campaign-a" },
        { campaignId: "campaign-b" },
        { campaignId: "campaign-c" },
      ])
    ).toEqual([{ campaignId: "campaign-b" }]);
  });

  it("projects no campaign when authoritative work is non-campaign", () => {
    expect(
      legacyCampaignCompatibilityCandidates(null, [
        { campaignId: "campaign-a" },
      ])
    ).toEqual([]);
  });
});

describe("Mission Director — execution constraint authority", () => {
  it("does not treat a locked weekly assignment type as physical availability", () => {
    expect(
      planningExecutionConstraint({
        weeklyPrimaryExecutionType: "challenge",
        weeklyIntentOverride: null,
      })
    ).toBeNull();
    expect(
      planningExecutionConstraint({
        weeklyPrimaryExecutionType: "mission",
        weeklyIntentOverride: null,
      })
    ).toBeNull();
  });

  it("stays unknown when no authoritative availability fact exists", () => {
    expect(planningExecutionConstraint(null)).toBeNull();
    expect(
      planningExecutionConstraint({
        weeklyPrimaryExecutionType: "challenge",
        weeklyIntentOverride: { code: "operator_replaced_weekly_primary" },
      })
    ).toBeNull();
  });
});

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
          unknownStopWorkReserveMinutes: null,
          usableMinutes: null,
          confidence: "low" as const,
          warnings: [],
        },
        isFallbackVariant: false,
        rankEvidence: {
          campaignId: "referral-ask",
          score: 20,
          confidence: "high",
          factors: [
            {
              name: "prep_readiness",
              value: true,
              source: "eligibility",
              effect: 20,
              confidence: "high",
            },
          ],
          warnings: [],
        },
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
          unknownStopWorkReserveMinutes: null,
          usableMinutes: null,
          confidence: "low" as const,
          warnings: [],
        },
        isFallbackVariant: false,
        rankEvidence: {
          campaignId: "referral-ask",
          score: 20,
          confidence: "high",
          factors: [
            {
              name: "prep_readiness",
              value: true,
              source: "eligibility",
              effect: 20,
              confidence: "high",
            },
          ],
          warnings: [],
        },
      },
      explanation: "",
      intelligence: "deterministic" as const,
      ranking: [],
    };
    const result = await explainMissionPlan({ tenantId: "default", outcome });
    expect(Object.keys(result).sort()).toEqual(["explanation", "intelligence"]);
    expect(result.intelligence).toBe("deterministic_fallback");
    expect(result.explanation).toContain("Referral Ask");
    ENV.anthropicApiKey = savedKey;
  });
});

describe("Mission Director — learned outcomes in the planning fingerprint (Stage 1 Phase 3 e)", () => {
  const rankingContext = {
    businessDate: "2026-10-19",
    macroGoal: { metricKey: "active_customers", targetValue: 50, objective: "Get to 50 active customers" },
    openTasks: [],
  };
  const fp = (context: Parameters<typeof computePlanningFingerprint>[0]["rankingContext"]) =>
    computePlanningFingerprint({
      businessDate: "2026-10-19",
      fieldItemIds: ["stop-1"],
      fieldScheduledAts: ["2026-10-19T17:00:00.000Z"],
      campaigns: [],
      prepReady: {},
      rankingContext: context,
      commandFingerprint: "cmd",
      candidateFingerprint: "cand",
      executionConstraint: null,
    });
  const lesson = { outcomeId: "outcome-1", selectedRef: "work-x", result: "contradicted" as const, deltaIds: ["delta-1"] };

  it("with no lessons the fingerprint is the one stored plans already carry, so nothing re-plans or re-explains", () => {
    // Pinned from the code before this change, for the same inputs.
    expect(fp(rankingContext)).toBe("f0830b426d4fcd2f");
    expect(fp({ ...rankingContext, outcomeLessons: [] })).toBe("f0830b426d4fcd2f");
  });

  it("a new lesson changes it; another delta for an outcome already counted does not", () => {
    const one = fp({ ...rankingContext, outcomeLessons: [lesson] });
    expect(one).not.toBe("f0830b426d4fcd2f");
    expect(fp({ ...rankingContext, outcomeLessons: [{ ...lesson, deltaIds: ["delta-1", "delta-2"] }] })).toBe(one);
    expect(fp({ ...rankingContext, outcomeLessons: [lesson, { ...lesson, outcomeId: "outcome-2" }] })).not.toBe(one);
  });
});
