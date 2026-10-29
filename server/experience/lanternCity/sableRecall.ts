/**
 * Sable's recall for one customer at Rook's correspondence desk: what the existing records hold, nothing more.
 *
 * Read-only, tenant- and operator-scoped. Sources, all existing:
 *   scheduled_outreach_messages + scheduled_outreach_revisions: the words you saved, by revision, with their times
 *   sms_compose_handoff_audits: when you opened a message in your messaging app, and when you reported sending it
 *   personal_outreach_replies: replies (with their source and the reply service's stored reading of them), and any
 *   independently observed outbound send
 * Every entry carries its authority ("record", "operator_reported", "observed") and never more than the row proves:
 * a saved message is only a draft, an opened hand-off is not a send, a reported send is not an observed one.
 * shared/correspondenceDesk.ts turns these into what she quotes and the things she says are not known.
 * No order rows are read: orders placed after a message do not reach this desk yet.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  personalOutreachReplies,
  scheduledOutreachMessages,
  scheduledOutreachRevisions,
  smsComposeHandoffAudits,
} from "../../../drizzle/schema";
import { getDb } from "../../db";
import type { RecallEntry } from "../../../shared/correspondenceDesk";
import { COZY_REPLY_CLASSIFICATIONS, type CozyReplyClassification } from "../../../shared/cozyVillagerEvidence";

const OBSERVED_SOURCES = new Set(["provider_webhook", "device_observed"]);

export async function loadSableRecall(input: { tenantId: string; operatorId: string; customerId: string }): Promise<{ entries: RecallEntry[] }> {
  const db = await getDb();
  if (!db) return { entries: [] };
  const { tenantId, operatorId, customerId } = input;
  const messages = await db
    .select({
      id: scheduledOutreachMessages.id,
      status: scheduledOutreachMessages.status,
      externalMessageId: scheduledOutreachMessages.externalMessageId,
      dispatchedAt: scheduledOutreachMessages.dispatchedAt,
      createdAt: scheduledOutreachMessages.createdAt,
      currentMessageBody: scheduledOutreachMessages.currentMessageBody,
    })
    .from(scheduledOutreachMessages)
    .where(
      and(
        eq(scheduledOutreachMessages.tenantId, tenantId),
        eq(scheduledOutreachMessages.operatorId, operatorId),
        eq(scheduledOutreachMessages.customerId, customerId)
      )
    )
    .orderBy(desc(scheduledOutreachMessages.createdAt))
    .limit(10);
  const ids = messages.map(m => m.id);
  const revisions = ids.length
    ? await db
        .select({
          messageId: scheduledOutreachRevisions.outreachMessageId,
          revisionNumber: scheduledOutreachRevisions.revisionNumber,
          messageBody: scheduledOutreachRevisions.messageBody,
          createdAt: scheduledOutreachRevisions.createdAt,
        })
        .from(scheduledOutreachRevisions)
        .where(and(eq(scheduledOutreachRevisions.tenantId, tenantId), inArray(scheduledOutreachRevisions.outreachMessageId, ids)))
    : [];
  const handoffs = ids.length
    ? await db
        .select({
          messageId: smsComposeHandoffAudits.messageId,
          revisionCount: smsComposeHandoffAudits.revisionCount,
          handoffState: smsComposeHandoffAudits.handoffState,
          invokedAt: smsComposeHandoffAudits.invokedAt,
        })
        .from(smsComposeHandoffAudits)
        .where(
          and(
            eq(smsComposeHandoffAudits.tenantId, tenantId),
            eq(smsComposeHandoffAudits.operatorId, operatorId),
            inArray(smsComposeHandoffAudits.messageId, ids)
          )
        )
    : [];
  const replies = await db
    .select({
      id: personalOutreachReplies.id,
      direction: personalOutreachReplies.direction,
      source: personalOutreachReplies.source,
      replyText: personalOutreachReplies.replyText,
      reportedAt: personalOutreachReplies.reportedAt,
      classification: personalOutreachReplies.classification,
      permissionEffect: personalOutreachReplies.permissionEffect,
      preparedFollowUpDraft: personalOutreachReplies.preparedFollowUpDraft,
    })
    .from(personalOutreachReplies)
    .where(
      and(
        eq(personalOutreachReplies.tenantId, tenantId),
        eq(personalOutreachReplies.operatorId, operatorId),
        eq(personalOutreachReplies.customerId, customerId)
      )
    )
    .orderBy(desc(personalOutreachReplies.reportedAt))
    .limit(10);
  return { entries: recallEntriesFromRows({ messages, revisions, handoffs, replies }) };
}

type Rows = {
  messages: { id: string; status: string; externalMessageId: string | null; dispatchedAt: Date | null; createdAt: Date; currentMessageBody: string }[];
  revisions: { messageId: string; revisionNumber: number; messageBody: string; createdAt: Date }[];
  handoffs: { messageId: string; revisionCount: number; handoffState: string; invokedAt: Date }[];
  replies: {
    id: string;
    direction: string;
    source: string;
    replyText: string;
    reportedAt: Date;
    classification?: string | null;
    permissionEffect?: string | null;
    preparedFollowUpDraft?: string | null;
  }[];
};

/** The reply service's own reading of a reply, as stored; anything unknown is left for the desk to treat as unread. */
function storedReplyClass(value: string | null | undefined): CozyReplyClassification | undefined {
  return value && (COZY_REPLY_CLASSIFICATIONS as readonly string[]).includes(value) && value !== "outbound_sent"
    ? (value as CozyReplyClassification)
    : undefined;
}

/** Pure: rows to entries. Exported for tests. */
export function recallEntriesFromRows(rows: Rows): RecallEntry[] {
  const out: RecallEntry[] = [];
  const iso = (d: Date) => d.toISOString();
  const bodyAt = (messageId: string, revision: number) =>
    rows.revisions.find(r => r.messageId === messageId && r.revisionNumber === revision)?.messageBody ??
    rows.messages.find(m => m.id === messageId)?.currentMessageBody ??
    null;
  for (const m of rows.messages) {
    const revs = rows.revisions.filter(r => r.messageId === m.id).sort((a, b) => a.revisionNumber - b.revisionNumber);
    const last = revs[revs.length - 1];
    out.push({
      at: iso(last?.createdAt ?? m.createdAt),
      kind: "operator_message",
      text: last?.messageBody ?? m.currentMessageBody,
      authority: "record",
      source: `Your saved message${revs.length > 1 ? `, revision ${last?.revisionNumber}` : ""} (${m.id})`,
    });
    if (m.status === "dispatched" && m.externalMessageId && m.dispatchedAt) {
      // a dispatched message is final: the words it went out with are its current body
      out.push({ at: iso(m.dispatchedAt), kind: "observed_sent", text: m.currentMessageBody, authority: "observed", source: `Provider receipt ${m.externalMessageId}` });
    }
  }
  for (const h of rows.handoffs) {
    if (h.handoffState === "compose_opened") {
      out.push({ at: iso(h.invokedAt), kind: "handoff_opened", text: bodyAt(h.messageId, h.revisionCount), authority: "record", source: `Opened in your messaging app (${h.messageId})` });
    } else if (h.handoffState === "operator_reported_sent") {
      out.push({
        at: iso(h.invokedAt),
        kind: "reported_sent",
        text: bodyAt(h.messageId, h.revisionCount),
        authority: "operator_reported",
        source: `You reported sending it (${h.messageId})`,
      });
    }
  }
  for (const r of rows.replies) {
    const observed = OBSERVED_SOURCES.has(r.source);
    if (r.direction === "outbound") {
      if (observed) out.push({ at: iso(r.reportedAt), kind: "observed_sent", text: r.replyText, authority: "observed", source: `Observed send (${r.id})` });
      continue;
    }
    out.push({
      at: iso(r.reportedAt),
      kind: "reply",
      text: r.replyText,
      authority: observed ? "observed" : "operator_reported",
      source: observed ? `Observed reply (${r.id})` : `Reply you recorded (${r.id})`,
      replyClass: storedReplyClass(r.classification),
      optedOut: r.permissionEffect === "opted_out",
      preparedReply: r.preparedFollowUpDraft ?? null,
    });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at)).slice(-20);
}
