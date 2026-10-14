import { and, desc, eq, lte } from "drizzle-orm";
import {
  dayDirectorCommitments,
  goalCycleOutcomes,
  territoryOperatorProfiles,
} from "../../drizzle/schema";
import { getGoalCycleObjective } from "../agents/persistentOperator/objectiveStore";
import { loadStrategicDiagnosis } from "./strategicStore";
import { getDb } from "../db";
import { getActiveMacroGoalForOperators } from "../claire/macroGoalService";
import { parseAuthoritativeMetricObservation } from "../agents/persistentOperator/macroGoalRuns";
import type { CanonicalOperatorIdentity } from "../agents/persistentOperator/identity";
import type { VerticalRegistry } from "./verticalTemplates/registry";
import { readLaundryMatureRepeatCohort } from "./verticalTemplates/laundryCohortReader";
import { buildStrategySnapshot } from "./snapshotBuilder";
import { readCanonicalRevenue } from "../analytics/canonicalRevenue";
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
import { listActiveDaphneGoals } from "../agents/daphne/goalsPreferences";
import { addressScope } from "../claire/business/businessLanguage";
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
  const goal = await getActiveMacroGoalForOperators({
    tenantId: identity.tenantId,
    operatorUserIds: [
      identity.canonicalOpenId,
      ...identity.aliases.map(a => a.openId),
    ],
  });
  const evidence: StrategyEvidence[] = [];
  let sourceGaps: DiagnosisInput["sourceGaps"];
  let recordedFigures: DiagnosisInput["recordedFigures"];
  const metrics: DiagnosisInput["metrics"] = {};
  const goalRef = goal
    ? `operator_macro_goals:${goal.id}`
    : `goal_unavailable:${identity.canonicalOperatorId}`;
  evidence.push({
    id: goalRef,
    tenantId: identity.tenantId,
    source: "macroGoalService",
    capturedAt: now.toISOString(),
    classification: "operator_input",
    value: goal?.objective ?? null,
    unit: "goal",
    quality: goal ? "complete" : "unavailable",
    description: goal
      ? "Operator-declared goal, not measured performance"
      : "No active operator goal",
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
  // The operator's durable objective (Daphne goal) and its neighborhood evidence.
  const focus = await readObjectiveFocus({
    tenantId: identity.tenantId,
    canonicalOperatorId: identity.canonicalOperatorId,
    timeZone: input.timeZone,
    now,
    outage: Boolean(sourceGaps),
  }).catch(() => null);
  if (focus) evidence.push(...focus.evidence);
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
    const diagnosisId = objective?.selectedRef.split(":strategy-")[0];
    const originating = diagnosisId?.startsWith("diagnosis_")
      ? await loadStrategicDiagnosis(identity, diagnosisId)
      : null;
    if (
      originating &&
      objective?.canonicalOperatorId === identity.canonicalOperatorId
    ) {
      // The existing outcome authority supplies the result. A completed task or
      // revenue event alone cannot prove the hypothesized mechanism worked.
      const contradicted = /failed|blocked|hypothesis_contradicted/.test(
        row.outcomeKind
      );
      outcomes.push({
        id: row.id,
        actionDriver: originating.primaryConstraint,
        result: contradicted ? "contradicted" : "inconclusive",
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
      statement: goal?.objective ?? "Clarify the operator's goal",
      metricKey: goal?.metricKey ?? "unavailable",
      target: goal ? Number(goal.targetValue) : 0,
      current,
      evidenceRef: goalRef,
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

/**
 * Pure: the source conditions that mean sales data is actually missing.
 * A source that loaded but has orders without payment receipts is not an outage.
 */
export function salesSourceOutage(
  revenue:
    | { status: "unavailable"; coverage: { cleanCloudStatus: string | null; snapshotRead: boolean; loadedSources: readonly string[]; failedSources: readonly string[] } }
    | { status: "ok"; coverage: { cleanCloudStatus: string | null; snapshotRead: boolean; loadedSources: readonly string[]; failedSources: readonly string[] } }
): string[] {
  const c = revenue.coverage;
  if (revenue.status === "unavailable") return ["sales sources could not be read"];
  return [
    ...(c.cleanCloudStatus && !["fresh", "not_held"].includes(c.cleanCloudStatus)
      ? [`CleanCloud ${c.cleanCloudStatus}`]
      : []),
    ...c.failedSources
      .filter(s => !c.loadedSources.includes(s))
      .map(s => `${s} could not be loaded`),
    ...(!c.snapshotRead ? ["source coverage contract unreadable"] : []),
  ];
}

const FOCUS_WINDOW_DAYS = 90;

/**
 * Reads the operator's latest active Daphne goal that names a neighborhood and
 * measures that neighborhood with the same canonical business query Claire's
 * conversation uses: two equal completed trailing windows, and lapsed customers.
 */
export async function readObjectiveFocus(input: {
  tenantId: string;
  canonicalOperatorId: string;
  timeZone: string;
  now: Date;
  outage: boolean;
}): Promise<{ focus: NonNullable<DiagnosisInput["focus"]>; evidence: StrategyEvidence[] } | null> {
  const goals = await listActiveDaphneGoals({
    tenantId: input.tenantId,
    canonicalOperatorId: input.canonicalOperatorId,
  });
  const goal = [...goals]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(g => ({ g, scope: addressScope(g.statement) }))
    .find(x => x.scope?.addressAny?.length);
  if (!goal) return null;
  const label = goal.scope!.addressLabel!.replace(/^in\s+/i, "");
  const filters = { addressAny: goal.scope!.addressAny, addressLabel: goal.scope!.addressLabel };
  const deps = { ...defaultBusinessQueryDeps, now: () => input.now, timeZone: () => input.timeZone };
  const capturedAt = input.now.toISOString();
  const goalRef = `daphne_goals:${goal.g.id}`;
  const evidence: StrategyEvidence[] = [
    {
      id: goalRef,
      tenantId: input.tenantId,
      source: "Daphne durable operator goal",
      capturedAt,
      classification: "operator_input",
      value: goal.g.statement,
      unit: "operator_objective",
      quality: "complete",
      description: "Operator's stated objective",
    },
  ];
  const focus: NonNullable<DiagnosisInput["focus"]> = {
    statement: goal.g.statement,
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
      .map(m => ({ name: m.displayName, lastOrderDate: m.lastOrderDate, revenueCents: m.revenueCents }));
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
