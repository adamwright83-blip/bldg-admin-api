import type { AgentTool } from "../toolRegistry";

export const draftCustomerMessageTool: AgentTool<Record<string, any>> = {
  name: "draftCustomerMessageTool",
  description: "Prepare an internal draft message; does not send SMS or email.",
  async execute(input) {
    return {
      entityType: input.entityType ?? "message_draft",
      entityId: input.entityId ?? null,
      output: {
        audience: input.audience ?? "customer",
        channel: input.channel ?? "sms",
        draft: input.draft ?? input.note ?? "",
        sent: false,
        requiresHumanApprovalToSend: true,
      },
    };
  },
};
