import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { cleancloudPaidOrders, goalCycleOutcomes } from "../../drizzle/schema";
import { getDb } from "../db";
import { getAuthorityReceiptById } from "../authority/authorityReceipt";
import { isMysqlDuplicateKeyError } from "../mysqlErrors";
import {
  assertBusinessTruthEvidence,
  type GoldlineEvidenceClass,
} from "../../shared/goldlineTruthContract";
import {
  getGoalCycleObjective,
  transitionObjectiveStatus,
  type ObjectiveStatus,
  type PersistentGrowthObjective,
} from "./objectiveStore";

export const OUTCOME_IMPACT_CLASSES = [
  "action_verification",
  "operational_result",
  "commercial_revenue",
  "customer_lifecycle",
] as const;

export type OutcomeImpactClass = (typeof OUTCOME_IMPACT_CLASSES)[number];

export const EPISTEMIC_STATUSES = [
  "verified",
  "unverified",
  "disputed",
  "rejected",
] as const;

export type EpistemicStatus = (typeof EPISTEMIC_STATUSES)[number];

export type GoalCycleOutcomeRecord = {
  id: string;
  tenantId: string;
  goalRunId: string;
  cycleId: string;
  decisionId: string;
  objectiveId: string;
  canonicalOperatorId: string;
  operatorUserId: string;
  outcomeKind: string;
  impactClass: OutcomeImpactClass;
  epistemicStatus: EpistemicStatus;
  evidenceClass: GoldlineEvidenceClass;
  evidenceReference: string;
  sourceSystem: string;
  monetaryValueCents: number | null;
  quantityValue: string | null;
  unit: string | null;
  explanation: string | null;
  metadata: Record<string, unknown> | null;
  observedAt: string;
  createdAt: string;
};

export type RecordOutcomeInput = {
  tenantId: string;
  objectiveId: string;
  outcomeKind: string;
  impactClass: OutcomeImpactClass;
  evidenceClass: GoldlineEvidenceClass;
  evidenceReference: string;
  sourceSystem: string;
  epistemicStatus?: EpistemicStatus;
  monetaryValueCents?: number | null;
  quantityValue?: number | string | null;
  unit?: string | null;
  explanation?: string | null;
  metadata?: Record<string, unknown> | null;
  observedAt?: Date | string | null;
  financialReview?: boolean;
};

export type VerifyObjectiveExecutionInput = {
  tenantId: string;
  objectiveId: string;
  evidenceReference: string;
  sourceSystem: string;
  evidenceClass?: GoldlineEvidenceClass;
  outcomeKind?: string;
  explanation?: string | null;
  metadata?: Record<string, unknown> | null;
  observedAt?: Date | string | null;
  transitionObjectiveTo?: ObjectiveStatus;
  statusReason?: string | null;
};

export type BindEconomicOutcomeInput = {
  tenantId: string;
  objectiveId: string;
  outcomeKind: string;
  evidenceReference: string;
  sourceSystem: string;
  evidenceClass?: GoldlineEvidenceClass;
  impactClass?: OutcomeImpactClass;
  monetaryValueCents?: number | null;
  quantityValue?: number | string | null;
  unit?: string | null;
  explanation?: string | null;
  metadata?: Record<string, unknown> | null;
  observedAt?: Date | string | null;
  financialReview?: boolean;
};

function toRecord(
  row: typeof goalCycleOutcomes.$inferSelect
): GoalCycleOutcomeRecord {
  const impactClass: OutcomeImpactClass = (
    OUTCOME_IMPACT_CLASSES as readonly string[]
  ).includes(row.impactClass)
    ? (row.impactClass as OutcomeImpactClass)
    : "operational_result";

  const epistemicStatus: EpistemicStatus = (
    EPISTEMIC_STATUSES as readonly string[]
  ).includes(row.epistemicStatus)
    ? (row.epistemicStatus as EpistemicStatus)
    : "verified";

  const evidenceClass: GoldlineEvidenceClass =
    row.evidenceClass === "authoritative_external" ||
    row.evidenceClass === "operator_attested" ||
    row.evidenceClass === "derived" ||
    row.evidenceClass === "game_projection"
      ? row.evidenceClass
      : "authoritative_external";

  const metadata =
    row.metadataJson && typeof row.metadataJson === "object"
      ? (row.metadataJson as Record<string, unknown>)
      : null;

  return {
    id: row.id,
    tenantId: row.tenantId,
    goalRunId: row.goalRunId,
    cycleId: row.cycleId,
    decisionId: row.decisionId,
    objectiveId: row.objectiveId,
    canonicalOperatorId: row.canonicalOperatorId,
    operatorUserId: row.operatorUserId,
    outcomeKind: row.outcomeKind,
    impactClass,
    epistemicStatus,
    evidenceClass,
    evidenceReference: row.evidenceReference,
    sourceSystem: row.sourceSystem,
    monetaryValueCents: row.monetaryValueCents,
    quantityValue: row.quantityValue ? String(row.quantityValue) : null,
    unit: row.unit,
    explanation: row.explanation,
    metadata,
    observedAt: row.observedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

export async function getGoalCycleOutcome(input: {
  tenantId: string;
  outcomeId: string;
}): Promise<GoalCycleOutcomeRecord | null> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [row] = await db
    .select()
    .from(goalCycleOutcomes)
    .where(
      and(
        eq(goalCycleOutcomes.tenantId, input.tenantId),
        eq(goalCycleOutcomes.id, input.outcomeId)
      )
    )
    .limit(1);
  return row ? toRecord(row) : null;
}

export async function findOutcomeByIdempotencyKey(input: {
  tenantId: string;
  objectiveId: string;
  outcomeKind: string;
  evidenceReference: string;
}): Promise<GoalCycleOutcomeRecord | null> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [row] = await db
    .select()
    .from(goalCycleOutcomes)
    .where(
      and(
        eq(goalCycleOutcomes.tenantId, input.tenantId),
        eq(goalCycleOutcomes.objectiveId, input.objectiveId),
        eq(goalCycleOutcomes.outcomeKind, input.outcomeKind),
        eq(goalCycleOutcomes.evidenceReference, input.evidenceReference)
      )
    )
    .limit(1);
  return row ? toRecord(row) : null;
}

export async function listGoalCycleOutcomes(input: {
  tenantId: string;
  objectiveId?: string;
  decisionId?: string;
  goalRunId?: string;
  outcomeKind?: string;
  impactClass?: OutcomeImpactClass;
  limit?: number;
}): Promise<GoalCycleOutcomeRecord[]> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const where = [eq(goalCycleOutcomes.tenantId, input.tenantId)];
  if (input.objectiveId) {
    where.push(eq(goalCycleOutcomes.objectiveId, input.objectiveId));
  }
  if (input.decisionId) {
    where.push(eq(goalCycleOutcomes.decisionId, input.decisionId));
  }
  if (input.goalRunId) {
    where.push(eq(goalCycleOutcomes.goalRunId, input.goalRunId));
  }
  if (input.outcomeKind) {
    where.push(eq(goalCycleOutcomes.outcomeKind, input.outcomeKind));
  }
  if (input.impactClass) {
    where.push(eq(goalCycleOutcomes.impactClass, input.impactClass));
  }

  const rows = await db
    .select()
    .from(goalCycleOutcomes)
    .where(and(...where))
    .orderBy(desc(goalCycleOutcomes.createdAt))
    .limit(input.limit ?? 50);

  return rows.map(toRecord);
}

export async function getGoalCycleOutcomesByObjective(input: {
  tenantId: string;
  objectiveId: string;
}): Promise<GoalCycleOutcomeRecord[]> {
  return listGoalCycleOutcomes(input);
}

export async function getGoalCycleOutcomesByDecision(input: {
  tenantId: string;
  decisionId: string;
}): Promise<GoalCycleOutcomeRecord[]> {
  return listGoalCycleOutcomes(input);
}

/**
 * Records an authoritative outcome bound to a Persistent Growth Objective.
 *
 * Enforces:
 * 1. Lineage to existing objective, decision, cycle, goalRun, and canonical operator.
 * 2. Real-world business truth assertion (fails closed for game projection or unbacked claims).
 * 3. Financial review fails closed for commercial revenue truth.
 * 4. Idempotency on (tenantId, objectiveId, outcomeKind, evidenceReference).
 */
async function assertConsequentialOutcomeAuthority(
  input: RecordOutcomeInput
): Promise<void> {
  const requirements: Record<
    string,
    { claimType: "action_completed" | "account_won" | "payment_verified"; subjectType: string; subjectIdKey: string }
  > = {
    visit_completed: {
      claimType: "action_completed",
      subjectType: "commercial_mission",
      subjectIdKey: "missionId",
    },
    account_won: {
      claimType: "account_won",
      subjectType: "commercial_mission",
      subjectIdKey: "missionId",
    },
    cleancloud_order_paid: {
      claimType: "payment_verified",
      subjectType: "cleancloud_order",
      subjectIdKey: "cleancloudOrderId",
    },
  };
  const requirement = requirements[input.outcomeKind];
  if (!requirement) return;

  const metadata = input.metadata ?? {};
  const receiptId =
    typeof metadata.authorityReceiptId === "string"
      ? metadata.authorityReceiptId.trim()
      : "";
  const subjectIdValue = metadata[requirement.subjectIdKey];
  const subjectId =
    typeof subjectIdValue === "number" || typeof subjectIdValue === "string"
      ? String(subjectIdValue).trim()
      : "";
  if (!receiptId || !subjectId) {
    throw new Error(
      `Outcome '${input.outcomeKind}' requires a matching Authority Receipt`
    );
  }
  const receipt = await getAuthorityReceiptById({
    tenantId: input.tenantId,
    receiptId,
  });
  if (
    !receipt ||
    receipt.claimType !== requirement.claimType ||
    receipt.subjectType !== requirement.subjectType ||
    receipt.subjectId !== subjectId
  ) {
    throw new Error(
      `Outcome '${input.outcomeKind}' Authority Receipt does not match its subject`
    );
  }
  if (
    input.outcomeKind === "visit_completed" &&
    receipt.sourceRef !== input.evidenceReference
  ) {
    throw new Error(
      "visit_completed Authority Receipt must match the persisted completion event"
    );
  }

  if (input.outcomeKind === "cleancloud_order_paid") {
    if (
      receipt.sourceType !== "cleancloud_paid_order" ||
      input.monetaryValueCents == null ||
      input.monetaryValueCents <= 0
    ) {
      throw new Error(
        "cleancloud_order_paid requires verified CleanCloud payment evidence and a positive amount"
      );
    }
    const db = await getDb();
    if (!db) throw new Error("Database unavailable");
    const rows = await db
      .select({
        paid: cleancloudPaidOrders.paid,
        totalCents: cleancloudPaidOrders.totalCents,
      })
      .from(cleancloudPaidOrders)
      .where(
        and(
          eq(cleancloudPaidOrders.tenantId, input.tenantId),
          eq(cleancloudPaidOrders.cleancloudOrderId, subjectId)
        )
      );
    const amountMatches = rows.some(
      row =>
        row.paid === true &&
        (row.totalCents ?? 0) > 0 &&
        row.totalCents === input.monetaryValueCents
    );
    if (!amountMatches) {
      throw new Error(
        "cleancloud_order_paid amount does not match persisted paid-order evidence"
      );
    }
  }
}

export async function recordGoalCycleOutcome(
  input: RecordOutcomeInput
): Promise<{ outcome: GoalCycleOutcomeRecord; created: boolean }> {
  if (!input.tenantId.trim()) throw new Error("tenantId is required");
  if (!input.objectiveId.trim()) throw new Error("objectiveId is required");
  if (!input.outcomeKind.trim()) throw new Error("outcomeKind is required");
  if (!input.evidenceReference.trim()) {
    throw new Error("evidenceReference is required");
  }
  if (!input.sourceSystem.trim()) throw new Error("sourceSystem is required");

  await assertConsequentialOutcomeAuthority(input);

  // Check financial review rule: commercial revenue fails closed on financial review
  if (input.financialReview) {
    throw new Error(
      "Financial review status fails closed for authoritative commercial revenue"
    );
  }

  const objective = await getGoalCycleObjective({
    tenantId: input.tenantId,
    objectiveId: input.objectiveId,
  });
  if (!objective) {
    throw new Error(`Objective '${input.objectiveId}' not found for tenant '${input.tenantId}'`);
  }

  const observedDate =
    input.observedAt instanceof Date
      ? input.observedAt
      : typeof input.observedAt === "string"
        ? new Date(input.observedAt)
        : new Date();

  // If this represents a business or economic truth claim, verify evidence class
  if (
    input.impactClass === "commercial_revenue" ||
    input.impactClass === "customer_lifecycle" ||
    input.impactClass === "operational_result"
  ) {
    assertBusinessTruthEvidence(
      [
        {
          sourceType: input.sourceSystem,
          sourceReference: input.evidenceReference,
          classification: input.evidenceClass,
          observedAt: observedDate.toISOString(),
        },
      ],
      `Outcome '${input.outcomeKind}'`
    );
  } else if (input.evidenceClass === "game_projection") {
    throw new Error("Game projection cannot create business truth");
  }

  const existing = await findOutcomeByIdempotencyKey({
    tenantId: input.tenantId,
    objectiveId: input.objectiveId,
    outcomeKind: input.outcomeKind,
    evidenceReference: input.evidenceReference,
  });
  if (existing) {
    return { outcome: existing, created: false };
  }

  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const id = randomUUID();
  const quantityValue =
    input.quantityValue !== undefined && input.quantityValue !== null
      ? String(input.quantityValue)
      : null;

  const insertPayload = {
    id,
    tenantId: input.tenantId,
    goalRunId: objective.goalRunId,
    cycleId: objective.cycleId,
    decisionId: objective.decisionId,
    objectiveId: objective.id,
    canonicalOperatorId: objective.canonicalOperatorId,
    operatorUserId: objective.operatorUserId,
    outcomeKind: input.outcomeKind,
    impactClass: input.impactClass,
    epistemicStatus: input.epistemicStatus ?? "verified",
    evidenceClass: input.evidenceClass,
    evidenceReference: input.evidenceReference,
    sourceSystem: input.sourceSystem,
    monetaryValueCents: input.monetaryValueCents ?? null,
    quantityValue,
    unit: input.unit ?? null,
    explanation: input.explanation ?? null,
    metadataJson: input.metadata ?? null,
    observedAt: observedDate,
  };

  try {
    await db.insert(goalCycleOutcomes).values(insertPayload);
    const created = await getGoalCycleOutcome({
      tenantId: input.tenantId,
      outcomeId: id,
    });
    if (!created) throw new Error("Failed to load created outcome record");

    // Automatically trigger learning for epistemically settled outcomes (verified or rejected)
    if (created.epistemicStatus === "verified" || created.epistemicStatus === "rejected") {
      try {
        const { evaluateOutcomeAndRecordLearning } = await import("./learningStore");
        await evaluateOutcomeAndRecordLearning({
          tenantId: created.tenantId,
          outcomeId: created.id,
        });
      } catch (learningError) {
        console.warn(
          `[PersistentOperator] Automatic learning evaluation deferred for outcome ${created.id}:`,
          learningError instanceof Error ? learningError.message : learningError
        );
      }
    }

    return { outcome: created, created: true };
  } catch (error) {
    if (isMysqlDuplicateKeyError(error)) {
      const duplicate = await findOutcomeByIdempotencyKey({
        tenantId: input.tenantId,
        objectiveId: input.objectiveId,
        outcomeKind: input.outcomeKind,
        evidenceReference: input.evidenceReference,
      });
      if (duplicate) return { outcome: duplicate, created: false };
    }
    throw error;
  }
}

/**
 * Records that an objective's action was executed/attempted in the real world
 * (e.g. phone call completed, physical location arrived, tool executed).
 *
 * Advances objective status to 'action_executed' or 'completed'.
 * Crucially: this verifies WORK WAS DONE, but NEVER manufactures economic credit.
 */
export async function verifyObjectiveExecution(
  input: VerifyObjectiveExecutionInput
): Promise<{
  outcome: GoalCycleOutcomeRecord;
  objective: PersistentGrowthObjective;
  created: boolean;
}> {
  const outcomeResult = await recordGoalCycleOutcome({
    tenantId: input.tenantId,
    objectiveId: input.objectiveId,
    outcomeKind: input.outcomeKind ?? "action_verification",
    impactClass: "action_verification",
    evidenceClass: input.evidenceClass ?? "authoritative_external",
    evidenceReference: input.evidenceReference,
    sourceSystem: input.sourceSystem,
    epistemicStatus: "verified",
    monetaryValueCents: null,
    quantityValue: null,
    unit: null,
    explanation: input.explanation ?? "Action verified by authoritative evidence",
    metadata: input.metadata ?? null,
    observedAt: input.observedAt,
  });

  const nextStatus = input.transitionObjectiveTo ?? "action_executed";
  const updatedObjective = await transitionObjectiveStatus({
    tenantId: input.tenantId,
    objectiveId: input.objectiveId,
    toStatus: nextStatus,
    statusReason: input.statusReason ?? input.explanation ?? "Action execution verified",
    now: input.observedAt instanceof Date ? input.observedAt : new Date(),
  });

  return {
    outcome: outcomeResult.outcome,
    objective: updatedObjective,
    created: outcomeResult.created,
  };
}

/**
 * Binds authoritative economic accountability back to an Objective.
 *
 * Requires authoritative external or operator-attested financial evidence
 * (e.g. paid order, commercial revenue attribution).
 * Fails closed on financial review.
 */
export async function bindEconomicOutcome(
  input: BindEconomicOutcomeInput
): Promise<{ outcome: GoalCycleOutcomeRecord; created: boolean }> {
  return recordGoalCycleOutcome({
    tenantId: input.tenantId,
    objectiveId: input.objectiveId,
    outcomeKind: input.outcomeKind,
    impactClass: input.impactClass ?? "commercial_revenue",
    evidenceClass: input.evidenceClass ?? "authoritative_external",
    evidenceReference: input.evidenceReference,
    sourceSystem: input.sourceSystem,
    epistemicStatus: "verified",
    monetaryValueCents: input.monetaryValueCents ?? null,
    quantityValue: input.quantityValue ?? null,
    unit: input.unit ?? (input.monetaryValueCents != null ? "cents" : null),
    explanation: input.explanation ?? null,
    metadata: input.metadata ?? null,
    observedAt: input.observedAt,
    financialReview: input.financialReview,
  });
}
