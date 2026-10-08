/**
 * Slice 4 §6 (prep lead-time) — completion evidence, not a trusted flag.
 *
 * A campaign with prepLeadDays > 0 is eligible only when a matching ops task
 * has a durable completion time, a named completing actor, and the authoritative
 * ops_task_events.completed record created by the completion path. createdAt is
 * never prep-completion evidence.
 */
import { and, eq } from "drizzle-orm";
import { formatInTimeZone } from "date-fns-tz";
import { opsTaskEvents, opsTasks } from "../../../drizzle/schema";
import { getDb } from "../../db";
import type { GrowthCampaign } from "../../campaignLibrary/campaignLibraryTypes";

function daysBefore(businessDate: string, days: number): string {
  const [y, m, d] = businessDate.split("-").map(Number);
  const date = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

export type PrepCompletionEvidence = {
  completedAt: Date | null;
  completedBy: string | null;
  completionEventId: number | null;
  completionActorId: string | null;
};

export type PrepCompletionEvaluation = {
  ready: boolean;
  reason: string | null;
};

export function evaluatePrepCompletionEvidence(
  row: PrepCompletionEvidence,
  deadline: string,
  timeZone: string
): PrepCompletionEvaluation {
  if (!row.completedAt) {
    return { ready: false, reason: "ops_tasks.completedAt missing" };
  }
  const completedBy = row.completedBy?.trim() ?? "";
  if (!completedBy) {
    return { ready: false, reason: "ops_tasks.completedBy missing" };
  }
  if (row.completionEventId == null) {
    return {
      ready: false,
      reason: "ops_task_events.completed evidence missing",
    };
  }
  const completionActorId = row.completionActorId?.trim() ?? "";
  if (!completionActorId) {
    return {
      ready: false,
      reason: "ops_task_events.completed.actorId missing",
    };
  }
  if (completionActorId !== completedBy) {
    return {
      ready: false,
      reason: "ops task completion actor does not match completion event actor",
    };
  }
  if (formatInTimeZone(row.completedAt, timeZone, "yyyy-MM-dd") > deadline) {
    return {
      ready: false,
      reason: "ops_tasks.completedAt is after the prep lead-time deadline",
    };
  }
  return { ready: true, reason: null };
}

export async function computePrepReadiness(input: {
  tenantId: string;
  businessDate: string;
  campaigns: readonly GrowthCampaign[];
  timeZone: string;
}): Promise<Record<string, boolean>> {
  const db = await getDb();
  const readiness: Record<string, boolean> = {};
  const withPrep = input.campaigns.filter(campaign => campaign.prepLeadDays > 0);
  if (!db || withPrep.length === 0) {
    for (const campaign of withPrep) readiness[campaign.campaignId] = false;
    return readiness;
  }
  for (const campaign of withPrep) {
    const deadline = daysBefore(input.businessDate, campaign.prepLeadDays);
    const rows = await db
      .select({
        completedAt: opsTasks.completedAt,
        completedBy: opsTasks.completedBy,
        completionEventId: opsTaskEvents.id,
        completionActorId: opsTaskEvents.actorId,
      })
      .from(opsTasks)
      .leftJoin(
        opsTaskEvents,
        and(
          eq(opsTaskEvents.tenantId, input.tenantId),
          eq(opsTaskEvents.taskId, opsTasks.id),
          eq(opsTaskEvents.eventType, "completed")
        )
      )
      .where(
        and(
          eq(opsTasks.tenantId, input.tenantId),
          eq(
            opsTasks.taskType,
            campaign.opsTaskType as (typeof opsTasks.$inferSelect)["taskType"]
          ),
          eq(opsTasks.status, "completed")
        )
      );
    readiness[campaign.campaignId] = rows.some(
      row => evaluatePrepCompletionEvidence(row, deadline, input.timeZone).ready
    );
  }
  return readiness;
}
