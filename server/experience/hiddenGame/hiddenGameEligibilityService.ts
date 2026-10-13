/**
 * hidden_game.lost_property: unlock eligibility reader. (Spec v2 §2, system map §3a.)
 *
 * READ-ONLY toward the business. It reads the owning ledgers and records one
 * game-owned fact: that a chapter was opened. It never completes, marks or
 * changes any sale, order, commitment, objective or campaign run.
 *
 *   Chapter 1  first VERIFIED sale: an order whose payment the platform has
 *              admitted (customerOrderTruth `paid`, gated by an authority
 *              receipt), at a customer location that classifies to a territory.
 *              A bare "paid" flag, or a customer with no resolvable territory,
 *              opens nothing.
 *   Chapter 2/3  OBJECTIVES_PER_CHAPTER completed Objectives after the previous
 *              chapter's condition was met, counted by ledger completion time
 *              and de-duplicated by the underlying work.
 *
 * Unlocks are insert-only and monotonic. The count does not depend on the
 * player opening the game. Evaluation happens on read; no worker, no cron.
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import {
  dayDirectorCommitments,
  entityLocations,
  goalCycleObjectives,
  goldlineCampaignRuns,
  hiddenGameChapterUnlocks,
} from "../../../drizzle/schema";
import { classifyTerritory } from "../../../shared/lanternTerritories";
import { businessDateInZone } from "../../../shared/currentDayLine";
import {
  chaptersToRecord,
  isPreviewOperator,
  previewEligibility,
  projectEligibility,
  resolveChapters,
  type CompletedUnit,
  type FirstVerifiedSale,
  type HiddenGameEligibility,
  type UnlockRecord,
} from "../../../shared/hiddenGameEligibility";
import { getDashboardTimeZone } from "../../dashboardZoned";
import { getDb } from "../../db";
import {
  groupCustomerOrderTruth,
  loadCustomerOrderTruth,
} from "../../geography/customerOrderTruth";

export type HiddenGameScope = {
  tenantId: string;
  /** Canonical operator id. Keys the unlock ledger. */
  canonicalOperatorId: string;
  /** Day Director actor ids, as the Day Line router passes them. */
  operatorId: string;
  operatorIds?: string[];
  /** Campaign Run owner ids (open ids), canonical first. */
  operatorUserIds?: string[];
};

export type HiddenGameEligibilityDeps = {
  readFirstSale: (scope: HiddenGameScope) => Promise<FirstVerifiedSale | null>;
  readCompletedUnits: (scope: HiddenGameScope) => Promise<CompletedUnit[]>;
  listUnlocks: (scope: HiddenGameScope) => Promise<UnlockRecord[]>;
  /** Insert-only. Must tolerate a concurrent identical insert without throwing. */
  recordUnlock: (
    scope: HiddenGameScope,
    row: UnlockRecord & { evidence: Record<string, unknown> }
  ) => Promise<void>;
  /** Owner-only preview switch. Injected so tests control the environment. */
  env?: { openIds?: string; tenantId?: string; countFrom?: string };
};

function requireScope(scope: HiddenGameScope): void {
  // Never default a tenant. Throwing here is the tenant-isolation guarantee.
  if (!scope.tenantId?.trim()) throw new Error("hidden game eligibility requires a tenantId");
  if (!scope.canonicalOperatorId?.trim()) {
    throw new Error("hidden game eligibility requires a canonicalOperatorId");
  }
}

export async function readHiddenGameEligibility(
  scope: HiddenGameScope,
  deps: HiddenGameEligibilityDeps = defaultDeps
): Promise<HiddenGameEligibility> {
  requireScope(scope);
  const env = deps.env ?? {
    openIds: process.env.HIDDEN_GAME_PREVIEW_OPEN_IDS,
    tenantId: process.env.HIDDEN_GAME_PREVIEW_TENANT_ID,
    countFrom: process.env.HIDDEN_GAME_COUNT_FROM,
  };

  // Developer preview: answered before any ledger is read or written, so it
  // cannot change a legitimate unlock record or touch business data.
  if (
    isPreviewOperator({
      tenantId: scope.tenantId,
      canonicalOpenIds: scope.operatorUserIds ?? [],
      envOpenIds: env.openIds,
      envTenantId: env.tenantId,
    })
  ) {
    return previewEligibility();
  }

  const [firstSale, units, persisted] = await Promise.all([
    deps.readFirstSale(scope),
    deps.readCompletedUnits(scope),
    deps.listUnlocks(scope),
  ]);

  const resolved = resolveChapters({
    firstSale,
    units,
    persisted,
    countFrom: env.countFrom ?? null,
  });

  const toRecord = chaptersToRecord(resolved, persisted);
  const zone = getDashboardTimeZone();
  for (const row of toRecord) {
    await deps.recordUnlock(scope, {
      chapter: row.chapter,
      openedAt: row.openedAt,
      unlockedOnLocalDate: businessDateInZone(new Date(), zone),
      evidence: {
        ruleVersion: 2,
        openedAt: row.openedAt,
        ...(row.chapter === 1
          ? { firstSale }
          : { objectivesCounted: units.length }),
      },
    });
  }

  // The permanent record wins: a chapter that was recorded stays open even if
  // a ledger later stops supporting it.
  const reread = toRecord.length ? await deps.listUnlocks(scope) : persisted;
  const final = resolveChapters({
    firstSale,
    units,
    persisted: reread,
    countFrom: env.countFrom ?? null,
  });
  return projectEligibility({
    resolved: final,
    firstSale,
    units,
    countFrom: env.countFrom ?? null,
  });
}

// ── Default dependencies ─────────────────────────────────────────

async function readFirstSaleDefault(scope: HiddenGameScope): Promise<FirstVerifiedSale | null> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [records, locations] = await Promise.all([
    loadCustomerOrderTruth(scope.tenantId),
    db.select().from(entityLocations).where(eq(entityLocations.tenantId, scope.tenantId)),
  ]);
  const locationByKey = new Map(locations.map(row => [`${row.entityType}:${row.entityKey}`, row]));
  let best: FirstVerifiedSale | null = null;
  for (const [identityKey, group] of groupCustomerOrderTruth(scope.tenantId, records)) {
    const location = locationByKey.get(`customer:${identityKey}`);
    if (
      !location ||
      location.geocodeStatus !== "success" ||
      location.latitude == null ||
      location.longitude == null
    ) {
      continue;
    }
    const territory = classifyTerritory(Number(location.latitude), Number(location.longitude));
    if (!territory) continue;
    for (const record of group) {
      // `paid` is already gated by an admitted payment / paid-observation receipt.
      if (!record.paid || record.cancelled) continue;
      const occurredAt = record.createdAt.toISOString();
      if (!best || occurredAt < best.occurredAt) {
        best = { territoryId: territory.id, occurredAt };
      }
    }
  }
  return best;
}

function hasOperatorMission(metadata: unknown): boolean {
  return (
    typeof metadata === "object" &&
    metadata !== null &&
    (metadata as { operatorMission?: unknown }).operatorMission != null
  );
}

async function readCompletedUnitsDefault(scope: HiddenGameScope): Promise<CompletedUnit[]> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const actorIds = [
    ...new Set(
      (scope.operatorIds?.length ? scope.operatorIds : [scope.operatorId])
        .map(id => id.trim())
        .filter(Boolean)
    ),
  ];
  const ownerIds = [...new Set((scope.operatorUserIds ?? []).map(id => id.trim()).filter(Boolean))];

  const [commitments, objectives, runs] = await Promise.all([
    actorIds.length
      ? db
          .select()
          .from(dayDirectorCommitments)
          .where(
            and(
              eq(dayDirectorCommitments.tenantId, scope.tenantId),
              inArray(dayDirectorCommitments.actorId, actorIds),
              eq(dayDirectorCommitments.status, "completed"),
              isNotNull(dayDirectorCommitments.completedAt)
            )
          )
      : Promise.resolve([]),
    db
      .select()
      .from(goalCycleObjectives)
      .where(
        and(
          eq(goalCycleObjectives.tenantId, scope.tenantId),
          eq(goalCycleObjectives.canonicalOperatorId, scope.canonicalOperatorId),
          eq(goalCycleObjectives.status, "completed"),
          isNotNull(goalCycleObjectives.completedAt)
        )
      ),
    ownerIds.length
      ? db
          .select()
          .from(goldlineCampaignRuns)
          .where(
            and(
              eq(goldlineCampaignRuns.tenantId, scope.tenantId),
              inArray(goldlineCampaignRuns.operatorUserId, ownerIds),
              eq(goldlineCampaignRuns.status, "complete"),
              isNotNull(goldlineCampaignRuns.completedAt)
            )
          )
      : Promise.resolve([]),
  ]);

  const units: CompletedUnit[] = [];
  const commitmentKeys = new Set<string>();
  for (const row of commitments) {
    // Day Line work only: growth commitments, or ones designated as an operator mission.
    if (row.kind !== "growth" && !hasOperatorMission(row.metadataJson)) continue;
    commitmentKeys.add(row.id);
    units.push({ key: `commitment:${row.id}`, completedAt: row.completedAt!.toISOString() });
  }
  for (const row of objectives) {
    // An objective bridged from a commitment is the same work, not a second Objective.
    const key =
      row.actionTargetId && commitmentKeys.has(row.actionTargetId)
        ? `commitment:${row.actionTargetId}`
        : `objective:${row.id}`;
    units.push({ key, completedAt: row.completedAt!.toISOString() });
  }
  for (const row of runs) {
    units.push({ key: `campaign_run:${row.id}`, completedAt: row.completedAt!.toISOString() });
  }
  return units;
}

async function listUnlocksDefault(scope: HiddenGameScope): Promise<UnlockRecord[]> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const rows = await db
    .select()
    .from(hiddenGameChapterUnlocks)
    .where(
      and(
        eq(hiddenGameChapterUnlocks.tenantId, scope.tenantId),
        eq(hiddenGameChapterUnlocks.operatorId, scope.canonicalOperatorId)
      )
    );
  return rows.map(row => {
    const evidence = row.evidenceJson as { openedAt?: unknown } | null;
    return {
      chapter: row.chapter,
      unlockedOnLocalDate: row.unlockedOnLocalDate,
      openedAt:
        typeof evidence?.openedAt === "string" ? evidence.openedAt : row.createdAt.toISOString(),
    };
  });
}

async function recordUnlockDefault(
  scope: HiddenGameScope,
  row: UnlockRecord & { evidence: Record<string, unknown> }
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db
    .insert(hiddenGameChapterUnlocks)
    .values({
      id: randomUUID(),
      tenantId: scope.tenantId,
      operatorId: scope.canonicalOperatorId,
      chapter: row.chapter,
      unlockedOnLocalDate: row.unlockedOnLocalDate,
      evidenceJson: row.evidence,
    })
    // Two reads racing for the same chapter: the loser is a no-op, never an
    // overwrite. The ledger is insert-only.
    .onDuplicateKeyUpdate({ set: { id: sql`${hiddenGameChapterUnlocks.id}` } });
}

const defaultDeps: HiddenGameEligibilityDeps = {
  readFirstSale: readFirstSaleDefault,
  readCompletedUnits: readCompletedUnitsDefault,
  listUnlocks: listUnlocksDefault,
  recordUnlock: recordUnlockDefault,
};
