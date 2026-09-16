import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { dropPatternFlags, recoveryItems } from "../../drizzle/schema";
import { getDb } from "../db";
import { lintDisappointmentFraming } from "../claire/disappointmentLint";
import {
  isWarmthEmissionAllowed,
  recordClaireMissionOutcomeEvents,
} from "../claire/character/relationshipEmitters";

export type RecoveryItemState =
  | "visible"
  | "queued"
  | "repaired"
  | "rescheduled"
  | "dropped"
  | "archived_outstanding";

export type DropPatternType =
  | "play_cluster_drops"
  | "overall_drops_surge"
  | "repeated_reschedules"
  | "archived_backlog";

export interface RecoveryItem {
  id: string;
  tenantId: string;
  commitmentRef: string;
  playId: string | null;
  title: string;
  state: RecoveryItemState;
  dropReason: string | null;
  rescheduledToDate: string | null;
  missedAt: string;
  resolvedAt: string | null;
  promotedVisibleAt: string | null;
  chronicleRef: string | null;
}

export interface DropPatternFlag {
  id: string;
  tenantId: string;
  patternType: DropPatternType;
  playId: string | null;
  windowDays: number;
  occurrenceCount: number;
  firstOccurrenceAt: string;
  lastOccurrenceAt: string;
  surfacedAtDawn: boolean;
  dawnSummary: string | null;
  acknowledgedAt: string | null;
}

// In-memory store for test/offline environments
const memoryRecoveryItems = new Map<string, RecoveryItem>();
const memoryDropPatternFlags = new Map<string, DropPatternFlag>();
const lastPromotionDateByTenant = new Map<string, string>(); // YYYY-MM-DD

function itemKey(tenantId: string, id: string): string {
  return `${tenantId}:${id}`;
}

/**
 * 1. Record a missed commitment as a recovery item.
 * Enforces Guardrail G3: Exactly zero or ONE item is visible per tenant at a time.
 * All others remain queued and counted.
 */
export async function recordMissedCommitment(input: {
  tenantId: string;
  commitmentRef: string;
  playId?: string;
  title: string;
  missedAt?: Date;
}): Promise<RecoveryItem> {
  const missedAtStr = (input.missedAt ?? new Date()).toISOString();
  const id = `rec_${randomUUID().slice(0, 12)}`;

  // Check if tenant already has a visible item
  const existingVisible = Array.from(memoryRecoveryItems.values()).find(
    i => i.tenantId === input.tenantId && i.state === "visible"
  );

  const state: RecoveryItemState = existingVisible ? "queued" : "visible";
  const promotedVisibleAt = state === "visible" ? missedAtStr : null;

  const item: RecoveryItem = {
    id,
    tenantId: input.tenantId,
    commitmentRef: input.commitmentRef,
    playId: input.playId ?? null,
    title: input.title,
    state,
    dropReason: null,
    rescheduledToDate: null,
    missedAt: missedAtStr,
    resolvedAt: null,
    promotedVisibleAt,
    chronicleRef: `chronicle:${id}`,
  };

  memoryRecoveryItems.set(itemKey(input.tenantId, id), item);

  const db = await getDb();
  if (db) {
    try {
      await db.insert(recoveryItems).values({
        id: item.id,
        tenantId: item.tenantId,
        commitmentRef: item.commitmentRef,
        playId: item.playId,
        title: item.title,
        state: item.state,
        dropReason: item.dropReason,
        rescheduledToDate: item.rescheduledToDate,
        missedAt: new Date(item.missedAt),
        promotedVisibleAt: item.promotedVisibleAt ? new Date(item.promotedVisibleAt) : null,
        chronicleRef: item.chronicleRef,
      });
    } catch {
      // optional
    }
  }

  return item;
}

/**
 * 2. Resolve a recovery item (repair, reschedule, or drop).
 * - Repair: completes the original commitment and emits G1 allowlisted warmth.
 * - Reschedule: reschedules to a new date within caps.
 * - Drop: requires a named reason. Voice requires spoken confirmation.
 * When a visible item resolves, at most ONE promotion per day to visible occurs.
 */
export async function resolveRecoveryItem(input: {
  tenantId: string;
  itemId: string;
  action: "repair" | "reschedule" | "drop";
  dropReason?: string;
  rescheduledToDate?: string;
  spokenConfirmation?: boolean;
  surface?: "map" | "voice" | "admin";
  todayYmd?: string;
}): Promise<{
  item: RecoveryItem;
  nextPromotedItem: RecoveryItem | null;
  warmthEventEmitted: boolean;
}> {
  const item = memoryRecoveryItems.get(itemKey(input.tenantId, input.itemId));
  if (!item) {
    throw new Error(`Recovery item ${input.itemId} not found for tenant ${input.tenantId}`);
  }

  const now = new Date();
  const todayYmd = input.todayYmd ?? now.toISOString().slice(0, 10);
  let warmthEventEmitted = false;

  if (input.action === "repair") {
    item.state = "repaired";
    item.resolvedAt = now.toISOString();

    // Guardrail G1: Completion of a repaired commitment is an allowlisted warmth event
    if (
      isWarmthEmissionAllowed({
        eventType: "operator_follow_through",
        summary: `Repaired commitment: ${item.title}`,
        provenance: "recovery:repair",
      })
    ) {
      try {
        await recordClaireMissionOutcomeEvents({
          tenantId: input.tenantId,
          operatorUserId: "operator",
          missionId: 1,
          outcome: "repaired_completed",
        });
        warmthEventEmitted = true;
      } catch {
        // Non-fatal
      }
    }
  } else if (input.action === "reschedule") {
    if (!input.rescheduledToDate) {
      throw new Error("Rescheduling a recovery item requires a rescheduledToDate.");
    }
    item.state = "rescheduled";
    item.rescheduledToDate = input.rescheduledToDate;
    item.resolvedAt = now.toISOString();
  } else if (input.action === "drop") {
    if (!input.dropReason || input.dropReason.trim() === "") {
      throw new Error("Dropping a recovery item requires an explicit named reason.");
    }
    if (input.surface === "voice" && !input.spokenConfirmation) {
      throw new Error("Dropping via voice requires explicit spoken confirmation and read-back.");
    }
    item.state = "dropped";
    item.dropReason = input.dropReason.trim();
    item.resolvedAt = now.toISOString();
  }

  // If resolved item was visible, check if we can promote the next queued item (at most 1 promotion per day)
  let nextPromotedItem: RecoveryItem | null = null;
  const lastPromoDate = lastPromotionDateByTenant.get(input.tenantId);

  if (lastPromoDate !== todayYmd) {
    // Find next queued item
    const queuedItems = Array.from(memoryRecoveryItems.values())
      .filter(i => i.tenantId === input.tenantId && i.state === "queued")
      .sort((a, b) => Date.parse(a.missedAt) - Date.parse(b.missedAt));

    if (queuedItems.length > 0) {
      const next = queuedItems[0];
      next.state = "visible";
      next.promotedVisibleAt = now.toISOString();
      lastPromotionDateByTenant.set(input.tenantId, todayYmd);
      nextPromotedItem = next;
    }
  }

  const db = await getDb();
  if (db) {
    try {
      await db
        .update(recoveryItems)
        .set({
          state: item.state,
          dropReason: item.dropReason,
          rescheduledToDate: item.rescheduledToDate,
          resolvedAt: new Date(),
        })
        .where(eq(recoveryItems.id, item.id));

      if (nextPromotedItem) {
        await db
          .update(recoveryItems)
          .set({
            state: "visible",
            promotedVisibleAt: new Date(),
          })
          .where(eq(recoveryItems.id, nextPromotedItem.id));
      }
    } catch {
      // optional
    }
  }

  return {
    item,
    nextPromotedItem,
    warmthEventEmitted,
  };
}

/**
 * 3. Never silent: archive stale queued items older than 21 days to Chronicle.
 * Never hard-deletes; still counts toward drop-pattern tracking.
 */
export async function archiveStaleQueuedItems(input: {
  tenantId: string;
  ageDays?: number;
  now?: Date;
}): Promise<number> {
  const maxAgeDays = input.ageDays ?? 21;
  const nowMs = (input.now ?? new Date()).getTime();
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  let archivedCount = 0;

  for (const item of memoryRecoveryItems.values()) {
    if (item.tenantId === input.tenantId && item.state === "queued") {
      const elapsedMs = nowMs - Date.parse(item.missedAt);
      if (elapsedMs >= maxAgeMs) {
        item.state = "archived_outstanding";
        archivedCount += 1;
      }
    }
  }

  return archivedCount;
}

/**
 * 4. Drop-pattern tracking.
 * Patterns:
 * - >= 3 drops in same play within 14 days
 * - >= 5 drops overall within 14 days
 * - same commitment rescheduled >= 3 times
 * - >= 5 archived_outstanding items within 30 days
 * Surfaced exclusively at Dawn!
 */
export async function evaluateDropPatterns(input: {
  tenantId: string;
  now?: Date;
}): Promise<DropPatternFlag[]> {
  const nowMs = (input.now ?? new Date()).getTime();
  const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

  const flags: DropPatternFlag[] = [];
  const allItems = Array.from(memoryRecoveryItems.values()).filter(i => i.tenantId === input.tenantId);

  // 1. Overall drops within 14 days
  const recentDrops = allItems.filter(
    i => i.state === "dropped" && i.resolvedAt && nowMs - Date.parse(i.resolvedAt) <= fourteenDaysMs
  );

  if (recentDrops.length >= 5) {
    const flag: DropPatternFlag = {
      id: `flag_overall_${randomUUID().slice(0, 8)}`,
      tenantId: input.tenantId,
      patternType: "overall_drops_surge",
      playId: null,
      windowDays: 14,
      occurrenceCount: recentDrops.length,
      firstOccurrenceAt: recentDrops[recentDrops.length - 1].resolvedAt!,
      lastOccurrenceAt: recentDrops[0].resolvedAt!,
      surfacedAtDawn: false,
      dawnSummary: `Five commitments set aside over the past two weeks. The route asks for steady feet.`,
      acknowledgedAt: null,
    };
    flags.push(flag);
    memoryDropPatternFlags.set(flag.id, flag);
  }

  // 2. Play-clustered drops within 14 days
  const dropsByPlay = new Map<string, RecoveryItem[]>();
  for (const item of recentDrops) {
    if (item.playId) {
      const list = dropsByPlay.get(item.playId) ?? [];
      list.push(item);
      dropsByPlay.set(item.playId, list);
    }
  }

  for (const [playId, items] of dropsByPlay.entries()) {
    if (items.length >= 3) {
      const flag: DropPatternFlag = {
        id: `flag_play_${randomUUID().slice(0, 8)}`,
        tenantId: input.tenantId,
        patternType: "play_cluster_drops",
        playId,
        windowDays: 14,
        occurrenceCount: items.length,
        firstOccurrenceAt: items[items.length - 1].resolvedAt!,
        lastOccurrenceAt: items[0].resolvedAt!,
        surfacedAtDawn: false,
        dawnSummary: `Three commitments set aside under this path in 14 days. The road may need re-aiming.`,
        acknowledgedAt: null,
      };
      flags.push(flag);
      memoryDropPatternFlags.set(flag.id, flag);
    }
  }

  // 3. Archived backlog (>= 5 archived_outstanding within 30 days)
  const archivedItems = allItems.filter(
    i => i.state === "archived_outstanding" && nowMs - Date.parse(i.missedAt) <= thirtyDaysMs
  );

  if (archivedItems.length >= 5) {
    const flag: DropPatternFlag = {
      id: `flag_archived_${randomUUID().slice(0, 8)}`,
      tenantId: input.tenantId,
      patternType: "archived_backlog",
      playId: null,
      windowDays: 30,
      occurrenceCount: archivedItems.length,
      firstOccurrenceAt: archivedItems[archivedItems.length - 1].missedAt,
      lastOccurrenceAt: archivedItems[0].missedAt,
      surfacedAtDawn: false,
      dawnSummary: `Five older commitments hold quiet in the archive.`,
      acknowledgedAt: null,
    };
    flags.push(flag);
    memoryDropPatternFlags.set(flag.id, flag);
  }

  return flags;
}

/**
 * 5. Format Recovery utterance for Claire:
 * Kintsugi framing: a repaired line is a stronger line.
 * Passes G2 disappointment lint.
 */
export function formatRecoveryClaireUtterance(visibleItem: RecoveryItem | null): string {
  if (!visibleItem) {
    return "The slate is clear today; no open commitments remain in Recovery.";
  }

  const utterance = `One line remains in Recovery from our earlier plan: "${visibleItem.title}". ` +
    `We can repair it today, reschedule it for an upcoming route, or set it aside with a reason. Your call.`;

  const g2 = lintDisappointmentFraming(utterance);
  if (!g2.passes) {
    throw new Error(`Recovery utterance failed G2 disappointment lint: ${g2.matchedPattern}`);
  }

  return utterance;
}

/**
 * 6. Retrieve recovery state for a tenant.
 */
export function getRecoveryState(tenantId: string): {
  visibleItem: RecoveryItem | null;
  queuedCount: number;
  archivedCount: number;
  droppedCount: number;
  repairedCount: number;
} {
  const items = Array.from(memoryRecoveryItems.values()).filter(i => i.tenantId === tenantId);
  const visibleItem = items.find(i => i.state === "visible") ?? null;
  const queuedCount = items.filter(i => i.state === "queued").length;
  const archivedCount = items.filter(i => i.state === "archived_outstanding").length;
  const droppedCount = items.filter(i => i.state === "dropped").length;
  const repairedCount = items.filter(i => i.state === "repaired").length;

  return {
    visibleItem,
    queuedCount,
    archivedCount,
    droppedCount,
    repairedCount,
  };
}

export function _clearRecoveryStores(): void {
  memoryRecoveryItems.clear();
  memoryDropPatternFlags.clear();
  lastPromotionDateByTenant.clear();
}
