import type { PersistentActionPolicyDecision } from "./actionPolicy";

/**
 * The machine action a goal-cycle occurrence takes: prepare internal work
 * (a strategic proposal, a decision, an objective) for the operator to review.
 * INTERNAL_REVERSIBLE only. It never authorizes a Day Line commitment, a send
 * or a spend; the Day Line write boundary does not accept this receipt.
 */
export const GOAL_CYCLE_PREPARE_ACTION = "persistent_operator.goal_cycle.prepare" as const;
export const GOAL_CYCLE_PREPARE_RISK_CLASS = "INTERNAL_REVERSIBLE" as const;

type Receipt = {
  policy: "evaluatePersistentActionPolicy";
  exactAction: typeof GOAL_CYCLE_PREPARE_ACTION;
  riskClass: typeof GOAL_CYCLE_PREPARE_RISK_CLASS;
};

/** Recorded on the decision as sourceCoverage.actionPolicy. No timestamps, so retries fingerprint the same. */
export type GoalCyclePolicyReceipt =
  | (Receipt & {
      status: "allowed";
      authority: "automatic" | "explicit_approval" | "standing_authorization";
      standingAuthorizationId: string | null;
      standingAuthorizationVersion: number | null;
    })
  | (Receipt & {
      status: "denied";
      reason: Extract<PersistentActionPolicyDecision, { allowed: false }>["reason"];
    });

const base: Receipt = {
  policy: "evaluatePersistentActionPolicy",
  exactAction: GOAL_CYCLE_PREPARE_ACTION,
  riskClass: GOAL_CYCLE_PREPARE_RISK_CLASS,
};

export function goalCyclePolicyReceipt(decision: PersistentActionPolicyDecision): GoalCyclePolicyReceipt {
  return decision.allowed
    ? {
        ...base,
        status: "allowed",
        authority: decision.authority,
        standingAuthorizationId: decision.standingAuthorizationId,
        standingAuthorizationVersion: decision.standingAuthorizationVersion,
      }
    : { ...base, status: "denied", reason: decision.reason };
}

/** Fails closed: anything other than an allowed receipt for this exact action counts as denied. */
export function goalCyclePolicyAllows(receipt: GoalCyclePolicyReceipt | null | undefined): boolean {
  return Boolean(
    receipt &&
      receipt.status === "allowed" &&
      receipt.exactAction === GOAL_CYCLE_PREPARE_ACTION &&
      receipt.riskClass === GOAL_CYCLE_PREPARE_RISK_CLASS
  );
}
