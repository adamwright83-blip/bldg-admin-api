import type { AgentTool } from "../toolRegistry";

export const createScheduleExceptionTool: AgentTool<Record<string, any>> = {
  name: "createScheduleExceptionTool",
  description: "Create a scheduling exception from operator voice or admin action.",
  async execute(input) {
    const exception = {
      type: "schedule_exception",
      date: input.date,
      reason: input.reason ?? "operator_note",
      startsAtLocal: input.startsAtLocal ?? null,
      endsAtLocal: input.endsAtLocal ?? null,
      locationFrom: input.locationFrom ?? null,
      locationTo: input.locationTo ?? null,
      note: input.note ?? null,
      visibleToScheduling: true,
    };
    return { entityType: "schedule_exception", entityId: `${input.date ?? "unknown"}:${exception.reason}`, output: exception };
  },
};
