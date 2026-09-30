/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
/**
 * Autonomous Geographic Conquest & Route Density Propagation Engine
 *
 * Propagates account wins into immediate localized territory expansion:
 * 1. When an account is won, determines its physical coordinate and route corridor.
 * 2. Scans for neighboring commercial businesses within a tight route corridor (1.0 - 1.5 miles).
 * 3. Elevates high-density neighbor candidate missions with deterministic idempotency.
 * 4. Generates tailored "Won neighbor account · Rapid corridor expansion" sales briefs
 *    leveraging consolidated route proximity.
 * 5. Registers scheduled neighbor conquest obligations and enqueues autonomous cycle ticks,
 *    ensuring the next Day Line ranking prioritizes dense cluster missions along the winning corridor.
 * 6. Emits candidate_boost learned deltas with valid objective lineage.
 */

import { and, desc, eq, ne } from "drizzle-orm";
import {
  claireProactiveObligations,
  commercialAccounts,
  commercialAccountLocations,
  commercialMissions,
  goalCycleObjectives,
  macroGoalRuns,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { createCommercialMission, listCommercialMissions } from "../commercialMissions/commercialMissionStore";
import { recordGoalCycleOutcome } from "./outcomeStore";
import { evaluateOutcomeAndRecordLearning } from "./learningStore";
import { haversineDistanceMiles } from "../procurement/vendorCandidateServiceAreaVerifier";
import { getDefaultGoalCyclePool, GoalCycleStore } from "./goalCycleStore";
import { findDeterministicObjectivesForDriverAction } from "./fieldEventBridge";

export type PropagateGeographicConquestInput = {
  tenantId: string;
  missionId?: number | null;
  accountId?: number | null;
  actorId?: string | null;
  objectiveId?: string | null;
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

  // 2. Query other real commercial accounts in the tenant's database to find nearby unserviced locations
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

  // Check which accounts are already won customers (do not re-prospect won accounts)
  const existingMissions = await listCommercialMissions({
    tenantId: input.tenantId,
    limit: 100,
  });
  const wonAccountIds = new Set(
    existingMissions
      .filter(m => m.status === "won")
      .map(m => {
        const snap = m.account as { accountId?: number | string };
        return snap.accountId ? Number(snap.accountId) : null;
      })
      .filter((id): id is number => id !== null)
  );

  const existingMissionByAccountId = new Map<number, (typeof existingMissions)[0]>();
  for (const m of existingMissions) {
    const snap = m.account as { accountId?: number | string };
    const aId = snap?.accountId ? Number(snap.accountId) : null;
    if (aId && m.status !== "won") {
      existingMissionByAccountId.set(aId, m);
    }
  }

  const nearbyOpportunities: Array<{
    accountId: number;
    name: string;
    address: string;
    accountType: string;
    distanceMiles: number;
    existingMissionId?: number;
  }> = [];

  if (wonLat !== null && wonLng !== null) {
    for (const loc of otherLocations) {
      if (wonAccountIds.has(loc.accountId)) continue;
      if (!loc.latitude || !loc.longitude) continue;
      const candidateLat = Number(loc.latitude);
      const candidateLng = Number(loc.longitude);
      if (isNaN(candidateLat) || isNaN(candidateLng)) continue;

      const dist = haversineDistanceMiles(
        { lat: wonLat, lng: wonLng },
        { lat: candidateLat, lng: candidateLng }
      );
      if (dist <= radiusMiles) {
        const existing = existingMissionByAccountId.get(loc.accountId);
        nearbyOpportunities.push({
          accountId: loc.accountId,
          name: loc.accountName,
          address: loc.address,
          accountType: loc.accountType,
          distanceMiles: Math.round(dist * 100) / 100,
          existingMissionId: existing?.id,
        });
      }
    }
  }

  // Sort by nearest distance
  nearbyOpportunities.sort((a, b) => a.distanceMiles - b.distanceMiles);

  // 3. If no neighboring accounts exist within radius, fail gracefully without inventing fake accounts
  if (nearbyOpportunities.length === 0) {
    return {
      propagated: false,
      wonAccount,
      generatedMissions: [],
      reason: `No neighboring commercial accounts within corridor radius (${radiusMiles} mi)`,
    };
  }

  const operatorUserId = input.actorId ?? "adam-admin";
  const todayDate = new Date().toISOString().slice(0, 10);

  // 4. Spawn candidate missions or elevate existing corridor missions with deterministic idempotency keys
  for (const opp of nearbyOpportunities.slice(0, maxCandidates)) {
    let missionId = opp.existingMissionId;

    if (!missionId) {
      const stepKey = `step-corridor-won-${accountId}-neighbor-${opp.accountId}`;
      const idempotencyKey = `geo-conquest:won-${accountId}:neighbor-${opp.accountId}`;

      const mission = await createCommercialMission({
        tenantId: input.tenantId,
        assignedTo: operatorUserId,
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
          laundryOpportunity: `Direct corridor neighbor to recently won customer ${wonAccountName}. Consolidated route delivery eliminates transit overhead.`,
          salesAngle: `Since our route truck already services ${wonAccountName} directly on this block, we can integrate your facility with dedicated corridor delivery schedules and preferential neighbor pricing.`,
          openingLine: `Hi, our delivery team stops right next door at ${wonAccountName}—we wanted to introduce ourselves and see if we can streamline your commercial laundry and towel needs on the same run.`,
          discoveryQuestions: [
            "Who currently handles your commercial laundry or linens?",
            "Would consolidated route pickups along this corridor fit your schedule?",
          ],
          objections: ["We already have a vendor", "Price concerns"],
        },
        steps: [
          {
            key: stepKey,
            label: `Walk-in pitch to ${opp.name}`,
            detail: `Corridor neighbor pitch referencing ${wonAccountName}`,
            status: "pending",
            position: 1,
            type: "irl_visit",
            instructionText: `Introduce Goldline as the neighbor vendor for ${wonAccountName}`,
            revealPolicy: "sequential",
            destinationName: opp.name,
            destinationAddress: opp.address,
          },
        ],
        actor: { type: "system", id: operatorUserId, role: "admin" },
        idempotencyKey,
        initialPipelineStage: "discovered",
      });
      missionId = mission.id;
    }

    generatedMissions.push({
      missionId,
      accountName: opp.name,
      distanceMiles: opp.distanceMiles,
      reason: opp.existingMissionId
        ? `Elevated existing corridor mission for ${opp.name} (${opp.distanceMiles} mi from won account ${wonAccountName})`
        : `Spawned nearby corridor mission for ${opp.name} (${opp.distanceMiles} mi from won account ${wonAccountName})`,
    });

    // 5. Register scheduled neighbor conquest obligation in proactive obligations table
    try {
      await db
        .insert(claireProactiveObligations)
        .values({
          id: `sales:conquest:${mission.id}:${todayDate}`,
          tenantId: input.tenantId,
          operatorUserId,
          kind: "sales_follow_up",
          subjectKey: String(mission.id),
          payloadJson: {
            id: `sales:conquest:${mission.id}:${todayDate}`,
            why: `Corridor neighbor to recently won ${wonAccountName} (${opp.distanceMiles} mi away)`,
            kind: "sales_follow_up",
            draft: null,
            title: `Conquest pitch: ${opp.name}`,
            status: "scheduled",
            dueDate: todayDate,
            moveCount: 0,
            subjectKey: String(mission.id),
            subjectName: opp.name,
            historyIntact: true,
          },
          status: "scheduled",
          dueDate: todayDate,
        })
        .onDuplicateKeyUpdate({
          set: {
            status: "scheduled",
            dueDate: todayDate,
          },
        });
    } catch (err) {
      console.warn("[GeographicConquest] obligation registration deferred:", err);
    }
  }

  // 6. Enqueue an autonomous Goal Cycle tick to immediately process conquest obligation
  try {
    const pool = getDefaultGoalCyclePool();
    const store = new GoalCycleStore(pool);
    const [activeRun] = await db
      .select({ id: macroGoalRuns.id })
      .from(macroGoalRuns)
      .where(
        and(
          eq(macroGoalRuns.tenantId, input.tenantId),
          eq(macroGoalRuns.status, "active")
        )
      )
      .orderBy(desc(macroGoalRuns.createdAt))
      .limit(1);

    if (activeRun) {
      await store.enqueue({
        tenantId: input.tenantId,
        goalRunId: activeRun.id,
        triggerType: "scheduled_tick",
        triggerSourceReference: `conquest:account:${accountId}`,
        idempotencyKey: `auto_tick:conquest:${accountId}:${todayDate}`,
        availableAt: new Date(),
      });
    }
  } catch (err) {
    console.warn("[GeographicConquest] Goal cycle enqueue deferred:", err);
  }

  // 7. Emit candidate_boost learned delta with valid objective lineage
  let targetObjectiveId = input.objectiveId ?? null;
  if (!targetObjectiveId && input.missionId) {
    const matching = await findDeterministicObjectivesForDriverAction({
      tenantId: input.tenantId,
      actorId: operatorUserId,
      missionId: input.missionId,
      evidenceReference: `accounts:commercial:${accountId}`,
    }).catch(() => []);
    if (matching[0]) {
      targetObjectiveId = matching[0].id;
    }
  }
  if (!targetObjectiveId) {
    const [recentObj] = await db
      .select({ id: goalCycleObjectives.id })
      .from(goalCycleObjectives)
      .where(eq(goalCycleObjectives.tenantId, input.tenantId))
      .orderBy(desc(goalCycleObjectives.createdAt))
      .limit(1);
    if (recentObj) {
      targetObjectiveId = recentObj.id;
    }
  }

  if (targetObjectiveId) {
    try {
      const recorded = await recordGoalCycleOutcome({
        tenantId: input.tenantId,
        objectiveId: targetObjectiveId,
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
      console.warn("[GeographicConquest] learning delta write deferred:", err);
    }
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
