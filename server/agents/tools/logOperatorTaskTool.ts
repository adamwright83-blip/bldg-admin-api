import { createOperatorTask } from "../../db";
import { createOpsTask, mapLegacyLevelToOps } from "../../opsTasks";
import type { AgentTool } from "../toolRegistry";

type OperatorTaskInput = {
  level: "level_1" | "level_2" | "level_3" | "level_4";
  title: string;
  details?: string | null;
  priority?: "emergency" | "high" | "normal" | "low";
  target?: string | null;
  sourceNote?: string | null;
  source?: "emergency_composer" | "operator_voice" | "manual";
};

export const logOperatorTaskTool: AgentTool<OperatorTaskInput> = {
  name: "logOperatorTaskTool",
  description: "Persist a levelized operator task from emergency intake so Level 1-4 work does not live in external notes.",
  async execute(input, ctx) {
    const title = input.title.trim();
    if (!title) throw new Error("Operator task title is required");

    const task = await createOperatorTask({
      tenantId: ctx.tenantId,
      source: input.source ?? "emergency_composer",
      level: input.level,
      title: title.slice(0, 255),
      details: input.details ?? null,
      status: "open",
      priority: input.priority ?? "high",
      target: input.target ?? null,
      sourceNote: input.sourceNote ?? null,
      createdByUserId: ctx.actorId ?? null,
    });
    const mapped = mapLegacyLevelToOps(input.level);
    const opsTask = await createOpsTask({
      tenantId: ctx.tenantId,
      lane: mapped.lane,
      level: mapped.level,
      taskType: "emergency_task",
      title: title.slice(0, 255),
      description: input.details ?? input.sourceNote ?? null,
      source: input.source === "operator_voice" ? "voice" : "quick_input",
      status: "open",
      priority: input.priority ?? "high",
      createdBy: ctx.actorId ?? null,
      metadataJson: {
        legacyOperatorTaskId: task?.id ?? null,
        sourceNote: input.sourceNote ?? null,
        target: input.target ?? null,
      },
    });

    return {
      entityType: "ops_task",
      entityId: opsTask.id,
      output: task ?? {
        persisted: false,
        level: input.level,
        title,
        priority: input.priority ?? "high",
        opsTaskId: opsTask.id,
      },
    };
  },
};
