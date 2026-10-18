import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DEFAULT_DOCTRINE } from "./claireProactive";
import {
  appliedMandateFocus,
  assertOutcomeMetricKey,
  attributeMandateEvidence,
  outcomeContribution,
  parseOutcomeMetricKey,
  resolveOperatingMandate,
  scopedOutcomeMetricKey,
  statedMandateMethod,
  type MandateDecisionPayload,
  type MandateDecisionRecord,
  type MandateGoalSource,
  type MandateSources,
} from "./operatingMandate";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

const goal = (id: string, over: Partial<MandateGoalSource> = {}): MandateGoalSource => ({
  id,
  operatorUserId: "op",
  objective: "Get to 50 active customers",
  metricKey: "active_customers",
  targetValue: 50,
  unit: "customers",
  targetDate: "2027-01-15",
  source: "operator_attested",
  status: "active",
  supersededById: null,
  createdAt: "2026-07-01T10:00:00.000Z",
  updatedAt: "2026-07-01T10:00:00.000Z",
  ...over,
});

let seq = 0;
const decision = (payload: MandateDecisionPayload, decidedAt: string, over: Partial<MandateDecisionRecord> = {}): MandateDecisionRecord => ({
  id: `d${++seq}`,
  tenantId: "t",
  canonicalOperatorId: "op",
  kind: payload.kind,
  subjectKey: payload.kind === "focus" ? `focus:${payload.area}` : payload.kind,
  payload,
  status: "active",
  supersedesId: null,
  supersededById: null,
  decidedByOpenId: "op-open",
  source: "authenticated_app",
  decidedAt,
  ...over,
});

const silverLake = { key: "silver_lake", label: "Silver Lake" };
const echoPark = { key: "echo_park", label: "Echo Park" };

const sources = (over: Partial<MandateSources> = {}): MandateSources => ({
  tenantId: "t",
  canonicalOperatorId: "op",
  verticalKey: "laundry_fluff_fold",
  areaPlanning: true,
  businessDate: "2026-10-19",
  goals: [goal("g1")],
  remarks: [],
  decisions: [],
  doctrine: null,
  threads: [],
  commitments: [],
  areaOrders: {},
  ...over,
});

describe("outcome metric scope", () => {
  it("keeps unscoped keys and parses supported area scopes", () => {
    expect(parseOutcomeMetricKey("active_customers")).toEqual({ baseMetricKey: "active_customers", area: null });
    expect(parseOutcomeMetricKey("net_sales_per_period@area:silver_lake")).toEqual({ baseMetricKey: "net_sales_per_period", area: "silver_lake" });
    expect(scopedOutcomeMetricKey("paid_orders_per_period", "echo_park")).toBe("paid_orders_per_period@area:echo_park");
  });

  it("rejects scopes nothing can measure", () => {
    expect(parseOutcomeMetricKey("active_customers@area:silver_lake")).toBeNull();
    expect(parseOutcomeMetricKey("net_sales_per_period@area:Silver Lake")).toBeNull();
    expect(() => scopedOutcomeMetricKey("active_customers", "silver_lake")).toThrow(/cannot be limited/);
    expect(() => assertOutcomeMetricKey("net_sales_per_period@area:")).toThrow(/Unsupported/);
  });

  it("credits an area goal only with work in that area", () => {
    const area = { baseMetricKey: "net_sales_per_period", area: "silver_lake" };
    expect(outcomeContribution(area, { motion: "retention", area: "silver_lake" })?.tier).toBe("direct_fast");
    expect(outcomeContribution(area, { motion: "retention", area: null })).toBeNull();
    expect(outcomeContribution(area, { motion: "retention", area: "echo_park" })).toBeNull();
    expect(outcomeContribution({ baseMetricKey: "active_customers", area: null }, { motion: "retention", area: "echo_park" })?.tier).toBe("protects");
  });
});

describe("resolveOperatingMandate: outcomes", () => {
  it("addresses the only goal without calling it primary", () => {
    const m = resolveOperatingMandate(sources(), sha);
    expect(m.outcomes.map(o => o.id)).toEqual(["operator_macro_goals:g1"]);
    expect(m.primaryOutcomeId).toBeNull();
    expect(m.leadingOutcome).toEqual({ id: "operator_macro_goals:g1", basis: "sole_outcome" });
    expect(m.conflicts).toEqual([]);
  });

  it("keeps every active goal, never picks one by recency, and names the competition", () => {
    const m = resolveOperatingMandate(
      sources({
        goals: [
          goal("g2", { objective: "$2,000 a month in Silver Lake", metricKey: "net_sales_per_period@area:silver_lake", targetValue: 2000, unit: "USD", createdAt: "2026-10-10T10:00:00.000Z", updatedAt: "2026-10-10T10:00:00.000Z" }),
          goal("g1"),
        ],
      }),
      sha
    );
    expect(m.outcomes.map(o => [o.id, o.baseMetricKey, o.area])).toEqual([
      ["operator_macro_goals:g1", "active_customers", null],
      ["operator_macro_goals:g2", "net_sales_per_period", "silver_lake"],
    ]);
    expect(m.leadingOutcome).toBeNull();
    expect(m.primaryOutcomeId).toBeNull();
    const competing = m.conflicts.find(c => c.kind === "competing_outcomes")!;
    expect(competing).toMatchObject({ status: "unresolved", resource: "daily_primary_work", refs: ["operator_macro_goals:g1", "operator_macro_goals:g2"] });
    expect(m.uncertainty).toContain("2 goals are active and none is confirmed as first.");
  });

  it("makes a goal primary only by an explicit decision, which resolves the competition", () => {
    const pick = decision({ kind: "primary_outcome", outcomeId: "operator_macro_goals:g2" }, "2026-10-12T10:00:00.000Z");
    const m = resolveOperatingMandate(
      sources({ goals: [goal("g1"), goal("g2", { metricKey: "net_sales_per_period", createdAt: "2026-10-10T10:00:00.000Z" })], decisions: [pick] }),
      sha
    );
    expect(m.primaryOutcomeId).toBe("operator_macro_goals:g2");
    expect(m.leadingOutcome).toEqual({ id: "operator_macro_goals:g2", basis: "confirmed_primary" });
    expect(m.outcomes.find(o => o.primary)?.goalId).toBe("g2");
    expect(m.conflicts.find(c => c.kind === "competing_outcomes")).toMatchObject({ status: "resolved", resolution: { by: "confirmed_primary", ref: `operating_mandate_decisions:${pick.id}` } });
  });

  it("drops a primary choice whose goal was replaced, and says so", () => {
    const pick = decision({ kind: "primary_outcome", outcomeId: "operator_macro_goals:old" }, "2026-10-12T10:00:00.000Z");
    const m = resolveOperatingMandate(
      sources({ goals: [goal("old", { status: "superseded", supersededById: "g1" }), goal("g1")], decisions: [pick] }),
      sha
    );
    expect(m.primaryOutcomeId).toBeNull();
    expect(m.leadingOutcome).toEqual({ id: "operator_macro_goals:g1", basis: "sole_outcome" });
    expect(m.conflicts.find(c => c.kind === "stale_reference")?.status).toBe("unresolved");
    expect(m.history).toContainEqual(expect.objectContaining({ ref: "operator_macro_goals:old", supersededBy: "operator_macro_goals:g1" }));
  });
});

describe("resolveOperatingMandate: focuses", () => {
  const remark = (id: string, area: { key: string; label: string } | null, createdAt: string) => ({
    id,
    statement: area ? `Maximize sales in ${area.label}` : "Get more commercial accounts",
    createdAt,
    area,
  });

  it("applies a conversational area remark as an inferred focus that serves the confirmed goal", () => {
    const m = resolveOperatingMandate(sources({ remarks: [remark("r1", silverLake, "2026-10-01T10:00:00.000Z")], areaOrders: { silver_lake: 7 } }), sha);
    const focus = appliedMandateFocus(m)!;
    expect(focus).toMatchObject({ area: "silver_lake", confirmation: "inferred", status: "active", relationship: { kind: "serves", outcomeId: "operator_macro_goals:g1", confirmation: "inferred" } });
    // The remark never becomes a goal.
    expect(m.outcomes.map(o => o.statement)).toEqual(["Get to 50 active customers"]);
    expect(m.uncertainty.join(" ")).toMatch(/Silver Lake comes from conversation, not a confirmed goal/);
  });

  it("does not apply a remark about an area the business verifiably has no orders in, or with no service area", () => {
    const outside = resolveOperatingMandate(sources({ remarks: [remark("r1", silverLake, "2026-10-01T10:00:00.000Z")], areaOrders: { silver_lake: 0 } }), sha);
    expect(outside.appliedFocusId).toBeNull();
    expect(outside.focuses[0]).toMatchObject({ status: "not_applicable", statusReason: "no_orders_in_area" });
    const online = resolveOperatingMandate(sources({ areaPlanning: false, remarks: [remark("r1", silverLake, "2026-10-01T10:00:00.000Z")], areaOrders: { silver_lake: 7 } }), sha);
    expect(online.appliedFocusId).toBeNull();
    expect(online.focuses[0]).toMatchObject({ status: "not_applicable", statusReason: "no_physical_service_area" });
    // Orders that could not be read are not absence: the remark stays, marked unknown.
    const unread = resolveOperatingMandate(sources({ remarks: [remark("r1", silverLake, "2026-10-01T10:00:00.000Z")], areaOrders: { silver_lake: null } }), sha);
    expect(unread.appliedFocusId).toBe("daphne_goals:r1");
    expect(unread.focuses[0]).toMatchObject({ status: "active", statusReason: "area_orders_unknown" });
    expect(unread.focuses[0]!.uncertainty).toContain("Whether the business has orders in Silver Lake could not be read.");
  });

  it("lets a newer confirmed focus override an older remark, and never lets a newer remark replace it", () => {
    const confirm = decision(
      { kind: "focus", action: "confirm", area: "echo_park", label: "Echo Park", statement: "Focus on Echo Park", servesOutcomeId: "operator_macro_goals:g1" },
      "2026-10-05T10:00:00.000Z"
    );
    const m = resolveOperatingMandate(
      sources({
        remarks: [remark("old", silverLake, "2026-10-01T10:00:00.000Z"), remark("newer", { key: "los_feliz", label: "Los Feliz" }, "2026-10-08T10:00:00.000Z")],
        decisions: [confirm],
        areaOrders: { silver_lake: 7, los_feliz: 3 },
      }),
      sha
    );
    expect(appliedMandateFocus(m)).toMatchObject({ area: "echo_park", confirmation: "confirmed", relationship: { kind: "serves", outcomeId: "operator_macro_goals:g1", confirmation: "confirmed" } });
    expect(m.focuses.find(f => f.id === "daphne_goals:old")).toMatchObject({ status: "overridden", overriddenBy: `operating_mandate_decisions:${confirm.id}` });
    expect(m.focuses.find(f => f.id === "daphne_goals:newer")).toMatchObject({ status: "pending_confirmation", statusReason: "newer_remark_does_not_override_confirmed_focus" });
    expect(m.conflicts.filter(c => c.kind === "remark_vs_confirmed_intent").every(c => c.status === "resolved")).toBe(true);
  });

  it("keeps a dismissed area aside, even when it comes up again", () => {
    const dismiss = decision({ kind: "focus", action: "dismiss", area: "silver_lake", label: "Silver Lake", statement: "Not Silver Lake", servesOutcomeId: null }, "2026-10-05T10:00:00.000Z");
    const m = resolveOperatingMandate(
      sources({ remarks: [remark("before", silverLake, "2026-10-01T10:00:00.000Z"), remark("after", silverLake, "2026-10-09T10:00:00.000Z")], decisions: [dismiss], areaOrders: { silver_lake: 7 } }),
      sha
    );
    expect(m.appliedFocusId).toBeNull();
    expect(m.focuses.find(f => f.id === "daphne_goals:before")?.status).toBe("dismissed");
    expect(m.focuses.find(f => f.id === "daphne_goals:after")?.status).toBe("pending_confirmation");
  });

  it("without confirmations, the newest applicable remark applies", () => {
    const m = resolveOperatingMandate(
      sources({ remarks: [remark("a", silverLake, "2026-10-01T10:00:00.000Z"), remark("b", echoPark, "2026-10-03T10:00:00.000Z"), remark("c", null, "2026-10-04T10:00:00.000Z")], areaOrders: { silver_lake: 7, echo_park: 2 } }),
      sha
    );
    expect(m.appliedFocusId).toBe("daphne_goals:b");
    expect(m.focuses.find(f => f.id === "daphne_goals:a")?.status).toBe("superseded");
    // An emphasis with no place in it is context, never a plan.
    expect(m.focuses.find(f => f.id === "daphne_goals:c")).toMatchObject({ area: null, status: "active", statusReason: "no_area" });
  });

  it("relates an area remark to the goal scoped to that area", () => {
    const m = resolveOperatingMandate(
      sources({
        goals: [goal("g1"), goal("g2", { metricKey: "net_sales_per_period@area:silver_lake", createdAt: "2026-10-10T10:00:00.000Z" })],
        remarks: [remark("r1", silverLake, "2026-10-01T10:00:00.000Z")],
        areaOrders: { silver_lake: 7 },
      }),
      sha
    );
    expect(appliedMandateFocus(m)?.relationship).toEqual({ kind: "serves", outcomeId: "operator_macro_goals:g2", confirmation: "inferred" });
  });
});

describe("resolveOperatingMandate: hypotheses, constraints, revision", () => {
  it("adopts the operator's stated method for the leading goal and marks one for a replaced goal stale", () => {
    const method = decision(
      { kind: "method", outcomeId: "operator_macro_goals:g1", lever: "acquisition", population: "new_customers", area: "silver_lake", statement: "Find new Silver Lake customers door to door" },
      "2026-10-06T10:00:00.000Z"
    );
    const stale = decision(
      { kind: "method", outcomeId: "operator_macro_goals:gone", lever: "retention", population: "lapsed_customers", area: null, statement: "Win back lapsed customers" },
      "2026-10-02T10:00:00.000Z"
    );
    const m = resolveOperatingMandate(sources({ decisions: [method, stale], threads: [{ id: "w1", title: "Win back lapsed Silver Lake customers", lever: "retention", population: "lapsed_customers", area: "silver_lake", createdAt: "2026-10-03T10:00:00.000Z" }] }), sha);
    expect(statedMandateMethod(m)).toMatchObject({ origin: "operator_stated", confirmation: "confirmed", epistemicStatus: "unproven", lever: "acquisition", area: "silver_lake" });
    // Stating where to work confirms that area as the focus.
    expect(appliedMandateFocus(m)).toMatchObject({ id: `operating_mandate_decisions:${method.id}`, area: "silver_lake", confirmation: "confirmed", relationship: { kind: "serves", outcomeId: "operator_macro_goals:g1", confirmation: "confirmed" } });
    expect(m.hypotheses.find(h => h.id.endsWith(stale.id))?.status).toBe("stale");
    expect(m.hypotheses.find(h => h.id === "work_threads:w1")).toMatchObject({ origin: "work_thread", confirmation: "inferred", servesOutcomeIds: ["operator_macro_goals:g1"] });
  });

  it("with several goals and none first, applies the method that set the focus", () => {
    const method = decision(
      { kind: "method", outcomeId: "operator_macro_goals:g2", lever: "acquisition", population: "new_customers", area: "echo_park", statement: "Door-knock Echo Park" },
      "2026-10-06T10:00:00.000Z"
    );
    const m = resolveOperatingMandate(sources({ goals: [goal("g1"), goal("g2", { metricKey: "net_sales_per_period", createdAt: "2026-10-02T10:00:00.000Z" })], decisions: [method] }), sha);
    expect(m.leadingOutcome).toBeNull();
    expect(m.appliedFocusId).toBe(`operating_mandate_decisions:${method.id}`);
    expect(m.statedMethodId).toBe(`operating_mandate_decisions:${method.id}`);
  });

  it("separates operator doctrine from system defaults", () => {
    const m = resolveOperatingMandate(
      sources({ doctrine: { rules: { ...DEFAULT_DOCTRINE, maxRecoveryPerDay: 1, skipSalesUntil: "2026-10-25", skipSalesReason: "vacation" }, defaults: DEFAULT_DOCTRINE, sourceRef: "claire_operator_doctrine:t:op" } }),
      sha
    );
    expect(m.constraints.find(c => c.key === "maxRecoveryPerDay")).toMatchObject({ origin: "operator_doctrine", confirmation: "confirmed", value: 1 });
    expect(m.constraints.find(c => c.key === "outreachCooldownDays")).toMatchObject({ origin: "system_default", confirmation: "default" });
    expect(m.constraints.find(c => c.key === "skipSalesUntil")?.statement).toBe("No sales outreach until 2026-10-25 (vacation).");
  });

  it("is deterministic in its inputs, whatever their order, and changes with any decision", () => {
    const remarks = [
      { id: "a", statement: "Maximize sales in Silver Lake", createdAt: "2026-10-01T10:00:00.000Z", area: silverLake },
      { id: "b", statement: "Echo Park too", createdAt: "2026-10-02T10:00:00.000Z", area: echoPark },
    ];
    const goals = [goal("g1"), goal("g2", { metricKey: "net_sales_per_period", createdAt: "2026-10-10T10:00:00.000Z" })];
    const one = resolveOperatingMandate(sources({ goals, remarks, areaOrders: { silver_lake: 7, echo_park: 2 } }), sha);
    const two = resolveOperatingMandate(sources({ goals: [...goals].reverse(), remarks: [...remarks].reverse(), areaOrders: { echo_park: 2, silver_lake: 7 } }), sha);
    expect(two.revision).toBe(one.revision);
    expect(one.revision).toMatch(/^mandate_[0-9a-f]{40}$/);
    const decided = resolveOperatingMandate(
      sources({ goals, remarks, areaOrders: { silver_lake: 7, echo_park: 2 }, decisions: [decision({ kind: "primary_outcome", outcomeId: "operator_macro_goals:g1" }, "2026-10-12T10:00:00.000Z")] }),
      sha
    );
    expect(decided.revision).not.toBe(one.revision);
  });
});

describe("attributeMandateEvidence", () => {
  const m = resolveOperatingMandate(
    sources({
      goals: [
        goal("g1"),
        goal("g2", { metricKey: "net_sales_per_period@area:silver_lake", createdAt: "2026-10-10T10:00:00.000Z" }),
        goal("g3", { metricKey: "net_sales_per_period@area:echo_park", createdAt: "2026-10-11T10:00:00.000Z" }),
      ],
    }),
    sha
  );

  it("counts one sale once while it advances every goal it belongs to", () => {
    const sale = { evidenceRef: "goal_cycle_outcomes:o1", kind: "paid_order" as const, cents: 4800, area: "silver_lake", firstPurchase: false };
    const result = attributeMandateEvidence(m.outcomes, [sale, sale]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.advancesOutcomeIds).toEqual(["operator_macro_goals:g1", "operator_macro_goals:g2"]);
    expect(result.byOutcome["operator_macro_goals:g1"]).toEqual(["goal_cycle_outcomes:o1"]);
    expect(result.byOutcome["operator_macro_goals:g2"]).toEqual(["goal_cycle_outcomes:o1"]);
    expect(result.byOutcome["operator_macro_goals:g3"]).toEqual([]);
    expect(result.distinctCents).toBe(4800);
    expect(result.distinctEvidenceCount).toBe(1);
  });

  it("does not place a sale of unknown area in an area goal", () => {
    const result = attributeMandateEvidence(m.outcomes, [{ evidenceRef: "goal_cycle_outcomes:o2", kind: "paid_order", cents: 1000, area: null, firstPurchase: null }]);
    expect(result.items[0]!.advancesOutcomeIds).toEqual(["operator_macro_goals:g1"]);
  });
});
