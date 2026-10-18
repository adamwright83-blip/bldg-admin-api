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

  it("carried-forward approved work keeps its stored execution type instead of text classification", () => {
    const carried = candidate(
      "carried",
      "Recover lapsed customers",
      "Recover lapsed customers",
      { motion: "customer_recovery", storedExecutionType: "mission", alreadyInFlight: true }
    );
    const unstored = candidate("unstored", "Recover lapsed customers", "Recover lapsed customers", {
      motion: "customer_recovery",
    });
    const plan = rankMissionDirectorWork({
      candidates: [carried, unstored],
      campaigns: [],
      campaignPrepReady: {},
      context,
      pockets: [],
    });
    const carriedRank = plan.ranking.find(item => item.workId === "carried")!;
    expect(carriedRank.executionType).toBe("mission");
    expect(carriedRank.blockedReasons).not.toContain("EXECUTION_TYPE_UNKNOWN");
    expect(plan.ranking.find(item => item.workId === "unstored")!.blockedReasons).toContain("EXECUTION_TYPE_UNKNOWN");
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

describe("stale overdue urgency", () => {
  it("recent overdue work keeps its urgency; work overdue for weeks does not outrank current work", () => {
    const ctx = { businessDate: "2026-10-14", macroGoal: null, openTasks: [] };
    const stale = candidate("stale", "The Louise", "Email Dana (due Aug 7, 3:00 PM)", { observedDueDate: "2026-08-07" });
    const recent = candidate("recent", "Text Andrew", "Text Andrew", { observedDueDate: "2026-10-10" });
    const plan = rankMissionDirectorWork({ candidates: [stale, recent], campaigns: [], campaignPrepReady: {}, context: ctx, pockets: [] });
    const due = (id: string) => plan.ranking.find(r => r.workId === id)!.factors.find(f => f.name === "due_work")!;
    expect(due("recent").effect).toBe(200);
    expect(due("stale").effect).toBe(0);
    expect(plan.ranking.find(r => r.workId === "stale")!.eligible).toBe(true);
  });
});

describe("ranking by contribution to the operator's goal", () => {
  const goalContext = (metricKey: string) => ({
    businessDate: "2026-10-17",
    macroGoal: { metricKey, targetValue: 50, objective: `${metricKey} goal` },
    openTasks: [],
  });
  const desk = "Text the customer from the operator's phone";
  const recovery = candidate("recovery", "Win back a lapsed regular", desk, { sourceKind: "customer_recovery", motion: "customer_recovery" });
  const referral = candidate("referral", "Ask a regular for a referral", desk, { sourceKind: "campaign_library", motion: "relationship_capital" });
  const retention = candidate("retention", "Check in with a cooling regular", desk, { sourceKind: "customer_recovery", motion: "retention" });
  const followUp = candidate("followup", "Follow up the property manager", "Cold call the property manager", { motion: "commercial_follow_up" });
  const rank = (metricKey: string, candidates: WeeklyGrowthCandidate[]) => {
    const plan = rankMissionDirectorWork({ candidates, campaigns: [], campaignPrepReady: {}, context: goalContext(metricKey), pockets: [] });
    if (plan.status !== "ranked") throw new Error(plan.status);
    return plan;
  };
  const goalEffect = (plan: ReturnType<typeof rank>, id: string) =>
    plan.ranking.find(item => item.workId === id)?.factors.find(f => f.name === "macro_goal_alignment");

  it("puts winning back a lapsed customer ahead of a referral ask for an active-customers goal", () => {
    const plan = rank("active_customers", [referral, retention, recovery]);
    expect(plan.primary.workId).toBe("recovery");
    expect(goalEffect(plan, "recovery")).toMatchObject({ effect: 180, value: "active_customers:customer_recovery:direct_fast" });
    expect(goalEffect(plan, "retention")?.effect).toBe(90);
    expect(goalEffect(plan, "referral")?.effect).toBe(50);
    expect(goalEffect(plan, "recovery")?.source).toMatch(/^goal-contribution-v1: /);
  });

  it("puts an account already in conversation ahead of a lapsed customer for a new-customers goal", () => {
    const plan = rank("new_paying_customers", [recovery, followUp]);
    expect(plan.primary.workId).toBe("followup");
    expect(goalEffect(plan, "recovery")?.effect).toBe(50);
  });

  it("gives no goal weight without an active goal or for work that does not move the metric", () => {
    const noGoal = rankMissionDirectorWork({ candidates: [recovery], campaigns: [], campaignPrepReady: {}, context, pockets: [] });
    if (noGoal.status !== "ranked") throw new Error(noGoal.status);
    expect(noGoal.ranking[0].factors.find(f => f.name === "macro_goal_alignment")).toMatchObject({ effect: 0, value: false });
    const reputation = candidate("reviews", "Ask for reviews", desk, { motion: "reputation" });
    expect(goalEffect(rank("active_customers", [reputation]), "reviews")?.effect).toBe(0);
  });
});

describe("Mission Director ranking consumes learned outcomes (Stage 1 Phase 3 e)", () => {
  const desk = "Call the customer";
  const x = candidate("work-x", "Call customer X", desk, {
    sourceRefs: [
      { sourceKind: "commercial_follow_up", sourceType: "commercial_follow_up", sourceId: "work-x" },
      { sourceKind: "proactive_obligation", sourceType: "proactive_obligation", sourceId: "obligation-x" },
    ],
    alreadyInFlight: true,
  });
  const y = candidate("work-y", "Call customer Y", desk, { observedDueDate: "2026-10-05" });
  const lesson = (selectedRef: string, result: "supported" | "contradicted", n: number) => ({
    outcomeId: `outcome-${selectedRef}-${result}-${n}`,
    selectedRef,
    result,
    deltaIds: [`delta-${n}`],
  });
  const rank = (outcomeLessons?: ReturnType<typeof lesson>[]) => {
    const plan = rankMissionDirectorWork({
      candidates: [x, y],
      campaigns: [],
      campaignPrepReady: {},
      context: outcomeLessons ? { ...context, outcomeLessons } : context,
      pockets: [],
    });
    if (plan.status !== "ranked") throw new Error(plan.status);
    return plan;
  };
  const learning = (plan: ReturnType<typeof rank>, id: string) =>
    plan.ranking.find(item => item.workId === id)?.factors.find(f => f.name === "outcome_learning_delta");

  it("with no lessons, ranking is exactly what it was", () => {
    const before = rank();
    expect(before.primary.workId).toBe("work-x");
    expect(rank([])).toEqual(before);
    expect(rank([lesson("someone-else", "contradicted", 1)])).toEqual(before);
    expect(learning(before, "work-x")).toBeUndefined();
  });

  it("a contradicted lesson demotes the work behind an eligible alternative, without forbidding it", () => {
    const plan = rank([lesson("work-x", "contradicted", 1)]);
    expect(plan.primary.workId).toBe("work-y");
    const demoted = plan.ranking.find(item => item.workId === "work-x")!;
    expect(demoted.eligible).toBe(true);
    expect(learning(plan, "work-x")).toMatchObject({ effect: -300, value: "contradicted:1,supported:0", confidence: "high" });
    // Matched through the obligation it was selected as, too, and bounded.
    const repeated = rank([1, 2, 3].map(n => lesson("obligation-x", "contradicted", n)));
    expect(learning(repeated, "work-x")?.effect).toBe(-600);
  });

  it("a supported lesson gives a small boost, capped", () => {
    expect(learning(rank([lesson("work-y", "supported", 1)]), "work-y")).toMatchObject({ effect: 60, confidence: "low" });
    const capped = rank([1, 2, 3, 4].map(n => lesson("work-y", "supported", n)));
    expect(learning(capped, "work-y")?.effect).toBe(120);
    const score = (plan: ReturnType<typeof rank>) => plan.ranking.find(item => item.workId === "work-y")!.score;
    expect(score(capped) - score(rank())).toBe(120);
  });
});
