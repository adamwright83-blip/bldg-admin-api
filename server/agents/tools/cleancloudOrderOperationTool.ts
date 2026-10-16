import type { IntakePlan } from "../../../shared/cleancloudIntake";
import {
  commitCleanCloudOrderOperation,
  proposeCleanCloudOrderOperation,
  type CleanCloudOrderAction,
} from "../../claire/cleancloudOrderOperation";
import type { AgentTool } from "../toolRegistry";

function actionOf(value: unknown): CleanCloudOrderAction {
  if (value === "prepare" || value === "approve_submit") return value;
  throw new Error("That CleanCloud order operation is not available.");
}

function planOf(value: unknown): IntakePlan | undefined {
  if (value == null) return undefined;
  return value as IntakePlan;
}

export const proposeCleanCloudOrderOperationTool: AgentTool<Record<string, unknown>> = {
  name: "proposeCleanCloudOrderOperationTool",
  description: "Draft a CleanCloud intake operation from the captured order. Does not contact CleanCloud, submit, or charge.",
  requiresHumanApproval: false,
  async execute(input, ctx) {
    const proposal = await proposeCleanCloudOrderOperation({
      actor: { tenantId: ctx.tenantId, actorId: ctx.actorId ?? "claire" },
      orderId: String(input.orderId ?? ""),
      action: actionOf(input.action),
      plan: planOf(input.plan),
    });
    return {
      entityType: "cleancloud_intake_order",
      entityId: proposal.orderId,
      output: proposal,
    };
  },
};

export const commitCleanCloudOrderOperationTool: AgentTool<Record<string, unknown>> = {
  name: "commitCleanCloudOrderOperationTool",
  description: "Queue an operator-approved CleanCloud intake operation through the existing intake service. Does not contact CleanCloud.",
  requiresHumanApproval: true,
  async execute(input, ctx) {
    if (input.reviewed !== true) {
      throw new Error("Review the captured order before approving it.");
    }
    const receipt = await commitCleanCloudOrderOperation({
      actor: { tenantId: ctx.tenantId, actorId: ctx.actorId ?? ctx.approvedByUserId ?? "operator" },
      approvedByUserId: ctx.approvedByUserId,
      orderId: String(input.orderId ?? ""),
      action: actionOf(input.action),
      plan: planOf(input.plan),
      fingerprint: String(input.fingerprint ?? ""),
      revision: typeof input.revision === "string" ? input.revision : null,
      reviewed: true,
    });
    return {
      entityType: "cleancloud_intake_order",
      entityId: receipt.orderId,
      output: receipt,
    };
  },
};
