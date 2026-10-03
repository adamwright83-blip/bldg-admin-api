import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "../../db";
import type { ClaireBrainV3Interpretation } from "./brainV3";

export type ClaireDecisionType =
  | "turn_type"
  | "turn_readiness"
  | "pending_action_relationship";

export type ClaireTurnType =
  | "correction"
  | "new_work"
  | "question"
  | "interruption"
  | "conversation"
  | "unknown";

export type ClaireTurnReadiness = "ready" | "incomplete" | "ambiguous" | "unknown";

export type ClairePendingActionRelationship =
  | "continues_pending"
  | "replaces_pending"
  | "unrelated"
  | "unknown";

export type ClaireDecisionOutput =
  | ClaireTurnType
  | ClaireTurnReadiness
  | ClairePendingActionRelationship
  | "clarify";

export type ClaireAbstentionReason =
  | "margin_below_threshold"
  | "confidence_below_threshold"
  | "provider_unavailable";

export type ClaireDecisionCandidate<T extends string> = {
  decisionType: ClaireDecisionType;
  provider: string;
  allowedOutputs: readonly T[];
  providerSelectedOutput: T | null;
  distribution: Record<string, number> | null;
  abstained: boolean;
  abstentionReason: ClaireAbstentionReason | null;
  effectiveOutput: T | "clarify";
  latencyMs: number | null;
  estimatedCostUsd: number | null;
  fallbackUsed: boolean;
};

export type ClaireClosedDecisionSet = {
  turnType: ClaireDecisionCandidate<ClaireTurnType>;
  turnReadiness: ClaireDecisionCandidate<ClaireTurnReadiness>;
  pendingActionRelationship: ClaireDecisionCandidate<ClairePendingActionRelationship>;
};

export type ClaireDecisionRecordInput = {
  decisionId: string;
  turnId: string;
  tenantId: string;
  operatorUserId: string;
  agent: "claire";
  decision: ClaireDecisionCandidate<string>;
};

export type ClaireDecisionStore = {
  writeAndSeal: (rows: ClaireDecisionRecordInput[]) => Promise<void>;
};

type DeriveInput = {
  brain: ClaireBrainV3Interpretation | null;
  provider: string;
  fallbackUsed: boolean;
  thoughtCompleteness: "complete" | "incomplete" | "forced_flush";
  hasPendingAction: boolean;
  telephonySessionEnded?: boolean;
};

export const TURN_TYPE_OUTPUTS = ["correction", "new_work", "question", "interruption", "conversation", "unknown"] as const;
export const TURN_READINESS_OUTPUTS = ["ready", "incomplete", "ambiguous", "unknown"] as const;
export const PENDING_RELATIONSHIP_OUTPUTS = ["continues_pending", "replaces_pending", "unrelated", "unknown"] as const;

export function claireDecisionId(turnId: string, decisionType: ClaireDecisionType): string {
  return createHash("sha256").update(`${turnId}:${decisionType}`).digest("hex").slice(0, 40);
}

const oneHot = (label: string | null): Record<string, number> | null =>
  label == null ? null : { [label]: 1 };

function resolved<T extends string>(
  decisionType: ClaireDecisionType,
  provider: string,
  allowedOutputs: readonly T[],
  selected: T,
  effective: T | "clarify" = selected,
  fallbackUsed = false
): ClaireDecisionCandidate<T> {
  return {
    decisionType,
    provider,
    allowedOutputs,
    providerSelectedOutput: selected,
    distribution: oneHot(selected),
    abstained: false,
    abstentionReason: null,
    effectiveOutput: effective,
    latencyMs: null,
    estimatedCostUsd: null,
    fallbackUsed,
  };
}

function unavailable<T extends string>(
  decisionType: ClaireDecisionType,
  provider: string,
  allowedOutputs: readonly T[],
  effectiveOutput: T | "clarify"
): ClaireDecisionCandidate<T> {
  return {
    decisionType,
    provider,
    allowedOutputs,
    providerSelectedOutput: null,
    distribution: null,
    abstained: true,
    abstentionReason: "provider_unavailable",
    effectiveOutput,
    latencyMs: null,
    estimatedCostUsd: null,
    fallbackUsed: false,
  };
}

export function deriveClaireClosedDecisions(input: DeriveInput): ClaireClosedDecisionSet {
  if (!input.brain) {
    return {
      turnType: unavailable<ClaireTurnType>("turn_type", input.provider, TURN_TYPE_OUTPUTS, "clarify"),
      turnReadiness: unavailable<ClaireTurnReadiness>(
        "turn_readiness",
        input.provider,
        TURN_READINESS_OUTPUTS,
        "incomplete"
      ),
      pendingActionRelationship: unavailable<ClairePendingActionRelationship>(
        "pending_action_relationship",
        input.provider,
        PENDING_RELATIONSHIP_OUTPUTS,
        "continues_pending"
      ),
    };
  }

  let turnType: ClaireTurnType;
  if (input.telephonySessionEnded) {
    turnType = "interruption";
  } else {
    switch (input.brain.act) {
      case "correction":
        turnType = "correction";
        break;
      case "question":
      case "advice_request":
      case "prior_claim_probe":
        turnType = "question";
        break;
      case "action_request":
      case "work_commitment":
      case "confirmation":
        turnType = "new_work";
        break;
      case "conversation_control":
        turnType = "interruption";
        break;
      case "unclear":
        turnType = "unknown";
        break;
      default:
        turnType = "conversation";
        break;
    }
  }

  const readiness: ClaireTurnReadiness =
    input.thoughtCompleteness === "incomplete"
      ? "incomplete"
      : input.brain.act === "unclear"
        ? "ambiguous"
        : "ready";

  let relationship: ClairePendingActionRelationship = "unrelated";
  if (input.hasPendingAction) {
    if (
      input.brain.target === "pending_action" ||
      input.brain.target === "pending_briefing" ||
      input.brain.target === "pending_account_follow_up" ||
      input.brain.act === "correction"
    ) {
      relationship = "continues_pending";
    } else if (
      input.brain.act === "action_request" ||
      input.brain.act === "work_commitment"
    ) {
      relationship = "replaces_pending";
    }
  }

  return {
    turnType: resolved(
      "turn_type",
      input.provider,
      TURN_TYPE_OUTPUTS,
      turnType,
      turnType,
      input.fallbackUsed
    ),
    turnReadiness: resolved(
      "turn_readiness",
      input.provider,
      TURN_READINESS_OUTPUTS,
      readiness,
      readiness,
      input.fallbackUsed
    ),
    pendingActionRelationship: resolved(
      "pending_action_relationship",
      input.provider,
      PENDING_RELATIONSHIP_OUTPUTS,
      relationship,
      relationship,
      input.fallbackUsed
    ),
  };
}

export function applyClaireDecisionAbstention<T extends string>(input: {
  decision: ClaireDecisionCandidate<T>;
  confidenceThreshold: number;
  marginThreshold: number;
  fallback: T | "clarify";
}): ClaireDecisionCandidate<T> {
  const distribution = input.decision.distribution;
  if (!distribution || input.decision.providerSelectedOutput == null) {
    return {
      ...input.decision,
      abstained: true,
      abstentionReason: "provider_unavailable",
      effectiveOutput: input.fallback,
    };
  }

  const ranked = Object.values(distribution).sort((a, b) => b - a);
  const confidence = ranked[0] ?? 0;
  const margin = confidence - (ranked[1] ?? 0);

  if (confidence < input.confidenceThreshold) {
    return {
      ...input.decision,
      abstained: true,
      abstentionReason: "confidence_below_threshold",
      effectiveOutput: input.fallback,
    };
  }
  if (margin < input.marginThreshold) {
    return {
      ...input.decision,
      abstained: true,
      abstentionReason: "margin_below_threshold",
      effectiveOutput: input.fallback,
    };
  }
  return input.decision;
}

function rowsFromExecute(result: unknown): any[] {
  if (Array.isArray(result) && Array.isArray(result[0])) return result[0] as any[];
  return [];
}

export const claireDecisionStore: ClaireDecisionStore = {
  async writeAndSeal(rows) {
    if (!rows.length) return;
    const db = await getDb();
    if (!db) return;

    await db.transaction(async tx => {
      for (const row of rows) {
        const selected = row.decision.providerSelectedOutput;
        const distributionJson =
          row.decision.distribution == null
            ? null
            : JSON.stringify(row.decision.distribution);

        const existingResult = await tx.execute(sql`
          SELECT decision_id, branch_executed
          FROM claire_decision_records
          WHERE turn_id = ${row.turnId}
            AND decision_type = ${row.decision.decisionType}
          FOR UPDATE
        `);
        const existing = rowsFromExecute(existingResult)[0];

        if (existing?.branch_executed) {
          throw new Error(
            `Claire decision already consumed: ${row.turnId}/${row.decision.decisionType}`
          );
        }

        if (existing) {
          await tx.execute(sql`
            UPDATE claire_decision_records
            SET provider = ${row.decision.provider},
                provider_selected_output = ${selected},
                distribution_json = ${distributionJson},
                abstained = ${row.decision.abstained},
                abstention_reason = ${row.decision.abstentionReason},
                effective_output = ${row.decision.effectiveOutput},
                latency_ms = ${row.decision.latencyMs},
                estimated_cost_usd = ${row.decision.estimatedCostUsd},
                fallback_used = ${row.decision.fallbackUsed},
                updated_at = CURRENT_TIMESTAMP
            WHERE turn_id = ${row.turnId}
              AND decision_type = ${row.decision.decisionType}
          `);
        } else {
          await tx.execute(sql`
            INSERT INTO claire_decision_records (
              decision_id,
              turn_id,
              tenant_id,
              operator_user_id,
              agent,
              decision_type,
              provider,
              allowed_outputs_json,
              provider_selected_output,
              distribution_json,
              abstained,
              abstention_reason,
              effective_output,
              latency_ms,
              estimated_cost_usd,
              fallback_used,
              branch_executed,
              created_at,
              updated_at
            ) VALUES (
              ${row.decisionId},
              ${row.turnId},
              ${row.tenantId},
              ${row.operatorUserId},
              ${row.agent},
              ${row.decision.decisionType},
              ${row.decision.provider},
              ${JSON.stringify(row.decision.allowedOutputs)},
              ${selected},
              ${distributionJson},
              ${row.decision.abstained},
              ${row.decision.abstentionReason},
              ${row.decision.effectiveOutput},
              ${row.decision.latencyMs},
              ${row.decision.estimatedCostUsd},
              ${row.decision.fallbackUsed},
              FALSE,
              CURRENT_TIMESTAMP,
              CURRENT_TIMESTAMP
            )
          `);
        }
      }

      const turnId = rows[0]!.turnId;
      await tx.execute(sql`
        UPDATE claire_decision_records
        SET branch_executed = TRUE,
            branch_executed_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE turn_id = ${turnId}
          AND branch_executed = FALSE
      `);
    });
  },
};
