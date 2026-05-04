import type { AgentContext } from "./permissions";

export const approvalRequiredToolNames = new Set([
  "sendCustomerReminderTool",
  "requestVendorConfirmationTool",
  "requestVendorBookingConfirmationTool",
  "chargeCardTool",
  "refundCardTool",
  "cancelOrderTool",
]);

export type ApprovalDecision = {
  allowed: boolean;
  requiresHumanApproval: boolean;
  approvedByUserId?: string | null;
};

export function evaluateHumanApproval(ctx: AgentContext, toolName: string): ApprovalDecision {
  const requiresHumanApproval = approvalRequiredToolNames.has(toolName);
  if (!requiresHumanApproval) {
    return { allowed: true, requiresHumanApproval: false, approvedByUserId: null };
  }
  return {
    allowed: Boolean(ctx.approvedByUserId),
    requiresHumanApproval: true,
    approvedByUserId: ctx.approvedByUserId ?? null,
  };
}
