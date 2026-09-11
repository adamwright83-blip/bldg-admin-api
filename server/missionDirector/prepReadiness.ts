/**
 * Slice 4 §6 (prep lead-time) — real evidence, not a trusted flag.
 * A campaign with prepLeadDays > 0 is only eligible when a completed
 * ops_tasks row of its opsTaskType exists, created early enough to satisfy
 * the lead time.
 */
import { and, eq } from "drizzle-orm";
import { opsTasks } from "../../drizzle/schema";
import { getDb } from "../db";
import type { GrowthCampaign } from "../campaignLibrary/campaignLibraryTypes";

function daysBefore(businessDate: string, days: number): string {
  const [y, m, d] = businessDate.split("-").map(Number);
  const date = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

export async function computePrepReadiness(input: {
  tenantId: string;
  businessDate: string;
  campaigns: readonly GrowthCampaign[];
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
      .select({ id: opsTasks.id, createdAt: opsTasks.createdAt })
      .from(opsTasks)
      .where(
        and(
          eq(opsTasks.tenantId, input.tenantId),
          eq(opsTasks.taskType, campaign.opsTaskType as (typeof opsTasks.$inferSelect)["taskType"]),
          eq(opsTasks.status, "completed")
        )
      );
    const ready = rows.some(row => row.createdAt.toISOString().slice(0, 10) <= deadline);
    readiness[campaign.campaignId] = ready;
  }
  return readiness;
}
