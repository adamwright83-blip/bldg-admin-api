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

export const updateResidentAgentPlanTool: AgentTool<Record<string, any>, {
  planId: number;
  planStatus: PlanStatus;
}> = {
  name: "updateResidentAgentPlanTool",
  description: "Update a resident agent parent plan after child operational tools run.",
  async execute(input, ctx) {
    const planId = planIdFromInput(input.planId);
    const existing = await getResidentAgentPlan(ctx.tenantId, planId);
    if (!existing) {
      throw new Error("Resident agent plan not found");
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
