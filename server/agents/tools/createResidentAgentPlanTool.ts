import { createResidentAgentPlan } from "../../db";
import type { AgentTool } from "../toolRegistry";

type PlanStatus =
  | "partially_confirmed"
  | "pending_confirmation"
  | "completed"
  | "failed"
  | "cancelled";

const defaultPlanStatus: PlanStatus = "pending_confirmation";

function nullableString(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function nullableNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export const createResidentAgentPlanTool: AgentTool<Record<string, any>, {
  planId: number;
  planStatus: PlanStatus;
  message: string;
}> = {
  name: "createResidentAgentPlanTool",
  description: "Create a tenant-scoped parent plan for a multi-intent resident request.",
  async execute(input, ctx) {
    const originalMessage = nullableString(input.originalMessage);
    if (!originalMessage) {
      throw new Error("originalMessage is required");
    }

    const planStatus = defaultPlanStatus;
    const planId = await createResidentAgentPlan({
      tenantId: ctx.tenantId,
      bldgUserId: nullableNumber(input.bldgUserId),
      residentName: nullableString(input.residentName),
      buildingSlug: nullableString(input.buildingSlug),
      buildingName: nullableString(input.buildingName),
      unit: nullableString(input.unit),
      conversationId: nullableString(input.sourceConversationId) ?? ctx.conversationId ?? null,
      sessionId: nullableString(input.sourceSessionId) ?? ctx.sessionId ?? null,
      originalMessage,
      planStatus,
      planJson: input.planJson ?? null,
    });

    return {
      entityType: "resident_agent_plan",
      entityId: planId,
      output: {
        planId,
        planStatus,
        message: "Resident agent plan created and awaiting operational confirmation.",
      },
    };
  },
};
