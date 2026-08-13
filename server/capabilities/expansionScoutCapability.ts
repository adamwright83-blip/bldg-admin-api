import { and, desc, eq, isNotNull } from "drizzle-orm";
import {
  commercialAccountLocations,
  commercialAccounts,
  commercialMissions,
  commercialPipelineRecords,
  territoryOperatorProfiles,
} from "../../drizzle/schema";
import {
  evaluateExpansionScout,
  EXPANSION_SCOUT,
  type CapabilityEvaluation,
  type ExpansionScoutEvidence,
} from "../../shared/expansionScout";
import { getDb } from "../db";
import { projectGoldlineProgressionForIdentity } from "../driverGameWorld/progressionProjectionService";

export async function getExpansionScoutEvidence(input: {
  tenantId: string;
  actorId: string;
}): Promise<ExpansionScoutEvidence> {
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
          eq(commercialMissions.tenantId, input.tenantId),
          eq(commercialMissions.assignedTo, input.actorId),
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
      .where(eq(territoryOperatorProfiles.tenantId, input.tenantId))
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
      ...(profile ? [`territory_operator_profiles:${input.tenantId}`] : []),
    ],
  };
}

export async function evaluateExpansionScoutForIdentity(input: {
  tenantId: string;
  actorId: string;
}): Promise<CapabilityEvaluation> {
  const [progression, sourceEvaluation] = await Promise.all([
    projectGoldlineProgressionForIdentity(input),
    getExpansionScoutEvidence(input).then(evaluateExpansionScout),
  ]);
  const scout = progression.agents.find(agent => agent.agentId === "SCOUT");
  const capture = progression.unlocks.find(
    unlock => unlock.ruleId === "FIRST_CAPTURE"
  );
  const unlocked = scout?.eligible ?? false;
  return {
    capabilityId: EXPANSION_SCOUT,
    eligible: unlocked,
    unlocked,
    reasons: unlocked
      ? sourceEvaluation.eligible
        ? sourceEvaluation.reasons
        : [
            "Scout is eligible from FIRST_CAPTURE; current source data yields zero runnable discovery searches",
            ...sourceEvaluation.reasons,
          ]
      : ["FIRST_CAPTURE authoritative evidence is required"],
    sourceReferences: scout?.evidenceRefs.map(ref => ref.sourceRef) ?? [],
    evidenceSummary: {
      ruleId: "FIRST_CAPTURE",
      ruleVersion: progression.ruleVersion,
      operationalSourceReady: sourceEvaluation.eligible,
      ...sourceEvaluation.evidenceSummary,
    },
    unlockedAt: capture?.earnedAt ?? null,
  };
}
