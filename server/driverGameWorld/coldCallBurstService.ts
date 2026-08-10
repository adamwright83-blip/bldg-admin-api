import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  commercialAccountContacts,
  commercialAccountLocations,
  commercialAccounts,
  commercialMissionEvents,
  commercialMissions,
  commercialPipelineRecords,
  driverColdCallBatches,
  driverColdCallTargets,
  territoryOperatorProfiles,
} from "../../drizzle/schema";
import type { CommercialMissionBrief } from "../../shared/commercialMission";
import {
  coldCallEligibility,
  comboAfterChain,
  type ColdCallBatch,
  type ColdCallTarget,
} from "../../shared/coldCallBurst";
import { getDb } from "../db";
import { distanceMiles } from "../territory/territoryDiscovery";
import {
  recordCommercialMissionCallAttempt,
  type CommercialMissionCallOutcome,
} from "../commercialMissions/commercialMissionCallService";

type EligibleRow = {
  missionId: number;
  accountId: number;
  companyName: string;
  phoneNumber: string;
  reason: string;
  sourceReference: string;
  openingLine: string;
  provenance: string;
};

async function eligibleColdCallRows(input: {
  tenantId: string;
  actorId: string;
}): Promise<EligibleRow[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [profile] = await db
    .select()
    .from(territoryOperatorProfiles)
    .where(eq(territoryOperatorProfiles.tenantId, input.tenantId))
    .limit(1);
  const rows = await db
    .select({
      mission: commercialMissions,
      account: commercialAccounts,
      contact: commercialAccountContacts,
      location: commercialAccountLocations,
      callEventId: commercialMissionEvents.id,
    })
    .from(commercialMissions)
    .innerJoin(
      commercialPipelineRecords,
      and(
        eq(commercialPipelineRecords.tenantId, commercialMissions.tenantId),
        eq(commercialPipelineRecords.missionId, commercialMissions.id)
      )
    )
    .innerJoin(
      commercialAccounts,
      and(
        eq(commercialAccounts.tenantId, commercialMissions.tenantId),
        eq(commercialAccounts.id, commercialPipelineRecords.accountId)
      )
    )
    .innerJoin(
      commercialAccountContacts,
      and(
        eq(commercialAccountContacts.tenantId, commercialMissions.tenantId),
        eq(commercialAccountContacts.accountId, commercialAccounts.id)
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
    .leftJoin(
      commercialMissionEvents,
      and(
        eq(commercialMissionEvents.tenantId, commercialMissions.tenantId),
        eq(commercialMissionEvents.missionId, commercialMissions.id),
        eq(commercialMissionEvents.eventName, "cold_call_logged")
      )
    )
    .where(
      and(
        eq(commercialMissions.tenantId, input.tenantId),
        eq(commercialMissions.assignedTo, input.actorId),
        inArray(commercialMissions.status, ["phone_ready", "preparing"])
      )
    )
    .orderBy(
      asc(commercialMissions.createdAt),
      asc(commercialAccountContacts.id)
    );

  const seen = new Set<number>();
  const eligible: EligibleRow[] = [];
  for (const row of rows) {
    if (seen.has(row.mission.id)) continue;
    seen.add(row.mission.id);
    const hasCoordinates = Boolean(
      profile?.latitude &&
        profile.longitude &&
        row.location?.latitude &&
        row.location.longitude
    );
    const withinServiceArea = hasCoordinates
      ? distanceMiles(
          { lat: Number(profile!.latitude), lng: Number(profile!.longitude) },
          {
            lat: Number(row.location!.latitude),
            lng: Number(row.location!.longitude),
          }
        ) <= Number(profile!.serviceRadiusMiles)
      : null;
    const decision = coldCallEligibility({
      missionId: row.mission.id,
      missionStatus: row.mission.status,
      assignedTo: row.mission.assignedTo,
      actorId: input.actorId,
      phoneNumber: row.contact.phone,
      contactSource: row.contact.source,
      preferredChannel: row.contact.preferredChannel,
      withinServiceArea,
      alreadyCompleted: row.callEventId != null,
    });
    if (!decision.eligible || !row.contact.phone) continue;
    const brief = row.mission.missionBriefJson as CommercialMissionBrief;
    eligible.push({
      missionId: row.mission.id,
      accountId: row.account.id,
      companyName: row.account.name,
      phoneNumber: row.contact.phone,
      reason: decision.reason,
      sourceReference: `commercial_account_contacts:${row.contact.id}`,
      openingLine: brief.openingLine,
      provenance: `commercial_missions:${row.mission.id}:missionBriefJson.openingLine`,
    });
  }
  return eligible;
}

async function readBatch(input: {
  tenantId: string;
  actorId: string;
  batchId?: string;
}): Promise<ColdCallBatch | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const batches = await db
    .select()
    .from(driverColdCallBatches)
    .where(
      and(
        eq(driverColdCallBatches.tenantId, input.tenantId),
        eq(driverColdCallBatches.actorId, input.actorId),
        ...(input.batchId ? [eq(driverColdCallBatches.id, input.batchId)] : [])
      )
    )
    .orderBy(desc(driverColdCallBatches.updatedAt))
    .limit(1);
  const batch = batches[0];
  if (!batch) return null;
  const rows = await db
    .select({
      target: driverColdCallTargets,
      mission: commercialMissions,
      account: commercialAccounts,
      contact: commercialAccountContacts,
    })
    .from(driverColdCallTargets)
    .innerJoin(
      commercialMissions,
      and(
        eq(commercialMissions.tenantId, driverColdCallTargets.tenantId),
        eq(commercialMissions.id, driverColdCallTargets.missionId)
      )
    )
    .innerJoin(
      commercialAccounts,
      and(
        eq(commercialAccounts.tenantId, driverColdCallTargets.tenantId),
        eq(commercialAccounts.id, driverColdCallTargets.accountId)
      )
    )
    .innerJoin(
      commercialAccountContacts,
      and(
        eq(commercialAccountContacts.tenantId, driverColdCallTargets.tenantId),
        eq(commercialAccountContacts.accountId, driverColdCallTargets.accountId)
      )
    )
    .where(
      and(
        eq(driverColdCallTargets.batchId, batch.id),
        eq(driverColdCallTargets.tenantId, input.tenantId),
        eq(driverColdCallTargets.actorId, input.actorId)
      )
    )
    .orderBy(
      asc(driverColdCallTargets.position),
      asc(commercialAccountContacts.id)
    );
  const seen = new Set<string>();
  const targets: ColdCallTarget[] = [];
  for (const row of rows) {
    if (seen.has(row.target.id) || !row.contact.phone) continue;
    seen.add(row.target.id);
    const brief = row.mission.missionBriefJson as CommercialMissionBrief;
    targets.push({
      id: row.target.id,
      entityId: String(row.target.accountId),
      missionId: row.target.missionId,
      companyName: row.account.name,
      phoneNumber: row.contact.phone,
      eligibility: "eligible",
      reason: "Persisted eligible batch target",
      sourceReference: row.target.sourceReference,
      coaching: {
        openingLine: brief.openingLine,
        provenance: `commercial_missions:${row.target.missionId}:missionBriefJson.openingLine`,
      },
      status: row.target.status,
      position: row.target.position,
      outcome: row.target.outcome,
    });
  }
  return {
    id: batch.id,
    targets,
    createdAt: batch.createdAt.toISOString(),
    sourceReferences: batch.sourceReferencesJson as string[],
    status: batch.status,
    combo: batch.combo,
    completedCount: batch.completedCount,
    totalTargets: batch.totalTargets,
  };
}

export async function getColdCallBurstState(input: {
  tenantId: string;
  actorId: string;
}) {
  const [batch, eligible] = await Promise.all([
    readBatch(input),
    eligibleColdCallRows(input),
  ]);
  return {
    batch,
    eligibleCount: eligible.length,
    emptyReason:
      eligible.length === 0
        ? "No assigned call-ready missions have a sourced, permitted phone contact"
        : null,
  };
}

export async function createColdCallBatch(input: {
  tenantId: string;
  actorId: string;
  requestId: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await readBatch(input);
  if (existing?.status === "active") return existing;
  const targets = (await eligibleColdCallRows(input)).slice(0, 5);
  if (!targets.length) return null;
  const id = randomUUID();
  await db.transaction(async tx => {
    await tx.insert(driverColdCallBatches).values({
      id,
      tenantId: input.tenantId,
      actorId: input.actorId,
      requestId: input.requestId,
      totalTargets: targets.length,
      sourceReferencesJson: targets.map(target => target.sourceReference),
    });
    await tx.insert(driverColdCallTargets).values(
      targets.map((target, position) => ({
        id: randomUUID(),
        batchId: id,
        tenantId: input.tenantId,
        actorId: input.actorId,
        missionId: target.missionId,
        accountId: target.accountId,
        position,
        status: position === 0 ? ("selected" as const) : ("pending" as const),
        sourceReference: target.sourceReference,
      }))
    );
  });
  return readBatch({ ...input, batchId: id });
}

async function ownedTarget(input: {
  tenantId: string;
  actorId: string;
  batchId: string;
  targetId: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [target] = await db
    .select()
    .from(driverColdCallTargets)
    .where(
      and(
        eq(driverColdCallTargets.id, input.targetId),
        eq(driverColdCallTargets.batchId, input.batchId),
        eq(driverColdCallTargets.tenantId, input.tenantId),
        eq(driverColdCallTargets.actorId, input.actorId)
      )
    )
    .limit(1);
  if (!target) throw new Error("Cold-call target not found");
  return target;
}

export async function startColdCallTarget(input: {
  tenantId: string;
  actorId: string;
  batchId: string;
  targetId: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const target = await ownedTarget(input);
  if (target.status === "completed")
    throw new Error("Call outcome is already recorded");
  const stillEligible = (await eligibleColdCallRows(input)).some(
    candidate => candidate.missionId === target.missionId
  );
  if (!stillEligible) {
    throw new Error("This target is no longer eligible for a cold call");
  }
  await db
    .update(driverColdCallTargets)
    .set({ status: "live" })
    .where(eq(driverColdCallTargets.id, target.id));
  return readBatch(input);
}

export async function completeColdCallTarget(input: {
  tenantId: string;
  actorId: string;
  batchId: string;
  targetId: string;
  requestId: string;
  outcome: CommercialMissionCallOutcome;
  notes: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const target = await ownedTarget(input);
  if (target.status === "completed") return readBatch(input);
  if (target.status !== "live") {
    throw new Error("Start the real phone action before logging its outcome");
  }
  const attempt = await recordCommercialMissionCallAttempt({
    tenantId: input.tenantId,
    missionId: target.missionId,
    actorId: input.actorId,
    requestId: input.requestId,
    outcome: input.outcome,
    notes: input.notes,
  });
  await db.transaction(async tx => {
    await tx
      .update(driverColdCallTargets)
      .set({
        status: "completed",
        callAttemptEventId: attempt.id,
        outcome: input.outcome,
        completedAt: new Date(),
      })
      .where(eq(driverColdCallTargets.id, target.id));
    const progress = await tx
      .select({
        id: driverColdCallTargets.id,
        status: driverColdCallTargets.status,
      })
      .from(driverColdCallTargets)
      .where(eq(driverColdCallTargets.batchId, input.batchId));
    const completedCount = progress.filter(
      item => item.status === "completed"
    ).length;
    const remainingCount = progress.length - completedCount;
    await tx
      .update(driverColdCallBatches)
      .set({
        completedCount,
        status: remainingCount === 0 ? "completed" : "active",
        ...(remainingCount === 0 ? { combo: Math.max(1, completedCount) } : {}),
      })
      .where(eq(driverColdCallBatches.id, input.batchId));
  });
  return readBatch(input);
}

export async function selectColdCallChainTarget(input: {
  tenantId: string;
  actorId: string;
  batchId: string;
  targetId: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const target = await ownedTarget(input);
  if (target.status !== "pending")
    throw new Error("Next target is not pending");
  const batch = await readBatch(input);
  if (!batch) throw new Error("Cold-call batch not found");
  const resolution = comboAfterChain({
    currentCombo: batch.combo,
    selectedNextTarget: true,
    hasEligibleNextTarget: true,
  });
  await db.transaction(async tx => {
    await tx
      .update(driverColdCallTargets)
      .set({ status: "pending" })
      .where(
        and(
          eq(driverColdCallTargets.batchId, input.batchId),
          eq(driverColdCallTargets.status, "selected")
        )
      );
    await tx
      .update(driverColdCallTargets)
      .set({ status: "selected" })
      .where(eq(driverColdCallTargets.id, target.id));
    await tx
      .update(driverColdCallBatches)
      .set({ combo: resolution.combo })
      .where(eq(driverColdCallBatches.id, input.batchId));
  });
  return readBatch(input);
}

export async function breakColdCallCombo(input: {
  tenantId: string;
  actorId: string;
  batchId: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const batch = await readBatch(input);
  if (!batch) throw new Error("Cold-call batch not found");
  await db
    .update(driverColdCallBatches)
    .set({ combo: 0 })
    .where(eq(driverColdCallBatches.id, input.batchId));
  return readBatch(input);
}
