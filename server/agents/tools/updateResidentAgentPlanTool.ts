import { getResidentAgentPlan, updateResidentAgentPlan } from "../../db";
import type { AgentTool } from "../toolRegistry";

type PlanStatus =
  | "partially_confirmed"
  | "pending_confirmation"
  | "completed"
  | "failed"
  | "cancelled";

const allowedPlanStatuses = new Set<PlanStatus>([
  "partially_confirmed",
  "pending_confirmation",
  "completed",
  "failed",
  "cancelled",
]);

function planIdFromInput(value: unknown): number {
  const planId = Number(value);
  if (!Number.isInteger(planId) || planId <= 0) {
    throw new Error("planId must be a positive integer");
  }
  return planId;
}

function planStatusFromInput(value: unknown): PlanStatus | undefined {
  if (value == null) return undefined;
  if (allowedPlanStatuses.has(value as PlanStatus)) return value as PlanStatus;
  throw new Error("planStatus is invalid");
}

function positiveIntegerOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
}

function sameNonEmptyText(left: unknown, right: unknown): boolean {
  const a = typeof left === "string" ? left.trim() : "";
  const b = typeof right === "string" ? right.trim() : "";
  return Boolean(a && b && a === b);
}

export const updateResidentAgentPlanTool: AgentTool<Record<string, any>, {
  planId: number;
  planStatus: PlanStatus;
}> = {
  name: "updateResidentAgentPlanTool",
  description: "Update a resident agent parent plan after child operational tools run.",
  async execute(input, ctx) {
    if (ctx.agentType !== "resident_agent" || ctx.actorType !== "resident_chat") {
      throw new Error("Resident plan updates require resident action authority");
    }

    const planId = planIdFromInput(input.planId);
    const existing = await getResidentAgentPlan(ctx.tenantId, planId);
    if (!existing) {
      throw new Error("Resident agent plan not found");
    }

    const requestedResidentId = positiveIntegerOrNull(input.bldgUserId);
    const storedResidentId = positiveIntegerOrNull(existing.bldgUserId);
    if (
      requestedResidentId != null &&
      storedResidentId != null &&
      requestedResidentId !== storedResidentId
    ) {
      throw new Error("Resident agent plan does not belong to resident");
    }

    const residentMatches =
      requestedResidentId != null &&
      storedResidentId != null &&
      requestedResidentId === storedResidentId;
    const conversationMatches = sameNonEmptyText(
      existing.conversationId,
      ctx.conversationId
    );
    const sessionMatches = sameNonEmptyText(existing.sessionId, ctx.sessionId);

    if (!residentMatches && !conversationMatches && !sessionMatches) {
      throw new Error("Resident agent plan update lacks resident ownership evidence");
    }

    const nextStatus = planStatusFromInput(input.planStatus) ?? existing.planStatus;
    await updateResidentAgentPlan(ctx.tenantId, planId, {
      planStatus: nextStatus,
      planJson: input.planJson ?? existing.planJson ?? null,
    });

    return {
      entityType: "resident_agent_plan",
      entityId: planId,
      output: {
        planId,
        planStatus: nextStatus,
      },
    };
  },
};
