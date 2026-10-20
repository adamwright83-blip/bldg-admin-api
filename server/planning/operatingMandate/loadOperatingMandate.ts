import { createHash } from "node:crypto";
import { and, desc, eq, gte, inArray, isNull, or } from "drizzle-orm";
import {
  dayDirectorCommitments,
  goalCycleObjectives,
  goalCycleOutcomes,
  workThreads,
} from "../../../drizzle/schema";
import { DEFAULT_DOCTRINE } from "../../../shared/claireProactive";
import {
  attributeMandateEvidence,
  resolveMandateFocuses,
  resolveOperatingMandate,
  type MandateEvidenceItem,
  type MandateFocus,
  type MandateSources,
  type ResolvedOperatingMandate,
} from "../../../shared/operatingMandate";
import type { BusinessDriver } from "../../../shared/strategicIntelligence";
import { normalizeAreaKey, type StrategyOpportunityPopulation } from "../../../shared/workThread";
import { listActiveDaphneGoals } from "../../agents/daphne/goalsPreferences";
import {
  resolveCanonicalOperatorIdentity,
  type CanonicalOperatorIdentity,
} from "../../agents/persistentOperator/identity";
import { resolveOperatorTimeZone } from "../../agents/persistentOperator/operatorAppointmentPolicy";
import { loadOperatorDoctrine } from "../../agents/persistentOperator/operatorDoctrineStore";
import { applyLineageFilters } from "../../analytics/businessLineage";
import { addDaysYmd, businessToday } from "../../analytics/businessPeriods";
import { readCanonicalRevenue } from "../../analytics/canonicalRevenue";
import { salesSourceOutage } from "../../analytics/salesSourceOutage";
import { customerTruthDispositionOf, loadBusinessSourceCoverage } from "../../analytics/sourceCoverage";
import { findNeighborhood } from "../../analytics/laNeighborhoods";
import { addressScope } from "../../claire/business/businessLanguage";
import { getDb } from "../../db";
import { resolveTenantVerticalKey, strategyMarketMode } from "../../strategy/marketContext";
import { listMacroGoalsForOperators } from "../macroGoalStore";
import { listMandateDecisions } from "./mandateDecisionStore";

/**
 * Loads the operator's operating mandate from the stores that hold each part
 * and resolves it (shared/operatingMandate.ts). Read-only. Every consumer
 * (Strategic Diagnosis, Mission Director, the goal-cycle decision, the
 * operator's own view) loads the same sources the same way, so one stored
 * state has one revision wherever it is read.
 */
export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** How far back the business's own orders show it serves an area. */
const AREA_ORDER_LOOKBACK_DAYS = 395;

/** A neighborhood named in a remark, as an area key and its label. */
export function remarkArea(statement: string): { key: string; label: string } | null {
  const scope = addressScope(statement);
  if (!scope?.addressAny?.length || !scope.addressLabel) return null;
  const label = scope.addressLabel.replace(/^in\s+/i, "");
  const key = normalizeAreaKey(label);
  return key ? { key, label } : null;
}

/** Ledger filters for an area key: its ZIP codes or its name in the recorded address. */
export function areaLedgerFilters(area: string): { addressAny: string[]; addressLabel: string } | null {
  const neighborhood = findNeighborhood(area.replace(/_/g, " "));
  if (!neighborhood) return null;
  return {
    addressAny: [...neighborhood.zips, neighborhood.label.toLowerCase()],
    addressLabel: `in ${neighborhood.label}`,
  };
}

async function countAreaOrders(input: {
  tenantId: string;
  areas: readonly string[];
  businessDate: string;
  timeZone: string;
  now: Date;
}): Promise<Record<string, number | null>> {
  const unknown = Object.fromEntries(input.areas.map(area => [area, null])) as Record<string, number | null>;
  if (!input.areas.length) return unknown;
  try {
    // A count is evidence of where the business sells only when its customer
    // truth is current: the same gate an area's call sheet passes before it
    // states anything about customers. After a failed, stale or missing import
    // an empty read "is not zero customers", so the count is unknown.
    const coverage = await loadBusinessSourceCoverage({ tenantId: input.tenantId, now: input.now });
    if (customerTruthDispositionOf(coverage) !== "current") return unknown;
    const ledger = await readCanonicalRevenue({
      tenantId: input.tenantId,
      from: addDaysYmd(input.businessDate, -(AREA_ORDER_LOOKBACK_DAYS - 1)),
      to: input.businessDate,
      timeZone: input.timeZone,
      now: input.now,
    });
    if (ledger.status === "unavailable" || salesSourceOutage(ledger).length) return unknown;
    return Object.fromEntries(
      input.areas.map(area => {
        const filters = areaLedgerFilters(area);
        return [area, filters ? applyLineageFilters(ledger.includedEvents, filters).length : 0];
      })
    );
  } catch {
    return unknown;
  }
}

const metadataOf = (value: unknown): Record<string, unknown> => {
  const parsed = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
};
const nested = (value: unknown, key: string): string | null => {
  const inner = value && typeof value === "object" ? (value as Record<string, unknown>)[key] : null;
  return typeof inner === "string" && inner.trim() ? inner : null;
};

/** What decides the operator's focus: remarks, decisions, and the business's own orders in each area named. */
async function loadFocusSources(input: {
  tenantId: string;
  canonicalOperatorId: string;
  now: Date;
  timeZone?: string | null;
  /** The book whose orders say where the business sells, when it is not the signed-in tenant's own. */
  orderBookTenantId?: string;
}) {
  const { tenantId, now } = input;
  const timeZone = input.timeZone?.trim() || (await resolveOperatorTimeZone(tenantId)) || "UTC";
  const businessDate = businessToday(now, timeZone);
  const verticalKey = await resolveTenantVerticalKey(tenantId);
  const [remarks, decisions] = await Promise.all([
    listActiveDaphneGoals({ tenantId, canonicalOperatorId: input.canonicalOperatorId }),
    listMandateDecisions({ tenantId, canonicalOperatorId: input.canonicalOperatorId }),
  ]);
  const remarkSources = remarks.map(r => ({ id: r.id, statement: r.statement, createdAt: r.createdAt, area: remarkArea(r.statement) }));
  const areas = [...new Set(remarkSources.flatMap(r => (r.area ? [r.area.key] : [])))].sort();
  const areaPlanning = strategyMarketMode(verticalKey) !== "online";
  const areaOrders: Record<string, number | null> = areaPlanning
    ? await countAreaOrders({ tenantId: input.orderBookTenantId ?? tenantId, areas, businessDate, timeZone, now })
    : Object.fromEntries(areas.map(area => [area, null]));
  return { timeZone, businessDate, verticalKey, remarks: remarkSources, decisions, areaPlanning, areaOrders };
}

/**
 * The focus planning applies, by the mandate's own rule (confirmed before
 * conversational, then newest applicable), without loading the rest of the
 * mandate. Focus resolution never depends on goals, so this is the same focus
 * the full mandate applies.
 */
export async function loadAppliedMandateFocus(input: {
  tenantId: string;
  canonicalOperatorId: string;
  now?: Date;
  timeZone?: string | null;
  orderBookTenantId?: string;
}): Promise<MandateFocus | null> {
  const sources = await loadFocusSources({ ...input, now: input.now ?? new Date() });
  const resolved = resolveMandateFocuses(sources, sha256);
  return resolved.focuses.find(f => f.id === resolved.appliedFocusId) ?? null;
}

export async function loadOperatingMandateSources(input: {
  identity: CanonicalOperatorIdentity;
  now?: Date;
  timeZone?: string | null;
}): Promise<MandateSources> {
  const { identity } = input;
  const now = input.now ?? new Date();
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const tenantId = identity.tenantId;
  const operatorUserIds = [...new Set([identity.canonicalOpenId, identity.sourceOpenId, ...identity.aliases.map(a => a.openId)])];
  const focus = await loadFocusSources({ tenantId, canonicalOperatorId: identity.canonicalOperatorId, now, timeZone: input.timeZone });
  const { businessDate, verticalKey } = focus;

  const [goals, doctrineRules, threadRows, commitmentRows] = await Promise.all([
    listMacroGoalsForOperators({ tenantId, operatorUserIds }),
    loadOperatorDoctrine({ tenantId, operatorUserId: identity.canonicalOpenId }),
    db
      .select()
      .from(workThreads)
      .where(
        and(
          eq(workThreads.tenantId, tenantId),
          eq(workThreads.status, "open"),
          eq(workThreads.kind, "strategy_opportunity"),
          or(eq(workThreads.createdByOperatorId, identity.canonicalOperatorId), isNull(workThreads.createdByOperatorId))
        )
      ),
    identity.dayDirectorActorIds.length
      ? db
          .select()
          .from(dayDirectorCommitments)
          .where(
            and(
              eq(dayDirectorCommitments.tenantId, tenantId),
              inArray(dayDirectorCommitments.actorId, identity.dayDirectorActorIds),
              gte(dayDirectorCommitments.businessDate, businessDate),
              eq(dayDirectorCommitments.status, "open")
            )
          )
      : Promise.resolve([]),
  ]);

  return {
    tenantId,
    canonicalOperatorId: identity.canonicalOperatorId,
    verticalKey,
    areaPlanning: focus.areaPlanning,
    businessDate,
    goals: goals.map(g => ({
      id: g.id,
      operatorUserId: g.operatorUserId,
      objective: g.objective,
      metricKey: g.metricKey,
      targetValue: g.targetValue,
      unit: g.unit,
      targetDate: g.targetDate ?? null,
      source: g.source,
      status: g.status,
      supersededById: g.supersededById ?? null,
      createdAt: g.createdAt.toISOString(),
      updatedAt: g.updatedAt.toISOString(),
    })),
    remarks: focus.remarks,
    decisions: focus.decisions,
    doctrine: {
      rules: doctrineRules,
      defaults: DEFAULT_DOCTRINE,
      sourceRef: `claire_operator_doctrine:${tenantId}:${identity.canonicalOpenId}`,
    },
    threads: threadRows.flatMap(t => {
      const opportunity = metadataOf(t.opportunityJson);
      if (opportunity.kind !== "strategy_opportunity") return [];
      return [
        {
          id: t.id,
          title: t.title,
          lever: opportunity.lever as BusinessDriver,
          population: opportunity.population as StrategyOpportunityPopulation,
          area: typeof opportunity.area === "string" ? opportunity.area : null,
          createdAt: t.createdAt.toISOString(),
        },
      ];
    }),
    commitments: commitmentRows.map(c => {
      const metadata = metadataOf(c.metadataJson);
      return {
        id: c.id,
        title: c.title,
        businessDate: c.businessDate,
        status: c.status,
        workThreadId: nested(metadata.workThread, "id"),
        objectiveId: nested(metadata.objectiveLineage, "objectiveId"),
      };
    }),
    areaOrders: focus.areaOrders,
  };
}

export async function loadOperatingMandate(input: {
  identity: CanonicalOperatorIdentity;
  now?: Date;
  timeZone?: string | null;
}): Promise<ResolvedOperatingMandate> {
  return resolveOperatingMandate(await loadOperatingMandateSources(input), sha256);
}

/**
 * The mandate for an operator known only by open ids (Mission Director's
 * inputs). Null when the operator does not resolve to a canonical identity.
 */
export async function loadOperatingMandateForOperatorIds(input: {
  tenantId: string;
  operatorUserIds: readonly string[];
  now?: Date;
  timeZone?: string | null;
}): Promise<ResolvedOperatingMandate | null> {
  const openId = input.operatorUserIds.map(id => id.trim()).find(Boolean);
  if (!openId) return null;
  const resolved = await resolveCanonicalOperatorIdentity({
    tenantId: input.tenantId,
    source: { type: "open_id", value: openId },
    subsystem: "planning.operating_mandate",
  });
  if (!resolved.ok) return null;
  return loadOperatingMandate({ identity: resolved.identity, now: input.now, timeZone: input.timeZone });
}

/** `tenant:<tenantId>:operator:<openId>` → the operator's identity, when it still resolves. */
export async function identityForCanonicalOperator(tenantId: string, canonicalOperatorId: string) {
  const prefix = `tenant:${tenantId}:operator:`;
  if (!canonicalOperatorId.startsWith(prefix)) return null;
  const resolved = await resolveCanonicalOperatorIdentity({
    tenantId,
    source: { type: "open_id", value: canonicalOperatorId.slice(prefix.length) },
    subsystem: "planning.operating_mandate",
  });
  return resolved.ok && resolved.identity.canonicalOperatorId === canonicalOperatorId ? resolved.identity : null;
}

/**
 * Verified paid results on the operator's goal objectives, attributed to every
 * goal each one advances and counted once (attributeMandateEvidence). A paid
 * order observed after a win-back in an area happened in that area: its
 * customer was chosen from that area's own orders.
 */
export async function loadMandateEvidence(input: {
  mandate: ResolvedOperatingMandate;
  now?: Date;
  lookbackDays?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const now = input.now ?? new Date();
  const since = new Date(now.getTime() - (input.lookbackDays ?? 90) * 86_400_000);
  const rows = await db
    .select({
      id: goalCycleOutcomes.id,
      monetaryValueCents: goalCycleOutcomes.monetaryValueCents,
      metadataJson: goalCycleOutcomes.metadataJson,
      workThreadId: goalCycleObjectives.workThreadId,
    })
    .from(goalCycleOutcomes)
    .innerJoin(
      goalCycleObjectives,
      and(eq(goalCycleObjectives.tenantId, goalCycleOutcomes.tenantId), eq(goalCycleObjectives.id, goalCycleOutcomes.objectiveId))
    )
    .where(
      and(
        eq(goalCycleOutcomes.tenantId, input.mandate.tenantId),
        eq(goalCycleOutcomes.canonicalOperatorId, input.mandate.canonicalOperatorId),
        eq(goalCycleOutcomes.outcomeKind, "cleancloud_order_paid"),
        eq(goalCycleOutcomes.epistemicStatus, "verified"),
        gte(goalCycleOutcomes.observedAt, since)
      )
    )
    .orderBy(desc(goalCycleOutcomes.observedAt), desc(goalCycleOutcomes.id));
  const threadIds = [...new Set(rows.flatMap(r => (r.workThreadId ? [r.workThreadId] : [])))];
  const threads = threadIds.length
    ? await db
        .select({ id: workThreads.id, opportunityJson: workThreads.opportunityJson })
        .from(workThreads)
        .where(and(eq(workThreads.tenantId, input.mandate.tenantId), inArray(workThreads.id, threadIds)))
    : [];
  const threadArea = new Map(
    threads.map(t => {
      const opportunity = metadataOf(t.opportunityJson);
      return [t.id, typeof opportunity.area === "string" ? opportunity.area : null] as const;
    })
  );
  const items: MandateEvidenceItem[] = rows.map(r => {
    const attribution = metadataOf(r.metadataJson).attribution;
    const viaAttempt = nested(attribution, "kind") === "contacted_customer_paid_within_window";
    return {
      evidenceRef: `goal_cycle_outcomes:${r.id}`,
      kind: "paid_order",
      cents: r.monetaryValueCents ?? null,
      area: viaAttempt && r.workThreadId ? threadArea.get(r.workThreadId) ?? null : null,
      firstPurchase: null,
    };
  });
  return attributeMandateEvidence(input.mandate.outcomes, items);
}
