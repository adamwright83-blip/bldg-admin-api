import { describe, expect, it } from "vitest";
import type { WeeklyGrowthCandidate } from "../../../shared/weeklyGrowthCandidates";
import type { RankingContext, RankingOutcome } from "./missionRank";
import { rankMissionDirectorWork } from "./rankableWork";

function candidate(id: string, overrides: Partial<WeeklyGrowthCandidate>): WeeklyGrowthCandidate {
  return {
    id,
    sourceKind: "strategy_diagnosis",
    motion: "retention",
    title: id,
    objective: `Do ${id}`,
    alreadyInFlight: false,
    observedDueDate: null,
    sourceRefs: [{ sourceKind: "strategy_diagnosis", sourceType: "strategic_diagnosis", sourceId: id }],
    provenance: { reader: "test", sourceType: "strategic_diagnosis", sourceIds: [id], observedAt: "2026-10-05T12:00:00.000Z" },
    prep: { leadDays: 0, condition: null, feasibleWithinHorizon: true },
    fit: { pocketKind: null, minimumMinutes: null },
    observedSignals: [],
    assumptions: [],
    confidence: "high",
    rankReasons: [],
    ...overrides,
  };
}

const customers: RankingOutcome = { id: "operator_macro_goals:customers", metricKey: "active_customers", area: null, primary: false, statement: "Get to 50 active customers" };
const silverLake: RankingOutcome = { id: "operator_macro_goals:silver", metricKey: "net_sales_per_period", area: "silver_lake", primary: false, statement: "$2,000 a month in Silver Lake" };

function alignment(context: RankingContext, work: WeeklyGrowthCandidate) {
  // Alignment is scored whether or not the work is eligible today.
  const plan = rankMissionDirectorWork({ candidates: [work], campaigns: [], campaignPrepReady: {}, context, pockets: [] });
  return plan.ranking[0]!.factors.find(f => f.name === "macro_goal_alignment")!;
}

const base = { businessDate: "2026-10-05", openTasks: [] };
const areaWinBack = candidate("area-win-back", { motion: "retention", scopeArea: "silver_lake" });
const recovery = candidate("recovery", { motion: "customer_recovery", sourceKind: "customer_recovery" });

describe("Mission Director goal alignment from the operating mandate", () => {
  it("one business-wide goal ranks exactly as the single legacy goal did", () => {
    const legacy = alignment({ ...base, macroGoal: { metricKey: "active_customers", targetValue: 50, objective: customers.statement } }, recovery);
    const mandate = alignment({ ...base, macroGoal: { metricKey: "active_customers", targetValue: 50, objective: customers.statement }, outcomes: [customers] }, recovery);
    expect(mandate).toEqual(legacy);
    expect(mandate).toMatchObject({ value: "active_customers:customer_recovery:direct_fast", effect: 180 });
  });

  it("with two goals and none first, work earns its strongest alignment; an area goal credits only work in its area", () => {
    const context: RankingContext = { ...base, macroGoal: null, outcomes: [customers, silverLake] };
    expect(alignment(context, areaWinBack)).toMatchObject({ value: "net_sales_per_period@silver_lake:retention:direct_fast", effect: 180 });
    // Business-wide work is never assumed to land in Silver Lake.
    expect(alignment(context, candidate("anywhere", { motion: "retention" }))).toMatchObject({ value: "active_customers:retention:protects", effect: 90 });
    expect(alignment(context, recovery)).toMatchObject({ value: "active_customers:customer_recovery:direct_fast", effect: 180 });
  });

  it("a confirmed primary halves only the goals that are not first", () => {
    const silverFirst: RankingContext = { ...base, macroGoal: null, outcomes: [customers, { ...silverLake, primary: true }] };
    expect(alignment(silverFirst, areaWinBack)).toMatchObject({ value: "net_sales_per_period@silver_lake:retention:direct_fast", effect: 180 });
    expect(alignment(silverFirst, recovery)).toMatchObject({ value: "active_customers:customer_recovery:direct_fast:not_primary", effect: 90 });
    const customersFirst: RankingContext = { ...base, macroGoal: null, outcomes: [{ ...customers, primary: true }, silverLake] };
    expect(alignment(customersFirst, recovery)).toMatchObject({ effect: 180 });
    expect(alignment(customersFirst, areaWinBack)).toMatchObject({ value: "active_customers:retention:protects", effect: 90 });
  });

  it("an area goal alone never credits work outside its area", () => {
    const context: RankingContext = { ...base, macroGoal: null, outcomes: [silverLake] };
    expect(alignment(context, recovery)).toMatchObject({ value: false, effect: 0 });
  });
});
