import { and, desc, eq } from "drizzle-orm";
import { weeklyIntents } from "../../../drizzle/schema";
import type { WeeklyIntentRecord } from "../../../shared/weeklyMissionReadiness";
import { getDb } from "../../db";

export async function latestWeeklyIntent(input: {
  tenantId: string;
  operatorId: string;
  weekStart: string;
}): Promise<WeeklyIntentRecord | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(weeklyIntents)
    .where(
      and(
        eq(weeklyIntents.tenantId, input.tenantId),
        eq(weeklyIntents.operatorId, input.operatorId),
        eq(weeklyIntents.weekStart, input.weekStart)
      )
    )
    .orderBy(desc(weeklyIntents.revision))
    .limit(1);
  if (!row) return null;
  const days = typeof row.daysJson === "string" ? JSON.parse(row.daysJson) : row.daysJson;
  return {
    id: row.id,
    tenantId: row.tenantId,
    operatorId: row.operatorId,
    weekStart: row.weekStart,
    revision: row.revision,
    source: "operator_confirmed_proposal",
    lockedAt: row.lockedAt.toISOString(),
    days: Array.isArray(days) ? days : [],
  };
}

export async function saveWeeklyIntent(intent: WeeklyIntentRecord): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(weeklyIntents).values({
    id: intent.id,
    tenantId: intent.tenantId,
    operatorId: intent.operatorId,
    weekStart: intent.weekStart,
    revision: intent.revision,
    source: intent.source,
    lockedAt: new Date(intent.lockedAt),
    daysJson: intent.days,
  });
}
