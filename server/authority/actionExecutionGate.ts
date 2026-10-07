export class ActionExecutionGateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActionExecutionGateError";
  }
}

export type ActionExecutionSource =
  | {
      kind: "conversation";
    }
  | {
      kind: "background_grant";
      tenantId: string;
      canonicalOperatorId: string;
    }
  | {
      kind: "durable_background";
      tenantId: string;
      canonicalOperatorId: string;
      sourceReference: string;
      idempotencyKey: string;
    };

export type ActionExecutionAdmission = {
  actionName: string;
  tenantId?: string | null;
  canonicalOperatorId?: string | null;
  authorityBasis: string;
  source: ActionExecutionSource;
  expiresAtMs: number;
  constraints: {
    mutationAllowed: boolean;
    shadowOnly: boolean;
  };
};

export type ActionExecutionResult<T> =
  | { executed: false; reason: "shadow_only" }
  | { executed: true; result: T };

function required(value: string | null | undefined, label: string): string {
  const normalized = value?.trim() ?? "";
  if (!normalized) {
    throw new ActionExecutionGateError(
      "Action execution requires " + label
    );
  }
  return normalized;
}

export function assertActionExecutionAdmission(
  admission: ActionExecutionAdmission,
  nowMs = Date.now()
): "shadow_only" | "live" {
  required(admission.actionName, "actionName");
  required(admission.authorityBasis, "authorityBasis");

  if (
    !Number.isFinite(admission.expiresAtMs) ||
    admission.expiresAtMs <= nowMs
  ) {
    throw new ActionExecutionGateError(
      "Action authority expired before execution"
    );
  }

  if (admission.source.kind !== "conversation") {
    const tenantId = required(admission.tenantId, "tenantId");
    const canonicalOperatorId = required(
      admission.canonicalOperatorId,
      "canonicalOperatorId"
    );
    const sourceTenantId = required(
      admission.source.tenantId,
      "source tenantId"
    );
    const sourceCanonicalOperatorId = required(
      admission.source.canonicalOperatorId,
      "source canonicalOperatorId"
    );
    if (
      tenantId !== sourceTenantId ||
      canonicalOperatorId !== sourceCanonicalOperatorId
    ) {
      throw new ActionExecutionGateError(
        "Background action authority does not match execution tenant/canonical operator"
      );
    }

    if (admission.source.kind === "durable_background") {
      required(admission.source.sourceReference, "durable sourceReference");
      required(admission.source.idempotencyKey, "durable idempotencyKey");
    }
  }

  if (admission.constraints.shadowOnly) {
    if (admission.constraints.mutationAllowed) {
      throw new ActionExecutionGateError(
        "shadow grant may not carry mutation authority"
      );
    }
    return "shadow_only";
  }

  if (!admission.constraints.mutationAllowed) {
    throw new ActionExecutionGateError(
      "live grant is missing mutation authority"
    );
  }

  return "live";
}

/**
 * Final, domain-neutral mutation gate.
 *
 * Source-specific systems still prove their own authority:
 * - Claire proves a branded ExecutiveActionGrant.
 * - Persistent background work proves identity + policy + durable job lineage.
 *
 * Both must then cross this same final execution fence. This gate carries no
 * business outcome semantics and cannot mint authority for either source.
 */
export async function executeAdmittedAction<T>(
  admission: ActionExecutionAdmission,
  options: {
    execute?: () => Promise<T>;
    nowMs?: number;
    executorRequiredMessage?: string;
  } = {}
): Promise<ActionExecutionResult<T>> {
  const state = assertActionExecutionAdmission(
    admission,
    options.nowMs ?? Date.now()
  );
  if (state === "shadow_only") {
    return { executed: false, reason: "shadow_only" };
  }
  if (!options.execute) {
    throw new ActionExecutionGateError(
      options.executorRequiredMessage ??
        "Action execution requires an injected production executor"
    );
  }
  return {
    executed: true,
    result: await options.execute(),
  };
}
