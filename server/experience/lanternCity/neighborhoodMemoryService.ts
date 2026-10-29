/**
 * Phase 4: Durable Server-Backed Neighborhood Memory Service.
 *
 * Replaces browser localStorage reliance with tenant-scoped server persistence.
 * Tracks character relationships (Barnaby, Bramble), courtyard choices,
 * visit history, and unfinished activities across devices and days.
 *
 * Never fabricates customer outcomes or revenue. Fictional world memory
 * stays cleanly partitioned from authoritative CleanCloud / messaging truth.
 */
import { and, eq } from "drizzle-orm";
import { formatInTimeZone } from "date-fns-tz";
import {
  lanternNeighborhoodMemories,
  type LanternNeighborhoodMemoryRow,
} from "../../../drizzle/schema";
import { getDb } from "../../db";
import type {
  LetterApproachId,
  NeighborhoodFeatureChoice,
  NeighborhoodMemoryState,
  UnfinishedActivityState,
  VillagerMemoryRecord,
  VillagerVariant,
} from "../../../shared/playableVillagers";

export interface LoadNeighborhoodMemoryInput {
  tenantId: string;
  territoryId?: string;
  now?: Date;
  timeZone?: string;
  touchVisit?: boolean;
}

export interface SaveNeighborhoodFeatureInput {
  tenantId: string;
  territoryId?: string;
  featureChoice: NeighborhoodFeatureChoice;
  now?: Date;
}

export interface RecordVillagerInteractionInput {
  tenantId: string;
  territoryId?: string;
  villagerVariant: VillagerVariant;
  customerId?: string;
  customerName?: string;
  approach?: LetterApproachId;
  draftBody?: string;
  actionType?:
    | "draft_prepared"
    | "scheduled"
    | "compose_handoff_opened"
    | "operator_reported_sent"
    | "independently_verified_sent";
  now?: Date;
}

export interface SaveUnfinishedDraftInput {
  tenantId: string;
  territoryId?: string;
  customerId: string;
  customerName: string;
  villagerVariant: VillagerVariant;
  selectedApproach: LetterApproachId;
  draftBody: string;
  now?: Date;
}

// In-memory test fallback store for isolated unit tests without MySQL connection
const testMemoryStore = new Map<string, LanternNeighborhoodMemoryRow>();

export function _resetNeighborhoodTestStore(): void {
  testMemoryStore.clear();
}

function allowTestFallback(): boolean {
  return process.env.NODE_ENV === "test" && !process.env.DATABASE_URL;
}

function rowKey(tenantId: string, territoryId: string): string {
  return `${tenantId}::${territoryId}`;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (!value) return fallback;
  if (typeof value === "object") return value as T;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
}

function computeRelationshipTier(
  encountersCount: number,
  lettersComposed: number
): "new_acquaintance" | "familiar_friend" | "cherished_partner" {
  if (lettersComposed >= 3 || encountersCount >= 5) {
    return "cherished_partner";
  }
  if (lettersComposed >= 1 || encountersCount >= 2) {
    return "familiar_friend";
  }
  return "new_acquaintance";
}

export async function loadNeighborhoodWorldMemory(
  input: LoadNeighborhoodMemoryInput
): Promise<NeighborhoodMemoryState> {
  const tenantId = input.tenantId;
  const territoryId = input.territoryId ?? "silver-lake";
  const now = input.now ?? new Date();
  const timeZone = input.timeZone ?? "America/Los_Angeles";
  const touchVisit = input.touchVisit ?? true;

  const db = await getDb();
  let row: LanternNeighborhoodMemoryRow | undefined;

  if (db) {
    try {
      const results = await db
        .select()
        .from(lanternNeighborhoodMemories)
        .where(
          and(
            eq(lanternNeighborhoodMemories.tenantId, tenantId),
            eq(lanternNeighborhoodMemories.territoryId, territoryId)
          )
        )
        .limit(1);
      row = results[0];
    } catch (err: any) {
      if (allowTestFallback()) {
        row = testMemoryStore.get(rowKey(tenantId, territoryId));
      } else {
        throw new Error(`Failed to load neighborhood memory from database: ${err.message}`);
      }
    }
  } else if (allowTestFallback()) {
    row = testMemoryStore.get(rowKey(tenantId, territoryId));
  } else {
    throw new Error("Durable database connection unavailable for neighborhood memory");
  }

  const currentDateStr = formatInTimeZone(now, timeZone, "yyyy-MM-dd");
  let isReturnVisitTomorrowOrLater = false;
  let previousVisitedAt: string | null = null;
  let visitCount = 1;

  if (row) {
    previousVisitedAt = row.lastVisitedAt ? row.lastVisitedAt.toISOString() : null;
    visitCount = (row.visitCount ?? 0) + (touchVisit ? 1 : 0);
    if (previousVisitedAt) {
      const previousDateStr = formatInTimeZone(
        new Date(previousVisitedAt),
        timeZone,
        "yyyy-MM-dd"
      );
      isReturnVisitTomorrowOrLater = currentDateStr > previousDateStr;
    }
  }

  const encounterCounts = parseJson<Record<string, number>>(
    row?.encounterHistoryJson,
    {}
  );
  const villagerMemories = parseJson<Record<string, VillagerMemoryRecord>>(
    row?.villagerRelationshipsJson,
    {}
  );
  const unfinishedActivity = parseJson<UnfinishedActivityState | null>(
    row?.unfinishedActivitiesJson,
    null
  );
  const celebratedMilestones = parseJson<string[]>(
    row?.celebratedEventsJson,
    []
  );

  // If touchVisit is true and row exists, update lastVisitedAt and visitCount
  if (touchVisit) {
    const updatedRow: LanternNeighborhoodMemoryRow = {
      id: row?.id ?? `mem_${tenantId}_${territoryId}`,
      tenantId,
      territoryId,
      courtyardFeature: row?.courtyardFeature ?? null,
      courtyardPlacedAt: row?.courtyardPlacedAt ?? null,
      lastVisitedAt: now,
      visitCount,
      encounterHistoryJson: row?.encounterHistoryJson ?? encounterCounts,
      villagerRelationshipsJson: row?.villagerRelationshipsJson ?? villagerMemories,
      unfinishedActivitiesJson: row?.unfinishedActivitiesJson ?? unfinishedActivity,
      celebratedEventsJson: row?.celebratedEventsJson ?? celebratedMilestones,
      courtyardDiscoveriesJson: row?.courtyardDiscoveriesJson ?? null,
      createdAt: row?.createdAt ?? now,
      updatedAt: now,
    };

    if (db) {
      try {
        await db
          .insert(lanternNeighborhoodMemories)
          .values(updatedRow)
          .onDuplicateKeyUpdate({
            set: {
              lastVisitedAt: now,
              visitCount,
              updatedAt: now,
            },
          });
      } catch (err: any) {
        if (allowTestFallback()) {
          testMemoryStore.set(rowKey(tenantId, territoryId), updatedRow);
        } else {
          throw new Error(`Failed to touch neighborhood visit in database: ${err.message}`);
        }
      }
    } else if (allowTestFallback()) {
      testMemoryStore.set(rowKey(tenantId, territoryId), updatedRow);
    } else {
      throw new Error("Durable database connection unavailable for touching neighborhood visit");
    }
  }

  return {
    featureChoice: (row?.courtyardFeature as NeighborhoodFeatureChoice) ?? null,
    courtyardPlacedAt: row?.courtyardPlacedAt?.toISOString() ?? null,
    lastVisitedAt: now.toISOString(),
    previousVisitedAt,
    visitCount,
    isReturnVisitTomorrowOrLater,
    encounterCounts,
    villagerMemories,
    unfinishedActivity,
    celebratedMilestones,
    lastDraftedCustomer: null,
  };
}

export async function saveNeighborhoodFeature(
  input: SaveNeighborhoodFeatureInput
): Promise<NeighborhoodMemoryState> {
  const tenantId = input.tenantId;
  const territoryId = input.territoryId ?? "silver-lake";
  const now = input.now ?? new Date();

  const current = await loadNeighborhoodWorldMemory({
    tenantId,
    territoryId,
    now,
    touchVisit: false,
  });

  const milestone = `milestone_placed_${input.featureChoice}`;
  const currentMilestones = current.celebratedMilestones ?? [];
  const celebratedMilestones = Array.from(
    new Set([...currentMilestones, milestone])
  );

  const rowValues: LanternNeighborhoodMemoryRow = {
    id: `mem_${tenantId}_${territoryId}`,
    tenantId,
    territoryId,
    courtyardFeature: input.featureChoice,
    courtyardPlacedAt: now,
    lastVisitedAt: now,
    visitCount: current.visitCount ?? 1,
    encounterHistoryJson: current.encounterCounts,
    villagerRelationshipsJson: current.villagerMemories ?? {},
    unfinishedActivitiesJson: current.unfinishedActivity,
    celebratedEventsJson: celebratedMilestones,
    courtyardDiscoveriesJson: null,
    createdAt: now,
    updatedAt: now,
  };

  const db = await getDb();
  if (db) {
    try {
      await db
        .insert(lanternNeighborhoodMemories)
        .values(rowValues)
        .onDuplicateKeyUpdate({
          set: {
            courtyardFeature: input.featureChoice,
            courtyardPlacedAt: now,
            celebratedEventsJson: celebratedMilestones,
            updatedAt: now,
          },
        });
    } catch (err: any) {
      if (allowTestFallback()) {
        testMemoryStore.set(rowKey(tenantId, territoryId), rowValues);
      } else {
        throw new Error(`Failed to save courtyard feature to database: ${err.message}`);
      }
    }
  } else if (allowTestFallback()) {
    testMemoryStore.set(rowKey(tenantId, territoryId), rowValues);
  } else {
    throw new Error("Durable database connection unavailable for saving courtyard feature");
  }

  return {
    ...current,
    featureChoice: input.featureChoice,
    courtyardPlacedAt: now.toISOString(),
    celebratedMilestones,
  };
}

export async function recordVillagerInteraction(
  input: RecordVillagerInteractionInput
): Promise<NeighborhoodMemoryState> {
  const tenantId = input.tenantId;
  const territoryId = input.territoryId ?? "silver-lake";
  const now = input.now ?? new Date();
  const variant = input.villagerVariant;

  const current = await loadNeighborhoodWorldMemory({
    tenantId,
    territoryId,
    now,
    touchVisit: false,
  });

  const newCount = (current.encounterCounts[variant] ?? 0) + 1;
  const updatedEncounterCounts = {
    ...current.encounterCounts,
    [variant]: newCount,
  };

  const existingMemory = current.villagerMemories?.[variant] ?? {
    encountersCount: 0,
    lastEncounterAt: null,
    preferredApproach: null,
    lettersDraftedCount: 0,
    lettersScheduledCount: 0,
    lettersDispatchedCount: 0,
    relationshipTier: "new_acquaintance",
    memorableMoments: [],
  };

  const isCommitted = Boolean(input.actionType && input.actionType !== "draft_prepared");
  const draftedIncrement = input.approach || input.actionType === "draft_prepared" ? 1 : 0;
  const scheduledIncrement = input.actionType === "scheduled" ? 1 : 0;
  const handoffOpenedIncrement = input.actionType === "compose_handoff_opened" ? 1 : 0;
  const operatorReportedIncrement = input.actionType === "operator_reported_sent" ? 1 : 0;
  // Dispatched count is ONLY incremented when independently verified!
  const dispatchedIncrement = input.actionType === "independently_verified_sent" ? 1 : 0;

  const totalComposed = existingMemory.lettersDraftedCount + draftedIncrement;
  const totalScheduled = existingMemory.lettersScheduledCount + scheduledIncrement;
  const totalHandoffOpened = (existingMemory.lettersHandoffOpenedCount ?? 0) + handoffOpenedIncrement;
  const totalOperatorReported = (existingMemory.lettersOperatorReportedCount ?? 0) + operatorReportedIncrement;
  const totalDispatched = existingMemory.lettersDispatchedCount + dispatchedIncrement;

  const totalInteractions = totalComposed + totalScheduled + totalHandoffOpened + totalOperatorReported + totalDispatched;
  const relationshipTier = computeRelationshipTier(newCount, totalInteractions);

  const moments = [...existingMemory.memorableMoments];
  const dateFormatted = formatInTimeZone(now, "America/Los_Angeles", "MMM d");
  if (input.customerName) {
    if (input.actionType === "independently_verified_sent") {
      moments.push(`Independently verified send delivered to ${input.customerName} on ${dateFormatted}`);
    } else if (input.actionType === "operator_reported_sent") {
      moments.push(`Operator reported sending message to ${input.customerName} on ${dateFormatted}`);
    } else if (input.actionType === "compose_handoff_opened") {
      moments.push(`Opened Google Messages handoff for ${input.customerName} on ${dateFormatted}`);
    } else if (input.actionType === "scheduled") {
      moments.push(`Placed scheduled letter on morning dispatch shelf for ${input.customerName} on ${dateFormatted}`);
    } else if (input.approach) {
      moments.push(`Crafted ${input.approach} note for ${input.customerName} on ${dateFormatted}`);
    }
  }
  if (moments.length > 5) {
    moments.splice(0, moments.length - 5);
  }

  const updatedVillagerMemory: VillagerMemoryRecord = {
    encountersCount: newCount,
    lastEncounterAt: now.toISOString(),
    preferredApproach: input.approach ?? existingMemory.preferredApproach,
    lettersDraftedCount: totalComposed,
    lettersScheduledCount: totalScheduled,
    lettersHandoffOpenedCount: totalHandoffOpened,
    lettersOperatorReportedCount: totalOperatorReported,
    lettersDispatchedCount: totalDispatched,
    relationshipTier,
    memorableMoments: moments,
  };

  const updatedVillagerMemories = {
    ...current.villagerMemories,
    [variant]: updatedVillagerMemory,
  };

  // If the letter action was committed, clear unfinished activity
  let updatedUnfinished = current.unfinishedActivity;
  if (isCommitted && updatedUnfinished?.customerId === input.customerId) {
    updatedUnfinished = null;
  }

  // Celebrated milestones: ONLY append dispatch milestone on independently_verified_sent!
  const currentMilestones = current.celebratedMilestones ?? [];
  const nextMilestones = new Set(currentMilestones);
  if (input.customerId && input.actionType === "independently_verified_sent") {
    nextMilestones.add(`milestone_verified_sent_${input.customerId}`);
    nextMilestones.add("milestone_first_verified_send");
  } else if (input.customerId && input.actionType === "scheduled") {
    nextMilestones.add(`milestone_scheduled_${input.customerId}`);
  } else if (input.customerId && input.actionType === "compose_handoff_opened") {
    nextMilestones.add(`milestone_handoff_opened_${input.customerId}`);
  }
  const celebratedMilestones = Array.from(nextMilestones);

  const rowValues: LanternNeighborhoodMemoryRow = {
    id: `mem_${tenantId}_${territoryId}`,
    tenantId,
    territoryId,
    courtyardFeature: current.featureChoice,
    courtyardPlacedAt: current.courtyardPlacedAt
      ? new Date(current.courtyardPlacedAt)
      : null,
    lastVisitedAt: now,
    visitCount: current.visitCount ?? 1,
    encounterHistoryJson: updatedEncounterCounts,
    villagerRelationshipsJson: updatedVillagerMemories,
    unfinishedActivitiesJson: updatedUnfinished,
    celebratedEventsJson: celebratedMilestones,
    courtyardDiscoveriesJson: null,
    createdAt: now,
    updatedAt: now,
  };

  const db = await getDb();
  if (db) {
    try {
      await db
        .insert(lanternNeighborhoodMemories)
        .values(rowValues)
        .onDuplicateKeyUpdate({
          set: {
            encounterHistoryJson: updatedEncounterCounts,
            villagerRelationshipsJson: updatedVillagerMemories,
            unfinishedActivitiesJson: updatedUnfinished,
            celebratedEventsJson: celebratedMilestones,
            updatedAt: now,
          },
        });
    } catch (err: any) {
      if (allowTestFallback()) {
        testMemoryStore.set(rowKey(tenantId, territoryId), rowValues);
      } else {
        throw new Error(`Failed to record villager interaction in database: ${err.message}`);
      }
    }
  } else if (allowTestFallback()) {
    testMemoryStore.set(rowKey(tenantId, territoryId), rowValues);
  } else {
    throw new Error("Durable database connection unavailable for recording villager interaction");
  }

  return {
    ...current,
    encounterCounts: updatedEncounterCounts,
    villagerMemories: updatedVillagerMemories,
    unfinishedActivity: updatedUnfinished,
    celebratedMilestones,
  };
}

export async function saveUnfinishedLetterDraft(
  input: SaveUnfinishedDraftInput
): Promise<NeighborhoodMemoryState> {
  const tenantId = input.tenantId;
  const territoryId = input.territoryId ?? "silver-lake";
  const now = input.now ?? new Date();

  const current = await loadNeighborhoodWorldMemory({
    tenantId,
    territoryId,
    now,
    touchVisit: false,
  });

  const unfinishedActivity: UnfinishedActivityState = {
    customerId: input.customerId,
    customerName: input.customerName,
    villagerVariant: input.villagerVariant,
    selectedApproach: input.selectedApproach,
    draftBody: input.draftBody,
    updatedAt: now.toISOString(),
  };

  const rowValues: LanternNeighborhoodMemoryRow = {
    id: `mem_${tenantId}_${territoryId}`,
    tenantId,
    territoryId,
    courtyardFeature: current.featureChoice,
    courtyardPlacedAt: current.courtyardPlacedAt
      ? new Date(current.courtyardPlacedAt)
      : null,
    lastVisitedAt: now,
    visitCount: current.visitCount ?? 1,
    encounterHistoryJson: current.encounterCounts,
    villagerRelationshipsJson: current.villagerMemories ?? {},
    unfinishedActivitiesJson: unfinishedActivity,
    celebratedEventsJson: current.celebratedMilestones ?? [],
    courtyardDiscoveriesJson: null,
    createdAt: now,
    updatedAt: now,
  };

  const db = await getDb();
  if (db) {
    try {
      await db
        .insert(lanternNeighborhoodMemories)
        .values(rowValues)
        .onDuplicateKeyUpdate({
          set: {
            unfinishedActivitiesJson: unfinishedActivity,
            updatedAt: now,
          },
        });
    } catch (err: any) {
      if (allowTestFallback()) {
        testMemoryStore.set(rowKey(tenantId, territoryId), rowValues);
      } else {
        throw new Error(`Failed to save unfinished letter draft in database: ${err.message}`);
      }
    }
  } else if (allowTestFallback()) {
    testMemoryStore.set(rowKey(tenantId, territoryId), rowValues);
  } else {
    throw new Error("Durable database connection unavailable for saving unfinished letter draft");
  }

  return {
    ...current,
    unfinishedActivity,
  };
}
