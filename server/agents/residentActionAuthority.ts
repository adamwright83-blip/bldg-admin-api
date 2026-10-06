import type { AgentContext } from "./permissions";

type ResidentOwnedPlan = {
  bldgUserId?: number | null;
  conversationId?: string | null;
  sessionId?: string | null;
};

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function positiveIntegerOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
}

export function assertResidentActionPrincipal(
  ctx: AgentContext,
  options: {
    principalError?: string;
    tenantError?: string;
  } = {}
): string {
  if (ctx.agentType !== "resident_agent" || ctx.actorType !== "resident_chat") {
    throw new Error(
      options.principalError ?? "Resident write requires resident action authority"
    );
  }

  const tenantId = ctx.tenantId.trim();
  if (!tenantId) {
    throw new Error(
      options.tenantError ?? "Resident write requires tenant authority"
    );
  }
  return tenantId;
}

export function residentIdFromActor(
  actorId: string | null | undefined
): number | null {
  const raw = actorId?.trim() ?? "";
  const match = raw.match(/^(?:bldg_user:|resident:)?(\d+)$/i);
  if (!match) return null;
  return positiveIntegerOrNull(match[1]);
}

export function resolveResidentActionId(
  ctx: AgentContext,
  suppliedResidentId: unknown,
  options: {
    required?: boolean;
    requiredError?: string;
    mismatchError?: string;
    principalError?: string;
    tenantError?: string;
  } = {}
): number | null {
  assertResidentActionPrincipal(ctx, options);

  const actorResidentId = residentIdFromActor(ctx.actorId);
  const supplied =
    suppliedResidentId == null || suppliedResidentId === ""
      ? null
      : positiveIntegerOrNull(suppliedResidentId);

  if (
    suppliedResidentId != null &&
    suppliedResidentId !== "" &&
    supplied == null
  ) {
    throw new Error(
      options.requiredError ?? "Resident write requires a valid resident owner id"
    );
  }

  if (
    actorResidentId != null &&
    supplied != null &&
    actorResidentId !== supplied
  ) {
    throw new Error(
      options.mismatchError ??
        "Resident actor identity does not match resident authority"
    );
  }

  const resolved = actorResidentId ?? supplied;
  if (options.required && resolved == null) {
    throw new Error(
      options.requiredError ?? "Resident write requires the resident owner id"
    );
  }
  return resolved;
}

export function resolveResidentLineage(input: {
  contextValue?: string | null;
  suppliedValue?: unknown;
  label: "conversationId" | "sessionId";
}): string | null {
  const contextValue = trimmed(input.contextValue);
  const suppliedValue = trimmed(input.suppliedValue);
  if (contextValue && suppliedValue && contextValue !== suppliedValue) {
    throw new Error(
      `Resident ${input.label} does not match authenticated context`
    );
  }
  return contextValue || suppliedValue || null;
}

export function assertResidentIdentityOrLineage(input: {
  residentId: number | null;
  conversationId?: string | null;
  sessionId?: string | null;
}): void {
  if (
    input.residentId == null &&
    !trimmed(input.conversationId) &&
    !trimmed(input.sessionId)
  ) {
    throw new Error("Resident write lacks resident ownership evidence");
  }
}

export function assertTenantOwnedRecord(input: {
  ctx: AgentContext;
  recordTenantId?: string | null;
  label: string;
}): void {
  const tenantId = input.ctx.tenantId.trim();
  const recordTenantId = trimmed(input.recordTenantId);
  if (!tenantId || !recordTenantId || recordTenantId !== tenantId) {
    throw new Error(`${input.label} does not belong to tenant`);
  }
}

export function assertResidentOwnedRecord(input: {
  residentId: number | null;
  storedResidentId?: number | null;
  label: string;
}): number {
  const stored = positiveIntegerOrNull(input.storedResidentId);
  if (stored == null || input.residentId == null || stored !== input.residentId) {
    throw new Error(`${input.label} does not belong to resident`);
  }
  return stored;
}

export function assertResidentOwnedPlan(input: {
  ctx: AgentContext;
  residentId: number | null;
  plan: ResidentOwnedPlan;
}): number | null {
  const stored = positiveIntegerOrNull(input.plan.bldgUserId);

  if (
    stored != null &&
    input.residentId != null &&
    stored !== input.residentId
  ) {
    throw new Error("Resident agent plan does not belong to resident");
  }

  const residentMatches =
    stored != null &&
    input.residentId != null &&
    stored === input.residentId;
  const conversationMatches =
    Boolean(trimmed(input.ctx.conversationId)) &&
    trimmed(input.ctx.conversationId) === trimmed(input.plan.conversationId);
  const sessionMatches =
    Boolean(trimmed(input.ctx.sessionId)) &&
    trimmed(input.ctx.sessionId) === trimmed(input.plan.sessionId);

  if (!residentMatches && !conversationMatches && !sessionMatches) {
    throw new Error("Resident agent plan update lacks resident ownership evidence");
  }

  return input.residentId ?? stored;
}
