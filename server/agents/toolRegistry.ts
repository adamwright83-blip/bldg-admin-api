import type { AgentContext } from "./permissions";
import { createLaundryOrderTool } from "./tools/createLaundryOrderTool";
import { createPendingDryCleaningOrderTool } from "./tools/createPendingDryCleaningOrderTool";
import { updateOperatorAvailabilityTool } from "./tools/updateOperatorAvailabilityTool";
import { createScheduleExceptionTool } from "./tools/createScheduleExceptionTool";
import { createDriverStopTool } from "./tools/createDriverStopTool";
import { attachReceiptToOrderTool } from "./tools/attachReceiptToOrderTool";
import { extractReceiptLineItemsTool } from "./tools/extractReceiptLineItemsTool";
import { completeDryCleaningIntakeTool } from "./tools/completeDryCleaningIntakeTool";
import { draftCustomerMessageTool } from "./tools/draftCustomerMessageTool";
import { sendCustomerReminderTool } from "./tools/sendCustomerReminderTool";
import { logRevenueInterventionTool } from "./tools/logRevenueInterventionTool";
import { updateOrderStatusTool } from "./tools/updateOrderStatusTool";
import { getLevel4GateStateTool } from "./tools/getLevel4GateStateTool";
import { createDriverMissionTool } from "./tools/createDriverMissionTool";
import { getResidentContextTool } from "./tools/getResidentContextTool";
import { requestVendorConfirmationTool } from "./tools/requestVendorConfirmationTool";
import { createVendorOnboardingSessionTool } from "./tools/createVendorOnboardingSessionTool";

export type AgentToolResult<TOutput = unknown> = {
  entityType?: string | null;
  entityId?: string | number | null;
  output: TOutput;
};

export type AgentTool<TInput = unknown, TOutput = unknown> = {
  name: string;
  description: string;
  requiresHumanApproval?: boolean;
  execute(input: TInput, ctx: AgentContext): Promise<AgentToolResult<TOutput>>;
};

const tools = [
  createLaundryOrderTool,
  createPendingDryCleaningOrderTool,
  updateOperatorAvailabilityTool,
  createScheduleExceptionTool,
  createDriverStopTool,
  attachReceiptToOrderTool,
  extractReceiptLineItemsTool,
  completeDryCleaningIntakeTool,
  draftCustomerMessageTool,
  sendCustomerReminderTool,
  logRevenueInterventionTool,
  updateOrderStatusTool,
  getLevel4GateStateTool,
  createDriverMissionTool,
  getResidentContextTool,
  requestVendorConfirmationTool,
  createVendorOnboardingSessionTool,
] satisfies AgentTool[];

export const toolRegistry = new Map<string, AgentTool>(
  tools.map((tool) => [tool.name, tool])
);

export function getAgentTool(name: string): AgentTool {
  const tool = toolRegistry.get(name);
  if (!tool) throw new Error(`Unknown agent tool: ${name}`);
  return tool;
}

export function listAgentTools() {
  return Array.from(toolRegistry.values()).map((tool) => ({
    name: tool.name,
    description: tool.description,
    requiresHumanApproval: tool.requiresHumanApproval === true,
  }));
}
