import type { AgentContext } from "./permissions";

type ResidentOwnedPlan = {
  bldgUserId?: number | null;
  conversationId?: string | null;
  sessionId?: string | null;
};

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function storedResidentId(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
}

export function assertResidentActionPrincipal(ctx: AgentContext): void {
  if (ctx.agentType !== "resident_agent" || ctx.actorType !== "resident_chat") {
    throw new Error("Resident write requires the resident action authority");
  }
  if (!ctx.tenantId.trim()) {
    throw new Error("Resident write requires tenant authority");
  }
}

export function parseOptionalResidentId(
  value: unknown,
  label = "bldgUserId"
): number | null {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return numeric;
}

export function residentIdFromActor(actorId: string | null | undefined): number | null {
  const raw = actorId?.trim() ?? "";
  const match = raw.match(/^(?:bldg_user:|resident:)?(\d+)$/i);
  if (!match) return null;
  const numeric = Number(match[1]);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
}

export function resolveResidentActionId(
  ctx: AgentContext,
  suppliedResidentId: unknown
): number | null {
  assertResidentActionPrincipal(ctx);
  const actorResidentId = residentIdFromActor(ctx.actorId);
  const inputResidentId = parseOptionalResidentId(suppliedResidentId);
  if (
    actorResidentId != null &&
    inputResidentId != null &&
    actorResidentId !== inputResidentId
  ) {
    throw new Error("Resident actor identity does not match resident authority");
  }
  return actorResidentId ?? inputResidentId;
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
  const recordTenantId = trimmed(input.recordTenantId) || "default";
  if (recordTenantId !== input.ctx.tenantId.trim()) {
    throw new Error(`${input.label} does not belong to tenant`);
  }
}

export function assertResidentOwnedRecord(input: {
  ctx: AgentContext;
  residentId: number | null;
  storedResidentId?: number | null;
  label: string;
}): number {
  const stored = storedResidentId(input.storedResidentId);
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
  const stored = storedResidentId(input.plan.bldgUserId);
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
