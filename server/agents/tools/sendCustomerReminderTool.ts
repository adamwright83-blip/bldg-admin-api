import type { AgentTool } from "../toolRegistry";

export const sendCustomerReminderTool: AgentTool<Record<string, any>> = {
  name: "sendCustomerReminderTool",
  description: "Send an external customer reminder only after human approval.",
  requiresHumanApproval: true,
  async execute(input, ctx) {
    return {
      entityType: input.orderId ? "order" : "customer",
      entityId: input.orderId ?? input.customerId ?? null,
      output: {
        channel: input.channel ?? "sms",
        recipient: input.recipient ?? null,
        templateId: input.templateId ?? null,
        message: input.message ?? null,
        sent: true,
        approvedByUserId: ctx.approvedByUserId,
      },
    };
  },
};
