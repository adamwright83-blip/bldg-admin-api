import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, lt, ne } from "drizzle-orm";
import {
  commercialAccountContacts,
  commercialAccountLocations,
  commercialAccounts,
  commercialMissionEvents,
  commercialMissions,
  commercialPipelineRecords,
  driverColdCallBatches,
  driverColdCallTargets,
  salesCallAttempts,
  territoryOperatorProfiles,
} from "../../drizzle/schema";
import type { CommercialMissionBrief } from "../../shared/commercialMission";
import {
  coldCallEligibility,
  comboAfterChain,
  isColdCallRollingTerminal,
  type ColdCallBatch,
  type ColdCallRollingCall,
  type ColdCallRollingStatus,
  type ColdCallTarget,
} from "../../shared/coldCallBurst";
import { getDb } from "../db";
import { distanceMiles } from "../territory/territoryDiscovery";
import {
  recordCommercialMissionCallAttempt,
  type CommercialMissionCallOutcome,
} from "../commercialMissions/commercialMissionCallService";
import {
  authorizedOperatorPhone,
  claireTwilioFromNumber,
} from "../claire/claireTwilio";
import {
  assertColdCallConversationOutcome,
  assertVerifiedOutgoingCallerId,
  placeOperatorFirstBridgeCall,
} from "../salesCalls";

type EligibleRow = {
  missionId: number;
  accountId: number;
  contactId: number;
  companyName: string;
  phoneNumber: string;
  reason: string;
  sourceReference: string;
  openingLine: string;
  provenance: string;
};

function affectedRows(result: unknown): number {
  return Number(
    (result as { affectedRows?: number; [0]?: { affectedRows?: number } })
      .affectedRows ??
      (result as { [0]?: { affectedRows?: number } })[0]?.affectedRows ??
      0
  );
}

function withinServiceAreaFor(
  profile:
    | {
        latitude: string | number | null;
        longitude: string | number | null;
        serviceRadiusMiles: string | number | null;
      }
    | undefined,
  location:
    | {
        latitude: string | number | null;
        longitude: string | number | null;
      }
    | null
): boolean | null {
  const hasCoordinates = Boolean(
    profile?.latitude &&
      profile.longitude &&
      location?.latitude &&
      location.longitude
  );
  if (!hasCoordinates || !profile || !location) return null;
  return (
    distanceMiles(
      { lat: Number(profile.latitude), lng: Number(profile.longitude) },
      { lat: Number(location.latitude), lng: Number(location.longitude) }
    ) <= Number(profile.serviceRadiusMiles)
  );
}

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
    const decision = coldCallEligibility({
      missionId: row.mission.id,
      missionStatus: row.mission.status,
      assignedTo: row.mission.assignedTo,
      actorId: input.actorId,
      phoneNumber: row.contact.phone,
      contactSource: row.contact.source,
      preferredChannel: row.contact.preferredChannel,
      withinServiceArea: withinServiceAreaFor(profile, row.location),
      alreadyCompleted: row.callEventId != null,
    });
    if (!decision.eligible || !row.contact.phone) continue;
    const brief = row.mission.missionBriefJson as CommercialMissionBrief;
    eligible.push({
      missionId: row.mission.id,
      accountId: row.account.id,
      contactId: row.contact.id,
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
        eq(commercialAccountContacts.id, driverColdCallTargets.contactId),
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
    if (seen.has(row.target.id)) continue;
    if (row.contact.id !== row.target.contactId) continue;
    seen.add(row.target.id);
    if (!row.contact.phone?.trim()) continue;
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
  const live =
    targets.find(target => target.status === "live") ??
    targets.find(target => target.status === "selected") ??
    null;
  const rollingCall = live
    ? await rollingCallForTarget({
        tenantId: input.tenantId,
        target: live,
      })
    : null;
  return {
    id: batch.id,
    targets,
    createdAt: batch.createdAt.toISOString(),
    sourceReferences: batch.sourceReferencesJson as string[],
    status: batch.status,
    combo: batch.combo,
    completedCount: batch.completedCount,
    totalTargets: batch.totalTargets,
    rollingCall,
  };
}

async function latestColdCallAttempt(tenantId: string, targetId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db
    .select()
    .from(salesCallAttempts)
    .where(
      and(
        eq(salesCallAttempts.tenantId, tenantId),
        eq(salesCallAttempts.coldCallTargetId, targetId)
      )
    )
    .orderBy(desc(salesCallAttempts.id))
    .limit(1);
  return rows[0] ?? null;
}

async function rollingCallForTarget(input: {
  tenantId: string;
  target: ColdCallTarget;
}): Promise<ColdCallRollingCall | null> {
  const attempt = await latestColdCallAttempt(input.tenantId, input.target.id);
  if (!attempt) return null;
  return {
    attemptId: attempt.id,
    targetId: input.target.id,
    status: attempt.status as ColdCallRollingStatus,
    failureReason: attempt.failureReason,
    companyName: input.target.companyName,
    phoneNumber: input.target.phoneNumber,
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
        contactId: target.contactId,
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

const COLD_CALL_INELIGIBLE = "This target is no longer eligible for a cold call";

/**
 * Recovery bound for a Cold Call roll that never reached Twilio.
 *
 * A `rollClaimId` with no attempt, or a `dialing_rep` attempt whose
 * `repLegCallSid` is still null, may be reclaimed only after this age.
 * The claim age is `driver_cold_call_targets.updatedAt` from the claim
 * write. The attempt age is `sales_call_attempts.created_at`.
 *
 * A younger row is an in-flight roll and is not stolen. A non-terminal
 * attempt with a provider SID, or any status past `dialing_rep`, is a
 * live leg and is never reclaimed by age.
 */
export const COLD_CALL_ROLL_RECOVERY_BOUND_MS = 120_000;

export const COLD_CALL_STALE_DIALING_REP_REASON =
  "stale_dialing_rep_without_provider_sid";

function coldCallRecoveryDeadline(now = Date.now()): Date {
  return new Date(now - COLD_CALL_ROLL_RECOVERY_BOUND_MS);
}

function timestampMs(value: Date | string | null | undefined): number | null {
  if (value == null) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  const ms = parsed.getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** The attempt row is the provider-leg signal. A SID repaired from an operator callback counts. Receipts are not consulted. */
function providerLegEstablished(attempt: {
  status: string;
  repLegCallSid?: string | null;
}): boolean {
  if (attempt.repLegCallSid?.trim()) return true;
  return attempt.status !== "dialing_rep";
}

/**
 * Reload the contact id stored on the target. Eligibility is re-checked on
 * that row alone. A sibling contact on the same mission is not a substitute.
 */
async function loadPinnedColdCallContact(input: {
  tenantId: string;
  actorId: string;
  missionId: number;
  accountId: number;
  contactId: number | null;
}): Promise<string> {
  if (input.contactId == null) throw new Error(COLD_CALL_INELIGIBLE);
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
    .from(commercialAccountContacts)
    .innerJoin(
      commercialAccounts,
      and(
        eq(commercialAccounts.tenantId, commercialAccountContacts.tenantId),
        eq(commercialAccounts.id, commercialAccountContacts.accountId)
      )
    )
    .innerJoin(
      commercialPipelineRecords,
      and(
        eq(commercialPipelineRecords.tenantId, commercialAccountContacts.tenantId),
        eq(commercialPipelineRecords.accountId, commercialAccountContacts.accountId)
      )
    )
    .innerJoin(
      commercialMissions,
      and(
        eq(commercialMissions.tenantId, commercialPipelineRecords.tenantId),
        eq(commercialMissions.id, commercialPipelineRecords.missionId)
      )
    )
    .leftJoin(
      commercialAccountLocations,
      and(
        eq(commercialAccountLocations.tenantId, commercialAccountContacts.tenantId),
        eq(commercialAccountLocations.accountId, commercialAccountContacts.accountId),
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
        eq(commercialAccountContacts.id, input.contactId),
        eq(commercialAccountContacts.tenantId, input.tenantId),
        eq(commercialAccountContacts.accountId, input.accountId),
        eq(commercialMissions.id, input.missionId),
        eq(commercialMissions.tenantId, input.tenantId),
        eq(commercialMissions.assignedTo, input.actorId)
      )
    )
    .limit(1);
  const row = rows[0];
  if (!row || row.contact.id !== input.contactId) {
    throw new Error(COLD_CALL_INELIGIBLE);
  }
  const decision = coldCallEligibility({
    missionId: row.mission.id,
    missionStatus: row.mission.status,
    assignedTo: row.mission.assignedTo,
    actorId: input.actorId,
    phoneNumber: row.contact.phone,
    contactSource: row.contact.source,
    preferredChannel: row.contact.preferredChannel,
    withinServiceArea: withinServiceAreaFor(profile, row.location),
    alreadyCompleted: row.callEventId != null,
  });
  if (!decision.eligible || !row.contact.phone?.trim()) {
    throw new Error(COLD_CALL_INELIGIBLE);
  }
  return row.contact.phone;
}

/** Compare-and-swap. The row update is the lock; a loser does not dial. */
async function claimColdCallRoll(input: {
  tenantId: string;
  actorId: string;
  batchId: string;
  targetId: string;
}): Promise<string | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const claimId = randomUUID();
  const result = await db
    .update(driverColdCallTargets)
    .set({ rollClaimId: claimId })
    .where(
      and(
        eq(driverColdCallTargets.id, input.targetId),
        eq(driverColdCallTargets.batchId, input.batchId),
        eq(driverColdCallTargets.tenantId, input.tenantId),
        eq(driverColdCallTargets.actorId, input.actorId),
        isNull(driverColdCallTargets.rollClaimId),
        ne(driverColdCallTargets.status, "completed")
      )
    );
  return affectedRows(result) === 1 ? claimId : null;
}

/**
 * Take a claim that survived a crash. Matches the observed claim id and
 * only when its write is older than the recovery bound.
 */
async function recoverStaleColdCallClaim(input: {
  tenantId: string;
  actorId: string;
  batchId: string;
  targetId: string;
  observedClaimId: string;
  deadline: Date;
}): Promise<string | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const claimId = randomUUID();
  const result = await db
    .update(driverColdCallTargets)
    .set({ rollClaimId: claimId, updatedAt: new Date() })
    .where(
      and(
        eq(driverColdCallTargets.id, input.targetId),
        eq(driverColdCallTargets.batchId, input.batchId),
        eq(driverColdCallTargets.tenantId, input.tenantId),
        eq(driverColdCallTargets.actorId, input.actorId),
        eq(driverColdCallTargets.rollClaimId, input.observedClaimId),
        lt(driverColdCallTargets.updatedAt, input.deadline),
        ne(driverColdCallTargets.status, "completed")
      )
    );
  return affectedRows(result) === 1 ? claimId : null;
}

/** One later roll retires a SID-less dialing_rep row. A second roll loses. */
async function retireStaleDialingRepAttempt(input: {
  attemptId: number;
  tenantId: string;
  targetId: string;
  deadline: Date;
}): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db
    .update(salesCallAttempts)
    .set({
      status: "failed",
      rewardGranted: false,
      failureReason: COLD_CALL_STALE_DIALING_REP_REASON,
    })
    .where(
      and(
        eq(salesCallAttempts.id, input.attemptId),
        eq(salesCallAttempts.tenantId, input.tenantId),
        eq(salesCallAttempts.coldCallTargetId, input.targetId),
        eq(salesCallAttempts.status, "dialing_rep"),
        isNull(salesCallAttempts.repLegCallSid),
        lt(salesCallAttempts.createdAt, input.deadline)
      )
    );
  return affectedRows(result) === 1;
}

async function releaseColdCallRoll(targetId: string, claimId: string) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(driverColdCallTargets)
    .set({ rollClaimId: null })
    .where(
      and(
        eq(driverColdCallTargets.id, targetId),
        eq(driverColdCallTargets.rollClaimId, claimId)
      )
    );
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
  await loadPinnedColdCallContact({
    tenantId: input.tenantId,
    actorId: input.actorId,
    missionId: target.missionId,
    accountId: target.accountId,
    contactId: target.contactId,
  });
  await db
    .update(driverColdCallTargets)
    .set({ status: "live" })
    .where(eq(driverColdCallTargets.id, target.id));
  return readBatch(input);
}

/**
 * Operator-first Cold Call Burst roll.
 * The browser supplies batch and target ids only. Both phone numbers are
 * resolved here. The prospect is not dialed by this function.
 * A compare-and-swap claim is taken before any Twilio call.
 */
export async function rollColdCallTarget(input: {
  tenantId: string;
  actorId: string;
  batchId: string;
  targetId: string;
}) {
  const target = await ownedTarget(input);
  if (target.status === "completed") {
    throw new Error("Call outcome is already recorded");
  }
  const deadline = coldCallRecoveryDeadline();
  let existing = await latestColdCallAttempt(input.tenantId, target.id);
  if (
    existing &&
    !isColdCallRollingTerminal(existing.status as ColdCallRollingStatus)
  ) {
    const createdMs = timestampMs(existing.createdAt);
    const staleSidLess =
      !providerLegEstablished(existing) &&
      createdMs != null &&
      createdMs < deadline.getTime();
    if (!staleSidLess) return readBatch(input);
    const retired = await retireStaleDialingRepAttempt({
      attemptId: existing.id,
      tenantId: input.tenantId,
      targetId: target.id,
      deadline,
    });
    if (!retired) return readBatch(input);
    existing = await latestColdCallAttempt(input.tenantId, target.id);
    if (
      existing &&
      !isColdCallRollingTerminal(existing.status as ColdCallRollingStatus)
    ) {
      return readBatch(input);
    }
  }
  // A finished attempt may leave the previous claim in place. Clear only
  // that observed claim. An in-flight roll has no attempt yet, so a peer
  // that lost the compare-and-swap must not clear it.
  if (
    target.rollClaimId &&
    existing &&
    isColdCallRollingTerminal(existing.status as ColdCallRollingStatus)
  ) {
    await releaseColdCallRoll(target.id, target.rollClaimId);
  }
  let claimId = await claimColdCallRoll(input);
  const claimUpdatedMs = timestampMs(target.updatedAt);
  if (
    !claimId &&
    target.rollClaimId &&
    claimUpdatedMs != null &&
    claimUpdatedMs < deadline.getTime()
  ) {
    claimId = await recoverStaleColdCallClaim({
      ...input,
      observedClaimId: target.rollClaimId,
      deadline,
    });
  }
  if (!claimId) return readBatch(input);
  try {
    const prospectLegTo = await loadPinnedColdCallContact({
      tenantId: input.tenantId,
      actorId: input.actorId,
      missionId: target.missionId,
      accountId: target.accountId,
      contactId: target.contactId,
    });
    const operatorLegTo = await authorizedOperatorPhone({
      tenantId: input.tenantId,
      actorId: input.actorId,
    });
    const operatorLegFrom = claireTwilioFromNumber();
    const prospectCallerId = operatorLegTo;
    await assertVerifiedOutgoingCallerId(operatorLegTo);
    await placeOperatorFirstBridgeCall({
      tenantId: input.tenantId,
      coldCallTargetId: target.id,
      legs: {
        operatorLegTo,
        operatorLegFrom,
        prospectLegTo,
        prospectCallerId,
      },
    });
    return await startColdCallTarget(input);
  } catch (error) {
    const attempt = await latestColdCallAttempt(input.tenantId, target.id);
    if (
      !attempt ||
      isColdCallRollingTerminal(attempt.status as ColdCallRollingStatus)
    ) {
      await releaseColdCallRoll(target.id, claimId);
    }
    throw error;
  }
}

export async function getColdCallRollingCall(input: {
  tenantId: string;
  actorId: string;
  batchId: string;
  targetId: string;
}): Promise<ColdCallRollingCall | null> {
  const target = await ownedTarget(input);
  const batch = await readBatch(input);
  const view = batch?.targets.find(item => item.id === target.id);
  if (!view) return null;
  return rollingCallForTarget({ tenantId: input.tenantId, target: view });
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
  await assertColdCallConversationOutcome({
    tenantId: input.tenantId,
    coldCallTargetId: target.id,
    outcome: input.outcome,
  });
  const attempt = await recordCommercialMissionCallAttempt({
    tenantId: input.tenantId,
    missionId: target.missionId,
    actorId: input.actorId,
    requestId: input.requestId,
    outcome: input.outcome,
    notes: input.notes,
    coldCallTargetId: target.id,
  });
  await db.transaction(async tx => {
    await tx
      .update(driverColdCallTargets)
      .set({
        status: "completed",
        callAttemptEventId: attempt.id,
        outcome: attempt.outcome,
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
