import { describe, expect, it } from "vitest";
import type { StrategyEvidence } from "../../shared/strategicIntelligence";
import { workThreadOpportunityKey, type StrategyOpportunity } from "../../shared/workThread";
import { prepareStrategicChallenge } from "./strategicChallenge";
import type { DiagnosisInput, DiagnosisMandate } from "./strategicDiagnosis";

const evidence = (id: string, value: number, over: Partial<StrategyEvidence> = {}): StrategyEvidence => ({
  id,
  tenantId: "t",
  source: "test",
  capturedAt: "2026-10-19T16:00:00.000Z",
  classification: "verified",
  value,
  unit: "count",
  quality: "complete",
  description: "test evidence",
  ...over,
});

const goal = { id: "operator_macro_goals:g1", statement: "Get to 50 active customers", metricKey: "active_customers", baseMetricKey: "active_customers", area: null, primary: false };
const doctrine = (over: Record<string, { value: number | string; origin: "operator_doctrine" | "system_default" }> = {}) =>
  Object.entries({
    minPriorOrders: { value: 2, origin: "system_default" as const },
    maxRecoveryPerDay: { value: 2, origin: "system_default" as const },
    ...over,
  }).map(([key, c]) => ({ id: `claire_operator_doctrine:t:op:${key}`, key, value: c.value, origin: c.origin, statement: `${key} = ${c.value}` }));

const mandate = (over: Partial<DiagnosisMandate> = {}): DiagnosisMandate => ({
  revision: "mandate_x",
  outcomes: [goal],
  leadingOutcomeId: goal.id,
  primaryOutcomeId: null,
  focus: { id: "operating_mandate_decisions:m1", area: "silver_lake", confirmation: "confirmed" },
  method: {
    id: "operating_mandate_decisions:m1",
    lever: "acquisition",
    population: "new_customers",
    area: "silver_lake",
    statement: "Find new Silver Lake customers door to door",
    outcomeId: goal.id,
  },
  unresolvedConflicts: [],
  notes: [],
  constraints: doctrine(),
  ...over,
});

type Focus = NonNullable<DiagnosisInput["focus"]>;
const focus = (over: Partial<Focus> = {}): Focus => ({
  statement: "Find new Silver Lake customers door to door",
  area: "Silver Lake",
  evidenceRef: "operating_mandate_decisions:m1",
  windowDays: 90,
  sales: 8000,
  priorSales: 9000,
  orders: 2,
  priorOrders: 3,
  salesRef: "objective_area_sales:t",
  dormant: 4,
  dormantRef: "objective_area_dormant:t",
  dormantTop: [],
  dormantMembers: [
    { identityKey: "cleancloud:c2", name: "Bea Lund", lastOrderDate: "2026-08-05", revenueCents: 18300, paidOrders: 3, matched: true },
    { identityKey: "cleancloud:c1", name: "Alma Reyes", lastOrderDate: "2026-07-16", revenueCents: 14400, paidOrders: 3, matched: true },
    { identityKey: "cleancloud:c9", name: "Fay Ng", lastOrderDate: "2026-07-01", revenueCents: 2000, paidOrders: 1, matched: true },
    { identityKey: null, name: "Walk-in", lastOrderDate: "2026-06-01", revenueCents: 1500, paidOrders: 1, matched: false },
  ],
  figuresVerified: true,
  confirmation: "confirmed",
  ...over,
});

const methodOpportunity: StrategyOpportunity = { kind: "strategy_opportunity", verticalKey: "laundry_fluff_fold", lever: "acquisition", population: "new_customers", area: "silver_lake" };
const alternativeOpportunity: StrategyOpportunity = { ...methodOpportunity, lever: "retention", population: "lapsed_customers" };

function input(over: Partial<Parameters<typeof prepareStrategicChallenge>[0]> = {}): Parameters<typeof prepareStrategicChallenge>[0] {
  return {
    verticalKey: "laundry_fluff_fold",
    mandate: mandate(),
    focus: focus(),
    focusKey: "silver_lake",
    methodHeldReason: null,
    methodFitsFocus: true,
    revisitingFailedHypothesis: false,
    evidencePlan: { driver: "retention", chosen: "Win back lapsed Silver Lake customers", population: "lapsed_customers" },
    outcomes: [],
    byId: new Map([
      ["objective_area_dormant:t", evidence("objective_area_dormant:t", 4)],
      ["snap:new_customers_30d", evidence("snap:new_customers_30d", 2)],
    ]),
    metrics: { new_customers_30d: "snap:new_customers_30d" },
    workThreadIds: { [workThreadOpportunityKey(methodOpportunity)]: "thread-method", [workThreadOpportunityKey(alternativeOpportunity)]: "thread-win-back" },
    methodOpportunity,
    observationWindowDays: 14,
    ...over,
  };
}

describe("evidence-backed strategic challenge", () => {
  it("challenges a stated method with the goal, the thread, evidence both ways, a real cohort and what needs approval", () => {
    const result = prepareStrategicChallenge(input());
    if (!result || !("challenge" in result)) throw new Error("expected a challenge");
    const c = result.challenge;
    expect(c.status).toBe("raised");
    expect(c.id).toMatch(/^challenge_[0-9a-f]{40}$/);
    expect(c.statedMethod).toEqual({ id: "operating_mandate_decisions:m1", statement: "Find new Silver Lake customers door to door", lever: "acquisition", population: "new_customers", area: "silver_lake" });
    expect(c.outcome).toEqual({ id: goal.id, statement: goal.statement });
    expect(c.workThreadId).toBe("thread-method");
    expect(c.evidenceFor).toEqual([{ ref: "snap:new_customers_30d", statement: expect.stringMatching(/^2 new customers in the last 30 days/) }]);
    expect(c.evidenceAgainst[0]).toEqual({ ref: "objective_area_dormant:t", statement: expect.stringMatching(/^4 Silver Lake customers ordered before.*2 can be followed up/) });
    expect(c.alternative).toMatchObject({ approach: "Win back lapsed Silver Lake customers", opportunity: alternativeOpportunity, workThreadId: "thread-win-back" });
    expect(c.alternative.cohort.members.map(m => m.identityKey)).toEqual(["cleancloud:c2", "cleancloud:c1"]);
    expect(c.alternative.cohort.exclusions).toEqual([
      { identityKey: "cleancloud:c9", displayName: "Fay Ng", reason: "Fewer than 2 paid orders (the default rule).", constraintRef: "claire_operator_doctrine:t:op:minPriorOrders" },
      { identityKey: null, displayName: "Walk-in", reason: expect.stringMatching(/^No customer identity/), constraintRef: null },
    ]);
    expect(c.alternative.nextMeasurableAction).toMatch(/^If you choose it: contact up to 2 a day/);
    expect(c.autonomy.preparedWithoutApproval.join(" ")).not.toMatch(/contact|send|spend/i);
    expect(c.autonomy.requiresApproval).toEqual([
      "Switching from your approach (Find new Silver Lake customers door to door) to this one",
      "Contacting anyone on the list",
      "Any offer, discount or spend",
    ]);
    // No return is estimated anywhere in it.
    expect(JSON.stringify(c)).not.toMatch(/\$|ROI|return on|will (earn|make|generate)/i);
    expect(c.uncertainty).toContain("Neither approach has been measured for this business, so their results cannot be compared yet; no return is estimated.");
  });

  it("is deterministic in what it rests on, and changes when the cohort does", () => {
    const one = prepareStrategicChallenge(input()) as { challenge: { id: string } };
    const again = prepareStrategicChallenge(input({ byId: new Map([...input().byId].reverse()) })) as { challenge: { id: string } };
    expect(again.challenge.id).toBe(one.challenge.id);
    const fewer = prepareStrategicChallenge(input({ focus: focus({ dormantMembers: focus().dormantMembers!.slice(1) }) })) as { challenge: { id: string } };
    expect(fewer.challenge.id).not.toBe(one.challenge.id);
  });

  it("says nothing without a stated method, and abstains with the reason otherwise", () => {
    expect(prepareStrategicChallenge(input({ mandate: mandate({ method: null }) }))).toBeNull();
    const reason = (over: Partial<Parameters<typeof prepareStrategicChallenge>[0]>) =>
      (prepareStrategicChallenge(input(over)) as { abstained: { reason: string } }).abstained.reason;
    expect(reason({ methodHeldReason: "the business has a capacity constraint" })).toBe("method_on_hold");
    expect(reason({ revisitingFailedHypothesis: true })).toBe("method_on_hold");
    expect(reason({ methodFitsFocus: false })).toBe("insufficient_evidence");
    expect(
      reason({ mandate: mandate({ method: { ...mandate().method!, lever: "retention", population: "lapsed_customers", statement: "Win back lapsed Silver Lake customers" } }) })
    ).toBe("method_matches_evidence");
    expect(reason({ evidencePlan: { driver: "acquisition", chosen: "Find new Silver Lake customers", population: "new_customers" } })).toBe("method_matches_evidence");
    expect(reason({ byId: new Map([["objective_area_dormant:t", evidence("objective_area_dormant:t", 4, { quality: "partial" })]]) })).toBe("insufficient_evidence");
    expect(
      reason({
        outcomes: [{ id: "o1", actionDriver: "retention", result: "contradicted", evidenceRef: "goal_cycle_outcomes:o1" }],
        byId: new Map([...input().byId, ["goal_cycle_outcomes:o1", evidence("goal_cycle_outcomes:o1", 1)]]),
      })
    ).toBe("alternative_contradicted");
  });

  it("lets the operator's confirmed constraints decide first", () => {
    const skip = prepareStrategicChallenge(
      input({ mandate: mandate({ constraints: [...doctrine(), { id: "claire_operator_doctrine:t:op:skipSalesUntil", key: "skipSalesUntil", value: "2026-11-01", origin: "operator_doctrine", statement: "No sales outreach until 2026-11-01 (vacation)." }] }) })
    );
    expect(skip).toEqual({
      abstained: {
        reason: "constraint_precludes_alternative",
        detail: "No sales outreach until 2026-11-01 (vacation). Winning customers back means contacting them, so it is not proposed.",
        constraintRefs: ["claire_operator_doctrine:t:op:skipSalesUntil"],
      },
    });
    const strict = prepareStrategicChallenge(input({ mandate: mandate({ constraints: doctrine({ minPriorOrders: { value: 4, origin: "operator_doctrine" } }) }) }));
    expect(strict).toMatchObject({ abstained: { reason: "constraint_precludes_alternative", constraintRefs: ["claire_operator_doctrine:t:op:minPriorOrders"] } });
    const yours = prepareStrategicChallenge(input({ mandate: mandate({ constraints: doctrine({ minPriorOrders: { value: 3, origin: "operator_doctrine" } }) }) })) as {
      challenge: { alternative: { cohort: { members: Array<{ identityKey: string }>; exclusions: Array<{ displayName: string; reason: string }> } } };
    };
    expect(yours.challenge.alternative.cohort.members.map(m => m.identityKey)).toEqual(["cleancloud:c2", "cleancloud:c1"]);
    expect(yours.challenge.alternative.cohort.exclusions[0]).toMatchObject({ displayName: "Fay Ng", reason: "Fewer than 3 paid orders (your rule)." });
  });
});
