/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  commercialAccounts,
  commercialMissionEvents,
  commercialMissions,
  cleancloudPaidOrders,
  goalCycleObjectives,
  goalCycleOutcomes,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { admitCompletedCommercialVisit } from "../authority/actionCompletionAdmission";
import { admitCommercialFieldObservation } from "../authority/fieldObservationAdmission";
import { findAuthorityReceiptForSubject } from "../authority/authorityReceipt";
import { findCleanCloudPaidObservationReceipt } from "../cleancloudPaidEvidence";
import {
  getGoalCycleObjective,
  listGoalCycleObjectives,
  transitionObjectiveStatus,
  type PersistentGrowthObjective,
} from "./objectiveStore";
import {
  bindEconomicOutcome,
  recordGoalCycleOutcome,
  verifyObjectiveExecution,
  type EpistemicStatus,
  type GoalCycleOutcomeRecord,
} from "./outcomeStore";
import {
  evaluateOutcomeAndRecordLearning,
  listGoalCycleLearnedDeltas,
  type GoalCycleLearnedDeltaRecord,
} from "./learningStore";

export type BridgeDriverActionInput = {
  tenantId: string;
  actorId: string;
  objectiveId?: string | null;
  missionId?: number | null;
  orderId?: number | null;
  commitmentId?: string | null;
  stopId?: string | null;
  evidenceReference: string;
  sourceSystem?: string;
  outcomeKind?: string;
  explanation?: string | null;
  observedAt?: Date | string | null;
  metadata?: Record<string, unknown> | null;
};

export type BridgeDriverActionResult =
  | {
      bridged: true;
      objective: PersistentGrowthObjective;
      outcome: GoalCycleOutcomeRecord;
      delta?: GoalCycleLearnedDeltaRecord | null;
    }
  | {
      bridged: false;
      reason:
        | "unrelated_stop"
        | "ambiguous_lineage"
        | "objective_not_found"
        | "already_completed";
      candidateObjectiveIds?: string[];
      message: string;
    };

export type BridgeCleanCloudOrderInput = {
  tenantId: string;
  cleancloudOrderId: string;
  cleancloudCustomerId?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  paid: boolean;
  totalCents: number;
  paidDateUtc?: Date | string | null;
  objectiveId?: string | null;
  sourceFileName?: string | null;
  explanation?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type BridgeCleanCloudOrderResult =
  | {
      bridged: true;
      objective: PersistentGrowthObjective;
      outcome: GoalCycleOutcomeRecord;
      delta?: GoalCycleLearnedDeltaRecord | null;
    }
  | {
      bridged: false;
      reason:
        | "order_not_paid_or_zero"
        | "unrelated_order"
        | "ambiguous_lineage"
        | "objective_not_found"
        | "payment_authority_missing"
        | "payment_evidence_mismatch";
      candidateObjectiveIds?: string[];
      message: string;
    };

/**
 * Bridges a real completed Driver / Day Line work item to action verification.
 *
 * Enforces:
 * 1. Lineage to a goal_cycle_objective: deterministic match ONLY.
 * 2. If no objective matches, returns unrelated_stop (unrelated route stops
 *    must NEVER become Persistent Growth outcomes).
 * 3. If multiple active objectives could plausibly match, fails closed.
 * 4. Calls verifyObjectiveExecution (never manufactures economic revenue).
 * 5. Uses actual persisted stop/mission completion event as evidenceReference.
 */
export async function bridgeDriverAction(
  input: BridgeDriverActionInput
): Promise<BridgeDriverActionResult> {
  if (!input.tenantId?.trim()) throw new Error("tenantId is required");
  if (!input.evidenceReference?.trim()) throw new Error("evidenceReference is required");

  let matchedObjective: PersistentGrowthObjective | null = null;

  if (input.objectiveId?.trim()) {
    try {
      matchedObjective = await getGoalCycleObjective({
        tenantId: input.tenantId,
        objectiveId: input.objectiveId.trim(),
      });
    } catch {
      matchedObjective = null;
    }
    if (!matchedObjective) {
      return {
        bridged: false,
        reason: "objective_not_found",
        message: `Preserved objectiveId '${input.objectiveId}' was not found for tenant '${input.tenantId}'`,
      };
    }
  } else {
    // Resolve deterministic lineage from missionId, orderId, commitmentId, or stopId
    const candidates = await findDeterministicObjectivesForDriverAction(input);

    if (candidates.length === 0) {
      return {
        bridged: false,
        reason: "unrelated_stop",
        message:
          "No active Persistent Growth objective matches this driver action; unrelated stops never become outcomes.",
      };
    }

    if (candidates.length > 1) {
      // Rule 1: Fail closed on ambiguity!
      return {
        bridged: false,
        reason: "ambiguous_lineage",
        candidateObjectiveIds: candidates.map(c => c.id),
        message: `Multiple active objectives (${candidates.length}) matched this driver action; failed closed to prevent ambiguous attribution.`,
      };
    }

    matchedObjective = candidates[0];
  }

  const effectiveOutcomeKind = input.outcomeKind ?? "visit_completed";
  if (effectiveOutcomeKind === "visit_completed" && input.missionId == null) {
    throw new Error("visit_completed requires a commercial mission identity");
  }
  const actionAuthority =
    effectiveOutcomeKind === "visit_completed"
      ? await admitCompletedCommercialVisit({
          tenantId: input.tenantId,
          missionId: input.missionId!,
          evidenceReference: input.evidenceReference,
        })
      : null;

  // Action verification: verifies work was done, never awards money
  const verification = await verifyObjectiveExecution({
    tenantId: input.tenantId,
    objectiveId: matchedObjective.id,
    evidenceReference: input.evidenceReference,
    sourceSystem: input.sourceSystem ?? "dayforge_field",
    outcomeKind: effectiveOutcomeKind,
    explanation:
      input.explanation ??
      `Driver action verified completed by real field event (${input.evidenceReference})`,
    transitionObjectiveTo: "action_executed",
    observedAt: input.observedAt,
    metadata: {
      ...(input.metadata ?? {}),
      ...(input.missionId != null ? { missionId: input.missionId } : {}),
      ...(actionAuthority ? { authorityReceiptId: actionAuthority.id } : {}),
    },
  });

  // Query any automatically produced learned delta for this outcome
  const deltas = await listGoalCycleLearnedDeltas({
    tenantId: input.tenantId,
    outcomeId: verification.outcome.id,
    limit: 1,
  });

  return {
    bridged: true,
    objective: verification.objective,
    outcome: verification.outcome,
    delta: deltas[0] ?? null,
  };
}

export type BridgeCommercialResolutionInput = {
  tenantId: string;
  actorId: string;
  missionId: number;
  resolution: "won" | "lost";
  evidenceReference: string;
  sourceSystem?: string;
  explanation?: string;
  observedAt?: Date | string;
  metadata?: Record<string, unknown>;
};

export type BridgeCommercialResolutionResult =
  | {
      bridged: true;
      objective: PersistentGrowthObjective;
      outcome: GoalCycleOutcomeRecord;
      delta: GoalCycleLearnedDeltaRecord | null;
    }
  | {
      bridged: false;
      reason: string;
    };

/**
 * Bridges an authoritative commercial pipeline resolution (won/lost) to the Persistent
 * Growth Operator ledger as an operational_result outcome.
 *
 * Enforces key truth distinction:
 * - A driver field visit is an action_verification (work happened).
 * - An account won or lost is an operational_result (business milestone achieved).
 * - Neither manufactures economic revenue cents (that belongs exclusively to commercial_revenue).
 */
export async function bridgeCommercialResolution(
  input: BridgeCommercialResolutionInput
): Promise<BridgeCommercialResolutionResult> {
  const db = await getDb();
  if (!db) {
    return { bridged: false, reason: "Database unavailable" };
  }

  const matchingObjectives = await findDeterministicObjectivesForDriverAction({
    tenantId: input.tenantId,
    actorId: input.actorId,
    missionId: input.missionId,
    evidenceReference: input.evidenceReference,
  });

  if (matchingObjectives.length === 0) {
    return {
      bridged: false,
      reason: `No active objective deterministically linked to commercial mission ${input.missionId}`,
    };
  }

  if (matchingObjectives.length > 1) {
    console.warn(
      `[PersistentOperator] Ambiguous match: ${matchingObjectives.length} objectives match mission ${input.missionId}. Failing closed.`
    );
    return {
      bridged: false,
      reason: `Ambiguous match: multiple active objectives found for mission ${input.missionId}`,
    };
  }

  const targetObjective = matchingObjectives[0];
  const isWon = input.resolution === "won";
  const outcomeKind = isWon ? "account_won" : "account_lost";
  const epistemicStatus: EpistemicStatus = isWon ? "verified" : "rejected";

  const winAuthority = isWon
    ? await findAuthorityReceiptForSubject({
        tenantId: input.tenantId,
        claimType: "account_won",
        subjectType: "commercial_mission",
        subjectId: String(input.missionId),
      })
    : null;
  if (isWon && !winAuthority) {
    return {
      bridged: false,
      reason: `Commercial mission ${input.missionId} has no account_won Authority Receipt`,
    };
  }
  if (isWon) {
    const match = /^commercial_mission_events:(\d+)$/.exec(input.evidenceReference.trim());
    if (!match) {
      return { bridged: false, reason: "Account win evidence is not a persisted mission event" };
    }
    const [event] = await db
      .select({
        missionId: commercialMissionEvents.missionId,
        eventName: commercialMissionEvents.eventName,
        metadataJson: commercialMissionEvents.metadataJson,
      })
      .from(commercialMissionEvents)
      .where(
        and(
          eq(commercialMissionEvents.tenantId, input.tenantId),
          eq(commercialMissionEvents.id, Number(match[1]))
        )
      )
      .limit(1);
    const eventMetadata =
      event?.metadataJson && typeof event.metadataJson === "object"
        ? (event.metadataJson as Record<string, unknown>)
        : {};
    if (
      !event ||
      event.missionId !== input.missionId ||
      event.eventName !== "account_won" ||
      eventMetadata.authorityReceiptId !== winAuthority!.id
    ) {
      return { bridged: false, reason: "Account win event is not bound to its Authority Receipt" };
    }
  }

  const recorded = await recordGoalCycleOutcome({
    tenantId: input.tenantId,
    objectiveId: targetObjective.id,
    outcomeKind,
    impactClass: "operational_result",
    epistemicStatus,
    evidenceClass: "authoritative_external",
    evidenceReference: input.evidenceReference,
    sourceSystem: input.sourceSystem ?? "commercial_pipeline",
    monetaryValueCents: null,
    observedAt: input.observedAt ?? new Date(),
    explanation:
      input.explanation ??
      `Commercial pipeline mission ${input.missionId} resolved as ${input.resolution} (${input.evidenceReference})`,
    metadata: {
      missionId: input.missionId,
      resolution: input.resolution,
      ...input.metadata,
      ...(winAuthority ? { authorityReceiptId: winAuthority.id } : {}),
    },
  });
  const outcome = recorded.outcome;

  if (isWon) {
    await transitionObjectiveStatus({
      tenantId: input.tenantId,
      objectiveId: targetObjective.id,
      toStatus: "completed",
      statusReason: `Account won via mission ${input.missionId}`,
    }).catch(err => {
      console.warn("[PersistentOperator] failed to transition objective status to completed", err);
    });

    try {
      const { propagateGeographicConquest } = await import("./geographicConquestService");
      await propagateGeographicConquest({
        tenantId: input.tenantId,
        missionId: input.missionId,
        actorId: input.actorId,
        objectiveId: targetObjective.id,
      });
    } catch (err) {
      console.warn("[PersistentOperator] geographic conquest propagation error:", err);
    }
  }

  const deltas = await listGoalCycleLearnedDeltas({
    tenantId: input.tenantId,
    outcomeId: outcome.id,
    limit: 1,
  });

  return {
    bridged: true,
    objective: targetObjective,
    outcome,
    delta: deltas[0] ?? null,
  };
}

/**
 * Searches for active objectives that have an explicit, deterministic link
 * to the given driver action target.
 */
export async function findDeterministicObjectivesForDriverAction(
  input: BridgeDriverActionInput
): Promise<PersistentGrowthObjective[]> {
  const db = await getDb();
  if (!db) return [];

  const targetChecks: Array<{ actionTargetType: string; actionTargetId: string }> = [];

  if (input.missionId != null) {
    targetChecks.push({
      actionTargetType: "commercial_mission",
      actionTargetId: String(input.missionId),
    });

    // Check if the mission belongs to a commercial account
    const [mission] = await db
      .select({ accountSnapshotJson: commercialMissions.accountSnapshotJson })
      .from(commercialMissions)
      .where(
        and(
          eq(commercialMissions.tenantId, input.tenantId),
          eq(commercialMissions.id, input.missionId)
        )
      )
      .limit(1);

    const snapshot = mission?.accountSnapshotJson as { accountId?: number | string } | null;
    const accountId = snapshot?.accountId;
    if (accountId) {
      targetChecks.push({
        actionTargetType: "commercial_account",
        actionTargetId: String(accountId),
      });
    }
  }

  if (input.orderId != null) {
    targetChecks.push({
      actionTargetType: "order",
      actionTargetId: String(input.orderId),
    });
  }

  if (input.commitmentId?.trim()) {
    targetChecks.push({
      actionTargetType: "commitment",
      actionTargetId: input.commitmentId.trim(),
    });
  }

  if (input.stopId?.trim()) {
    targetChecks.push({
      actionTargetType: "stop",
      actionTargetId: input.stopId.trim(),
    });
  }

  if (targetChecks.length === 0) {
    return [];
  }

  // Load all objectives for this tenant that match any target check
  const allObjectives = await listGoalCycleObjectives({
    tenantId: input.tenantId,
    limit: 100,
  });

  // Filter to active objectives matching any of the target checks exactly
  return allObjectives.filter(obj => {
    if (obj.status === "completed" || obj.status === "cancelled") return false;
    return targetChecks.some(
      tc =>
        obj.actionTargetType === tc.actionTargetType &&
        obj.actionTargetId === tc.actionTargetId
    );
  });
}

/**
 * Bridges a real paid CleanCloud order to an authoritative economic outcome.
 *
 * Enforces:
 * 1. Non-heuristic attribution: NO fuzzy matching on customer names, addresses,
 *    dates, or buildings.
 * 2. Deterministic lineage ONLY: explicit customer ID, order ID, or account link.
 * 3. Ambiguity fails closed: if multiple objectives match, leaves unattributed.
 * 4. Fails closed on unpaid orders or non-positive cents.
 * 5. Uses actual CleanCloud order as evidenceReference ("orders:cleancloud:<id>").
 * 6. Preserves delayed attribution: binds to historical objective without
 *    reopening old goal runs or cycles.
 */
export async function bridgeCleanCloudPaidOrder(
  input: BridgeCleanCloudOrderInput
): Promise<BridgeCleanCloudOrderResult> {
  if (!input.tenantId?.trim()) throw new Error("tenantId is required");
  if (!input.cleancloudOrderId?.trim()) throw new Error("cleancloudOrderId is required");

  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const sourceRows = await db
    .select({
      paid: cleancloudPaidOrders.paid,
      totalCents: cleancloudPaidOrders.totalCents,
      cleancloudCustomerId: cleancloudPaidOrders.cleancloudCustomerId,
      paymentDateUtc: cleancloudPaidOrders.paymentDateUtc,
      paidDateUtc: cleancloudPaidOrders.paidDateUtc,
      placedAtUtc: cleancloudPaidOrders.placedAtUtc,
    })
    .from(cleancloudPaidOrders)
    .where(
      and(
        eq(cleancloudPaidOrders.tenantId, input.tenantId),
        eq(cleancloudPaidOrders.cleancloudOrderId, input.cleancloudOrderId.trim())
      )
    );
  const authoritativeSource = sourceRows.find(
    row => row.paid === true && (row.totalCents ?? 0) > 0 && row.totalCents === input.totalCents
  );
  if (!authoritativeSource) {
    return {
      bridged: false,
      reason: "payment_evidence_mismatch",
      message: `CleanCloud order #${input.cleancloudOrderId} caller values do not match persisted paid-order evidence`,
    };
  }

  // Rule 2: Unpaid orders or 0 total can never be economic outcomes
  if (!input.paid || input.totalCents <= 0) {
    return {
      bridged: false,
      reason: "order_not_paid_or_zero",
      message: `CleanCloud order #${input.cleancloudOrderId} is not paid or has non-positive amount (${input.totalCents} cents); cannot bind economic credit.`,
    };
  }

  let matchedObjective: PersistentGrowthObjective | null = null;

  if (input.objectiveId?.trim()) {
    try {
      matchedObjective = await getGoalCycleObjective({
        tenantId: input.tenantId,
        objectiveId: input.objectiveId.trim(),
      });
    } catch {
      matchedObjective = null;
    }
    if (!matchedObjective) {
      return {
        bridged: false,
        reason: "objective_not_found",
        message: `Explicit objectiveId '${input.objectiveId}' was not found for tenant '${input.tenantId}'`,
      };
    }
  } else {
    // Deterministic matching ONLY:
    const candidates = await findDeterministicObjectivesForCleanCloudOrder(input);

    if (candidates.length === 0) {
      return {
        bridged: false,
        reason: "unrelated_order",
        message: `CleanCloud order #${input.cleancloudOrderId} has no deterministic lineage to an objective; left unattributed.`,
      };
    }

    if (candidates.length > 1) {
      // Fail closed on ambiguity!
      return {
        bridged: false,
        reason: "ambiguous_lineage",
        candidateObjectiveIds: candidates.map(c => c.id),
        message: `Multiple candidate objectives (${candidates.length}) could plausibly receive credit; failed closed to prevent false revenue attribution.`,
      };
    }

    matchedObjective = candidates[0];
  }

  const evidenceReference = `orders:cleancloud:${input.cleancloudOrderId.trim()}`;
  const observedAt =
    input.paidDateUtc instanceof Date
      ? input.paidDateUtc
      : typeof input.paidDateUtc === "string"
        ? new Date(input.paidDateUtc)
        : new Date();

  const cleanCloudEvidence = await findCleanCloudPaidObservationReceipt({
    tenantId: input.tenantId,
    cleancloudOrderId: input.cleancloudOrderId.trim(),
  });
  if (!cleanCloudEvidence) {
    return {
      bridged: false,
      reason: "payment_authority_missing",
      message: `CleanCloud order #${input.cleancloudOrderId} has no admitted CleanCloud paid observation`,
    };
  }

  const bound = await bindEconomicOutcome({
    tenantId: input.tenantId,
    objectiveId: matchedObjective.id,
    outcomeKind: "cleancloud_order_paid",
    impactClass: "commercial_revenue",
    evidenceClass: "authoritative_external",
    evidenceReference,
    sourceSystem: "cleancloud",
    monetaryValueCents: input.totalCents,
    observedAt,
    explanation:
      input.explanation ??
      `Authoritative CleanCloud paid order #${input.cleancloudOrderId} ($${(input.totalCents / 100).toFixed(2)}) deterministically attributed.`,
    metadata: {
      cleancloudOrderId: input.cleancloudOrderId,
      cleancloudCustomerId: input.cleancloudCustomerId ?? null,
      sourceFileName: input.sourceFileName ?? null,
      ...input.metadata,
      authorityReceiptId: cleanCloudEvidence.id,
    },
  });

  const deltas = await listGoalCycleLearnedDeltas({
    tenantId: input.tenantId,
    outcomeId: bound.outcome.id,
    limit: 1,
  });

  return {
    bridged: true,
    objective: matchedObjective,
    outcome: bound.outcome,
    delta: deltas[0] ?? null,
  };
}

/**
 * Searches for objectives with an explicit, deterministic link to a CleanCloud order.
 * Strictly avoids heuristic name/address matching.
 */
async function findDeterministicObjectivesForCleanCloudOrder(
  input: BridgeCleanCloudOrderInput
): Promise<PersistentGrowthObjective[]> {
  const db = await getDb();
  if (!db) return [];

  const cleancloudCustomerId = input.cleancloudCustomerId?.trim() || null;
  const cleancloudOrderId = input.cleancloudOrderId.trim();

  const allObjectives = await listGoalCycleObjectives({
    tenantId: input.tenantId,
    limit: 100,
  });

  // Check 1: Direct cleancloud customer or order target
  const directMatches = allObjectives.filter(obj => {
    if (
      cleancloudCustomerId &&
      obj.actionTargetType === "cleancloud_customer" &&
      obj.actionTargetId === cleancloudCustomerId
    ) {
      return true;
    }
    if (
      obj.actionTargetType === "cleancloud_order" &&
      obj.actionTargetId === cleancloudOrderId
    ) {
      return true;
    }
    return false;
  });

  if (directMatches.length > 0) {
    return directMatches;
  }

  // Check 2: Commercial accounts linked via providerAccountId === cleancloudCustomerId
  if (cleancloudCustomerId) {
    const matchingAccounts = await db
      .select({ id: commercialAccounts.id })
      .from(commercialAccounts)
      .where(
        and(
          eq(commercialAccounts.tenantId, input.tenantId),
          eq(commercialAccounts.providerAccountId, cleancloudCustomerId)
        )
      );

    const accountIds = new Set(matchingAccounts.map(a => String(a.id)));
    if (accountIds.size > 0) {
      const accountMatches = allObjectives.filter(
        obj =>
          obj.actionTargetType === "commercial_account" &&
          obj.actionTargetId != null &&
          accountIds.has(obj.actionTargetId)
      );
      if (accountMatches.length > 0) {
        return accountMatches;
      }
    }

    // Check 3: Commercial missions linked to this commercial account or providerAccountId
    const missionObjectives = allObjectives.filter(
      obj => obj.actionTargetType === "commercial_mission" && obj.actionTargetId != null
    );
    if (missionObjectives.length > 0) {
      const missionIds = missionObjectives
        .map(obj => Number(obj.actionTargetId))
        .filter(id => !isNaN(id) && id > 0);
      if (missionIds.length > 0) {
        const missions = await db
          .select({ id: commercialMissions.id, accountSnapshotJson: commercialMissions.accountSnapshotJson })
          .from(commercialMissions)
          .where(
            and(
              eq(commercialMissions.tenantId, input.tenantId),
              inArray(commercialMissions.id, missionIds)
            )
          );

        const matchedMissionIds = new Set<string>();
        for (const m of missions) {
          const snap = m.accountSnapshotJson as {
            accountId?: number | string;
            providerAccountId?: string;
          } | null;
          if (
            (snap?.providerAccountId && String(snap.providerAccountId) === cleancloudCustomerId) ||
            (snap?.accountId && accountIds.has(String(snap.accountId)))
          ) {
            matchedMissionIds.add(String(m.id));
          }
        }

        const missionMatches = missionObjectives.filter(
          obj => obj.actionTargetId != null && matchedMissionIds.has(obj.actionTargetId)
        );
        if (missionMatches.length > 0) {
          return missionMatches;
        }
      }
    }
  }

  return [];
}

/**
 * Helper for commercial mission completion lifecycle event.
 */
export async function bridgeCommercialMissionCompletion(input: {
  tenantId: string;
  missionId: number;
  actorId: string;
  eventId: number;
  eventName: string;
  metadata?: Record<string, unknown>;
}): Promise<BridgeDriverActionResult> {
  return bridgeDriverAction({
    tenantId: input.tenantId,
    actorId: input.actorId,
    missionId: input.missionId,
    evidenceReference: `commercial_mission_events:${input.eventId}`,
    sourceSystem: "dayforge_field",
    outcomeKind: input.eventName === "visit_completed" ? "visit_completed" : input.eventName,
    metadata: input.metadata,
  });
}

export type BridgeParkingLotDebriefInput = {
  tenantId: string;
  actorId: string;
  missionId: number;
  evidenceReference: string;
  debriefText: string;
  visitOutcome?: {
    outcome: string;
    notes?: string | null;
    decisionMakerStatus?: string | null;
    reason?: string | null;
    quoteRequested?: boolean;
    pilotRequested?: boolean;
  } | null;
  observedAt?: Date;
  metadata?: Record<string, unknown>;
};

export type BridgeParkingLotDebriefResult =
  | {
      bridged: true;
      objective: PersistentGrowthObjective;
      outcome: GoalCycleOutcomeRecord;
      delta?: GoalCycleLearnedDeltaRecord | null;
      tacticalSignal: {
        targetKey: string;
        learningKind:
          | "doctrine_weight"
          | "loadout_recommendation"
          | "execution_constraint"
          | "channel_affinity";
        deltaType: "boost" | "suppress" | "reinforce" | "constraint";
        explanation: string;
        confidence: "high" | "medium" | "low";
      };
    }
  | {
      bridged: false;
      reason: string;
    };

export function extractTacticalSignalsFromDebrief(
  text: string,
  visitOutcome?: BridgeParkingLotDebriefInput["visitOutcome"]
): {
  targetKey: string;
  learningKind:
    | "doctrine_weight"
    | "loadout_recommendation"
    | "execution_constraint"
    | "channel_affinity";
  deltaType: "boost" | "suppress" | "reinforce" | "constraint";
  explanation: string;
  confidence: "high" | "medium" | "low";
} {
  const combined = (
    text +
    " " +
    (visitOutcome?.reason ?? "") +
    " " +
    (visitOutcome?.notes ?? "")
  ).toLowerCase();

  // 1. Pricing resistance / friction
  if (
    combined.includes("price") ||
    combined.includes("pricing") ||
    combined.includes("expensive") ||
    combined.includes("too high") ||
    combined.includes("cost") ||
    combined.includes("cents per pound") ||
    combined.includes("per pound") ||
    combined.includes("cheaper") ||
    combined.includes("rates") ||
    combined.includes("rate")
  ) {
    return {
      targetKey: "doctrine:pricing_defense",
      learningKind: "doctrine_weight",
      deltaType: "boost",
      explanation: `Field debrief revealed pricing resistance: "${text.slice(0, 100)}". Elevated pricing_defense doctrine.`,
      confidence: "high",
    };
  }

  // 2. Speed / Turnaround friction
  if (
    combined.includes("turnaround") ||
    combined.includes("24-hour") ||
    combined.includes("same day") ||
    combined.includes("next day") ||
    combined.includes("too slow") ||
    combined.includes("delay") ||
    combined.includes("rush")
  ) {
    return {
      targetKey: "doctrine:express_turnaround",
      learningKind: "doctrine_weight",
      deltaType: "boost",
      explanation: `Field debrief highlighted turnaround sensitivity: "${text.slice(0, 100)}". Elevated express_turnaround doctrine.`,
      confidence: "high",
    };
  }

  // 3. Gatekeeper / Access constraint
  if (
    combined.includes("gate code") ||
    combined.includes("appointment required") ||
    combined.includes("security") ||
    combined.includes("guard") ||
    combined.includes("receptionist refused") ||
    visitOutcome?.decisionMakerStatus === "gatekeeper_blocked"
  ) {
    return {
      targetKey: "constraint:appointment_required",
      learningKind: "execution_constraint",
      deltaType: "constraint",
      explanation: `Field debrief reported facility access restriction: "${text.slice(0, 100)}". Enforced appointment_required constraint.`,
      confidence: "high",
    };
  }

  // 4. Quote / Pilot requested or positive interest
  if (
    visitOutcome?.quoteRequested ||
    visitOutcome?.pilotRequested ||
    combined.includes("quote") ||
    combined.includes("pilot") ||
    combined.includes("excited") ||
    combined.includes("interested") ||
    combined.includes("samples")
  ) {
    return {
      targetKey: "doctrine:field_first",
      learningKind: "loadout_recommendation",
      deltaType: "boost",
      explanation: `Field debrief validated in-person presentation: quote/pilot interest observed. Reinforced field_first doctrine.`,
      confidence: "high",
    };
  }

  // Default: General field discovery
  return {
    targetKey: "doctrine:field_first",
    learningKind: "channel_affinity",
    deltaType: "reinforce",
    explanation: `Operator field testimony recorded: "${text.slice(0, 100)}". Reinforced field channel affinity.`,
    confidence: "medium",
  };
}

/**
 * Bridges driver parking-lot debrief (Claire voice debrief or clerk observation)
 * to an authoritative outcome and immediately derives a tactical learned delta.
 */
export async function bridgeParkingLotDebrief(
  input: BridgeParkingLotDebriefInput
): Promise<BridgeParkingLotDebriefResult> {
  const db = await getDb();
  if (!db) {
    return { bridged: false, reason: "Database unavailable" };
  }

  const admitted = await admitCommercialFieldObservation({
    tenantId: input.tenantId,
    missionId: input.missionId,
    evidenceReference: input.evidenceReference,
  });

  const matchingObjectives = await findDeterministicObjectivesForDriverAction({
    tenantId: input.tenantId,
    actorId: input.actorId,
    missionId: input.missionId,
    evidenceReference: input.evidenceReference,
  });

  if (matchingObjectives.length === 0) {
    return {
      bridged: false,
      reason: `No active objective deterministically linked to mission ${input.missionId}`,
    };
  }
  if (matchingObjectives.length > 1) {
    return {
      bridged: false,
      reason: `Ambiguous objective lineage for mission ${input.missionId}; debrief learning failed closed`,
    };
  }

  const targetObjective = matchingObjectives[0];
  const tacticalSignal = extractTacticalSignalsFromDebrief(
    admitted.observationText,
    admitted.visitOutcome
  );

  const recorded = await recordGoalCycleOutcome({
    tenantId: input.tenantId,
    objectiveId: targetObjective.id,
    outcomeKind: "field_debrief_analyzed",
    impactClass: "operational_result",
    epistemicStatus: "verified",
    evidenceClass: "operator_attested",
    evidenceReference: input.evidenceReference,
    sourceSystem: "claire_field_debrief",
    monetaryValueCents: null,
    observedAt: input.observedAt ?? new Date(),
    explanation: tacticalSignal.explanation,
    metadata: {
      ...(input.metadata ?? {}),
      missionId: input.missionId,
      debriefText: admitted.observationText,
      tacticalSignal,
      authorityReceiptId: admitted.receipt.id,
    },
  });

  let delta: GoalCycleLearnedDeltaRecord | null = null;
  try {
    const learningResult = await evaluateOutcomeAndRecordLearning({
      tenantId: input.tenantId,
      outcomeId: recorded.outcome.id,
      targetKey: tacticalSignal.targetKey,
      learningKind: tacticalSignal.learningKind,
      deltaType: tacticalSignal.deltaType,
      explanation: tacticalSignal.explanation,
    });
    delta = learningResult.delta;
  } catch (err) {
    console.warn(
      "[PersistentOperator] evaluateOutcomeAndRecordLearning deferred for debrief",
      err
    );
  }

  return {
    bridged: true,
    objective: targetObjective,
    outcome: recorded.outcome,
    delta,
    tacticalSignal,
  };
}
