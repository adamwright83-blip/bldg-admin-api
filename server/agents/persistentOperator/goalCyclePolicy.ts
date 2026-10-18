import {
  evaluatePersistentActionPolicy,
  type PersistentActionPolicyDecision,
} from "./actionPolicy";

/**
 * Stage 1 policy gate for the goal cycle. Before Claire prepares anything for a
 * goal run, the persistent action policy decides whether this operator's tenant
 * and role allow it. The result is recorded in the cycle's decision.
 *
 * INTERNAL_REVERSIBLE covers internal preparation only: research, proposals and
 * objectives the operator reviews. It never admits a Day Line commitment; that
 * needs the operator's own admission at the Day Director write boundary.
 */
export const GOAL_CYCLE_PREPARE_ACTION = "persistent_operator.goal_cycle.prepare";
export const GOAL_CYCLE_PREPARE_RISK_CLASS = "INTERNAL_REVERSIBLE" as const;

type Denied = Extract<PersistentActionPolicyDecision, { allowed: false }>;
type Allowed = Extract<PersistentActionPolicyDecision, { allowed: true }>;

export type GoalCycleActionPolicy =
  | {
      status: "allowed";
      exactAction: typeof GOAL_CYCLE_PREPARE_ACTION;
      riskClass: typeof GOAL_CYCLE_PREPARE_RISK_CLASS;
      authority: Allowed["authority"];
    }
  | {
      status: "denied";
      exactAction: typeof GOAL_CYCLE_PREPARE_ACTION;
      riskClass: typeof GOAL_CYCLE_PREPARE_RISK_CLASS;
      reason: Denied["reason"];
    }
  | {
      /** The run was not active, so nothing would be prepared and the policy was not asked. */
      status: "not_evaluated";
      exactAction: typeof GOAL_CYCLE_PREPARE_ACTION;
      riskClass: typeof GOAL_CYCLE_PREPARE_RISK_CLASS;
      reason: "goal_run_inactive";
    };

export async function evaluateGoalCyclePreparePolicy(
  input: {
    tenantId: string;
    run: { status: string; canonicalOperatorId: string; operatorUserId: string };
    now?: Date;
  },
  evaluate: typeof evaluatePersistentActionPolicy = evaluatePersistentActionPolicy
): Promise<GoalCycleActionPolicy> {
  const base = {
    exactAction: GOAL_CYCLE_PREPARE_ACTION,
    riskClass: GOAL_CYCLE_PREPARE_RISK_CLASS,
  } as const;
  if (input.run.status !== "active") {
    return { ...base, status: "not_evaluated", reason: "goal_run_inactive" };
  }
  const decision = await evaluate({
    tenantId: input.tenantId,
    canonicalOperatorId: input.run.canonicalOperatorId,
    operatorUserId: input.run.operatorUserId,
    exactAction: GOAL_CYCLE_PREPARE_ACTION,
    riskClass: GOAL_CYCLE_PREPARE_RISK_CLASS,
    now: input.now,
  });
  return decision.allowed
    ? { ...base, status: "allowed", authority: decision.authority }
    : { ...base, status: "denied", reason: decision.reason };
}
