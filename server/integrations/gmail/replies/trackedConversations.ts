import { and, desc, eq, gte, inArray, or, sql } from "drizzle-orm";
import { firstTenJourneys } from "../../../firstTenMinutes/schema";
import { getDb } from "../../../db";
import { gmailSends } from "../gmailSendLedger";
import { gmailInboundMessages } from "./replyStore";
import type { Mailbox, TrackedConversation, TrackedConversations } from "./replyDetection";

/**
 * Conversations JOYSTICK started from this mailbox's own account, and owned by this mailbox's tenant: messages the Gmail
 * send service sent and Google confirmed (gmail_sends, status "sent", with Google's thread id). A reply belongs to one
 * when it is in the same Gmail thread, or when it answers the Message-ID JOYSTICK gave the message. Nothing else is a
 * tracked conversation: an email from a known address in some other thread is not treated as a reply.
 *
 * Ownership is the tenant boundary. Two tenants may watch the same Gmail address; a conversation is tracked only for
 * the tenant that owns it, never for the other. gmail_sends carries no tenant, so the owner comes from the sender:
 * a first-ten send (`first_ten:<journey>`) belongs to the tenant its journey was provisioned into. A send whose owner
 * isn't known (a journey not provisioned yet, or a sender with no owner rule) is tracked for nobody.
 */
const ownedBy = (tenantId: string) =>
  and(
    eq(gmailSends.actor, "first_ten_onboarding"),
    sql`${gmailSends.sendKey} = CONCAT('first_ten:', ${firstTenJourneys.id})`,
    eq(firstTenJourneys.tenantId, tenantId)
  );

export const sentConversations: TrackedConversations = {
  async match(mailbox, message) {
    const db = await getDb();
    if (!db) return null;
    const byThread = message.threadId ? eq(gmailSends.gmailThreadId, message.threadId) : undefined;
    const byReference = message.referencedIds.length ? inArray(gmailSends.rfc822MessageId, message.referencedIds) : undefined;
    if (!byThread && !byReference) return null;
    const [row] = await db
      .select({ send: gmailSends })
      .from(gmailSends)
      .innerJoin(firstTenJourneys, ownedBy(mailbox.tenantId))
      .where(and(eq(gmailSends.accountEmail, mailbox.email), eq(gmailSends.status, "sent"), or(byThread, byReference)))
      .orderBy(desc(gmailSends.sentAt))
      .limit(1);
    return row ? conversationOf(row.send) : null;
  },
  async open(mailbox, since) {
    const db = await getDb();
    if (!db) return [];
    const rows = await db
      .select({ send: gmailSends })
      .from(gmailSends)
      .innerJoin(firstTenJourneys, ownedBy(mailbox.tenantId))
      .where(and(eq(gmailSends.accountEmail, mailbox.email), eq(gmailSends.status, "sent"), gte(gmailSends.sentAt, since)));
    return rows.map(row => conversationOf(row.send));
  },
};

function conversationOf(row: typeof gmailSends.$inferSelect): TrackedConversation {
  return {
    kind: "gmail_send",
    ref: row.sendKey,
    threadId: row.gmailThreadId,
    rfc822MessageId: row.rfc822MessageId.toLowerCase(),
    recipient: row.recipient.toLowerCase(),
    sentAt: row.sentAt ?? row.lastAttemptAt,
  };
}

export type FollowUpVerdict = { proceed: true } | { proceed: false; reason: "replied" | "delivery_failed"; evidence: { gmailMessageId: string; receivedAt: Date } };

/**
 * The gate every automated follow-up in a tracked conversation must pass immediately before it sends: once the person
 * has written back, or the address has bounced, a follow-up written for silence is no longer appropriate, and it is
 * held. An out-of-office does not stop it. This only ever holds a send; it never authorises one.
 */
export async function followUpVerdict(conversation: { kind: string; ref: string }): Promise<FollowUpVerdict> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db
    .select({ kind: gmailInboundMessages.kind, gmailMessageId: gmailInboundMessages.gmailMessageId, receivedAt: gmailInboundMessages.receivedAt })
    .from(gmailInboundMessages)
    .where(
      and(
        eq(gmailInboundMessages.conversationKind, conversation.kind),
        eq(gmailInboundMessages.conversationRef, conversation.ref),
        inArray(gmailInboundMessages.kind, ["human_reply", "delivery_failure"])
      )
    )
    .orderBy(desc(gmailInboundMessages.receivedAt))
    .limit(1);
  if (!row) return { proceed: true };
  return { proceed: false, reason: row.kind === "human_reply" ? "replied" : "delivery_failed", evidence: { gmailMessageId: row.gmailMessageId, receivedAt: row.receivedAt } };
}

export type { Mailbox };
