import { createAgentEvent, listRecentAgentEvents } from "../db";
import type { AgentContext } from "./permissions";

export type AgentEventStatus = "success" | "failed" | "approval_required" | "blocked";

export type AgentEventWrite = {
  ctx: AgentContext;
  toolName: string;
  inputJson?: unknown;
  outputJson?: unknown;
  status: AgentEventStatus;
  errorMessage?: string | null;
  latencyMs?: number | null;
  entityType?: string | null;
  entityId?: string | number | null;
  modelUsed?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostCents?: number;
  requiresHumanApproval?: boolean;
};

export async function logAgentEvent(event: AgentEventWrite): Promise<number | null> {
  return createAgentEvent({
    tenantId: event.ctx.tenantId,
    sessionId: event.ctx.sessionId ?? null,
    conversationId: event.ctx.conversationId ?? null,
    agentType: event.ctx.agentType,
    actorType: event.ctx.actorType,
    actorId: event.ctx.actorId ?? null,
    toolName: event.toolName,
    entityType: event.entityType ?? null,
    entityId: event.entityId == null ? null : String(event.entityId),
    inputJson: event.inputJson ?? null,
    outputJson: event.outputJson ?? null,
    status: event.status,
    errorMessage: event.errorMessage ?? null,
    latencyMs: event.latencyMs ?? null,
    modelUsed: event.modelUsed ?? null,
    inputTokens: event.inputTokens ?? 0,
    outputTokens: event.outputTokens ?? 0,
    estimatedCostCents: event.estimatedCostCents ?? 0,
    requiresHumanApproval: event.requiresHumanApproval ?? false,
    approvedByUserId: event.ctx.approvedByUserId ?? null,
  });
}

export async function getAgentEventTimeline(tenantId = "default", limit = 100) {
  return listRecentAgentEvents(tenantId, limit);
}
