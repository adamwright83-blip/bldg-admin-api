import { and, eq } from "drizzle-orm";
import {
  daphneObservations,
  daphneInterventions,
  daphneMetaPreferences,
  operatorRepresentativeAdaptationReceipts,
} from "../../../drizzle/schema";
import { getDb } from "../../db";
import type { DaphneAdaptationUseReceipt } from "../operatorRepresentative/adaptationReceipts";
import { DAPHNE_STAGE3B_TARGET_KEY } from "../operatorRepresentative/adaptationContract";
import { recordDaphneObservation } from "./observationStore";
import {
  listDaphneInterventions,
  recordDaphneIntervention,
} from "./interventionLedger";
import { listDaphneOutcomes, recordDaphneOutcome } from "./outcomeLedger";
import {
  buildDaphneResponseModel,
  persistDaphneResponseEstimate,
} from "./responseModel";
import { previewDaphneOutcomeInformedPolicy } from "./learnedPolicy";
import { isDaphneV2ClaireEnabled } from "./claireAdapter";
import {
  loadDaphneMetaPreferences,
  daphneAdaptationAllowed,
} from "./goalsPreferences";

export const DAPHNE_STAGE3B_CONTEXT = "stage3b:ambiguous_pending_continuation";

type Persistence = Pick<
  NonNullable<Awaited<ReturnType<typeof getDb>>>,
  "select" | "insert"
>;
export async function loadDaphneStage3bRecommendation(
  scope: { tenantId: string; canonicalOperatorId: string },
  persistence?: Persistence
) {
  if (
    !persistence &&
    (!isDaphneV2ClaireEnabled(scope.tenantId) ||
      !daphneAdaptationAllowed(await loadDaphneMetaPreferences(scope)))
  ) {
    return previewDaphneOutcomeInformedPolicy({
      contextKey: DAPHNE_STAGE3B_CONTEXT,
      policyVersion: "stage3b-evidence-v1",
      interventions: [],
      outcomes: [],
      options: [
        {
          key: "ask_instead",
          burden: 0,
          relationshipRisk: 0,
          preferenceFit: 1,
          uncertainty: 1,
        },
      ],
    });
  }
  const [interventions, outcomes] = await Promise.all([
    listDaphneInterventions({ ...scope, limit: 500 }, persistence),
    listDaphneOutcomes({ ...scope, limit: 500 }, persistence),
  ]);
  return previewDaphneOutcomeInformedPolicy({
    contextKey: DAPHNE_STAGE3B_CONTEXT,
    policyVersion: "stage3b-evidence-v1",
    interventions: interventions.filter(
      i =>
        i.agentId === "claire" &&
        i.policyReceipt?.targetKey === DAPHNE_STAGE3B_TARGET_KEY &&
        i.policyReceipt?.executionStatus === "branch_selected"
    ),
    outcomes,
    options: [
      {
        key: "ask_instead",
        burden: 0,
        relationshipRisk: 0,
        preferenceFit: 1,
        uncertainty: 0.5,
      },
    ],
  });
}

/** Called only after the existing receipted Claire branch has actually selected clarification. */
export async function recordDaphneStage3bExecution(
  receipt: DaphneAdaptationUseReceipt,
  priorRecommendation?: Awaited<
    ReturnType<typeof loadDaphneStage3bRecommendation>
  > | null
) {
  if (!isDaphneV2ClaireEnabled(receipt.tenantId)) return null;
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const scope = {
    tenantId: receipt.tenantId,
    canonicalOperatorId: receipt.canonicalOperatorId,
  };
  if (!daphneAdaptationAllowed(await loadDaphneMetaPreferences(scope)))
    return null;
  const [stored] = await db
    .select()
    .from(operatorRepresentativeAdaptationReceipts)
    .where(
      and(
        eq(operatorRepresentativeAdaptationReceipts.id, receipt.id),
        eq(operatorRepresentativeAdaptationReceipts.tenantId, scope.tenantId),
        eq(
          operatorRepresentativeAdaptationReceipts.canonicalOperatorId,
          scope.canonicalOperatorId
        )
      )
    )
    .limit(1);
  if (
    !stored ||
    stored.targetKey !== DAPHNE_STAGE3B_TARGET_KEY ||
    stored.directiveId !== receipt.directiveId
  )
    throw new Error(
      "Stage 3B execution requires the durable original authorization/use receipt"
    );
  const observed = await recordDaphneObservation({
    ...scope,
    agentId: "claire",
    sessionId: receipt.conversationId,
    actorType: "agent",
    actorId: "claire",
    observationKind: "agent_action",
    evidenceChannel: "system_record",
    verificationStatus: "verified",
    sourceType: "daphne_stage3b_execution",
    sourceReference: receipt.id,
    occurredAt: new Date(),
    payload: {
      targetKey: receipt.targetKey,
      action: "ask_instead",
      structuralOutcome: receipt.structuralOutcome,
    },
    idempotencyKey: `stage3b-execution:${receipt.id}`,
  });
  const recommendation =
    priorRecommendation ?? (await loadDaphneStage3bRecommendation(scope));
  return recordDaphneIntervention({
    ...scope,
    agentId: "claire",
    decisionPointId: receipt.turnId.slice(0, 128),
    contextKey: DAPHNE_STAGE3B_CONTEXT,
    acceptableActions: ["ask_instead"],
    chosenAction: "ask_instead",
    selectionMode: "deterministic",
    policyVersion: "stage3b-evidence-v1",
    proximalOutcomeWindowMinutes: 30,
    sourceObservationIds: [observed.id],
    idempotencyKey: `stage3b:${receipt.id}`,
    policyReceipt: {
      executionStatus: "branch_selected",
      targetKey: receipt.targetKey,
      directiveId: receipt.directiveId,
      originalUseReceiptId: receipt.id,
      recommendation,
      appliedAuthority: "explicit_ask_instead_directive",
      expandedBehaviorEnabled: false,
      evidenceDecisionPhase: priorRecommendation
        ? "before_authorized_branch"
        : "execution_audit",
    },
  });
}

/** Consume independently verified, scoped system evidence, never model prose or silence. */
export async function ingestVerifiedDaphneStage3bOutcome(
  input: {
    tenantId: string;
    canonicalOperatorId: string;
    observationId: string;
  },
  persistence?: Persistence
): Promise<{
  outcome: Awaited<ReturnType<typeof recordDaphneOutcome>>;
  recommendation: Awaited<ReturnType<typeof loadDaphneStage3bRecommendation>>;
  expandedBehaviorEnabled: false;
}> {
  const database = await getDb();
  if (!database) throw new Error("Database unavailable");
  if (!persistence)
    return database.transaction(tx =>
      ingestVerifiedDaphneStage3bOutcome(input, tx)
    );
  const db = persistence;
  if (!isDaphneV2ClaireEnabled(input.tenantId))
    throw new Error("Daphne learning disabled");
  const controls = await db
    .select()
    .from(daphneMetaPreferences)
    .where(
      and(
        eq(daphneMetaPreferences.tenantId, input.tenantId),
        eq(daphneMetaPreferences.canonicalOperatorId, input.canonicalOperatorId)
      )
    )
    .orderBy(daphneMetaPreferences.version);
  const latest = new Map(
    controls.map(control => [control.preferenceKey, control])
  );
  if (
    ["adaptation_enabled", "memory_recall"].some(
      key =>
        latest.get(key)?.status === "revoked" ||
        latest.get(key)?.valueJson === false
    )
  )
    throw new Error("Daphne learning revoked");
  const [evidence] = await db
    .select()
    .from(daphneObservations)
    .where(
      and(
        eq(daphneObservations.id, input.observationId),
        eq(daphneObservations.tenantId, input.tenantId),
        eq(daphneObservations.canonicalOperatorId, input.canonicalOperatorId)
      )
    )
    .limit(1);
  if (
    !evidence ||
    evidence.observationKind !== "verified_operational_outcome" ||
    evidence.verificationStatus !== "verified" ||
    !["system", "tool", "external"].includes(evidence.actorType) ||
    !["system_record", "authoritative_external"].includes(
      evidence.evidenceChannel
    )
  )
    throw new Error("Ineligible outcome evidence");
  const payload = evidence.payloadJson as {
    interventionId?: string;
    measureKey?: string;
    value?: number;
  } | null;
  if (
    !payload?.interventionId ||
    !["started", "burden"].includes(payload.measureKey ?? "") ||
    typeof payload.value !== "number" ||
    !Number.isFinite(payload.value) ||
    payload.value < 0 ||
    payload.value > 1
  )
    throw new Error("Invalid predefined outcome measurement");
  const [intervention] = await db
    .select()
    .from(daphneInterventions)
    .where(
      and(
        eq(daphneInterventions.id, payload.interventionId),
        eq(daphneInterventions.tenantId, input.tenantId),
        eq(daphneInterventions.canonicalOperatorId, input.canonicalOperatorId)
      )
    )
    .limit(1);
  const policy = intervention?.policyReceiptJson as Record<
    string,
    unknown
  > | null;
  if (
    !intervention ||
    intervention.agentId !== "claire" ||
    policy?.targetKey !== DAPHNE_STAGE3B_TARGET_KEY ||
    policy.executionStatus !== "branch_selected" ||
    (evidence.agentId && evidence.agentId !== "claire")
  )
    throw new Error("Outcome lacks executed Stage 3B intervention");
  const elapsed =
    evidence.occurredAt.getTime() - intervention.createdAt.getTime();
  if (elapsed < 0 || elapsed > 30 * 60_000)
    throw new Error("Outcome outside predefined window");
  const outcome = await recordDaphneOutcome(
    {
      ...input,
      interventionId: intervention.id,
      outcomeClass: payload.measureKey === "burden" ? "burden" : "proximal",
      measureKey: payload.measureKey!,
      value: payload.value,
      evidenceClass: evidence.evidenceChannel as
        | "system_record"
        | "authoritative_external",
      verificationStatus: "verified",
      sourceReference: evidence.id,
      observedAt: evidence.occurredAt,
      windowStart: intervention.createdAt,
      windowEnd: new Date(intervention.createdAt.getTime() + 30 * 60_000),
      idempotencyKey: `stage3b-outcome:${evidence.id}`,
    },
    db
  );
  const [interventions, outcomes] = await Promise.all([
    listDaphneInterventions({ ...input, limit: 500 }, db),
    listDaphneOutcomes({ ...input, limit: 500 }, db),
  ]);
  for (const estimate of buildDaphneResponseModel({
    interventions: interventions.filter(
      i =>
        i.agentId === "claire" &&
        i.policyReceipt?.targetKey === DAPHNE_STAGE3B_TARGET_KEY
    ),
    outcomes,
    successMeasureKey: "started",
    burdenMeasureKey: "burden",
  }))
    await persistDaphneResponseEstimate(
      {
        ...input,
        agentId: "claire",
        estimate,
        modelVersion: "stage3b-evidence-v1",
      },
      db
    );
  return {
    outcome,
    recommendation: await loadDaphneStage3bRecommendation(input, db),
    expandedBehaviorEnabled: false as const,
  };
}
