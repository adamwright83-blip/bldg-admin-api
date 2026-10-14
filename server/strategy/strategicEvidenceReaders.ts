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
import {
  loadStrategyMarketContext,
  resolveTenantVerticalKey,
} from "./marketContext";
import type {
  BusinessDriver,
  StrategyEvidence,
} from "../../shared/strategicIntelligence";
import type { DiagnosisInput } from "./strategicDiagnosis";

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
