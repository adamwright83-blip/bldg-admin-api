import type { AgentTool } from "../toolRegistry";

export const createDriverStopTool: AgentTool<Record<string, any>> = {
  name: "createDriverStopTool",
  description: "Create an operational driver stop from a trusted UI or operator voice action.",
  async execute(input) {
    const stop = {
      type: "driver_stop",
      stopType: input.stopType ?? "pickup",
      orderId: input.orderId ?? null,
      date: input.date ?? null,
      buildingSlug: input.buildingSlug ?? null,
      buildingName: input.buildingName ?? null,
      customerName: input.customerName ?? null,
      unit: input.unit ?? null,
      eta: input.eta ?? null,
      notes: input.notes ?? null,
    };
    return { entityType: "driver_stop", entityId: input.orderId ?? `${stop.date}:${stop.buildingName ?? stop.buildingSlug ?? "unknown"}`, output: stop };
  },
};
