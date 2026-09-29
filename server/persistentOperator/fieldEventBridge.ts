import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  commercialAccounts,
  commercialMissions,
  cleancloudPaidOrders,
  goalCycleObjectives,
  goalCycleOutcomes,
} from "../../drizzle/schema";
import { getDb } from "../db";
import {
  getGoalCycleObjective,
  listGoalCycleObjectives,
  type PersistentGrowthObjective,
} from "./objectiveStore";
import {
  bindEconomicOutcome,
  verifyObjectiveExecution,
  type GoalCycleOutcomeRecord,
} from "./outcomeStore";
import {
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
        | "objective_not_found";
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

  // Action verification: verifies work was done, never awards money
  const verification = await verifyObjectiveExecution({
    tenantId: input.tenantId,
    objectiveId: matchedObjective.id,
    evidenceReference: input.evidenceReference,
    sourceSystem: input.sourceSystem ?? "dayforge_field",
    outcomeKind: input.outcomeKind ?? "visit_completed",
    explanation:
      input.explanation ??
      `Driver action verified completed by real field event (${input.evidenceReference})`,
    transitionObjectiveTo: "action_executed",
    observedAt: input.observedAt,
    metadata: input.metadata,
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

/**
 * Searches for active objectives that have an explicit, deterministic link
 * to the given driver action target.
 */
async function findDeterministicObjectivesForDriverAction(
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
      .select({ accountId: commercialMissions.accountId })
      .from(commercialMissions)
      .where(
        and(
          eq(commercialMissions.tenantId, input.tenantId),
          eq(commercialMissions.id, input.missionId)
        )
      )
      .limit(1);

    if (mission?.accountId) {
      targetChecks.push({
        actionTargetType: "commercial_account",
        actionTargetId: String(mission.accountId),
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
