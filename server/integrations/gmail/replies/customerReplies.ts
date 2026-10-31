import { mailboxStore, recentInbound, type VerifiedInbound } from "./replyStore";
import { replyDetectionEnabled } from "./replyService";

/**
 * What Claire may know about people writing back: inbound messages recorded by Gmail reply detection in conversations
 * JOYSTICK started, fetched from Gmail and matched to the conversation (never inferred), for this tenant only. Plus
 * whether replies are being watched at all, so "no replies" is only ever said when JOYSTICK could have seen one.
 */
export type CustomerRepliesView = {
  /** "watching": replies are being received; anything else means JOYSTICK can't see new replies right now */
  watching: "watching" | "reconnect_required" | "not_connected" | "off";
  since: string;
  replies: Array<{
    from: string;
    receivedAt: string;
    subject: string;
    /** the opening of their message, as Gmail shows it */
    excerpt: string;
    kind: "wrote_back" | "automatic_reply" | "delivery_failed";
    conversation: string;
  }>;
};

const KIND: Record<VerifiedInbound["kind"], CustomerRepliesView["replies"][number]["kind"]> = {
  human_reply: "wrote_back",
  auto_reply: "automatic_reply",
  delivery_failure: "delivery_failed",
};

export async function readCustomerReplies(tenantId: string, now: Date, days = 30): Promise<CustomerRepliesView> {
  const since = new Date(now.getTime() - days * 86_400_000);
  if (!replyDetectionEnabled()) return { watching: "off", since: since.toISOString(), replies: [] };
  const mailbox = await mailboxStore.find(`operator:${tenantId}`);
  const watching: CustomerRepliesView["watching"] = !mailbox
    ? "not_connected"
    : mailbox.status === "active"
      ? "watching"
      : mailbox.status === "reconnect_required"
        ? "reconnect_required"
        : "not_connected";
  const rows = await recentInbound(tenantId, since, { limit: 20 });
  return {
    watching,
    since: since.toISOString(),
    replies: rows.map(row => ({
      from: row.fromAddress,
      receivedAt: row.receivedAt.toISOString(),
      subject: row.subject,
      excerpt: row.snippet,
      kind: KIND[row.kind],
      conversation: `${row.conversationKind}:${row.conversationRef}`,
    })),
  };
}
