import { randomUUID } from "node:crypto";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import {
  commercialAccountLocations,
  commercialAccounts,
  commercialMissions,
  commercialPipelineRecords,
  driverCapabilityUnlocks,
  territoryOperatorProfiles,
} from "../../drizzle/schema";
import {
  evaluateExpansionScout,
  EXPANSION_SCOUT,
  type CapabilityEvaluation,
  type ExpansionScoutEvidence,
} from "../../shared/expansionScout";
import { getDb } from "../db";

export async function getExpansionScoutEvidence(
  tenantId: string
): Promise<ExpansionScoutEvidence> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [wonRows, profiles] = await Promise.all([
    db
      .select({
        missionId: commercialMissions.id,
        accountId: commercialAccounts.id,
        accountType: commercialAccounts.accountType,
        address: commercialAccountLocations.address,
        latitude: commercialAccountLocations.latitude,
        longitude: commercialAccountLocations.longitude,
        approvedValue: commercialPipelineRecords.approvedContractValueCents,
      })
      .from(commercialMissions)
      .innerJoin(
        commercialPipelineRecords,
        and(
          eq(commercialPipelineRecords.tenantId, commercialMissions.tenantId),
          eq(commercialPipelineRecords.missionId, commercialMissions.id),
          eq(commercialPipelineRecords.stage, "won"),
          isNotNull(commercialPipelineRecords.approvedContractValueCents)
        )
      )
      .innerJoin(
        commercialAccounts,
        and(
          eq(commercialAccounts.tenantId, commercialMissions.tenantId),
          eq(commercialAccounts.id, commercialPipelineRecords.accountId)
        )
      )
      .leftJoin(
        commercialAccountLocations,
        and(
          eq(commercialAccountLocations.tenantId, commercialMissions.tenantId),
          eq(commercialAccountLocations.accountId, commercialAccounts.id),
          eq(commercialAccountLocations.isPrimary, true)
        )
      )
      .where(
        and(
          eq(commercialMissions.tenantId, tenantId),
          eq(commercialMissions.status, "won")
        )
      )
      .orderBy(
        desc(commercialMissions.completedAt),
        desc(commercialMissions.id)
      ),
    db
      .select()
      .from(territoryOperatorProfiles)
      .where(eq(territoryOperatorProfiles.tenantId, tenantId))
      .limit(1),
  ]);
  const won =
    wonRows.find(
      row =>
        Boolean(row.accountType && row.accountType !== "other") &&
        Boolean(row.address && row.latitude && row.longitude)
    ) ?? wonRows[0];
  const profile = profiles[0];
  return {
    verifiedWin: Boolean(won),
    accountArchetype: won?.accountType ?? null,
    accountAddress: won?.address ?? null,
    latitude: won?.latitude == null ? null : Number(won.latitude),
    longitude: won?.longitude == null ? null : Number(won.longitude),
    serviceType: profile?.commercialWashFoldEnabled
      ? "commercial_wash_fold"
      : null,
    serviceRadiusMiles: profile ? Number(profile.serviceRadiusMiles) : null,
    commercialServiceEnabled: profile?.commercialWashFoldEnabled ?? false,
    sourceReferences: [
      ...(won
        ? [
            `commercial_missions:${won.missionId}`,
            `commercial_accounts:${won.accountId}`,
            `commercial_pipeline_records:mission:${won.missionId}`,
          ]
        : []),
      ...(profile ? [`territory_operator_profiles:${tenantId}`] : []),
    ],
  };
}

export async function evaluateAndPersistExpansionScout(input: {
  tenantId: string;
  actorId: string;
}): Promise<CapabilityEvaluation> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [persisted] = await db
    .select()
    .from(driverCapabilityUnlocks)
    .where(
      and(
        eq(driverCapabilityUnlocks.tenantId, input.tenantId),
        eq(driverCapabilityUnlocks.scopeId, "tenant_business"),
        eq(driverCapabilityUnlocks.capabilityId, EXPANSION_SCOUT)
      )
    )
    .limit(1);
  if (persisted) {
    return {
      capabilityId: EXPANSION_SCOUT,
      eligible: true,
      unlocked: true,
      reasons: [
        "Expansion Scout is durably unlocked from verified business evidence",
      ],
      sourceReferences: persisted.sourceReferencesJson as string[],
      evidenceSummary: persisted.evidenceSummaryJson as Record<string, unknown>,
      unlockedAt: persisted.unlockedAt.toISOString(),
    };
  }
  const evaluation = evaluateExpansionScout(
    await getExpansionScoutEvidence(input.tenantId)
  );
  if (!evaluation.eligible) {
    return { ...evaluation, unlocked: false, unlockedAt: null };
  }
  const unlockedAt = new Date();
  await db
    .insert(driverCapabilityUnlocks)
    .values({
      id: randomUUID(),
      tenantId: input.tenantId,
      scopeId: "tenant_business",
      capabilityId: EXPANSION_SCOUT,
      unlockedByActorId: input.actorId,
      unlockedAt,
      sourceReferencesJson: evaluation.sourceReferences,
      evidenceSummaryJson: evaluation.evidenceSummary,
    })
    .onDuplicateKeyUpdate({
      set: { capabilityId: EXPANSION_SCOUT },
    });
  const [unlock] = await db
    .select()
    .from(driverCapabilityUnlocks)
    .where(
      and(
        eq(driverCapabilityUnlocks.tenantId, input.tenantId),
        eq(driverCapabilityUnlocks.scopeId, "tenant_business"),
        eq(driverCapabilityUnlocks.capabilityId, EXPANSION_SCOUT)
      )
    )
    .limit(1);
  return {
    ...evaluation,
    unlocked: true,
    unlockedAt: (unlock?.unlockedAt ?? unlockedAt).toISOString(),
  };
}
