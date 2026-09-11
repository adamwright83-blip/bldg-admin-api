/**
 * Slice 1 — growth campaign library service.
 *
 * A campaign is an editable template. Editing/enabling/disabling one never
 * requires a deploy. See docs/goldline/BUILD_BRIEF_SLICES_1_5.md Slice 1.
 */
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { goldlineCampaigns } from "../../drizzle/schema";
import { getDb } from "../db";
import type {
  FallbackVariant,
  GrowthCampaign,
  GrowthCampaignInput,
  GrowthCampaignPatch,
  LegacyContractRef,
  MissionCategory,
  PocketKind,
  TimingAssumption,
} from "./campaignLibraryTypes";

function toRecord(row: typeof goldlineCampaigns.$inferSelect): GrowthCampaign {
  return {
    id: row.id,
    tenantId: row.tenantId,
    campaignId: row.campaignId,
    enabled: row.enabled,
    title: row.title,
    objective: row.objective,
    completionCondition: row.completionCondition,
    prepLeadDays: row.prepLeadDays,
    prepCondition: row.prepCondition ?? null,
    pocketKind: row.pocketKind as PocketKind,
    pocketMinutesMin: row.pocketMinutesMin,
    fallbackVariant: (row.fallbackVariantJson as FallbackVariant | null) ?? null,
    autoVerifiable: (row.autoVerifiableJson as string[]) ?? [],
    selfReported: (row.selfReportedJson as string[]) ?? [],
    missionCategory: row.missionCategory as MissionCategory,
    companionAbilityId: row.companionAbilityId ?? null,
    timingAssumptions: (row.timingAssumptionsJson as TimingAssumption[]) ?? [],
    opsTaskType: row.opsTaskType,
    legacyContract: (row.legacyContract as "lead_hunt" | null) ?? null,
    legacyContractRef:
      (row.legacyContractRefJson as LegacyContractRef | null) ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listCampaigns(input: {
  tenantId: string;
  includeDisabled?: boolean;
}): Promise<GrowthCampaign[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(goldlineCampaigns)
    .where(eq(goldlineCampaigns.tenantId, input.tenantId));
  const records = rows.map(toRecord);
  return input.includeDisabled
    ? records
    : records.filter(record => record.enabled);
}

export async function getCampaign(input: {
  tenantId: string;
  campaignId: string;
}): Promise<GrowthCampaign | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(goldlineCampaigns)
    .where(
      and(
        eq(goldlineCampaigns.tenantId, input.tenantId),
        eq(goldlineCampaigns.campaignId, input.campaignId)
      )
    )
    .limit(1);
  return row ? toRecord(row) : null;
}

export async function upsertCampaign(input: {
  tenantId: string;
  campaignId: string;
  campaign: GrowthCampaignInput;
}): Promise<GrowthCampaign> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await getCampaign(input);
  const row = {
    id: existing?.id ?? randomUUID(),
    tenantId: input.tenantId,
    campaignId: input.campaignId,
    enabled: input.campaign.enabled,
    title: input.campaign.title,
    objective: input.campaign.objective,
    completionCondition: input.campaign.completionCondition,
    prepLeadDays: input.campaign.prepLeadDays,
    prepCondition: input.campaign.prepCondition,
    pocketKind: input.campaign.pocketKind,
    pocketMinutesMin: input.campaign.pocketMinutesMin,
    fallbackVariantJson: input.campaign.fallbackVariant,
    autoVerifiableJson: input.campaign.autoVerifiable,
    selfReportedJson: input.campaign.selfReported,
    missionCategory: input.campaign.missionCategory,
    companionAbilityId: input.campaign.companionAbilityId,
    timingAssumptionsJson: input.campaign.timingAssumptions,
    opsTaskType: input.campaign.opsTaskType,
    legacyContract: input.campaign.legacyContract,
    legacyContractRefJson: input.campaign.legacyContractRef,
  };
  if (existing) {
    await db
      .update(goldlineCampaigns)
      .set(row)
      .where(
        and(
          eq(goldlineCampaigns.tenantId, input.tenantId),
          eq(goldlineCampaigns.campaignId, input.campaignId)
        )
      );
  } else {
    await db.insert(goldlineCampaigns).values(row);
  }
  const stored = await getCampaign(input);
  if (!stored) throw new Error("Campaign was not persisted");
  return stored;
}

export async function patchCampaign(input: {
  tenantId: string;
  campaignId: string;
  patch: GrowthCampaignPatch;
}): Promise<GrowthCampaign> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await getCampaign(input);
  if (!existing) throw new Error(`Unknown campaign: ${input.campaignId}`);
  const set: Record<string, unknown> = {};
  if (input.patch.enabled !== undefined) set.enabled = input.patch.enabled;
  if (input.patch.title !== undefined) set.title = input.patch.title;
  if (input.patch.objective !== undefined) set.objective = input.patch.objective;
  if (input.patch.completionCondition !== undefined)
    set.completionCondition = input.patch.completionCondition;
  if (input.patch.prepLeadDays !== undefined)
    set.prepLeadDays = input.patch.prepLeadDays;
  if (input.patch.prepCondition !== undefined)
    set.prepCondition = input.patch.prepCondition;
  if (input.patch.pocketKind !== undefined)
    set.pocketKind = input.patch.pocketKind;
  if (input.patch.pocketMinutesMin !== undefined)
    set.pocketMinutesMin = input.patch.pocketMinutesMin;
  if (input.patch.fallbackVariant !== undefined)
    set.fallbackVariantJson = input.patch.fallbackVariant;
  if (input.patch.autoVerifiable !== undefined)
    set.autoVerifiableJson = input.patch.autoVerifiable;
  if (input.patch.selfReported !== undefined)
    set.selfReportedJson = input.patch.selfReported;
  if (input.patch.missionCategory !== undefined)
    set.missionCategory = input.patch.missionCategory;
  if (input.patch.companionAbilityId !== undefined)
    set.companionAbilityId = input.patch.companionAbilityId;
  if (input.patch.timingAssumptions !== undefined)
    set.timingAssumptionsJson = input.patch.timingAssumptions;
  if (input.patch.opsTaskType !== undefined)
    set.opsTaskType = input.patch.opsTaskType;
  await db
    .update(goldlineCampaigns)
    .set(set)
    .where(
      and(
        eq(goldlineCampaigns.tenantId, input.tenantId),
        eq(goldlineCampaigns.campaignId, input.campaignId)
      )
    );
  const stored = await getCampaign(input);
  if (!stored) throw new Error("Campaign was not persisted");
  return stored;
}

export async function setCampaignEnabled(input: {
  tenantId: string;
  campaignId: string;
  enabled: boolean;
}): Promise<GrowthCampaign> {
  return patchCampaign({
    tenantId: input.tenantId,
    campaignId: input.campaignId,
    patch: { enabled: input.enabled },
  });
}

/**
 * Idempotent seed. Only inserts campaigns that do not already exist by
 * campaignId — never overwrites an operator's edits on reseed.
 */
export async function seedCampaignsIfMissing(input: {
  tenantId: string;
  campaigns: Array<{ campaignId: string; campaign: GrowthCampaignInput }>;
}): Promise<{ inserted: string[]; skipped: string[] }> {
  const db = await getDb();
  if (!db) return { inserted: [], skipped: [] };
  const inserted: string[] = [];
  const skipped: string[] = [];
  for (const seed of input.campaigns) {
    const existing = await getCampaign({
      tenantId: input.tenantId,
      campaignId: seed.campaignId,
    });
    if (existing) {
      skipped.push(seed.campaignId);
      continue;
    }
    await upsertCampaign({
      tenantId: input.tenantId,
      campaignId: seed.campaignId,
      campaign: seed.campaign,
    });
    inserted.push(seed.campaignId);
  }
  return { inserted, skipped };
}
