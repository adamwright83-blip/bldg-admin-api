/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
/**
 * Autonomous Geographic Conquest & Route Density Propagation Engine
 *
 * Propagates account wins into immediate localized territory expansion:
 * 1. When an account is won, determines its physical coordinate and route corridor.
 * 2. Scans for neighboring commercial businesses within a tight route corridor (1.0 - 1.5 miles).
 * 3. Synthesizes or elevates high-density neighbor candidate missions.
 * 4. Generates tailored "Won neighbor account · Rapid corridor expansion" sales briefs
 *    leveraging the zero-delivery-fee advantage ("We already stop next door at X on Tuesdays").
 * 5. Emits candidate_boost learned deltas, ensuring the next Day Line ranking prioritizes
 *    dense cluster missions along the winning corridor.
 */

import { randomUUID } from "node:crypto";
import { and, eq, inArray, ne } from "drizzle-orm";
import {
  commercialAccounts,
  commercialAccountLocations,
  commercialMissions,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { createCommercialMission, listCommercialMissions } from "../commercialMissions/commercialMissionStore";
import { recordGoalCycleOutcome } from "./outcomeStore";
import { evaluateOutcomeAndRecordLearning } from "./learningStore";
import { haversineDistanceMiles } from "../procurement/vendorCandidateServiceAreaVerifier";

export type PropagateGeographicConquestInput = {
  tenantId: string;
  missionId?: number | null;
  accountId?: number | null;
  actorId?: string | null;
  radiusMiles?: number;
  maxNewCandidates?: number;
};

export type PropagateGeographicConquestResult = {
  propagated: boolean;
  wonAccount: {
    id: number;
    name: string;
    address: string | null;
    latitude: number | null;
    longitude: number | null;
  } | null;
  generatedMissions: Array<{
    missionId: number;
    accountName: string;
    distanceMiles?: number;
    reason: string;
  }>;
  reason?: string;
};

export async function propagateGeographicConquest(
  input: PropagateGeographicConquestInput
): Promise<PropagateGeographicConquestResult> {
  const db = await getDb();
  if (!db) {
    return { propagated: false, wonAccount: null, generatedMissions: [], reason: "Database unavailable" };
  }

  // 1. Resolve won account identity and location
  let accountId = input.accountId;
  let wonAccountName = "Commercial Account";

  if (!accountId && input.missionId) {
    const [mission] = await db
      .select({
        accountSnapshotJson: commercialMissions.accountSnapshotJson,
      })
      .from(commercialMissions)
      .where(
        and(
          eq(commercialMissions.tenantId, input.tenantId),
          eq(commercialMissions.id, input.missionId)
        )
      )
      .limit(1);

    const snapshot = mission?.accountSnapshotJson as {
      accountId?: number | string;
      name?: string;
    } | null;
    if (snapshot?.accountId) {
      accountId = Number(snapshot.accountId);
    }
    if (snapshot?.name) {
      wonAccountName = snapshot.name;
    }
  }

  if (!accountId) {
    return {
      propagated: false,
      wonAccount: null,
      generatedMissions: [],
      reason: "Could not resolve commercial account ID for won mission",
    };
  }

  const [accountRow] = await db
    .select({
      id: commercialAccounts.id,
      name: commercialAccounts.name,
    })
    .from(commercialAccounts)
    .where(
      and(
        eq(commercialAccounts.tenantId, input.tenantId),
        eq(commercialAccounts.id, accountId)
      )
    )
    .limit(1);

  if (accountRow?.name) {
    wonAccountName = accountRow.name;
  }

  const [locationRow] = await db
    .select()
    .from(commercialAccountLocations)
    .where(
      and(
        eq(commercialAccountLocations.tenantId, input.tenantId),
        eq(commercialAccountLocations.accountId, accountId)
      )
    )
    .limit(1);

  const wonLat = locationRow?.latitude ? Number(locationRow.latitude) : null;
  const wonLng = locationRow?.longitude ? Number(locationRow.longitude) : null;
  const wonAddress = locationRow?.address ?? null;

  const wonAccount = {
    id: accountId,
    name: wonAccountName,
    address: wonAddress,
    latitude: wonLat,
    longitude: wonLng,
  };

  const radiusMiles = input.radiusMiles ?? 1.5;
  const maxCandidates = input.maxNewCandidates ?? 3;
  const generatedMissions: PropagateGeographicConquestResult["generatedMissions"] = [];

  // 2. Query other accounts in the tenant's database to find nearby unserviced locations
  const otherLocations = await db
    .select({
      accountId: commercialAccountLocations.accountId,
      address: commercialAccountLocations.address,
      latitude: commercialAccountLocations.latitude,
      longitude: commercialAccountLocations.longitude,
      accountName: commercialAccounts.name,
      accountType: commercialAccounts.accountType,
    })
    .from(commercialAccountLocations)
    .innerJoin(
      commercialAccounts,
      and(
        eq(commercialAccountLocations.tenantId, commercialAccounts.tenantId),
        eq(commercialAccountLocations.accountId, commercialAccounts.id)
      )
    )
    .where(
      and(
        eq(commercialAccountLocations.tenantId, input.tenantId),
        ne(commercialAccountLocations.accountId, accountId)
      )
    )
    .limit(50);

  // Check which accounts already have active missions
  const existingMissions = await listCommercialMissions({
    tenantId: input.tenantId,
    limit: 100,
  });
  const existingMissionAccountIds = new Set(
    existingMissions
      .map(m => {
        const snap = m.account as { accountId?: number | string };
        return snap.accountId ? Number(snap.accountId) : null;
      })
      .filter((id): id is number => id !== null)
  );

  const nearbyOpportunities: Array<{
    accountId: number;
    name: string;
    address: string;
    accountType: string;
    distanceMiles: number;
  }> = [];

  if (wonLat !== null && wonLng !== null) {
    for (const loc of otherLocations) {
      if (existingMissionAccountIds.has(loc.accountId)) continue;
      if (!loc.latitude || !loc.longitude) continue;
      const candidateLat = Number(loc.latitude);
      const candidateLng = Number(loc.longitude);
      if (isNaN(candidateLat) || isNaN(candidateLng)) continue;

      const dist = haversineDistanceMiles(
        { lat: wonLat, lng: wonLng },
        { lat: candidateLat, lng: candidateLng }
      );
      if (dist <= radiusMiles) {
        nearbyOpportunities.push({
          accountId: loc.accountId,
          name: loc.accountName,
          address: loc.address,
          accountType: loc.accountType,
          distanceMiles: Math.round(dist * 100) / 100,
        });
      }
    }
  }

  // Sort by nearest distance
  nearbyOpportunities.sort((a, b) => a.distanceMiles - b.distanceMiles);

  // 3. Spawn candidate missions for nearby discovered businesses
  for (const opp of nearbyOpportunities.slice(0, maxCandidates)) {
    const candidateRunId = randomUUID().slice(0, 8);
    const mission = await createCommercialMission({
      tenantId: input.tenantId,
      assignedTo: input.actorId ?? null,
      account: {
        name: opp.name,
        accountType: opp.accountType,
        address: opp.address,
      },
      opportunity: {
        score: 85,
        estimateConfidence: "high",
        primarySignal: `Adjacent to recently won customer ${wonAccountName} (${opp.distanceMiles} mi away)`,
        reasons: ["LOCAL_ROUTE_DENSITY", "NEIGHBOR_ACCOUNT_WON", "CLUSTER_OPPORTUNITY"],
        risks: ["COLD_OUTREACH"],
        estimatedAnnualValueCents: 600000,
      },
      brief: {
        laundryOpportunity: `Direct corridor neighbor to ${wonAccountName}. Shared van drop-off minimizes transit overhead.`,
        salesAngle: `We already service ${wonAccountName} on this block every Tuesday/Thursday, so we can waive all delivery fees.`,
        openingLine: `Hi, our Goldline truck stops right next door at ${wonAccountName} every week—we noticed your towels/linens and can add you to the route with zero delivery fee.`,
        discoveryQuestions: [
          "How often do you currently receive laundry or linen deliveries?",
          "Would daily or bi-weekly route pickups along this corridor fit your schedule?",
        ],
        objections: ["We already have a vendor", "Price concerns"],
      },
      steps: [
        {
          key: `step-corridor-visit-${candidateRunId}`,
          label: `Walk-in pitch to ${opp.name}`,
          detail: `Zero-delivery-fee neighbor pitch referencing ${wonAccountName}`,
          status: "pending",
          position: 1,
          type: "irl_visit",
          instructionText: `Introduce Goldline as the neighbor vendor for ${wonAccountName}`,
          revealPolicy: "sequential",
          destinationName: opp.name,
          destinationAddress: opp.address,
        },
      ],
      actor: { type: "system", id: input.actorId ?? "geographic_conquest", role: "admin" },
      idempotencyKey: `geo-conquest-${accountId}-${opp.accountId}-${candidateRunId}`,
      initialPipelineStage: "discovered",
    });

    generatedMissions.push({
      missionId: mission.id,
      accountName: opp.name,
      distanceMiles: opp.distanceMiles,
      reason: `Spawned nearby corridor mission for ${opp.name} (${opp.distanceMiles} mi from won account ${wonAccountName})`,
    });
  }

  // 4. If no existing DB neighbors were found, synthesize an immediate high-density corridor expansion target
  if (generatedMissions.length === 0 && wonAddress) {
    const syntheticRunId = randomUUID().slice(0, 8);
    const corridorMission = await createCommercialMission({
      tenantId: input.tenantId,
      assignedTo: input.actorId ?? null,
      account: {
        name: `${wonAccountName} Corridor Prospect`,
        accountType: "commercial_laundry",
        address: wonAddress,
        latitude: wonLat,
        longitude: wonLng,
      },
      opportunity: {
        score: 80,
        estimateConfidence: "medium",
        primarySignal: `Immediate neighbor to won account ${wonAccountName} on active driver route`,
        reasons: ["LOCAL_ROUTE_DENSITY", "NEIGHBOR_ACCOUNT_WON"],
        risks: ["UNCONTACTED_DOOR"],
        estimatedAnnualValueCents: 500000,
      },
      brief: {
        laundryOpportunity: `Same-block commercial route expansion around ${wonAccountName}.`,
        salesAngle: `Active delivery corridor established at ${wonAccountName}. Pitch zero delivery fees for neighbor accounts.`,
        openingLine: `Hi! We just launched dedicated commercial laundry service next door at ${wonAccountName} and have extra capacity on this route.`,
        discoveryQuestions: [
          "Who manages your commercial linens and towels?",
          "Can we drop off a sample bag of freshly laundered linens for your team?",
        ],
        objections: ["Need to check with general manager"],
      },
      steps: [
        {
          key: `step-corridor-sweep-${syntheticRunId}`,
          label: `Corridor Door Outreach · Near ${wonAccountName}`,
          detail: `Visit neighboring commercial suites along ${wonAddress}`,
          status: "pending",
          position: 1,
          type: "irl_visit",
          instructionText: `Introduce Goldline to adjacent suites on the same block as ${wonAccountName}`,
          revealPolicy: "sequential",
          destinationName: `${wonAccountName} Corridor`,
          destinationAddress: wonAddress,
        },
      ],
      actor: { type: "system", id: input.actorId ?? "geographic_conquest", role: "admin" },
      idempotencyKey: `geo-corridor-${accountId}-${syntheticRunId}`,
      initialPipelineStage: "discovered",
    });

    generatedMissions.push({
      missionId: corridorMission.id,
      accountName: `${wonAccountName} Corridor Prospect`,
      distanceMiles: 0.1,
      reason: `Synthesized immediate corridor mission around ${wonAddress}`,
    });
  }

  // 5. Emit a candidate_boost learned delta to elevate corridor density in Persistent Growth planning
  try {
    const recorded = await recordGoalCycleOutcome({
      tenantId: input.tenantId,
      objectiveId: `conquest:${accountId}:${randomUUID().slice(0, 8)}`,
      outcomeKind: "geographic_conquest_expanded",
      impactClass: "operational_result",
      epistemicStatus: "verified",
      evidenceClass: "goldline_audit_log",
      evidenceReference: `accounts:commercial:${accountId}`,
      sourceSystem: "geographic_conquest",
      monetaryValueCents: null,
      observedAt: new Date(),
      explanation: `Account win at ${wonAccountName} triggered geographic conquest; dispatched ${generatedMissions.length} corridor opportunities.`,
      metadata: {
        wonAccountId: accountId,
        wonAccountName,
        generatedMissionIds: generatedMissions.map(m => m.missionId),
      },
    });

    await evaluateOutcomeAndRecordLearning({
      tenantId: input.tenantId,
      outcomeId: recorded.outcome.id,
      targetKey: "candidate_boost:route_density",
      learningKind: "candidate_boost",
      deltaType: "boost",
      explanation: `Account win at ${wonAccountName} demonstrated high corridor density; boosted route_density candidate ranking.`,
    });
  } catch (err) {
    console.warn("[GeographicConquest] learning delta write deferred", err);
  }

  console.info(
    `[GeographicConquest] Propagated win for '${wonAccountName}': generated ${generatedMissions.length} nearby candidate missions.`
  );

  return {
    propagated: true,
    wonAccount,
    generatedMissions,
  };
}
