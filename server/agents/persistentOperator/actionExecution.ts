import {
  executeAdmittedAction,
  type ActionExecutionResult,
} from "../../platform/authority/actionExecutionGate";
import {
  evaluatePersistentActionPolicy,
  type PersistentActionPolicyDecision,
  type ToolRiskClass,
} from "./actionPolicy";
import type { CanonicalOperatorIdentity } from "./identity";

export type PersistentOperatorActionSource =
  | {
      type: "goal_cycle";
      tenantId: string;
      canonicalOperatorId: string;
      goalRunId: string;
      cycleId: string;
      evidenceRefs: string[];
    }
  | {
      type: "pending_lifecycle";
      tenantId: string;
      canonicalOperatorId: string;
      lifecycleId: string;
    }
  | {
      type: "scheduled_operator_appointment";
      tenantId: string;
      canonicalOperatorId: string;
      appointmentId: string;
      appointmentKind:
        | "sunday_weekly_planning"
        | "weekly_planning_callback";
      standingAuthorizationId: string | null;
    };

export type PersistentOperatorActionExecutionContext = {
  tenantId: string;
  canonicalOperatorId: string;
  operatorUserId: string;
  actionClass: string;
  authorityBasis: string;
  exactAction: string;
  source: PersistentOperatorActionSource;
  sourceReference: string;
  idempotencyKey: string;
  policyAuthority: Extract<
    PersistentActionPolicyDecision,
    { allowed: true }
  >["authority"];
  standingAuthorizationId: string | null;
  standingAuthorizationVersion: number | null;
};

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error("Persistent operator action requires " + label);
  }
  return normalized;
}

/**
 * Background action admission.
 *
 * Persistent policy proves who may perform the exact action. Durable job
 * lineage proves which background work requested it. Only after both checks
 * does execution cross the same neutral final gate used by Claire live grants.
 */
export async function executePersistentOperatorAction<T>(input: {
  identity: CanonicalOperatorIdentity;
  actionClass: string;
  authorityBasis: string;
  source: PersistentOperatorActionSource;
  sourceReference: string;
  idempotencyKey: string;
  riskClass: ToolRiskClass;
  exactAction: string;
  standingAuthorizationId?: string | null;
  approvedByUserId?: string | null;
  expiresAtMs: number;
  execute: (
    context: PersistentOperatorActionExecutionContext
  ) => Promise<T>;
}): Promise<ActionExecutionResult<T>> {
  const actionClass = required(input.actionClass, "actionClass");
  const authorityBasis = required(input.authorityBasis, "authorityBasis");
  const exactAction = required(input.exactAction, "exactAction");
  const sourceReference = required(
    input.sourceReference,
    "durable sourceReference"
  );
  const idempotencyKey = required(
    input.idempotencyKey,
    "durable idempotencyKey"
  );

  if (
    input.source.tenantId !== input.identity.tenantId ||
    input.source.canonicalOperatorId !==
      input.identity.canonicalOperatorId
  ) {
    throw new Error(
      "Persistent operator authority source identity mismatch"
    );
  }

  const policy = await evaluatePersistentActionPolicy({
    tenantId: input.identity.tenantId,
    canonicalOperatorId: input.identity.canonicalOperatorId,
    operatorUserId: input.identity.canonicalOpenId,
    exactAction,
    riskClass: input.riskClass,
    standingAuthorizationId: input.standingAuthorizationId,
    approvedByUserId: input.approvedByUserId,
  });
  if (!policy.allowed) {
    throw new Error(
      "Persistent action policy denied: " + policy.reason
    );
  }

  const context: PersistentOperatorActionExecutionContext = {
    tenantId: input.identity.tenantId,
    canonicalOperatorId: input.identity.canonicalOperatorId,
    operatorUserId: input.identity.canonicalOpenId,
    actionClass,
    authorityBasis,
    exactAction,
    source: input.source,
    sourceReference,
    idempotencyKey,
    policyAuthority: policy.authority,
    standingAuthorizationId: policy.standingAuthorizationId,
    standingAuthorizationVersion:
      policy.standingAuthorizationVersion,
  };

  return executeAdmittedAction(
    {
      actionName: actionClass,
      tenantId: context.tenantId,
      canonicalOperatorId: context.canonicalOperatorId,
      authorityBasis,
      source: {
        kind: "durable_background",
        tenantId: input.source.tenantId,
        canonicalOperatorId: input.source.canonicalOperatorId,
        sourceReference,
        idempotencyKey,
      },
      expiresAtMs: input.expiresAtMs,
      constraints: {
        mutationAllowed: true,
        shadowOnly: false,
      },
    },
    {
      execute: () => input.execute(context),
    }
  );
}
