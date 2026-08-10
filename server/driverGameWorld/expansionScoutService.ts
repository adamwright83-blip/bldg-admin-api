import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import {
  commercialAccounts,
  commercialMissions,
  driverCapabilityUnlocks,
  driverGameWorldNodes,
  driverScoutDiscoveries,
  driverScoutReports,
} from "../../drizzle/schema";
import type {
  CommercialMissionAccountSnapshot,
  CommercialMissionOpportunitySnapshot,
} from "../../shared/commercialMission";
import { EXPANSION_SCOUT, type ScoutReport } from "../../shared/expansionScout";
import { getDb } from "../db";
import { createCommercialMission } from "../commercialMissions/commercialMissionStore";
import { getExpansionScoutEvidence } from "../capabilities/expansionScoutCapability";
import {
  discoverLaundryTerritory,
  type TerritoryBusinessProvider,
} from "../territory/territoryDiscovery";
import {
  getTerritoryOperatorProfile,
  persistTerritoryScan,
} from "../territory/territoryStore";

const CATEGORY_BY_ARCHETYPE: Record<string, string[]> = {
  property_management: ["property management company", "apartment complex"],
  hotel: ["hotel"],
  gym: ["gym", "fitness center"],
  salon_spa: ["salon", "spa"],
  medical_office: ["medical office", "clinic"],
  restaurant: ["restaurant"],
};

async function readScoutReport(input: {
  tenantId: string;
  actorId: string;
  reportId?: string;
}): Promise<ScoutReport | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [report] = await db
    .select()
    .from(driverScoutReports)
    .where(
      and(
        eq(driverScoutReports.tenantId, input.tenantId),
        eq(driverScoutReports.actorId, input.actorId),
        ...(input.reportId ? [eq(driverScoutReports.id, input.reportId)] : [])
      )
    )
    .orderBy(desc(driverScoutReports.generatedAt))
    .limit(1);
  if (!report) return null;
  const rows = await db
    .select({
      discovery: driverScoutDiscoveries,
      mission: commercialMissions,
    })
    .from(driverScoutDiscoveries)
    .innerJoin(
      commercialMissions,
      and(
        eq(commercialMissions.tenantId, driverScoutDiscoveries.tenantId),
        eq(commercialMissions.id, driverScoutDiscoveries.missionId)
      )
    )
    .where(
      and(
        eq(driverScoutDiscoveries.tenantId, input.tenantId),
        eq(driverScoutDiscoveries.actorId, input.actorId),
        eq(driverScoutDiscoveries.reportId, report.id)
      )
    );
  return {
    id: report.id,
    generatedAt: report.generatedAt.toISOString(),
    sourceReferences: report.sourceReferencesJson as string[],
    criteria: report.criteriaJson as ScoutReport["criteria"],
    discoveries: rows.map(({ discovery, mission }) => {
      const account =
        mission.accountSnapshotJson as CommercialMissionAccountSnapshot;
      const opportunity =
        mission.opportunitySnapshotJson as CommercialMissionOpportunitySnapshot;
      return {
        entityId: String(account.accountId),
        missionId: mission.id,
        companyName: account.name,
        address: account.address,
        matchScore: opportunity.score,
        evidence: [opportunity.primarySignal, ...opportunity.reasons],
        sourceReference: discovery.sourceReference,
      };
    }),
  };
}

export async function getLatestScoutReport(input: {
  tenantId: string;
  actorId: string;
}) {
  return readScoutReport(input);
}

export async function runExpansionScout(input: {
  tenantId: string;
  actorId: string;
  requestId: string;
  provider: TerritoryBusinessProvider;
}): Promise<ScoutReport> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [replay] = await db
    .select({ id: driverScoutReports.id })
    .from(driverScoutReports)
    .where(
      and(
        eq(driverScoutReports.tenantId, input.tenantId),
        eq(driverScoutReports.actorId, input.actorId),
        eq(driverScoutReports.requestId, input.requestId)
      )
    )
    .limit(1);
  if (replay) {
    const report = await readScoutReport({ ...input, reportId: replay.id });
    if (!report) throw new Error("Persisted Scout report is unavailable");
    return report;
  }
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
  if (!unlock) throw new Error("Expansion Scout is not unlocked");
  const [evidence, operator] = await Promise.all([
    getExpansionScoutEvidence(input.tenantId),
    getTerritoryOperatorProfile(input.tenantId),
  ]);
  if (
    !operator ||
    !evidence.accountAddress ||
    !evidence.accountArchetype ||
    evidence.serviceRadiusMiles == null
  ) {
    throw new Error("Scout evidence is no longer available for a new search");
  }
  const categories = CATEGORY_BY_ARCHETYPE[evidence.accountArchetype] ?? [];
  const discovery = await discoverLaundryTerritory({
    addressOrBusiness: evidence.accountAddress,
    provider: input.provider,
    operator,
    categories,
    limit: 20,
  });
  const persistedScan = await persistTerritoryScan({
    tenantId: input.tenantId,
    mode: "tenant",
    addressQuery: evidence.accountAddress,
    createdBy: input.actorId,
    result: discovery,
  });
  const existingAccounts = await db
    .select({
      providerName: commercialAccounts.providerName,
      providerAccountId: commercialAccounts.providerAccountId,
    })
    .from(commercialAccounts)
    .where(eq(commercialAccounts.tenantId, input.tenantId));
  const existingProviderKeys = new Set(
    existingAccounts
      .filter(row => row.providerName && row.providerAccountId)
      .map(row => `${row.providerName}:${row.providerAccountId}`)
  );
  const candidates = discovery.opportunities
    .filter(
      opportunity =>
        !existingProviderKeys.has(
          `${opportunity.providerName}:${opportunity.providerAccountId}`
        )
    )
    .slice(0, 3);
  const reportId = randomUUID();
  await db.insert(driverScoutReports).values({
    id: reportId,
    tenantId: input.tenantId,
    actorId: input.actorId,
    requestId: input.requestId,
    capabilityUnlockId: unlock.id,
    sourceScanId: persistedScan.scanId,
    criteriaJson: {
      archetype: evidence.accountArchetype,
      area: evidence.accountAddress,
      radiusMiles: evidence.serviceRadiusMiles,
    },
    sourceReferencesJson: [
      ...evidence.sourceReferences,
      `territory_scan_sessions:${persistedScan.scanId}`,
    ],
    discoveryCount: candidates.length,
  });
  for (const candidate of candidates) {
    const mission = await createCommercialMission({
      tenantId: input.tenantId,
      assignedTo: input.actorId,
      account: {
        providerName: candidate.providerName,
        providerAccountId: candidate.providerAccountId,
        name: candidate.account.name,
        accountType: candidate.account.accountType,
        website: candidate.account.website,
        address: candidate.account.address,
        latitude: candidate.account.latitude,
        longitude: candidate.account.longitude,
        locationCount: candidate.account.locationCount,
        decisionMaker: {
          ...candidate.account.decisionMaker,
          phone: candidate.account.phone,
          preferredChannel: candidate.account.phone ? "phone" : "unknown",
          relationshipType: "unknown",
          source: "provider_sourced",
          sourcedAt:
            candidate.evidence[0]?.capturedAt ?? new Date().toISOString(),
        },
      },
      opportunity: {
        estimatedAnnualValueCents: candidate.score.estimatedAnnualValueCents,
        estimateConfidence: candidate.score.grade,
        score: candidate.score.score,
        primarySignal: candidate.primarySignal,
        reasons: candidate.score.reasons,
        risks: candidate.score.risks,
        evidence: [
          ...candidate.evidence,
          {
            source: "driver_mission_builder",
            missionType: candidate.account.phone ? "cold_call" : "in_person",
            venueType: evidence.accountArchetype,
            scoutReportId: reportId,
            sourceScanId: persistedScan.scanId,
          },
        ],
      },
      brief: {
        laundryOpportunity: `Sourced lookalike opportunity for ${candidate.account.name}.`,
        salesAngle: `A local commercial laundry program matched to the verified ${evidence.accountArchetype} account pattern.`,
        openingLine: `Who is the right person to discuss recurring laundry service for ${candidate.account.name}?`,
        discoveryQuestions: [
          "How is recurring laundry handled today?",
          "Which pickup cadence fits this operation?",
        ],
        objections: ["Current provider", "Pricing", "Turnaround"],
      },
      steps: [
        {
          key: "scout",
          label: "Scout evidence",
          detail: `Review sourced evidence from ${candidate.providerName}.`,
          status: "completed",
          position: 0,
        },
        {
          key: "prepare",
          label: "Prepare",
          detail: "Review the sourced opening line and account evidence.",
          status: "ready",
          position: 1,
        },
        {
          key: "field",
          label: candidate.account.phone ? "Call" : "Visit",
          detail: candidate.account.phone
            ? "Place the real call and record its outcome."
            : "Approach the real sourced location.",
          status: "locked",
          position: 2,
        },
      ],
      actor: { type: "game", id: input.actorId },
      idempotencyKey: `scout:${reportId}:${candidate.candidateKey}`.slice(
        0,
        191
      ),
    });
    const sourceReference = `territory_scan_results:${persistedScan.scanId}:${candidate.candidateKey}`;
    await db.transaction(async tx => {
      await tx.insert(driverScoutDiscoveries).values({
        id: randomUUID(),
        reportId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        candidateKey: candidate.candidateKey,
        providerName: candidate.providerName,
        providerAccountId: candidate.providerAccountId,
        sourceReference,
        missionId: mission.id,
      });
      await tx
        .insert(driverGameWorldNodes)
        .values({
          id: randomUUID(),
          tenantId: input.tenantId,
          actorId: input.actorId,
          missionId: mission.id,
          entityType: "commercial_mission",
          entityId: String(mission.id),
          locationId: null,
          visualState: "available",
          worldAnchor: `scout_region_${candidate.account.accountType}`.slice(
            0,
            64
          ),
          unlockedPath: "scout_gold_path",
          discoveryState: "discovered",
          metadataJson: {
            source: "expansion_scout",
            reportId,
            sourceReference,
          },
        })
        .onDuplicateKeyUpdate({
          set: {
            discoveryState: "discovered",
            unlockedPath: "scout_gold_path",
          },
        });
    });
  }
  const report = await readScoutReport({ ...input, reportId });
  if (!report) throw new Error("Scout report was not persisted");
  return report;
}
