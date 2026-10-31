import { mailboxStore, recentInbound, type VerifiedInbound } from "./replyStore";
import { replyDetectionEnabledFor } from "./replyService";

/**
 * What Claire may know about people writing back: inbound messages recorded by Gmail reply detection in conversations
 * JOYSTICK started, fetched from Gmail and matched to the conversation (never inferred), for this tenant only. Plus
 * whether replies are being watched at all, so "no replies" is only ever said when JOYSTICK could have seen one.
 */
export type CustomerRepliesView = {
  /**
   * "watching": the mailbox is connected and JOYSTICK read it within the last WATCHING_WITHIN_MS, so a reply would
   * be here. "not_checked_recently": connected, but no recent read (a stalled loop, Google errors), so a missing reply
   * proves nothing. Anything else: JOYSTICK can't see new replies right now.
   */
  watching: "watching" | "not_checked_recently" | "reconnect_required" | "not_connected" | "off";
  /** when JOYSTICK last read the mailbox, or null */
  lastCheckedAt: string | null;
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

/** Reconciliation reads every active mailbox every 5 minutes; a read older than this means it isn't happening. */
export const WATCHING_WITHIN_MS = 30 * 60 * 1000;

const KIND: Record<VerifiedInbound["kind"], CustomerRepliesView["replies"][number]["kind"]> = {
  human_reply: "wrote_back",
  auto_reply: "automatic_reply",
  delivery_failure: "delivery_failed",
};

export async function readCustomerReplies(tenantId: string, now: Date, days = 30): Promise<CustomerRepliesView> {
  const since = new Date(now.getTime() - days * 86_400_000);
  if (!replyDetectionEnabledFor(tenantId)) return { watching: "off", lastCheckedAt: null, since: since.toISOString(), replies: [] };
  const mailbox = await mailboxStore.find(`operator:${tenantId}`);
  const recentlyRead = Boolean(mailbox?.lastProcessedAt && now.getTime() - mailbox.lastProcessedAt.getTime() <= WATCHING_WITHIN_MS);
  const watching: CustomerRepliesView["watching"] = !mailbox
    ? "not_connected"
    : mailbox.status === "reconnect_required"
      ? "reconnect_required"
      : mailbox.status !== "active"
        ? "not_connected"
        : recentlyRead
          ? "watching"
          : "not_checked_recently";
  const rows = await recentInbound(tenantId, since, { limit: 20 });
  return {
    watching,
    lastCheckedAt: mailbox?.lastProcessedAt?.toISOString() ?? null,
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
