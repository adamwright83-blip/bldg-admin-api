import { sendSMSWithReceipt } from "../../_core/sms";
import { findAuthorityReceiptForSubject } from "../../authority/authorityReceipt";
import { recordCommunicationReceipt } from "../../twilioPlatform/communicationReceipts";
import type { AgentTool } from "../toolRegistry";

export const sendCustomerReminderTool: AgentTool<Record<string, any>> = {
  name: "sendCustomerReminderTool",
  description: "Send an external customer reminder only after human approval and provider acceptance.",
  requiresHumanApproval: true,
  async execute(input, ctx) {
    const channel = String(input.channel ?? "sms").toLowerCase();
    if (channel !== "sms")
      throw new Error("sendCustomerReminderTool currently supports SMS only");
    const recipient = String(input.recipient ?? "").trim();
    const message = String(input.message ?? "").trim();
    if (!recipient) throw new Error("Customer reminder recipient is required");
    if (!message) throw new Error("Customer reminder message is required");

    const idempotencyKey =
      typeof input.idempotencyKey === "string" && input.idempotencyKey.trim()
        ? input.idempotencyKey.trim()
        : ctx.decisionId?.trim() || undefined;
    const provider = await sendSMSWithReceipt(
      recipient,
      message,
      idempotencyKey ? { idempotencyKey } : undefined
    );

    if (!provider.accepted || !provider.providerMessageId) {
      return {
        entityType: input.orderId ? "order" : "customer",
        entityId: input.orderId ?? input.customerId ?? null,
        output: {
          channel: "sms",
          recipient,
          templateId: input.templateId ?? null,
          message,
          sent: false,
          providerStatus: provider.providerStatus,
          sendEvidence: provider.evidenceName,
          authorityReceiptId: null,
          approvedByUserId: ctx.approvedByUserId,
        },
      };
    }

    const communication = await recordCommunicationReceipt({
      tenantId: ctx.tenantId,
      operatorUserId: ctx.actorId ?? null,
      eventType: "MESSAGE_SENT",
      messageSid: provider.providerMessageId,
      direction: "outbound",
      to: recipient,
      status: provider.providerStatus ?? "accepted",
      agentEventId: ctx.agentEventId ?? null,
      decisionId: ctx.decisionId ?? null,
    });
    const authority = await findAuthorityReceiptForSubject({
      tenantId: ctx.tenantId,
      claimType: "message_sent",
      subjectType: "message",
      subjectId: provider.providerMessageId,
    });
    if (!authority)
      throw new Error(
        "Provider accepted customer reminder but message authority receipt is missing"
      );

    return {
      entityType: input.orderId ? "order" : "customer",
      entityId: input.orderId ?? input.customerId ?? null,
      output: {
        channel: "sms",
        recipient,
        templateId: input.templateId ?? null,
        message,
        sent: true,
        providerMessageId: provider.providerMessageId,
        providerStatus: provider.providerStatus,
        communicationReceiptId: communication.receipt.id,
        authorityReceiptId: authority.id,
        approvedByUserId: ctx.approvedByUserId,
      },
    };
  },
};
