import type {
  ClaimedOperatorAppointment,
  OperatorAppointmentKind,
} from "./operatorAppointmentStore";

export type OperatorAppointmentExecutionContext = {
  jobId: string;
  scope: {
    kind: "tenant";
    tenantId: string;
  };
  actor: {
    kind: "user_delegation" | "standing_authorization";
    operatorUserId: string;
    canonicalOperatorId: string;
    standingAuthorizationId: string | null;
  };
  source: {
    kind: "operator_appointment";
    appointmentKind: OperatorAppointmentKind;
    sourceReference: string;
  };
  idempotencyKey: string;
};

function requireDurableIdentity(name: string, value: string): string {
  if (!value.trim()) {
    throw new Error(`Operator appointment execution requires durable ${name}`);
  }
  return value;
}

/**
 * Converts a claimed durable appointment into the narrow execution identity
 * allowed to enter the existing operator-appointment domain path.
 *
 * This context carries infrastructure authority only: job, tenant, actor
 * provenance, source, and idempotency. It deliberately carries no business
 * outcome such as paid/won/delivered/entitled/verified.
 */
export function admitOperatorAppointmentExecution(
  step: ClaimedOperatorAppointment
): OperatorAppointmentExecutionContext {
  const tenantId = requireDurableIdentity("tenantId", step.tenantId);
  const operatorUserId = requireDurableIdentity(
    "operatorUserId",
    step.operatorUserId
  );
  const canonicalOperatorId = requireDurableIdentity(
    "canonicalOperatorId",
    step.canonicalOperatorId
  );
  const sourceReference = requireDurableIdentity(
    "sourceReference",
    step.sourceReference
  );
  const idempotencyKey = requireDurableIdentity(
    "idempotencyKey",
    step.idempotencyKey
  );

  return {
    jobId: requireDurableIdentity("jobId", step.id),
    scope: {
      kind: "tenant",
      tenantId,
    },
    actor: {
      kind:
        step.source === "explicit_operator_request"
          ? "user_delegation"
          : "standing_authorization",
      operatorUserId,
      canonicalOperatorId,
      standingAuthorizationId: step.standingAuthorizationId,
    },
    source: {
      kind: "operator_appointment",
      appointmentKind: step.appointmentKind,
      sourceReference,
    },
    idempotencyKey,
  };
}

export function assertOperatorAppointmentExecutionContext(
  step: ClaimedOperatorAppointment,
  context: OperatorAppointmentExecutionContext
): void {
  const expected = admitOperatorAppointmentExecution(step);
  if (
    context.jobId !== expected.jobId ||
    context.scope.kind !== "tenant" ||
    context.scope.tenantId !== expected.scope.tenantId ||
    context.actor.kind !== expected.actor.kind ||
    context.actor.operatorUserId !== expected.actor.operatorUserId ||
    context.actor.canonicalOperatorId !== expected.actor.canonicalOperatorId ||
    context.actor.standingAuthorizationId !==
      expected.actor.standingAuthorizationId ||
    context.source.kind !== "operator_appointment" ||
    context.source.appointmentKind !== expected.source.appointmentKind ||
    context.source.sourceReference !== expected.source.sourceReference ||
    context.idempotencyKey !== expected.idempotencyKey
  ) {
    throw new Error(
      "Operator appointment execution context does not match durable job identity"
    );
  }
}
