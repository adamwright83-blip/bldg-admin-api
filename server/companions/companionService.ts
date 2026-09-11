/**
 * Slice 3 — companion roster + earned-state service.
 * See docs/goldline/BUILD_BRIEF_SLICES_1_5.md Slice 3.
 */
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { goldlineCompanions, goldlineCompanionUnlocks, opsTasks } from "../../drizzle/schema";
import { getDb } from "../db";
import type { CompanionUnlock, GoldlineCompanion, GoldlineCompanionInput } from "./companionTypes";
import { SEED_COMPANIONS } from "./seedCompanions";

function toRecord(row: typeof goldlineCompanions.$inferSelect): GoldlineCompanion {
  return {
    id: row.id,
    tenantId: row.tenantId,
    companionId: row.companionId,
    name: row.name,
    fictionTruth: row.fictionTruth,
    afterAvailableText: row.afterAvailableText,
    may: (row.mayJson as string[]) ?? [],
    mayNot: (row.mayNotJson as string[]) ?? [],
    fantasyExpression: (row.fantasyExpressionJson as string[]) ?? [],
    abilityId: row.abilityId,
    abilityDescription: row.abilityDescription,
    unifiedProductPersona: row.unifiedProductPersona,
    productPersonaNote: row.productPersonaNote ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toUnlock(row: typeof goldlineCompanionUnlocks.$inferSelect): CompanionUnlock {
  return {
    id: row.id,
    tenantId: row.tenantId,
    operatorId: row.operatorId,
    companionId: row.companionId,
    earnedAt: row.earnedAt.toISOString(),
    earnedViaKingdomId: row.earnedViaKingdomId,
    earnedViaCampaignId: row.earnedViaCampaignId,
    evidenceOpsTaskId: row.evidenceOpsTaskId,
  };
}

export async function listCompanions(input: {
  tenantId: string;
}): Promise<GoldlineCompanion[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(goldlineCompanions)
    .where(eq(goldlineCompanions.tenantId, input.tenantId));
  return rows.map(toRecord);
}

export async function getCompanion(input: {
  tenantId: string;
  companionId: string;
}): Promise<GoldlineCompanion | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(goldlineCompanions)
    .where(
      and(
        eq(goldlineCompanions.tenantId, input.tenantId),
        eq(goldlineCompanions.companionId, input.companionId)
      )
    )
    .limit(1);
  return row ? toRecord(row) : null;
}

export async function seedCompanionRoster(input: {
  tenantId: string;
}): Promise<{ inserted: string[]; skipped: string[] }> {
  const db = await getDb();
  if (!db) return { inserted: [], skipped: [] };
  const inserted: string[] = [];
  const skipped: string[] = [];
  for (const seed of SEED_COMPANIONS) {
    const existing = await getCompanion({
      tenantId: input.tenantId,
      companionId: seed.companionId,
    });
    if (existing) {
      skipped.push(seed.companionId);
      continue;
    }
    await db.insert(goldlineCompanions).values({
      id: randomUUID(),
      tenantId: input.tenantId,
      companionId: seed.companionId,
      name: seed.companion.name,
      fictionTruth: seed.companion.fictionTruth,
      afterAvailableText: seed.companion.afterAvailableText,
      mayJson: seed.companion.may,
      mayNotJson: seed.companion.mayNot,
      fantasyExpressionJson: seed.companion.fantasyExpression,
      abilityId: seed.companion.abilityId,
      abilityDescription: seed.companion.abilityDescription,
      unifiedProductPersona: seed.companion.unifiedProductPersona,
      productPersonaNote: seed.companion.productPersonaNote,
    });
    inserted.push(seed.companionId);
  }
  return { inserted, skipped };
}

export async function listUnlocks(input: {
  tenantId: string;
  operatorId: string;
}): Promise<CompanionUnlock[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(goldlineCompanionUnlocks)
    .where(
      and(
        eq(goldlineCompanionUnlocks.tenantId, input.tenantId),
        eq(goldlineCompanionUnlocks.operatorId, input.operatorId)
      )
    );
  return rows.map(toUnlock);
}

export async function isCompanionEarned(input: {
  tenantId: string;
  operatorId: string;
  companionId: string;
}): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const [row] = await db
    .select({ id: goldlineCompanionUnlocks.id })
    .from(goldlineCompanionUnlocks)
    .where(
      and(
        eq(goldlineCompanionUnlocks.tenantId, input.tenantId),
        eq(goldlineCompanionUnlocks.operatorId, input.operatorId),
        eq(goldlineCompanionUnlocks.companionId, input.companionId)
      )
    )
    .limit(1);
  return Boolean(row);
}

/**
 * The unlock transition. Companions are earned through real field work —
 * this function refuses to grant one without a real, completed ops_tasks
 * row as evidence. It never trusts fictional persistence alone.
 */
export async function earnCompanion(input: {
  tenantId: string;
  operatorId: string;
  companionId: string;
  kingdomId: string;
  campaignId: string;
  evidenceOpsTaskId: number;
}): Promise<CompanionUnlock> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [task] = await db
    .select()
    .from(opsTasks)
    .where(eq(opsTasks.id, input.evidenceOpsTaskId))
    .limit(1);
  if (!task) throw new Error("Evidence ops task not found");
  if (task.status !== "completed") {
    throw new Error("Evidence ops task is not completed — cannot earn companion");
  }
  if ((task.tenantId ?? "default") !== input.tenantId) {
    throw new Error("Evidence ops task belongs to a different tenant");
  }
  const already = await isCompanionEarned(input);
  if (already) {
    const existing = await listUnlocks(input);
    const found = existing.find(u => u.companionId === input.companionId);
    if (found) return found;
  }
  const row = {
    id: randomUUID(),
    tenantId: input.tenantId,
    operatorId: input.operatorId,
    companionId: input.companionId,
    earnedViaKingdomId: input.kingdomId,
    earnedViaCampaignId: input.campaignId,
    evidenceOpsTaskId: input.evidenceOpsTaskId,
  };
  try {
    await db.insert(goldlineCompanionUnlocks).values(row);
  } catch (error) {
    // Idempotent on the unique (tenant, operator, companion) key.
    const existing = await listUnlocks(input);
    const found = existing.find(u => u.companionId === input.companionId);
    if (found) return found;
    throw error;
  }
  const existing = await listUnlocks(input);
  const found = existing.find(u => u.companionId === input.companionId);
  if (!found) throw new Error("Companion unlock was not persisted");
  return found;
}
