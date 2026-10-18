import { and, desc, eq, lte } from "drizzle-orm";
import {
  dayDirectorCommitments,
  goalCycleOutcomes,
  territoryOperatorProfiles,
} from "../../drizzle/schema";
import { getGoalCycleObjective } from "../agents/persistentOperator/objectiveStore";
import { getWorkThread } from "../agents/persistentOperator/workThreadStore";
import { interpretStoredOutcome } from "../agents/persistentOperator/outcomeInterpretation";
import { loadStrategicDiagnosis } from "./strategicStore";
import { getDb } from "../db";
import { parseAuthoritativeMetricObservation } from "../agents/persistentOperator/macroGoalRuns";
import {
  appliedMandateFocus,
  mandateOutcome,
  statedMandateMethod,
  type MandateFocus,
} from "../../shared/operatingMandate";
import {
  areaLedgerFilters,
  loadAppliedMandateFocus,
  loadOperatingMandate,
} from "../planning/operatingMandate/loadOperatingMandate";
import type { CanonicalOperatorIdentity } from "../agents/persistentOperator/identity";
import type { VerticalRegistry } from "./verticalTemplates/registry";
import { readLaundryMatureRepeatCohort } from "./verticalTemplates/laundryCohortReader";
import { buildStrategySnapshot } from "./snapshotBuilder";
import { readCanonicalRevenue } from "../analytics/canonicalRevenue";
import { salesSourceOutage } from "../analytics/salesSourceOutage";
import { addDaysYmd } from "../analytics/businessPeriods";
import { identityKeysFor } from "../analytics/customerIdentityResolution";
import type { PaidOrderEvent } from "../analytics/paidOrderLedger";
import {
  loadStrategyMarketContext,
  resolveTenantVerticalKey,
} from "./marketContext";
import type {
  BusinessDriver,
  StrategyEvidence,
} from "../../shared/strategicIntelligence";
import type { DiagnosisInput } from "./strategicDiagnosis";
import {
  defaultBusinessQuery,
  defaultBusinessQueryDeps,
  runBusinessQuery,
} from "../analytics/businessQuery";

export async function readStrategicDiagnosisInputs(input: {
  identity: CanonicalOperatorIdentity;
  registry: VerticalRegistry;
  businessDate: string;
  timeZone: string;
  now: Date;
}): Promise<DiagnosisInput> {
  const { identity, registry, now } = input;
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const verticalKey = await resolveTenantVerticalKey(identity.tenantId);
  const market = await loadStrategyMarketContext(
    identity.tenantId,
    verticalKey,
    now
  );
  // The operating mandate decides which goal the work is addressed to: the
  // confirmed primary, or the only active goal. Several active goals with none
  // confirmed as first are all kept; none is picked by recency.
  const mandate = await loadOperatingMandate({ identity, now, timeZone: input.timeZone });
  const leading = mandateOutcome(mandate, mandate.leadingOutcome?.id);
  const goal = leading
    ? { id: leading.goalId, objective: leading.statement, metricKey: leading.metricKey, targetValue: leading.target }
    : null;
  const evidence: StrategyEvidence[] = [];
  let sourceGaps: DiagnosisInput["sourceGaps"];
  let recordedFigures: DiagnosisInput["recordedFigures"];
  const metrics: DiagnosisInput["metrics"] = {};
  const goalRef = goal
    ? `operator_macro_goals:${goal.id}`
    : mandate.outcomes.length
      ? `operating_mandate:${mandate.revision}`
      : `goal_unavailable:${identity.canonicalOperatorId}`;
  evidence.push({
    id: goalRef,
    tenantId: identity.tenantId,
    source: goal ? "macroGoalService" : "operating mandate",
    capturedAt: now.toISOString(),
    classification: "operator_input",
    value: goal?.objective ?? (mandate.outcomes.length ? mandate.outcomes.map(o => o.statement).join("; ") : null),
    unit: "goal",
    quality: goal || mandate.outcomes.length ? "complete" : "unavailable",
    description: goal
      ? "Operator-declared goal, not measured performance"
      : mandate.outcomes.length
        ? "Several operator goals are active and none is confirmed as first"
        : "No active operator goal",
  });
  for (const o of mandate.outcomes)
    if (o.id !== goalRef)
      evidence.push({
        id: o.id,
        tenantId: identity.tenantId,
        source: "macroGoalService",
        capturedAt: now.toISOString(),
        classification: "operator_input",
        value: o.statement,
        unit: "goal",
        quality: "complete",
        description: "Operator-declared goal, not measured performance",
      });
  let current: number | null = null;
  if (goal) {
    try {
      const result = parseAuthoritativeMetricObservation(
        await registry
          .resolveMetric(verticalKey, goal.metricKey)
          .reader({
            tenantId: identity.tenantId,
            asOf: now,
            timeZone: input.timeZone,
          })
      );
      if (result.observationRef) {
        evidence.push({
          id: result.observationRef,
          tenantId: identity.tenantId,
          source: "VerticalRegistry authoritative metric reader",
          capturedAt: result.observedAt ?? now.toISOString(),
          classification:
            result.precision === "exact" ? "verified" : "estimate",
          value: result.value,
          unit: goal.metricKey,
          quality: ["complete", "partial", "stale"].includes(result.coverage)
            ? (result.coverage as "complete" | "partial" | "stale")
            : "unavailable",
          description: "Progress toward the operator's stated goal",
        });
        if (result.precision === "exact" && result.coverage === "complete")
          current = result.value;
      }
    } catch {
      /* Unsupported reader leaves progress unknown. */
    }
  }
  if (verticalKey === "laundry_fluff_fold") {
    const snapshot = await buildStrategySnapshot(identity.tenantId, {
      now,
      operatorUserId: identity.canonicalOpenId,
      timeZone: input.timeZone,
    });
    const revenue = await readCanonicalRevenue({
      tenantId: identity.tenantId,
      from: addDaysYmd(input.businessDate, -29),
      to: input.businessDate,
      timeZone: input.timeZone,
      now,
    });
    const quality: StrategyEvidence["quality"] =
      revenue.status === "unavailable"
        ? "unavailable"
        : revenue.mayStateExact
          ? "complete"
          : revenue.coverage.bookStatus === "stale"
            ? "stale"
            : "partial";
    const add = (
      key: string,
      value: number | null,
      quality: StrategyEvidence["quality"],
      description: string
    ) => {
      const id = `${snapshot.id}:${key}`;
      metrics[key] = id;
      evidence.push({
        id,
        tenantId: identity.tenantId,
        source:
          "canonicalRevenue: admitted paid-order ledger; StrategyEngine snapshot lineage",
        capturedAt: snapshot.generatedAt,
        classification: quality === "complete" ? "verified" : "estimate",
        value,
        unit: key,
        quality,
        description,
      });
    };
    add(
      "paid_orders",
      revenue.status === "unavailable" ? null : revenue.exactIncludedOrderCount,
      quality,
      "Admitted paid orders in the trailing 30-day period; whole-book exactness requires source coverage"
    );
    add(
      "net_sales_cents",
      revenue.status === "unavailable" ? null : revenue.recordedCents,
      quality,
      "Recorded sales, not contribution profit; whole-book exactness requires source coverage"
    );
    add(
      "average_order_value_cents",
      revenue.status === "unavailable" || !revenue.exactIncludedOrderCount
        ? null
        : revenue.recordedCents / revenue.exactIncludedOrderCount,
      quality,
      "Recorded sales divided by admitted paid orders in the same period; no margin inference"
    );
    // Comparable periods and customer mix come from the same admitted ledger.
    // One lookback read; every derived figure inherits its coverage quality.
    const lookback = await readCanonicalRevenue({
      tenantId: identity.tenantId,
      from: addDaysYmd(input.businessDate, -394),
      to: input.businessDate,
      timeZone: input.timeZone,
      now,
    });
    const lookbackQuality: StrategyEvidence["quality"] =
      lookback.status === "unavailable"
        ? "unavailable"
        : lookback.mayStateExact
          ? "complete"
          : lookback.coverage.bookStatus === "stale"
            ? "stale"
            : "partial";
    const comparison = summarizeComparablePeriods(
      lookback.status === "unavailable" ? null : lookback.includedEvents,
      input.businessDate
    );
    for (const [key, value, description] of [
      ["prior_paid_orders", comparison?.prior.orders ?? null, "Admitted paid orders in the 30 days before the current trailing period"],
      ["prior_net_sales_cents", comparison?.prior.cents ?? null, "Recorded sales in the 30 days before the current trailing period; not profit"],
      ["mtd_net_sales_cents", comparison?.mtd.cents ?? null, "Recorded sales month-to-date"],
      ["prior_mtd_net_sales_cents", comparison?.priorMtd.cents ?? null, "Recorded sales for the same days of the prior month"],
      ["new_customers_30d", comparison?.customers.newCustomers ?? null, "Identified customers whose first admitted purchase in a 395-day lookback is in the trailing 30 days"],
      ["returning_customers_30d", comparison?.customers.returningCustomers ?? null, "Identified customers in the trailing 30 days with an earlier admitted purchase in the lookback"],
    ] as const)
      add(
        key,
        value,
        // Unidentified purchases make customer counts incomplete, never zero.
        key.endsWith("customers_30d") && (comparison?.customers.unidentifiedOrders ?? 0) > 0
          ? lookbackQuality === "complete" ? "partial" : lookbackQuality
          : lookbackQuality,
        description
      );
    // Three distinct conditions: a source outage (stale or unloadable source),
    // a payment-authority gap (orders loaded but lacking payment receipts), and
    // exact coverage. Only an outage means the connection needs repair.
    const outage = salesSourceOutage(lookback);
    if (outage.length) {
      const id = `${snapshot.id}:sales_source_coverage`;
      sourceGaps = { evidenceRef: id, description: outage.join("; ") };
      evidence.push({
        id,
        tenantId: identity.tenantId,
        source: "canonicalRevenue source coverage contract",
        capturedAt: snapshot.generatedAt,
        classification: "verified",
        value: sourceGaps.description,
        unit: "sales_source_coverage",
        quality: "complete",
        description: "Verified state of the sales sources for the comparison window",
      });
    } else if (lookback.status === "ok" && !lookback.mayStateExact) {
      const unverified = lookback.unverifiedPaymentAuthority;
      const id = `${snapshot.id}:payment_authority_gap`;
      recordedFigures = {
        evidenceRef: id,
        description: unverified?.count
          ? `${unverified.count} recorded orders lack payment-authority receipts; totals are recorded sales, not payment-verified`
          : "Totals are recorded sales; exact payment verification is not established for this window",
      };
      evidence.push({
        id,
        tenantId: identity.tenantId,
        source: "canonicalRevenue payment authority reconciliation",
        capturedAt: snapshot.generatedAt,
        classification: "verified",
        value: recordedFigures.description,
        unit: "payment_authority_gap",
        quality: "complete",
        description: "Sources are current; some recorded orders are not payment-verified",
      });
    }
    if (snapshot.payload.customers.aggregateSource === "observed")
      add(
        "dormant_customers",
        snapshot.payload.customers.dormantCount,
        "complete",
        "Previously active customers past the dormant threshold; eligible recovery contacts still require consent"
      );
    const mature = await readLaundryMatureRepeatCohort({
      tenantId: identity.tenantId,
      asOf: now,
      timeZone: input.timeZone,
    });
    for (const [key, observation] of [
      ["mature_cohort_customers", mature.cohort],
      ["mature_cohort_repeat_customers", mature.repeated],
    ] as const) {
      if (!observation.observationRef) continue;
      metrics[key] = observation.observationRef;
      evidence.push({
        id: observation.observationRef,
        tenantId: identity.tenantId,
        source: "canonical paid-order ledger: 30-day mature cohort",
        capturedAt: observation.observedAt,
        classification:
          observation.precision === "exact" ? "verified" : "estimate",
        value: observation.value,
        unit: key,
        quality:
          observation.coverage === "complete"
            ? "complete"
            : observation.coverage === "stale"
              ? "stale"
              : "partial",
        description:
          "30-day repeat purchasing for entrants 30–59 business days before this cycle",
      });
    }
    // The snapshot truncates the detailed cohort and has no observed cadence.
    // Never manufacture mature-cohort retention from totalRecent or all-time repeats.
    const [profile] = await db
      .select()
      .from(territoryOperatorProfiles)
      .where(eq(territoryOperatorProfiles.tenantId, identity.tenantId))
      .limit(1);
    if (profile) {
      metrics.available_capacity = `territory_operator_profiles:${identity.tenantId}:capacity`;
      evidence.push({
        id: metrics.available_capacity,
        tenantId: identity.tenantId,
        source: "territory_operator_profiles",
        capturedAt: profile.updatedAt.toISOString(),
        classification: "operator_input",
        value: profile.availableWeeklyCapacityPounds,
        unit: "pounds/week",
        quality: "complete",
        description:
          "Configured open capacity; reservations and current utilization need confirmation",
      });
    }
  }
  // The mandate's applied area focus (confirmed first, else a remark in an
  // area the business sells in) and that neighborhood's evidence.
  const appliedFocus = appliedMandateFocus(mandate);
  const focus = appliedFocus
    ? await measureObjectiveFocus({
        tenantId: identity.tenantId,
        timeZone: input.timeZone,
        now,
        outage: Boolean(sourceGaps),
        focus: appliedFocus,
      }).catch(() => null)
    : null;
  if (focus) evidence.push(...focus.evidence);
  const method = statedMandateMethod(mandate);
  for (const observation of market.observations)
    evidence.push({
      id: observation.id,
      tenantId: identity.tenantId,
      source: observation.source,
      capturedAt: observation.capturedAt,
      classification: "verified",
      value: observation.name,
      unit: "prospect_presence",
      quality: "complete",
      description: `Observed in ${observation.territoryId}; demand and account value unverified`,
    });
  const rows = await db
    .select()
    .from(goalCycleOutcomes)
    .where(
      and(
        eq(goalCycleOutcomes.tenantId, identity.tenantId),
        eq(goalCycleOutcomes.canonicalOperatorId, identity.canonicalOperatorId),
        eq(goalCycleOutcomes.epistemicStatus, "verified"),
        lte(goalCycleOutcomes.observedAt, now)
      )
    )
    .orderBy(desc(goalCycleOutcomes.observedAt))
    .limit(50);
  const outcomes: DiagnosisInput["outcomes"] = [];
  for (const row of rows) {
    // Action verification proves execution, not a result or causal effect.
    if (row.impactClass === "action_verification") continue;
    const ref = `goal_cycle_outcomes:${row.id}`;
    evidence.push({
      id: ref,
      tenantId: identity.tenantId,
      source: row.sourceSystem,
      capturedAt: row.observedAt.toISOString(),
      classification: "verified",
      value: row.explanation ?? row.outcomeKind,
      unit: row.unit ?? "outcome",
      quality: "complete",
      description: row.evidenceReference,
    });
    const objective = await getGoalCycleObjective({
      tenantId: identity.tenantId,
      objectiveId: row.objectiveId,
    });
    // The lever an outcome speaks to: its objective's strategy Work Thread or,
    // for a pre-thread objective, the diagnosis its old candidate id named.
    const thread = objective?.workThreadId
      ? await getWorkThread({ tenantId: identity.tenantId, threadId: objective.workThreadId })
      : null;
    const threadLever = thread?.opportunity.kind === "strategy_opportunity" ? thread.opportunity.lever : null;
    const diagnosisId = threadLever ? undefined : objective?.selectedRef.split(":strategy-")[0];
    const originating = diagnosisId?.startsWith("diagnosis_")
      ? await loadStrategicDiagnosis(identity, diagnosisId)
      : null;
    const actionDriver = threadLever ?? originating?.primaryConstraint ?? null;
    if (
      actionDriver &&
      objective?.canonicalOperatorId === identity.canonicalOperatorId
    ) {
      // The shared outcome reading (also used by learning and the proof
      // scoreboard). "supported" is a verified revenue or conversion result on
      // this objective: consistent with the approach, never proof the mechanism
      // caused it. A completed task alone stays inconclusive.
      const interpretation = interpretStoredOutcome(row).result;
      outcomes.push({
        id: row.id,
        actionDriver,
        result: interpretation === "supported" || interpretation === "contradicted" ? interpretation : "inconclusive",
        evidenceRef: ref,
      });
    }
  }
  const commitments = await db
    .select()
    .from(dayDirectorCommitments)
    .where(eq(dayDirectorCommitments.tenantId, identity.tenantId));
  return {
    tenantId: identity.tenantId,
    canonicalOperatorId: identity.canonicalOperatorId,
    verticalKey,
    businessDate: input.businessDate,
    now,
    goal: {
      statement:
        goal?.objective ??
        (mandate.outcomes.length
          ? `Goals with none confirmed as first: ${mandate.outcomes.map(o => o.statement).join("; ")}`
          : "Clarify the operator's goal"),
      metricKey: goal?.metricKey ?? (mandate.outcomes.length ? "unprioritized_goals" : "unavailable"),
      target: goal ? Number(goal.targetValue) : 0,
      current,
      evidenceRef: goalRef,
    },
    mandate: {
      revision: mandate.revision,
      outcomes: mandate.outcomes.map(o => ({
        id: o.id,
        statement: o.statement,
        metricKey: o.metricKey,
        baseMetricKey: o.baseMetricKey,
        area: o.area,
        primary: o.primary,
      })),
      leadingOutcomeId: mandate.leadingOutcome?.id ?? null,
      primaryOutcomeId: mandate.primaryOutcomeId,
      focus: appliedFocus?.area && focus ? { id: appliedFocus.id, area: appliedFocus.area, confirmation: appliedFocus.confirmation } : null,
      method:
        method && (method.population === "lapsed_customers" || method.population === "new_customers")
          ? { id: method.id, lever: method.lever, population: method.population, area: method.area, statement: method.statement }
          : null,
      unresolvedConflicts: mandate.conflicts.filter(c => c.status === "unresolved").map(c => c.description),
      notes: mandate.uncertainty,
    },
    evidence,
    metrics,
    market,
    outcomes,
    ...(sourceGaps ? { sourceGaps } : {}),
    ...(recordedFigures ? { recordedFigures } : {}),
    ...(focus ? { focus: focus.focus } : {}),
    commitments: commitments
      .filter(
        c =>
          identity.dayDirectorActorIds.includes(c.actorId) &&
          c.businessDate >= input.businessDate &&
          !["completed", "cancelled", "superseded"].includes(c.status)
      )
      .map(
        c => `${c.businessDate}: ${c.title} [day_director_commitments:${c.id}]`
      ),
  };
}

type PeriodTotals = { orders: number; cents: number };

/** Pure: period and customer comparisons from admitted ledger events. Null means the ledger was unreadable. */
export function summarizeComparablePeriods(
  events: readonly Pick<PaidOrderEvent, "businessDate" | "cents" | "identity">[] | null,
  businessDate: string
): null | {
  current: PeriodTotals;
  prior: PeriodTotals;
  mtd: PeriodTotals;
  priorMtd: PeriodTotals;
  customers: { newCustomers: number; returningCustomers: number; unidentifiedOrders: number };
} {
  if (!events) return null;
  const currentFrom = addDaysYmd(businessDate, -29);
  const priorFrom = addDaysYmd(businessDate, -59);
  const monthStart = `${businessDate.slice(0, 8)}01`;
  const [y, m] = businessDate.split("-").map(Number) as [number, number];
  const pm = m === 1 ? 12 : m - 1;
  const py = m === 1 ? y - 1 : y;
  const priorMonthStart = `${py}-${String(pm).padStart(2, "0")}-01`;
  const priorMonthDays = new Date(Date.UTC(py, pm, 0)).getUTCDate();
  const day = Math.min(Number(businessDate.slice(8, 10)), priorMonthDays);
  const priorMtdTo = `${priorMonthStart.slice(0, 8)}${String(day).padStart(2, "0")}`;
  const total = (from: string, to: string): PeriodTotals => {
    const inRange = events.filter(e => e.businessDate >= from && e.businessDate <= to);
    return { orders: inRange.length, cents: inRange.reduce((n, e) => n + e.cents, 0) };
  };
  const firstSeen = new Map<string, string>();
  for (const e of events)
    for (const key of identityKeysFor(e.identity))
      if (!firstSeen.has(key) || e.businessDate < firstSeen.get(key)!) firstSeen.set(key, e.businessDate);
  const newCustomers = new Set<string>();
  const returning = new Set<string>();
  let unidentifiedOrders = 0;
  for (const e of events) {
    if (e.businessDate < currentFrom || e.businessDate > businessDate) continue;
    const keys = identityKeysFor(e.identity);
    if (!keys.length) {
      unidentifiedOrders += 1;
      continue;
    }
    const first = keys.map(k => firstSeen.get(k)!).sort()[0]!;
    (first >= currentFrom ? newCustomers : returning).add(keys[0]!);
  }
  return {
    current: total(currentFrom, businessDate),
    prior: total(priorFrom, addDaysYmd(currentFrom, -1)),
    mtd: total(monthStart, businessDate),
    priorMtd: total(priorMonthStart, priorMtdTo),
    customers: { newCustomers: newCustomers.size, returningCustomers: returning.size, unidentifiedOrders },
  };
}

export { salesSourceOutage } from "../analytics/salesSourceOutage";

const FOCUS_WINDOW_DAYS = 90;

/**
 * The operator's applied area focus, by the operating mandate's rule: an area
 * the operator confirmed first, else the newest conversational remark naming
 * a neighborhood the business has orders in. Returned as business-query
 * address filters for the area's call sheets and rosters.
 */
export async function readObjectiveArea(input: { tenantId: string; canonicalOperatorId: string }) {
  const focus = await loadAppliedMandateFocus({ tenantId: input.tenantId, canonicalOperatorId: input.canonicalOperatorId });
  if (!focus?.area) return null;
  const filters = areaLedgerFilters(focus.area);
  if (!filters) return null;
  const label = filters.addressLabel.replace(/^in\s+/i, "");
  const scope = { addressAny: filters.addressAny, addressTerms: null, addressLabel: filters.addressLabel };
  return {
    goal: { g: { id: focus.id.split(":").slice(1).join(":"), statement: focus.statement, createdAt: focus.effectiveFrom }, scope },
    label,
    filters: { addressAny: filters.addressAny, addressLabel: filters.addressLabel },
    focus,
  };
}

/**
 * Measures the applied focus's neighborhood with the same canonical business
 * query Claire's conversation uses: two equal completed trailing windows, and
 * lapsed customers.
 */
export async function measureObjectiveFocus(input: {
  tenantId: string;
  timeZone: string;
  now: Date;
  outage: boolean;
  focus: MandateFocus;
}): Promise<{ focus: NonNullable<DiagnosisInput["focus"]>; evidence: StrategyEvidence[] } | null> {
  const area = input.focus.area ? areaLedgerFilters(input.focus.area) : null;
  if (!area) return null;
  const label = area.addressLabel.replace(/^in\s+/i, "");
  const filters = { addressAny: area.addressAny, addressLabel: area.addressLabel };
  const confirmed = input.focus.confirmation === "confirmed";
  const deps = { ...defaultBusinessQueryDeps, now: () => input.now, timeZone: () => input.timeZone };
  const capturedAt = input.now.toISOString();
  const goalRef = input.focus.sourceRef;
  const evidence: StrategyEvidence[] = [
    {
      id: goalRef,
      tenantId: input.tenantId,
      source: confirmed ? "Operator mandate decision" : "Daphne conversational remark",
      capturedAt,
      classification: "operator_input",
      value: input.focus.statement,
      unit: "operator_objective",
      quality: "complete",
      description: confirmed
        ? "Area the operator confirmed to focus on"
        : "Area the operator mentioned in conversation; not a confirmed goal",
    },
  ];
  const focus: NonNullable<DiagnosisInput["focus"]> = {
    statement: input.focus.statement,
    area: label,
    evidenceRef: goalRef,
    windowDays: FOCUS_WINDOW_DAYS,
    sales: null,
    priorSales: null,
    orders: null,
    priorOrders: null,
    salesRef: null,
    dormant: null,
    dormantRef: null,
    dormantTop: [],
    figuresVerified: false,
    confirmation: input.focus.confirmation,
  };
  if (input.outage) return { focus, evidence };
  const revenue = await runBusinessQuery(
    input.tenantId,
    { ...defaultBusinessQuery("revenue"), period: { kind: "trailing_days", days: FOCUS_WINDOW_DAYS }, comparison: "previous", filters },
    deps
  );
  if (revenue.status === "ok" && revenue.data.kind === "totals" && revenue.data.previous) {
    const exact = revenue.coverage?.canonicalRevenue?.mayStateExact === true;
    focus.sales = revenue.data.current.revenueCents;
    focus.orders = revenue.data.current.orderCount;
    focus.priorSales = revenue.data.previous.revenueCents;
    focus.priorOrders = revenue.data.previous.orderCount;
    focus.figuresVerified = exact;
    focus.salesRef = `objective_area_sales:${input.tenantId}:${label}:${capturedAt}`;
    evidence.push({
      id: focus.salesRef,
      tenantId: input.tenantId,
      source: "canonical business query (address scope)",
      capturedAt,
      classification: exact ? "verified" : "estimate",
      value: focus.sales,
      unit: "area_sales_cents",
      quality: exact ? "complete" : "partial",
      description: `${label} recorded sales, last ${FOCUS_WINDOW_DAYS} days vs the prior ${FOCUS_WINDOW_DAYS}: ${focus.sales} vs ${focus.priorSales} cents`,
    });
  }
  const dormant = await runBusinessQuery(
    input.tenantId,
    { ...defaultBusinessQuery("dormant_customers"), listMembers: true, limit: 50, filters },
    deps
  );
  if (dormant.status === "ok" && dormant.data.kind === "customers") {
    focus.dormant = dormant.data.population.count;
    focus.dormantTop = [...dormant.data.population.members]
      .filter(m => m.matched)
      .sort((a, b) => b.revenueCents - a.revenueCents)
      .slice(0, 5)
      .map(m => ({ name: m.displayName, lastOrderDate: m.lastOrderDate, revenueCents: m.revenueCents, identityKey: m.identityId }));
    focus.dormantRef = `objective_area_dormant:${input.tenantId}:${label}:${capturedAt}`;
    evidence.push({
      id: focus.dormantRef,
      tenantId: input.tenantId,
      source: "canonical business query (address scope)",
      capturedAt,
      classification: "verified",
      value: focus.dormant,
      unit: "area_dormant_customers",
      quality: "complete",
      description: `${label} customers with earlier orders and none in the last 60 days`,
    });
  }
  return { focus, evidence };
}
