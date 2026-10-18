import { describe, expect, it } from "vitest";
import type { StrategyEvidence } from "../../shared/strategicIntelligence";
import {
  normalizeAreaKey,
  workThreadCandidateId,
  workThreadIdFromCandidateId,
  workThreadOpportunityKey,
  type StrategyOpportunity,
} from "../../shared/workThread";
import { diagnosisCandidates } from "./strategicCandidateAdapter";
import { assembleStrategicDiagnosis, type DiagnosisInput } from "./strategicDiagnosis";
import { defaultVerticalRegistry } from "./verticalTemplates/defaultRegistry";

/**
 * Phase 2 · Slice A, pure half: which changes keep an opportunity's key and
 * which make a different opportunity. The durable identity itself (minting,
 * reuse, generations) is proven on MySQL in workThreadIdentity.mysql.integration.test.ts.
 */
const now = new Date("2026-10-14T20:00:00Z");
const at = now.toISOString();
const e = (id: string, value: number | string, quality: StrategyEvidence["quality"] = "complete"): StrategyEvidence => ({
  id, tenantId: "t", source: "test", capturedAt: at,
  classification: quality === "complete" ? "verified" : "estimate",
  value, unit: id, quality, description: id,
});
const focus = (over: Partial<NonNullable<DiagnosisInput["focus"]>> = {}): NonNullable<DiagnosisInput["focus"]> => ({
  statement: "Maximize sales in Silver Lake", area: "Silver Lake", evidenceRef: "objective", windowDays: 90,
  sales: 103000, priorSales: 190000, orders: 13, priorOrders: 26, salesRef: "area_sales",
  dormant: 2, dormantRef: "area_dormant",
  dormantTop: [{ name: "Bea Lund", lastOrderDate: "2026-08-01", revenueCents: 18300 }, { name: "Alma Reyes", lastOrderDate: "2026-07-11", revenueCents: 14400 }],
  figuresVerified: false,
  ...over,
});
const input = (over: Partial<DiagnosisInput> = {}): DiagnosisInput => ({
  tenantId: "t", canonicalOperatorId: "op", verticalKey: "laundry_fluff_fold", businessDate: "2026-10-14", now,
  goal: { statement: "Get to 50 active customers", metricKey: "active_customers", target: 50, current: null, evidenceRef: "goal" },
  evidence: [e("goal", "g"), e("objective", "objective"), e("area_sales", 103000), e("area_dormant", 2)],
  metrics: {},
  market: { tenantId: "t", mode: "physical", territories: [], observations: [], limitations: [] },
  outcomes: [], commitments: [],
  focus: focus(),
  ...over,
});
const diagnose = (over: Partial<DiagnosisInput> = {}) => assembleStrategicDiagnosis(input(over), defaultVerticalRegistry);
const keyOf = (d: ReturnType<typeof diagnose>) => workThreadOpportunityKey(d.actions[0]!.opportunity!);

describe("Work Thread opportunity key", () => {
  it("the Silver Lake win-back is one opportunity, scoped by structure", () => {
    const d = diagnose();
    expect(d.quality.structuralErrors).toEqual([]);
    expect(d.actions[0]!.title).toBe("Win back lapsed Silver Lake customers");
    expect(d.actions[0]!.opportunity).toEqual({
      kind: "strategy_opportunity",
      verticalKey: "laundry_fluff_fold",
      lever: "retention",
      population: "lapsed_customers",
      area: "silver_lake",
    });
    expect(keyOf(d)).toBe("strategy:v1:laundry_fluff_fold:retention:lapsed_customers:area=silver_lake");
  });

  it("restated focus, a changed target list and fresh evidence keep the key; the diagnosis id still changes", () => {
    const first = diagnose();
    const restated = diagnose({
      now: new Date(now.getTime() + 3_600_000),
      focus: focus({
        statement: "Grow Silver Lake revenue",
        dormant: 3,
        dormantTop: [...focus().dormantTop, { name: "Ellis Park", lastOrderDate: "2026-07-01", revenueCents: 9000 }],
      }),
      evidence: [e("goal", "g"), e("objective", "restated"), e("area_sales", 99000), e("area_dormant", 3)],
    });
    expect(restated.id).not.toBe(first.id);
    expect(restated.diagnosis).not.toBe(first.diagnosis);
    expect(restated.actions[0]!.completionCondition).not.toBe(first.actions[0]!.completionCondition);
    expect(keyOf(restated)).toBe(keyOf(first));
  });

  it("a contradicted hypothesis changes the tactic, not the opportunity", () => {
    const contradicted = diagnose({
      evidence: [e("goal", "g"), e("objective", "objective"), e("area_sales", 103000), e("area_dormant", 2), e("goal_cycle_outcomes:o1", "hypothesis_contradicted")],
      outcomes: [{ id: "o1", actionDriver: "retention", result: "contradicted", evidenceRef: "goal_cycle_outcomes:o1" }],
    });
    expect(contradicted.primaryConstraint).toBe("investigation");
    expect(contradicted.actions[0]!.title).toBe("Review the contradicted strategic hypothesis and compare a different mechanism");
    expect(keyOf(contradicted)).toBe(keyOf(diagnose()));
  });

  it("a different neighborhood, lever or population is a different opportunity", () => {
    const silverLake = keyOf(diagnose());
    // Same lever and population, different neighborhood.
    const echoPark = keyOf(diagnose({ focus: focus({ statement: "Maximize sales in Echo Park", area: "Echo Park" }) }));
    // Same neighborhood, no lapsed customers: acquisition of new customers.
    const acquire = diagnose({ focus: focus({ dormant: 0, dormantTop: [] }) });
    // No focus: the business-wide recovery program.
    const businessWide = diagnose({
      focus: undefined,
      evidence: [e("goal", "g"), e("net_sales_cents", 150000), e("prior_net_sales_cents", 200000), e("dormant_customers", 9)],
      metrics: { net_sales_cents: "net_sales_cents", prior_net_sales_cents: "prior_net_sales_cents", dormant_customers: "dormant_customers" },
    });
    // A stale sales source.
    const outage = diagnose({
      focus: undefined,
      evidence: [e("goal", "g"), e("gap", "CleanCloud stale")],
      sourceGaps: { evidenceRef: "gap", description: "CleanCloud stale" },
    });
    expect(acquire.actions[0]!.opportunity).toMatchObject({ lever: "acquisition", population: "new_customers", area: "silver_lake" });
    expect(businessWide.actions[0]!.opportunity).toMatchObject({ lever: "retention", population: "lapsed_customers", area: null });
    expect(outage.actions[0]!.opportunity).toMatchObject({ lever: "investigation", population: "sales_source", area: null });
    const keys = [silverLake, echoPark, keyOf(acquire), keyOf(businessWide), keyOf(outage)];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("a resolved thread is stamped on the action and becomes the candidate id; pre-thread diagnoses keep theirs", () => {
    const unthreaded = diagnose();
    const key = keyOf(unthreaded);
    const threaded = diagnose({ workThreadIds: { [key]: "thread-1" } });
    expect(threaded.actions[0]!.workThreadId).toBe("thread-1");
    expect(threaded.id).not.toBe(unthreaded.id);
    const [candidate] = diagnosisCandidates(threaded, now);
    expect(candidate!.id).toBe("work_thread:thread-1");
    expect(candidate!.workThreadId).toBe("thread-1");
    expect(candidate!.sourceRefs).toEqual([{ sourceKind: "strategy_diagnosis", sourceType: "strategic_diagnosis", sourceId: threaded.id }]);
    const [legacy] = diagnosisCandidates(unthreaded, now);
    expect(legacy!.id).toBe(`${unthreaded.id}:strategy-retention`);
    expect(legacy!.workThreadId).toBeUndefined();
  });

  it("normalizes labels, never reads wording, and only parses thread candidate ids", () => {
    expect(normalizeAreaKey("in Silver Lake")).toBe("silver_lake");
    expect(normalizeAreaKey(" Silver   Lake ")).toBe("silver_lake");
    expect(normalizeAreaKey("")).toBeNull();
    const opportunity: StrategyOpportunity = { kind: "strategy_opportunity", verticalKey: "laundry_fluff_fold", lever: "retention", population: "lapsed_customers", area: "Silver Lake" };
    expect(workThreadOpportunityKey(opportunity)).toBe(workThreadOpportunityKey({ ...opportunity, area: "silver_lake" }));
    expect(workThreadOpportunityKey({ kind: "work_subject", subjectRef: "wgc:t:day_director_commitment:c1" })).toBe("work:v1:wgc:t:day_director_commitment:c1");
    expect(() => workThreadOpportunityKey({ kind: "work_subject", subjectRef: " " })).toThrow();
    expect(workThreadIdFromCandidateId(workThreadCandidateId("abc"))).toBe("abc");
    expect(workThreadIdFromCandidateId("diagnosis_123:strategy-retention")).toBeNull();
    expect(workThreadIdFromCandidateId("work_thread:")).toBeNull();
  });
});
