import { getLevel4GateState } from "../../level4Gate";
import type { AgentTool } from "../toolRegistry";

export const getLevel4GateStateTool: AgentTool<Record<string, any>> = {
  name: "getLevel4GateStateTool",
  description: "Read the existing Level 4 gate state.",
  async execute(input) {
    const state = await getLevel4GateState(input.tenantId ?? "default");
    return { entityType: "level4_gate", entityId: input.tenantId ?? "default", output: state };
  },
};
