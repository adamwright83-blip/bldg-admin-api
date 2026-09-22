/**
 * Slice 4 — Mission Director v1 orchestrator.
 * See docs/goldline/SLICE_4_MISSION_DIRECTOR.md.
 */
import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { missionDirectorPlans, opsTasks } from "../../drizzle/schema";
import { getDb } from "../db";
import { getFieldToday } from "../field/fieldTodayService";
import { listCampaigns } from "../campaignLibrary/campaignLibraryService";
import { getActiveMacroGoal } from "../claire/macroGoalService";
import { loadDailyCommand } from "../claire/dailyCommandContract";
import { projectRecurrenceForDate } from "../claire/workdayRecurrenceService";
import { detectTimePockets, applyCommandProtection, DEFAULT_TRAVEL_RESERVE_MINUTES, DEFAULT_UNKNOWN_STOP_WORK_RESERVE_MINUTES } from "./pocketDetection";
import { eligibleCampaigns } from "./eligibility";
import { selectMissionPlan } from "./planSelection";
import { explainMissionPlan } from "./explainPlan";
import { computePrepReadiness } from "./prepReadiness";
import type { RankingContext, RankingOpenTask } from "./missionRank";
import type { MissionDirectorPlan, MissionPlanOutcome } from "./missionDirectorTypes";

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

async function loadRankingContext(input: {
  tenantId: string;
  operatorId: string;
  businessDate: string;
}): Promise<RankingContext> {
  let macroGoal: RankingContext["macroGoal"] = null;
  try {
    const goal = await getActiveMacroGoal({
      tenantId: input.tenantId,
      operatorUserId: input.operatorId,
    });
    if (goal) {
      macroGoal = {
        metricKey: goal.metricKey,
        targetValue: Number(goal.targetValue),
        objective: goal.objective,
      };
    }
  } catch {
    macroGoal = null;
  }
  const db = await getDb();
  const openTasks: RankingOpenTask[] = [];
  if (db) {
    const rows = await db
      .select({
        taskType: opsTasks.taskType,
        status: opsTasks.status,
        priority: opsTasks.priority,
        metadataJson: opsTasks.metadataJson,
      })
      .from(opsTasks)
      .where(
        and(
          eq(opsTasks.tenantId, input.tenantId),
          inArray(opsTasks.status, ["open", "accepted", "in_progress"])
        )
      );
    for (const row of rows) {
      const metadata =
        row.metadataJson && typeof row.metadataJson === "object"
          ? (row.metadataJson as Record<string, unknown>)
          : {};
      const dueAt =
        typeof metadata.dueAt === "string"
          ? metadata.dueAt
          : typeof metadata.dueDate === "string"
            ? metadata.dueDate
            : null;
      openTasks.push({
        taskType: row.taskType,
        status: row.status,
        priority: row.priority,
        dueAt,
      });
    }
  }
  return { businessDate: input.businessDate, macroGoal, openTasks };
}

export function planningCampaignFingerprint(campaign: {
  campaignId: string;
  enabled: boolean;
  objective: string;
  completionCondition: string;
  prepLeadDays: number;
  prepCondition: string | null;
  pocketKind: string;
  pocketMinutesMin: number;
  fallbackVariant: unknown;
  missionCategory: string;
  opsTaskType: string;
  timingAssumptions: unknown;
}) {
  return {
    campaignId: campaign.campaignId,
    enabled: campaign.enabled,
    objective: campaign.objective,
    completionCondition: campaign.completionCondition,
    prepLeadDays: campaign.prepLeadDays,
    prepCondition: campaign.prepCondition,
    pocketKind: campaign.pocketKind,
    pocketMinutesMin: campaign.pocketMinutesMin,
    fallbackVariant: campaign.fallbackVariant,
    missionCategory: campaign.missionCategory,
    opsTaskType: campaign.opsTaskType,
    timingAssumptions: campaign.timingAssumptions,
  };
}

export function computePlanningFingerprint(input: {
  businessDate: string;
  fieldItemIds: readonly string[];
  fieldScheduledAts: readonly (string | null)[];
  campaigns: readonly Parameters<typeof planningCampaignFingerprint>[0][];
  prepReady: Record<string, boolean>;
  rankingContext: RankingContext;
  commandFingerprint?: string | null;
}): string {
  return fingerprint({
    businessDate: input.businessDate,
    fieldItemIds: input.fieldItemIds,
    fieldScheduledAts: input.fieldScheduledAts,
    campaigns: input.campaigns.map(planningCampaignFingerprint),
    prepReady: input.prepReady,
    ranking: {
      businessDate: input.rankingContext.businessDate,
      macroGoal: input.rankingContext.macroGoal,
      openTasks: input.rankingContext.openTasks.map(task => ({
        taskType: task.taskType,
        status: task.status,
        priority: task.priority,
        dueAt: task.dueAt,
      })),
      campaignPriorityById: input.rankingContext.campaignPriorityById ?? {},
    },
    travelReserveMinutes: DEFAULT_TRAVEL_RESERVE_MINUTES,
    unknownStopWorkReserveMinutes: DEFAULT_UNKNOWN_STOP_WORK_RESERVE_MINUTES,
    commandFingerprint: input.commandFingerprint ?? null,
  });
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
  const command = await loadDailyCommand({
    tenantId: input.tenantId,
    actorId: input.operatorId,
    dayDirectorActorId: input.operatorId,
    operatorUserId: input.operatorId,
    businessDate: input.businessDate,
    timeZone: input.timeZone,
  }).catch(() => null);
  const enabledCampaigns = allCampaigns.filter(c => c.enabled);
  const prepReady = await computePrepReadiness({
    tenantId: input.tenantId,
    businessDate: input.businessDate,
    campaigns: enabledCampaigns,
  });
  const rankingContext = await loadRankingContext({
    tenantId: input.tenantId,
    operatorId: input.operatorId,
    businessDate: input.businessDate,
  });
  const { eligible } = eligibleCampaigns({ campaigns: enabledCampaigns, prepReady });
  const timeline = [
    ...fieldToday.timeline.map(item => ({
      id: item.id,
      title: item.title,
      scheduledAt: item.scheduledAt,
      kind: item.kind,
    })),
    ...(command?.constraints.occupancies ?? []).map(occupancy => ({
      id: occupancy.id,
      title: occupancy.title,
      scheduledAt: occupancy.scheduledAt,
      kind: occupancy.kind,
      durationMinutes: occupancy.durationMinutes,
    })),
  ];
  const pockets = applyCommandProtection(
    detectTimePockets({ timeline }),
    Boolean(command?.constraints.protectDiscretionary)
  );
  const bare = selectMissionPlan({
    eligible,
    pockets,
    libraryTotalCount: allCampaigns.length,
    libraryEnabledCount: enabledCampaigns.length,
    rankingContext,
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

  const inputFingerprint = computePlanningFingerprint({
    businessDate: input.businessDate,
    fieldItemIds: fieldToday.timeline.map(item => item.id),
    fieldScheduledAts: fieldToday.timeline.map(item => item.scheduledAt),
    campaigns: enabledCampaigns,
    prepReady,
    rankingContext,
    commandFingerprint: command?.constraints.fingerprint ?? null,
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
    // Recurrence is not projected here: there is no database to write.
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
  // Execution write, not a read. Operator-confirmed recurrence rules become
  // today's Day Director commitments before the plan is computed. Idempotent
  // per rule and date. computeMissionPlan stays persistence-free and only reads.
  await projectRecurrenceForDate({
    tenantId: input.tenantId,
    actorId: input.operatorId,
    businessDate: input.businessDate,
  }).catch(() => ({ projectedIds: [], created: 0 }));
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
