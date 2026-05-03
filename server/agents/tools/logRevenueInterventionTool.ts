import type { AgentTool } from "../toolRegistry";

export const logRevenueInterventionTool: AgentTool<Record<string, any>> = {
  name: "logRevenueInterventionTool",
  description: "Log an internal admin revenue recovery, collection, stale lead, or vague-order mission.",
  async execute(input) {
    const missionCategory = input.missionCategory ?? "admin_revenue_recovery";
    if (String(missionCategory).startsWith("driver_")) {
      throw new Error("Driver game missions belong in createDriverMissionTool, not admin revenue interventions");
    }
    return {
      entityType: input.entityType ?? "revenue_intervention",
      entityId: input.entityId ?? null,
      output: {
        missionCategory,
        title: input.title ?? "Revenue intervention",
        target: input.target ?? null,
        dollarValueCents: input.dollarValueCents ?? 0,
        status: "logged",
      },
    };
  },
};
