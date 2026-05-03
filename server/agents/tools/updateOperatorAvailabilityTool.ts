import type { AgentTool } from "../toolRegistry";

export const updateOperatorAvailabilityTool: AgentTool<Record<string, any>> = {
  name: "updateOperatorAvailabilityTool",
  description: "Record operator availability changes for scheduling decisions.",
  async execute(input) {
    const availability = {
      type: "operator_availability",
      date: input.date,
      unavailableFromLocal: input.unavailableFromLocal ?? null,
      unavailableUntilLocal: input.unavailableUntilLocal ?? null,
      unavailableReason: input.unavailableReason ?? null,
      inferredAvailability: input.inferredAvailability ?? null,
      visibleToScheduling: true,
    };
    return { entityType: "operator_availability", entityId: input.date ?? null, output: availability };
  },
};
