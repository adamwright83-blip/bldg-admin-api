import { and, asc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { goldlineKingdoms } from "../../drizzle/schema";
import { getDb } from "../db";
import type {
  GoldlineKingdom,
  GoldlineKingdomInput,
  LanternCityStatus,
} from "./kingdomTypes";

function toRecord(row: typeof goldlineKingdoms.$inferSelect): GoldlineKingdom {
  return {
    id: row.id,
    tenantId: row.tenantId,
    kingdomId: row.kingdomId,
    sequence: row.sequence,
    title: row.title,
    realCampaignId: row.realCampaignId ?? null,
    fictionalFieldMission: row.fictionalFieldMission,
    lanternCityStatus: row.lanternCityStatus as LanternCityStatus,
    driverDayRelevance: row.driverDayRelevance,
    companionEarnedId: row.companionEarnedId ?? null,
    enablesKingdomId: row.enablesKingdomId ?? null,
    capabilityRequirement: row.capabilityRequirement ?? null,
    selectedAt: row.selectedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listKingdoms(input: {
  tenantId: string;
}): Promise<GoldlineKingdom[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(goldlineKingdoms)
    .where(eq(goldlineKingdoms.tenantId, input.tenantId))
    .orderBy(asc(goldlineKingdoms.sequence));
  return rows.map(toRecord);
}

export async function getKingdom(input: {
  tenantId: string;
  kingdomId: string;
}): Promise<GoldlineKingdom | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(goldlineKingdoms)
    .where(
      and(
        eq(goldlineKingdoms.tenantId, input.tenantId),
        eq(goldlineKingdoms.kingdomId, input.kingdomId)
      )
    )
    .limit(1);
  return row ? toRecord(row) : null;
}

export async function seedKingdomIfMissing(input: {
  tenantId: string;
  kingdomId: string;
  kingdom: GoldlineKingdomInput;
}): Promise<GoldlineKingdom> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await getKingdom(input);
  if (existing) return existing;
  const row = {
    id: randomUUID(),
    tenantId: input.tenantId,
    kingdomId: input.kingdomId,
    sequence: input.kingdom.sequence,
    title: input.kingdom.title,
    realCampaignId: input.kingdom.realCampaignId,
    fictionalFieldMission: input.kingdom.fictionalFieldMission,
    lanternCityStatus: input.kingdom.lanternCityStatus,
    driverDayRelevance: input.kingdom.driverDayRelevance,
    companionEarnedId: input.kingdom.companionEarnedId,
    enablesKingdomId: input.kingdom.enablesKingdomId,
    capabilityRequirement: input.kingdom.capabilityRequirement,
    selectedAt: input.kingdom.selectedAt ? new Date(input.kingdom.selectedAt) : null,
  };
  await db.insert(goldlineKingdoms).values(row);
  const stored = await getKingdom(input);
  if (!stored) throw new Error("Kingdom was not persisted");
  return stored;
}

/**
 * Slice 2 §2.4 — Kingdom 3's review-surface decision. Adam selects one real
 * campaign from the library and the system records the selection plus the
 * capability requirement. Nothing auto-selects; no companion is invented
 * here (companionEarnedId is set later, in Slice 3).
 */
export async function selectKingdomCampaign(input: {
  tenantId: string;
  kingdomId: string;
  realCampaignId: string;
  capabilityRequirement: string;
}): Promise<GoldlineKingdom> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await getKingdom(input);
  if (!existing) throw new Error(`Unknown kingdom: ${input.kingdomId}`);
  await db
    .update(goldlineKingdoms)
    .set({
      realCampaignId: input.realCampaignId,
      capabilityRequirement: input.capabilityRequirement,
      selectedAt: new Date(),
    })
    .where(
      and(
        eq(goldlineKingdoms.tenantId, input.tenantId),
        eq(goldlineKingdoms.kingdomId, input.kingdomId)
      )
    );
  const stored = await getKingdom(input);
  if (!stored) throw new Error("Kingdom was not persisted");
  return stored;
}

export async function setKingdomCompanion(input: {
  tenantId: string;
  kingdomId: string;
  companionEarnedId: string;
}): Promise<GoldlineKingdom> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(goldlineKingdoms)
    .set({ companionEarnedId: input.companionEarnedId })
    .where(
      and(
        eq(goldlineKingdoms.tenantId, input.tenantId),
        eq(goldlineKingdoms.kingdomId, input.kingdomId)
      )
    );
  const stored = await getKingdom(input);
  if (!stored) throw new Error("Kingdom was not persisted");
  return stored;
}

export async function setKingdomStatus(input: {
  tenantId: string;
  kingdomId: string;
  lanternCityStatus: LanternCityStatus;
}): Promise<GoldlineKingdom> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(goldlineKingdoms)
    .set({ lanternCityStatus: input.lanternCityStatus })
    .where(
      and(
        eq(goldlineKingdoms.tenantId, input.tenantId),
        eq(goldlineKingdoms.kingdomId, input.kingdomId)
      )
    );
  const stored = await getKingdom(input);
  if (!stored) throw new Error("Kingdom was not persisted");
  return stored;
}
