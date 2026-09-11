/**
 * Slice 4 — Mission Director v1 orchestrator.
 * See docs/goldline/SLICE_4_MISSION_DIRECTOR.md.
 */
import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { missionDirectorPlans } from "../../drizzle/schema";
import { getDb } from "../db";
import { getFieldToday } from "../field/fieldTodayService";
import { listCampaigns } from "../campaignLibrary/campaignLibraryService";
import { detectTimePockets } from "./pocketDetection";
import { eligibleCampaigns } from "./eligibility";
import { selectMissionPlan } from "./planSelection";
import { explainMissionPlan } from "./explainPlan";
import { computePrepReadiness } from "./prepReadiness";
import type { MissionDirectorPlan, MissionPlanOutcome } from "./missionDirectorTypes";

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

function stableKeyFor(tenantId: string, operatorId: string, businessDate: string): string {
  return `mission-director:${tenantId}:${operatorId}:${businessDate}`;
}

function toRecord(row: typeof missionDirectorPlans.$inferSelect): MissionDirectorPlan {
  return {
    id: row.id,
    tenantId: row.tenantId,
    operatorId: row.operatorId,
    businessDate: row.businessDate,
    stableKey: row.stableKey,
    revision: row.revision,
    inputFingerprint: row.inputFingerprint,
    outcome: row.outcomeJson as MissionPlanOutcome,
    usageOutcome: (row.usageOutcome as MissionDirectorPlan["usageOutcome"]) ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function getLatestPlan(input: {
  tenantId: string;
  operatorId: string;
  businessDate: string;
}): Promise<MissionDirectorPlan | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(missionDirectorPlans)
    .where(
      and(
        eq(missionDirectorPlans.tenantId, input.tenantId),
        eq(missionDirectorPlans.operatorId, input.operatorId),
        eq(missionDirectorPlans.businessDate, input.businessDate)
      )
    )
    .orderBy(desc(missionDirectorPlans.revision))
    .limit(1);
  return row ? toRecord(row) : null;
}

export async function listPlanRevisions(input: {
  tenantId: string;
  operatorId: string;
  businessDate: string;
}): Promise<MissionDirectorPlan[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(missionDirectorPlans)
    .where(
      and(
        eq(missionDirectorPlans.tenantId, input.tenantId),
        eq(missionDirectorPlans.operatorId, input.operatorId),
        eq(missionDirectorPlans.businessDate, input.businessDate)
      )
    )
    .orderBy(desc(missionDirectorPlans.revision));
  return rows.map(toRecord);
}

/**
 * Computes the deterministic plan + explanation for a bundle, without
 * touching persistence. Exposed separately so the determinism-invariant
 * test can call it directly with a frozen bundle.
 */
export async function computeMissionPlan(input: {
  tenantId: string;
  operatorId: string;
  businessDate: string;
  timeZone?: string;
}): Promise<{ outcome: MissionPlanOutcome; inputFingerprint: string }> {
  const [allCampaigns, fieldToday] = await Promise.all([
    listCampaigns({ tenantId: input.tenantId, includeDisabled: true }),
    getFieldToday({
      tenantId: input.tenantId,
      userId: input.operatorId,
      includeAllAssignees: true,
      businessDate: input.businessDate,
      timeZone: input.timeZone,
    }),
  ]);
  const enabledCampaigns = allCampaigns.filter(c => c.enabled);
  const prepReady = await computePrepReadiness({
    tenantId: input.tenantId,
    businessDate: input.businessDate,
    campaigns: enabledCampaigns,
  });
  const { eligible } = eligibleCampaigns({ campaigns: enabledCampaigns, prepReady });
  const pockets = detectTimePockets({ timeline: fieldToday.timeline });
  const bare = selectMissionPlan({
    eligible,
    pockets,
    libraryTotalCount: allCampaigns.length,
    libraryEnabledCount: enabledCampaigns.length,
  });
  const { explanation, intelligence } = await explainMissionPlan({
    tenantId: input.tenantId,
    outcome: bare,
  });
  const outcome: MissionPlanOutcome =
    bare.status === "no_plan"
      ? bare
      : bare.status === "fallback_only"
        ? { ...bare, explanation }
        : { ...bare, explanation, intelligence };

  const inputFingerprint = fingerprint({
    businessDate: input.businessDate,
    fieldItemIds: fieldToday.timeline.map(item => item.id),
    fieldScheduledAts: fieldToday.timeline.map(item => item.scheduledAt),
    campaignIds: enabledCampaigns.map(c => c.campaignId).sort(),
    prepReady,
  });
  return { outcome, inputFingerprint };
}

const activeRuns = new Map<string, Promise<MissionDirectorPlan>>();

/**
 * Returns the current plan for the date, computing and persisting a new
 * revision only when the real inputs have changed since the last one
 * (append-only — the prior revision stays readable).
 */
export async function planForDate(input: {
  tenantId: string;
  operatorId: string;
  businessDate: string;
  timeZone?: string;
}): Promise<MissionDirectorPlan> {
  const key = `${input.tenantId}:${input.operatorId}:${input.businessDate}`;
  const active = activeRuns.get(key);
  if (active) return active;
  const run = planForDateInner(input).finally(() => activeRuns.delete(key));
  activeRuns.set(key, run);
  return run;
}

async function planForDateInner(input: {
  tenantId: string;
  operatorId: string;
  businessDate: string;
  timeZone?: string;
}): Promise<MissionDirectorPlan> {
  const db = await getDb();
  if (!db) {
    // Fail closed like every other Goldline service, not by throwing —
    // getFieldToday itself hard-throws with no database, so this must be
    // checked before computeMissionPlan ever calls it.
    return {
      id: randomUUID(),
      tenantId: input.tenantId,
      operatorId: input.operatorId,
      businessDate: input.businessDate,
      stableKey: stableKeyFor(input.tenantId, input.operatorId, input.businessDate),
      revision: 1,
      inputFingerprint: fingerprint({ unavailable: true }),
      outcome: {
        status: "no_plan",
        reason: "SCHEDULE_DATA_INSUFFICIENT",
        remedy: "Database is unavailable — Goldline cannot read tomorrow's schedule right now.",
      },
      usageOutcome: null,
      createdAt: new Date().toISOString(),
    };
  }
  const { outcome, inputFingerprint } = await computeMissionPlan(input);
  const latest = await getLatestPlan(input);
  if (latest && latest.inputFingerprint === inputFingerprint) {
    return latest;
  }
  const revision = (latest?.revision ?? 0) + 1;
  const row = {
    id: randomUUID(),
    tenantId: input.tenantId,
    operatorId: input.operatorId,
    businessDate: input.businessDate,
    stableKey: stableKeyFor(input.tenantId, input.operatorId, input.businessDate),
    revision,
    inputFingerprint,
    outcomeJson: outcome,
    usageOutcome: null,
    usageReportedAt: null,
  };
  await db.insert(missionDirectorPlans).values(row);
  const stored = await getLatestPlan(input);
  if (!stored) throw new Error("Mission plan was not persisted");
  return stored;
}

export async function recordPlanUsage(input: {
  tenantId: string;
  operatorId: string;
  businessDate: string;
  usageOutcome: "used" | "ignored" | "wrong_mission";
}): Promise<{ ok: true }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const latest = await getLatestPlan(input);
  if (!latest) throw new Error("No plan found for this date");
  await db
    .update(missionDirectorPlans)
    .set({ usageOutcome: input.usageOutcome, usageReportedAt: new Date() })
    .where(
      and(
        eq(missionDirectorPlans.tenantId, input.tenantId),
        eq(missionDirectorPlans.operatorId, input.operatorId),
        eq(missionDirectorPlans.businessDate, input.businessDate),
        eq(missionDirectorPlans.revision, latest.revision)
      )
    );
  return { ok: true };
}
