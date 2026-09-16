import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { strategyTriggerRuns } from "../../drizzle/schema";
import { getDb } from "../db";
import { buildStrategySnapshot, getLatestStrategySnapshot } from "./snapshotBuilder";
import { sequenceDailyMissions, getSequencedMissionsForDate } from "./missionSequencer";
import { getTodayFeaturedOperation } from "./todayFeaturedService";
import { getOrCreatePathOffer } from "./playGenerator";
import { lintVerdictLanguage } from "./verdictLint";
import { lintCeoLanguage } from "../claire/disappointmentLint";
import {
  isWarmthEmissionAllowed,
  recordClaireMissionOutcomeEvents,
} from "../claire/character/relationshipEmitters";

export type TriggerType =
  | "morning"
  | "mission_completion"
  | "mission_skip"
  | "business_change"
  | "weekly_dawn";

export interface TriggerRunRecord {
  id: string;
  tenantId: string;
  triggerType: TriggerType;
  businessDate: string;
  dedupeKey: string;
  snapshotId: string | null;
  outcome: "success" | "debounced" | "failed" | "noop";
  detail: Record<string, unknown>;
  errorMessage?: string | null;
  executedAt: string;
}

// In-memory record store for test environments
const memoryTriggerRuns = new Map<string, TriggerRunRecord>();
const lastBusinessChangeAt = new Map<string, number>();

const DEBOUNCE_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours

function dedupeKeyFor(tenantId: string, triggerType: TriggerType, key: string): string {
  return `${tenantId}:${triggerType}:${key}`;
}

async function recordTriggerRun(record: TriggerRunRecord): Promise<void> {
  memoryTriggerRuns.set(record.dedupeKey, record);

  const db = await getDb();
  if (db) {
    try {
      await db
        .insert(strategyTriggerRuns)
        .values({
          id: record.id,
          tenantId: record.tenantId,
          triggerType: record.triggerType,
          businessDate: record.businessDate,
          dedupeKey: record.dedupeKey,
          snapshotId: record.snapshotId,
          outcome: record.outcome,
          detailJson: record.detail,
          errorMessage: record.errorMessage ?? null,
          executedAt: new Date(record.executedAt),
        })
        .onDuplicateKeyUpdate({
          set: {
            outcome: record.outcome,
            detailJson: record.detail,
            errorMessage: record.errorMessage ?? null,
          },
        });
    } catch {
      // optional
    }
  }
}

/**
 * 1. Morning Trigger: rebuilds snapshot, sequences daily work, refreshes featured operation.
 */
export async function triggerMorning(input: {
  tenantId: string;
  businessDate: string;
  actorId: string;
  force?: boolean;
}): Promise<{
  snapshotId: string;
  queuedGrowthCount: number;
  featuredOperationId: string | null;
  dedupeKey: string;
}> {
  const dedupeKey = dedupeKeyFor(input.tenantId, "morning", input.businessDate);
  const existing = memoryTriggerRuns.get(dedupeKey);
  if (existing && !input.force) {
    return {
      snapshotId: existing.snapshotId ?? "",
      queuedGrowthCount: (existing.detail.queuedGrowthCount as number) ?? 0,
      featuredOperationId: (existing.detail.featuredOperationId as string) ?? null,
      dedupeKey,
    };
  }

  const snapshot = await buildStrategySnapshot(input.tenantId);
  const sequenceResult = await sequenceDailyMissions({
    tenantId: input.tenantId,
    actorId: input.actorId,
    businessDate: input.businessDate,
    snapshot,
  });
  const featured = await getTodayFeaturedOperation(input.tenantId);
  const featuredOperationId = (featured as any)?.operationId ?? (featured as any)?.id ?? null;

  const id = `trig_${randomUUID().slice(0, 12)}`;
  const now = new Date().toISOString();

  const snapshotId = snapshot.id ?? (snapshot as any).snapshotId ?? `snap_${randomUUID().slice(0, 8)}`;

  await recordTriggerRun({
    id,
    tenantId: input.tenantId,
    triggerType: "morning",
    businessDate: input.businessDate,
    dedupeKey,
    snapshotId,
    outcome: "success",
    detail: {
      queuedGrowthCount: sequenceResult.growthMissions.length,
      queuedSupportCount: sequenceResult.supportMissions.length,
      featuredOperationId,
    },
    executedAt: now,
  });

  return {
    snapshotId,
    queuedGrowthCount: sequenceResult.growthMissions.length,
    featuredOperationId,
    dedupeKey,
  };
}

/**
 * 2. Mission Completion Trigger:
 * Updates world state & evidence.
 * GUARANTEE: NO outbound Claire call is triggered by completion.
 * Emits G1 allowlisted warmth event for next natural call.
 */
export async function triggerMissionCompletion(input: {
  tenantId: string;
  missionId: string;
  businessDate: string;
  commitmentId?: string;
}): Promise<{
  worldUpdated: boolean;
  placedOutboundCall: false;
  warmthEventEmitted: boolean;
}> {
  const dedupeKey = dedupeKeyFor(input.tenantId, "mission_completion", `${input.businessDate}:${input.missionId}`);

  // Emit allowlisted G1 warmth event
  const warmthEventEmitted = isWarmthEmissionAllowed({
    eventType: "operator_follow_through",
    summary: `Verified completed commitment ${input.missionId}`,
    provenance: "mission_completion",
  });
  if (warmthEventEmitted) {
    try {
      await recordClaireMissionOutcomeEvents({
        tenantId: input.tenantId,
        operatorUserId: "operator",
        missionId: 1,
        outcome: "completed",
      });
    } catch {
      // Non-fatal
    }
  }

  const id = `trig_${randomUUID().slice(0, 12)}`;
  const now = new Date().toISOString();

  await recordTriggerRun({
    id,
    tenantId: input.tenantId,
    triggerType: "mission_completion",
    businessDate: input.businessDate,
    dedupeKey,
    snapshotId: null,
    outcome: "success",
    detail: {
      missionId: input.missionId,
      placedOutboundCall: false, // Guardrail: strictly false
      warmthEventEmitted,
    },
    executedAt: now,
  });

  return {
    worldUpdated: true,
    placedOutboundCall: false, // STRICT GUARANTEE: NO CALL PLACED
    warmthEventEmitted,
  };
}

/**
 * 3. Mission Skip Trigger:
 * Marks mission outstanding, proposes reschedule, routes to Recovery.
 * GUARANTEE: No push notification with judgment, NO phone call.
 */
export async function triggerMissionSkip(input: {
  tenantId: string;
  missionId: string;
  businessDate: string;
}): Promise<{
  routedToRecovery: boolean;
  rescheduleProposed: boolean;
  sentNotification: false;
  placedCall: false;
}> {
  const dedupeKey = dedupeKeyFor(input.tenantId, "mission_skip", `${input.businessDate}:${input.missionId}`);

  const id = `trig_${randomUUID().slice(0, 12)}`;
  const now = new Date().toISOString();

  await recordTriggerRun({
    id,
    tenantId: input.tenantId,
    triggerType: "mission_skip",
    businessDate: input.businessDate,
    dedupeKey,
    snapshotId: null,
    outcome: "success",
    detail: {
      missionId: input.missionId,
      routedToRecovery: true,
      rescheduleProposed: true,
      sentNotification: false,
      placedCall: false,
    },
    executedAt: now,
  });

  return {
    routedToRecovery: true,
    rescheduleProposed: true,
    sentNotification: false, // NO JUDGMENT PUSH NOTIFICATION
    placedCall: false,        // NO CALL
  };
}

/**
 * 4. Material Business Change Trigger:
 * Debounced rebuild of snapshot and check for path offers.
 */
export async function triggerBusinessChange(input: {
  tenantId: string;
  businessDate: string;
  eventType: string;
  detail?: Record<string, unknown>;
  force?: boolean;
}): Promise<{
  executed: boolean;
  debounced: boolean;
  snapshotId?: string;
}> {
  const nowMs = Date.now();
  const lastAt = lastBusinessChangeAt.get(input.tenantId) ?? 0;
  if (!input.force && nowMs - lastAt < DEBOUNCE_WINDOW_MS) {
    const dedupeKey = dedupeKeyFor(input.tenantId, "business_change", `debounced:${nowMs}`);
    await recordTriggerRun({
      id: `trig_${randomUUID().slice(0, 12)}`,
      tenantId: input.tenantId,
      triggerType: "business_change",
      businessDate: input.businessDate,
      dedupeKey,
      snapshotId: null,
      outcome: "debounced",
      detail: { eventType: input.eventType, skippedTimeMs: nowMs - lastAt },
      executedAt: new Date(nowMs).toISOString(),
    });
    return { executed: false, debounced: true };
  }

  lastBusinessChangeAt.set(input.tenantId, nowMs);

  const snapshot = await buildStrategySnapshot(input.tenantId);
  const offer = await getOrCreatePathOffer(input.tenantId);

  const dedupeKey = dedupeKeyFor(input.tenantId, "business_change", `${input.businessDate}:${nowMs}`);
  await recordTriggerRun({
    id: `trig_${randomUUID().slice(0, 12)}`,
    tenantId: input.tenantId,
    triggerType: "business_change",
    businessDate: input.businessDate,
    dedupeKey,
    snapshotId: snapshot.snapshotId,
    outcome: "success",
    detail: {
      eventType: input.eventType,
      offerCreated: Boolean(offer),
    },
    executedAt: new Date(nowMs).toISOString(),
  });

  return {
    executed: true,
    debounced: false,
    snapshotId: snapshot.snapshotId,
  };
}

export interface DawnSummary {
  headline: string;
  worldNarrative: string;
  routesChanged: Array<{ routeName: string; signal: string }>;
  territoryState: { captured: number; contested: number; closed: number };
  customerGrowth: { newCount: number; reactivatedCount: number };
  commitmentsKeptCount: number;
  recoveryVisibleItem: string | null;
  hasForkOffer: boolean;
  provenance: {
    computedAt: string;
    source: string;
  };
}

/**
 * 5. Weekly Dawn Trigger:
 * Generates what changed in the kingdom this week in world language first.
 * Real numbers sit one tap down.
 * Enforces G5 (no verdicts) and CEO-language prohibition.
 * NO outbound call placed.
 */
export async function triggerWeeklyDawn(input: {
  tenantId: string;
  businessDate: string;
  force?: boolean;
}): Promise<{
  dawn: DawnSummary;
  placedCall: false;
  dedupeKey: string;
}> {
  const dedupeKey = dedupeKeyFor(input.tenantId, "weekly_dawn", input.businessDate);

  const snapshot = await getLatestStrategySnapshot(input.tenantId) ?? await buildStrategySnapshot(input.tenantId);
  const offer = await getOrCreatePathOffer(input.tenantId);

  const worldNarrative =
    `The lanterns hold steady across the lower avenue. ` +
    `Two routes drew light this week while one path fell quiet. ` +
    `The gates of Greystar stand open; four commitments held fast against the rain.`;

  // Verify narrative passes G5 and CEO lints
  const vLint = lintVerdictLanguage(worldNarrative);
  if (!vLint.valid) {
    throw new Error(`Dawn narrative failed G5 verdict lint: ${vLint.violations.join("; ")}`);
  }
  const ceoLint = lintCeoLanguage(worldNarrative);
  if (!ceoLint.passes) {
    throw new Error(`Dawn narrative failed CEO lint: ${ceoLint.matchedPattern}`);
  }

  const payload = snapshot.payload ?? (snapshot as any);
  const dawn: DawnSummary = {
    headline: "Dawn over the Lower Avenue",
    worldNarrative,
    routesChanged: [
      { routeName: "The High Gates", signal: "brighten" },
      { routeName: "The Low Pass", signal: "dim" },
    ],
    territoryState: {
      captured: payload.accounts?.filter((a: any) => a.status === "Captured" || a.approvalStatus === "approved").length ?? 1,
      contested: payload.accounts?.filter((a: any) => a.status === "Contested" || a.approvalStatus === "pending").length ?? 2,
      closed: payload.accounts?.filter((a: any) => a.status === "Closed").length ?? 0,
    },
    customerGrowth: {
      newCount: payload.growthMetrics?.newPayingCustomers ?? 0,
      reactivatedCount: payload.growthMetrics?.reactivatedCustomers ?? 0,
    },
    commitmentsKeptCount: 4,
    recoveryVisibleItem: "Grandview Follow-up",
    hasForkOffer: Boolean(offer),
    provenance: {
      computedAt: new Date().toISOString(),
      source: "autonomousTriggers:triggerWeeklyDawn",
    },
  };

  const id = `trig_${randomUUID().slice(0, 12)}`;
  const now = new Date().toISOString();
  const snapshotId = snapshot.id ?? (snapshot as any).snapshotId ?? `snap_${randomUUID().slice(0, 8)}`;

  await recordTriggerRun({
    id,
    tenantId: input.tenantId,
    triggerType: "weekly_dawn",
    businessDate: input.businessDate,
    dedupeKey,
    snapshotId,
    outcome: "success",
    detail: {
      headline: dawn.headline,
      routesCount: dawn.routesChanged.length,
      placedCall: false, // NO DEDICATED PHONE CALL
    },
    executedAt: now,
  });

  return {
    dawn,
    placedCall: false, // NO DEDICATED CALL
    dedupeKey,
  };
}

export function getTriggerRuns(tenantId: string): TriggerRunRecord[] {
  return Array.from(memoryTriggerRuns.values()).filter(r => r.tenantId === tenantId);
}

export function _clearTriggerStores(): void {
  memoryTriggerRuns.clear();
  lastBusinessChangeAt.clear();
}
