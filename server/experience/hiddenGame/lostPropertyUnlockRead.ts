/**
 * hidden_game.lost_property eligibility read.
 *
 * Sale authority is the paid-order ledger (`loadPaidOrderLedger`): an admitted
 * payment_verified or cleancloud_paid_observed event with a known captured
 * amount. Occurrence time is that ledger's occurredAt. Order createdAt and
 * ingestion time are not a sale. Territory is the customer's successful
 * geocode classified by `classifyTerritory`, the same placement Lantern City
 * uses. A message draft, schedule, send, or reply is not a sale.
 *
 * Objective authority is a verified action_verification outcome on a Mission,
 * Challenge, or Hybrid Objective (`goal_cycle_outcomes.observedAt`), plus a
 * completed Day Director operator mission (`day_director_commitments.completedAt`).
 * Campaign-run rows are not a second count of that work. Unfinished statuses
 * do not count.
 *
 * This module does not write business rows and does not write unlock rows.
 * Insert-once chapter permanence lives in lostPropertyChapterUnlock.ts.
 */
import { and, eq, inArray } from "drizzle-orm";
import {
  dayDirectorCommitments,
  entityLocations,
  goalCycleObjectives,
  goalCycleOutcomes,
} from "../../../drizzle/schema";
import {
  collectEligibleObjectiveUnits,
  isLostPropertyPreview,
  previewLostPropertyUnlock,
  projectLostPropertyUnlock,
  selectFirstVerifiedTerritorialSale,
  type AdmittedPaidOrder,
  type CompletedUnit,
  type CustomerTerritoryPlacement,
  type DayDirectorCommitmentEvidence,
  type FirstVerifiedSale,
  type GoalCycleActionEvidence,
  type GoalCycleObjectiveEvidence,
  type LostPropertyUnlockRead,
} from "../../../shared/lostPropertyUnlock";
import { loadPaidOrderLedger, type PaidOrderEvent } from "../../analytics/paidOrderLedger";
import { getDashboardTimeZone } from "../../dashboardZoned";
import { getDb } from "../../db";
import {
  groupCustomerOrderTruth,
  loadCustomerOrderTruth,
  type CustomerOrderTruthRecord,
} from "../../geography/customerOrderTruth";

export type LostPropertyScope = {
  tenantId: string;
  canonicalOperatorId: string;
  actorIds?: readonly string[];
  operatorOpenIds?: readonly string[];
};

export type LostPropertyUnlockDeps = {
  readFirstSale: (tenantId: string) => Promise<FirstVerifiedSale | null>;
  readCompletedUnits: (scope: LostPropertyScope) => Promise<CompletedUnit[]>;
  env?: { openIds?: string; tenantId?: string };
};

function requireTenant(tenantId: string): string {
  const id = tenantId.trim();
  if (!id) throw new Error("Lost Property eligibility requires a tenantId");
  return id;
}

function requireOperator(operatorId: string): string {
  const id = operatorId.trim();
  if (!id) throw new Error("Lost Property eligibility requires a canonicalOperatorId");
  return id;
}

export function indexPaidEventIdentity(
  groups: ReadonlyMap<string, readonly Pick<CustomerOrderTruthRecord, "source" | "sourceOrderId">[]>
): Map<string, string | "ambiguous"> {
  const indexed = new Map<string, string | "ambiguous">();
  for (const [identityKey, group] of groups) {
    for (const record of group) {
      const eventKey =
        record.source === "laundry_butler"
          ? `order:${record.sourceOrderId}`
          : record.source === "cleancloud"
            ? `cleancloud:${record.sourceOrderId}`
            : null;
      if (!eventKey) continue;
      const existing = indexed.get(eventKey);
      if (existing === undefined) indexed.set(eventKey, identityKey);
      else if (existing !== identityKey) indexed.set(eventKey, "ambiguous");
    }
  }
  return indexed;
}

function asIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function admittedOrdersFromLedger(input: {
  tenantId: string;
  events: readonly Pick<PaidOrderEvent, "eventKey" | "occurredAt" | "cents" | "ingestedAt">[];
  identityByEventKey: ReadonlyMap<string, string | "ambiguous">;
}): AdmittedPaidOrder[] {
  const orders: AdmittedPaidOrder[] = [];
  for (const event of input.events) {
    const occurredAt = asIso(event.occurredAt);
    if (!occurredAt) continue;
    const identity = input.identityByEventKey.get(event.eventKey);
    orders.push({
      tenantId: input.tenantId,
      eventKey: event.eventKey,
      occurredAt,
      ingestedAt: asIso(event.ingestedAt),
      cents: event.cents,
      customerIdentityKey: identity && identity !== "ambiguous" ? identity : null,
    });
  }
  return orders;
}

export async function readFirstVerifiedTerritorialSale(
  tenantId: string,
  now = new Date()
): Promise<FirstVerifiedSale | null> {
  const id = requireTenant(tenantId);
  const ledger = await loadPaidOrderLedger({
    tenantId: id,
    startUtc: new Date(0),
    endExclusiveUtc: new Date(now.getTime() + 1),
    timeZone: getDashboardTimeZone(),
  });
  if (ledger.completeness === "unavailable") {
    throw new Error("Lost Property sale ledger is unavailable");
  }
  const records = await loadCustomerOrderTruth(id);
  const identityByEventKey = indexPaidEventIdentity(groupCustomerOrderTruth(id, records));
  const db = await getDb();
  if (!db) throw new Error("Lost Property eligibility ledger is unavailable");
  const rows = await db
    .select({
      tenantId: entityLocations.tenantId,
      entityKey: entityLocations.entityKey,
      geocodeStatus: entityLocations.geocodeStatus,
      latitude: entityLocations.latitude,
      longitude: entityLocations.longitude,
    })
    .from(entityLocations)
    .where(and(eq(entityLocations.tenantId, id), eq(entityLocations.entityType, "customer")));
  const placements: CustomerTerritoryPlacement[] = rows.map(row => ({
    tenantId: row.tenantId,
    customerIdentityKey: row.entityKey,
    geocodeStatus: row.geocodeStatus,
    latitude: row.latitude == null ? null : Number(row.latitude),
    longitude: row.longitude == null ? null : Number(row.longitude),
  }));
  return selectFirstVerifiedTerritorialSale({
    tenantId: id,
    orders: admittedOrdersFromLedger({ tenantId: id, events: ledger.events, identityByEventKey }),
    placements,
  });
}

export async function readEligibleObjectiveCompletions(
  scope: LostPropertyScope
): Promise<CompletedUnit[]> {
  const tenantId = requireTenant(scope.tenantId);
  const canonicalOperatorId = requireOperator(scope.canonicalOperatorId);
  const actorIds = [...new Set((scope.actorIds ?? []).map(id => id.trim()).filter(Boolean))];
  const db = await getDb();
  if (!db) throw new Error("Lost Property eligibility ledger is unavailable");
  const [objectives, outcomes, commitments] = await Promise.all([
    db
      .select({
        tenantId: goalCycleObjectives.tenantId,
        canonicalOperatorId: goalCycleObjectives.canonicalOperatorId,
        id: goalCycleObjectives.id,
        executionType: goalCycleObjectives.executionType,
        status: goalCycleObjectives.status,
        actionTargetType: goalCycleObjectives.actionTargetType,
        actionTargetId: goalCycleObjectives.actionTargetId,
      })
      .from(goalCycleObjectives)
      .where(
        and(
          eq(goalCycleObjectives.tenantId, tenantId),
          eq(goalCycleObjectives.canonicalOperatorId, canonicalOperatorId)
        )
      ),
    db
      .select({
        tenantId: goalCycleOutcomes.tenantId,
        objectiveId: goalCycleOutcomes.objectiveId,
        observedAt: goalCycleOutcomes.observedAt,
        createdAt: goalCycleOutcomes.createdAt,
        impactClass: goalCycleOutcomes.impactClass,
        epistemicStatus: goalCycleOutcomes.epistemicStatus,
      })
      .from(goalCycleOutcomes)
      .where(
        and(
          eq(goalCycleOutcomes.tenantId, tenantId),
          eq(goalCycleOutcomes.canonicalOperatorId, canonicalOperatorId),
          eq(goalCycleOutcomes.impactClass, "action_verification"),
          eq(goalCycleOutcomes.epistemicStatus, "verified")
        )
      ),
    actorIds.length
      ? db
          .select({
            tenantId: dayDirectorCommitments.tenantId,
            actorId: dayDirectorCommitments.actorId,
            id: dayDirectorCommitments.id,
            status: dayDirectorCommitments.status,
            completedAt: dayDirectorCommitments.completedAt,
            metadataJson: dayDirectorCommitments.metadataJson,
          })
          .from(dayDirectorCommitments)
          .where(
            and(
              eq(dayDirectorCommitments.tenantId, tenantId),
              inArray(dayDirectorCommitments.actorId, actorIds),
              eq(dayDirectorCommitments.status, "completed")
            )
          )
      : Promise.resolve([]),
  ]);
  const objectiveRows: GoalCycleObjectiveEvidence[] = objectives;
  const outcomeRows: GoalCycleActionEvidence[] = outcomes.map(row => ({
    tenantId: row.tenantId,
    objectiveId: row.objectiveId,
    observedAt: row.observedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    impactClass: row.impactClass,
    epistemicStatus: row.epistemicStatus,
  }));
  const commitmentRows: DayDirectorCommitmentEvidence[] = commitments.map(row => ({
    tenantId: row.tenantId,
    actorId: row.actorId,
    id: row.id,
    status: row.status,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    metadata: row.metadataJson,
  }));
  return collectEligibleObjectiveUnits(
    { tenantId, canonicalOperatorId, actorIds },
    { objectives: objectiveRows, outcomes: outcomeRows, commitments: commitmentRows }
  );
}

function envFromProcess(): { openIds?: string; tenantId?: string } {
  return {
    openIds: process.env.HIDDEN_GAME_PREVIEW_OPEN_IDS,
    tenantId: process.env.HIDDEN_GAME_PREVIEW_TENANT_ID,
  };
}

const defaultDeps: LostPropertyUnlockDeps = {
  readFirstSale: tenantId => readFirstVerifiedTerritorialSale(tenantId),
  readCompletedUnits: scope => readEligibleObjectiveCompletions(scope),
};

export async function readLostPropertyUnlock(
  scope: LostPropertyScope,
  deps: LostPropertyUnlockDeps = defaultDeps
): Promise<LostPropertyUnlockRead> {
  const tenantId = requireTenant(scope.tenantId ?? "");
  const canonicalOperatorId = requireOperator(scope.canonicalOperatorId ?? "");
  const normalized: LostPropertyScope = {
    ...scope,
    tenantId,
    canonicalOperatorId,
    actorIds: scope.actorIds ?? [],
    operatorOpenIds: scope.operatorOpenIds ?? [],
  };
  const env = deps.env ?? envFromProcess();
  if (
    isLostPropertyPreview({
      tenantId,
      operatorOpenIds: normalized.operatorOpenIds ?? [],
      envOpenIds: env.openIds,
      envTenantId: env.tenantId,
    })
  ) {
    return previewLostPropertyUnlock();
  }
  const [firstSale, units] = await Promise.all([
    deps.readFirstSale(tenantId),
    deps.readCompletedUnits(normalized),
  ]);
  return projectLostPropertyUnlock({ firstSale, units });
}
