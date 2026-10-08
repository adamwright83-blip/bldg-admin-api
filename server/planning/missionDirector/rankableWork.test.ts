import { describe, expect, it } from "vitest";
import type { GrowthCampaign } from "../../campaignLibrary/campaignLibraryTypes";
import type { WeeklyGrowthCandidate } from "../../../shared/weeklyGrowthCandidates";
import { rankMissionDirectorWork } from "./rankableWork";

function candidate(
  id: string,
  title: string,
  objective: string,
  overrides: Partial<WeeklyGrowthCandidate> = {}
): WeeklyGrowthCandidate {
  return {
    id,
    sourceKind: "commercial_follow_up",
    motion: "commercial_follow_up",
    title,
    objective,
    alreadyInFlight: false,
    observedDueDate: null,
    sourceRefs: [
      {
        sourceKind: "commercial_follow_up",
        sourceType: "commercial_follow_up",
        sourceId: id,
      },
    ],
    provenance: {
      reader: "test",
      sourceType: "commercial_follow_up",
      sourceIds: [id],
      observedAt: "2026-10-05T12:00:00.000Z",
    },
    prep: { leadDays: 0, condition: null, feasibleWithinHorizon: true },
    fit: { pocketKind: null, minimumMinutes: null },
    observedSignals: [],
    assumptions: [],
    confidence: "high",
    rankReasons: [],
    ...overrides,
  };
}

const context = {
  businessDate: "2026-10-05",
  macroGoal: null,
  openTasks: [],
};

describe("Mission Director rankable work", () => {
  it("chooses a Challenge when today's execution constraint is desk/remote", () => {
    const field = candidate(
      "field",
      "Visit the property",
      "Visit the property in person",
      { motion: "account_acquisition" }
    );
    const desk = candidate(
      "desk",
      "Call the property",
      "Cold call the property manager"
    );
    const plan = rankMissionDirectorWork({
      candidates: [field, desk],
      campaigns: [],
      campaignPrepReady: {},
      context,
      pockets: [],
      executionConstraint: "challenge",
    });
    expect(plan.status).toBe("ranked");
    if (plan.status !== "ranked") return;
    expect(plan.primary.workId).toBe("desk");
    expect(plan.primary.executionType).toBe("challenge");
    expect(
      plan.ranking.find(item => item.workId === "field")?.blockedReasons
    ).toContain("EXECUTION_CLASS_UNAVAILABLE");
  });

  it("does not expose Hybrid Objective as the day's primary assignment", () => {
    const hybrid = candidate(
      "hybrid",
      "Visit then email",
      "Visit the property in person and email the manager"
    );
    const plan = rankMissionDirectorWork({
      candidates: [hybrid],
      campaigns: [],
      campaignPrepReady: {},
      context,
      pockets: [],
    });
    expect(plan.status).toBe("no_eligible_work");
    expect(plan.ranking[0]?.executionType).toBe("hybrid_objective");
    expect(plan.ranking[0]?.blockedReasons).toContain(
      "HYBRID_REQUIRES_ACTIONABLE_PHASE"
    );
  });

  it("lets due and continuity facts affect priority without source-class weighting", () => {
    const plain = candidate("aaa", "Email A", "Email account A");
    const due = candidate("zzz", "Email Z", "Email account Z", {
      observedDueDate: "2026-10-04",
    });
    const inFlight = candidate("mmm", "Email M", "Email account M", {
      alreadyInFlight: true,
    });
    const plan = rankMissionDirectorWork({
      candidates: [plain, due, inFlight],
      campaigns: [],
      campaignPrepReady: {},
      context,
      pockets: [],
    });
    expect(plan.status).toBe("ranked");
    expect(plan.ranking.filter(item => item.eligible).map(item => item.workId)).toEqual([
      "mmm",
      "zzz",
      "aaa",
    ]);
  });

  it("respects protected discretionary ownership by candidate lineage", () => {
    const protectedWork = candidate("stable-protected", "Call Dana", "Call Dana", {
      sourceRefs: [
        {
          sourceKind: "unfinished_growth_work",
          sourceType: "day_director_commitment",
          sourceId: "commit-1",
        },
      ],
    });
    const other = candidate("other", "Email someone else", "Email someone else");
    const plan = rankMissionDirectorWork({
      candidates: [other, protectedWork],
      campaigns: [],
      campaignPrepReady: {},
      context,
      pockets: [],
      protectDiscretionary: true,
      protectedSourceIds: ["commit-1"],
    });
    expect(plan.status).toBe("ranked");
    if (plan.status !== "ranked") return;
    expect(plan.primary.workId).toBe("stable-protected");
    expect(
      plan.ranking.find(item => item.workId === "other")?.blockedReasons
    ).toContain("DISCRETIONARY_TIME_PROTECTED");
  });

  it("does not let one task priority boost unrelated campaigns with the same task type", () => {
    const campaignA: GrowthCampaign = {
      id: "row-a",
      tenantId: "tenant",
      campaignId: "campaign-a",
      enabled: true,
      title: "Email A",
      objective: "Email account A",
      completionCondition: "Email account A",
      prepLeadDays: 0,
      prepCondition: null,
      pocketKind: "any",
      pocketMinutesMin: 0,
      fallbackVariant: null,
      autoVerifiable: [],
      selfReported: [],
      missionCategory: "account_acquisition",
      companionAbilityId: null,
      timingAssumptions: [],
      opsTaskType: "office_account_pitch",
      legacyContract: null,
      legacyContractRef: null,
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
    };
    const campaignB = { ...campaignA, id: "row-b", campaignId: "campaign-b", title: "Email B", objective: "Email account B", completionCondition: "Email account B" };
    const a = candidate("candidate-a", "Email A", "Email account A", {
      sourceRefs: [
        {
          sourceKind: "unfinished_growth_work",
          sourceType: "ops_task",
          sourceId: "task-a",
        },
        {
          sourceKind: "campaign_library",
          sourceType: "campaign_template",
          sourceId: "campaign-a",
        },
      ],
    });
    const b = candidate("candidate-b", "Email B", "Email account B", {
      sourceRefs: [
        {
          sourceKind: "campaign_library",
          sourceType: "campaign_template",
          sourceId: "campaign-b",
        },
      ],
    });
    const plan = rankMissionDirectorWork({
      candidates: [b, a],
      campaigns: [campaignA, campaignB],
      campaignPrepReady: { "campaign-a": true, "campaign-b": true },
      context: {
        ...context,
        openTasks: [
          {
            id: "task-a",
            taskType: "office_account_pitch",
            status: "open",
            priority: "high",
            dueAt: null,
          },
        ],
      },
      pockets: [],
    });
    expect(plan.status).toBe("ranked");
    if (plan.status !== "ranked") return;
    expect(plan.primary.workId).toBe("candidate-a");
    expect(
      plan.ranking
        .find(item => item.workId === "candidate-b")
        ?.factors.find(item => item.name === "explicit_operator_priority")
        ?.effect
    ).toBe(0);
  });

  it("requires Mission Director prep receipt truth for a campaign candidate", () => {
    const campaignCandidate = candidate(
      "wgc:tenant:campaign:campaign-1",
      "Visit Tower",
      "Visit Tower in person",
      {
        sourceKind: "campaign_library",
        sourceRefs: [
          {
            sourceKind: "campaign_library",
            sourceType: "campaign_template",
            sourceId: "campaign-1",
          },
        ],
      }
    );
    const campaign: GrowthCampaign = {
      id: "row-1",
      tenantId: "tenant",
      campaignId: "campaign-1",
      enabled: true,
      title: "Visit Tower",
      objective: "Visit Tower",
      completionCondition: "Visit Tower in person",
      prepLeadDays: 2,
      prepCondition: "Print materials",
      pocketKind: "any",
      pocketMinutesMin: 0,
      fallbackVariant: null,
      autoVerifiable: [],
      selfReported: [],
      missionCategory: "account_acquisition",
      companionAbilityId: null,
      timingAssumptions: [],
      opsTaskType: "office_account_pitch",
      legacyContract: null,
      legacyContractRef: null,
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
    };
    const plan = rankMissionDirectorWork({
      candidates: [campaignCandidate],
      campaigns: [campaign],
      campaignPrepReady: { "campaign-1": false },
      context,
      pockets: [],
    });
    expect(plan.status).toBe("no_eligible_work");
    expect(plan.ranking[0]?.blockedReasons).toContain("PREP_NOT_READY");
  });
});
