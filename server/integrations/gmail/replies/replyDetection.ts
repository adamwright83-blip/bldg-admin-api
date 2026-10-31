import { addressOf, classifyInbound, referencedMessageIds, type InboundHeaders, type InboundKind } from "./classifyInbound";

/**
 * Gmail reply detection: from "this mailbox changed" to "this person wrote back in a conversation JOYSTICK tracks",
 * with evidence. A Pub/Sub notice (or a reconciliation pass) only says a mailbox changed; the history since the
 * stored cursor is read, each added message is fetched, and only a message in a tracked conversation is recorded.
 * Nothing about a message outside a tracked conversation is stored.
 *
 * The cursor (Gmail historyId) moves only after everything up to it was handled, so a crash, a restart or a failed
 * fetch replays history rather than skipping it; replies are recorded idempotently (mailbox + Gmail message id), so a
 * replay or a duplicate notification never records one twice. An expired cursor (history.list 404) is recovered by
 * reading each open tracked thread directly, then restarting the cursor from the mailbox's current historyId.
 *
 * Receiving a reply never authorises sending anything: effects may record, defer or cancel, never send.
 */

export type MailboxStatus = "active" | "paused" | "reconnect_required" | "disconnected";

export type Mailbox = {
  key: string;
  tenantId: string;
  email: string;
  historyId: string | null;
  status: MailboxStatus;
};

export type AddedMessage = { id: string; threadId: string };

export type FetchedMessage = {
  id: string;
  threadId: string;
  internalDate: Date;
  labelIds: string[];
  headers: InboundHeaders;
  /** Gmail's own plain-text snippet: the opening of the message */
  snippet: string;
};

/** Google refused the mailbox's credentials (revoked, expired: Testing-mode grants end after 7 days). */
export class MailboxAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MailboxAccessError";
  }
}

export interface MailboxApi {
  /** Messages added since `startHistoryId`; "expired" when Gmail no longer has that history (HTTP 404). */
  historySince(
    startHistoryId: string,
    pageToken?: string
  ): Promise<{ added: AddedMessage[]; historyId: string; nextPageToken?: string; /** the id of the page's last history record */ lastRecordId?: string } | "expired">;
  /** One message's headers and snippet; "gone" when it was deleted before it could be read (HTTP 404). */
  message(id: string): Promise<FetchedMessage | "gone">;
  /** The ids of a thread's messages, oldest first (for recovery after an expired cursor). */
  threadMessageIds(threadId: string): Promise<string[] | "gone">;
  /** The mailbox's current historyId (users.getProfile), to restart a cursor. */
  currentHistoryId(): Promise<string>;
}

/** A conversation JOYSTICK started and is watching for an answer. */
export type TrackedConversation = {
  /** where it comes from and its key there, e.g. { kind: "gmail_send", ref: "first_ten:j1" } */
  kind: string;
  ref: string;
  threadId: string | null;
  /** the RFC 822 Message-ID JOYSTICK gave the outbound message */
  rfc822MessageId: string | null;
  recipient: string;
  sentAt: Date;
};

export interface TrackedConversations {
  /** The tracked conversation this message belongs to, by Gmail thread or by the Message-IDs it answers. */
  match(mailbox: Mailbox, message: { threadId: string; referencedIds: string[] }): Promise<TrackedConversation | null>;
  /** Conversations still waiting for an answer, for recovery when history has expired. */
  open(mailbox: Mailbox, since: Date): Promise<TrackedConversation[]>;
}

export type InboundRecord = {
  mailboxKey: string;
  tenantId: string;
  gmailMessageId: string;
  gmailThreadId: string;
  kind: Exclude<InboundKind, "own_message" | "bulk">;
  fromAddress: string;
  subject: string;
  snippet: string;
  receivedAt: Date;
  conversation: Pick<TrackedConversation, "kind" | "ref">;
};

export interface ReplyStore {
  /**
   * Records an inbound message once. "new": just recorded; "effects_pending": recorded before, but its effects didn't
   * finish (a crash mid-way); "done": recorded and applied (a replay or a duplicate notice changes nothing).
   */
  recordInbound(record: InboundRecord): Promise<"new" | "effects_pending" | "done">;
  markEffectsApplied(mailboxKey: string, gmailMessageId: string, at: Date): Promise<void>;
  /** Moves the cursor forward only (a stale cursor never overwrites a newer one). */
  advanceCursor(mailboxKey: string, historyId: string, at: Date): Promise<void>;
  setStatus(mailboxKey: string, status: MailboxStatus, reason: string | null, at: Date): Promise<void>;
}

/** What a new verified inbound message changes elsewhere: conversation state, pending follow-ups. Never a send. */
export type InboundEffect = (record: InboundRecord, conversation: TrackedConversation) => Promise<void>;

export type ProcessResult =
  /** `more`: history was read up to the page limit, not to the end; the next pass continues from `historyId` */
  | { outcome: "processed"; recorded: InboundRecord[]; historyId: string; recovered: boolean; more?: boolean }
  | { outcome: "skipped"; reason: string }
  | { outcome: "reconnect_required"; reason: string };

const RECOVERY_WINDOW_MS = 30 * 86_400_000;
const MAX_PAGES = 50;

const byNumber = (a: string, b: string) => (BigInt(a) > BigInt(b) ? a : b);

async function consider(
  mailbox: Mailbox,
  id: string,
  deps: { api: MailboxApi; tracked: TrackedConversations; store: ReplyStore; effects: readonly InboundEffect[] }
): Promise<InboundRecord | null> {
  const message = await deps.api.message(id);
  if (message === "gone") return null;
  const kind = classifyInbound({ headers: message.headers, labelIds: message.labelIds, mailboxEmail: mailbox.email });
  if (kind === "own_message" || kind === "bulk") return null;
  const conversation = await deps.tracked.match(mailbox, { threadId: message.threadId, referencedIds: referencedMessageIds(message.headers) });
  // not a conversation JOYSTICK tracks: nothing about it is kept
  if (!conversation) return null;
  // anything before the outbound message can't be an answer to it
  if (message.internalDate.getTime() < conversation.sentAt.getTime()) return null;
  const subjectHeader = Object.entries(message.headers).find(([name]) => name.toLowerCase() === "subject")?.[1] ?? "";
  const fromHeader = Object.entries(message.headers).find(([name]) => name.toLowerCase() === "from")?.[1] ?? "";
  const record: InboundRecord = {
    mailboxKey: mailbox.key,
    tenantId: mailbox.tenantId,
    gmailMessageId: message.id,
    gmailThreadId: message.threadId,
    kind,
    fromAddress: addressOf(fromHeader),
    subject: subjectHeader.slice(0, 500),
    snippet: message.snippet.slice(0, 500),
    receivedAt: message.internalDate,
    conversation: { kind: conversation.kind, ref: conversation.ref },
  };
  const state = await deps.store.recordInbound(record);
  if (state === "done") return null;
  // effects are idempotent; a failure here leaves the cursor where it was and the effects pending, to be re-run
  for (const effect of deps.effects) await effect(record, conversation);
  await deps.store.markEffectsApplied(mailbox.key, message.id, new Date());
  return state === "new" ? record : null;
}

/**
 * Handles one mailbox up to now. `noticedHistoryId` is the historyId a notice carried (or null for a reconciliation
 * pass); a notice older than the cursor is a duplicate or a late delivery and changes nothing.
 */
export async function processMailbox(
  mailbox: Mailbox,
  noticedHistoryId: string | null,
  deps: { api: MailboxApi; tracked: TrackedConversations; store: ReplyStore; effects?: readonly InboundEffect[]; now?: () => Date }
): Promise<ProcessResult> {
  const now = deps.now ?? (() => new Date());
  const effects = deps.effects ?? [];
  if (mailbox.status !== "active") return { outcome: "skipped", reason: `mailbox is ${mailbox.status}` };
  if (noticedHistoryId && mailbox.historyId && BigInt(noticedHistoryId) <= BigInt(mailbox.historyId)) {
    return { outcome: "skipped", reason: "already handled up to this notice" };
  }
  try {
    if (!mailbox.historyId) {
      // no cursor yet (a new watch, or one lost): begin from now; recovery covers anything open
      return await recover(mailbox, { ...deps, effects }, now);
    }
    const recorded: InboundRecord[] = [];
    let pageToken: string | undefined;
    let cursor = mailbox.historyId;
    let complete = false;
    const seen = new Set<string>();
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const history = await deps.api.historySince(mailbox.historyId, pageToken);
      if (history === "expired") return await recover(mailbox, { ...deps, effects }, now);
      for (const added of history.added) {
        if (seen.has(added.id)) continue;
        seen.add(added.id);
        const record = await consider(mailbox, added.id, { ...deps, effects });
        if (record) recorded.push(record);
      }
      if (!history.nextPageToken) {
        // read to the end: everything up to the mailbox's current historyId is handled
        cursor = byNumber(cursor, history.historyId);
        complete = true;
        break;
      }
      // not the end yet: only what was actually read counts, up to this page's last record
      if (history.lastRecordId) cursor = byNumber(cursor, history.lastRecordId);
      pageToken = history.nextPageToken;
    }
    // only now, with every message up to it handled, does the cursor move; a page limit never skips unread pages
    await deps.store.advanceCursor(mailbox.key, cursor, now());
    return { outcome: "processed", recorded, historyId: cursor, recovered: false, ...(complete ? {} : { more: true }) };
  } catch (error) {
    if (error instanceof MailboxAccessError) {
      await deps.store.setStatus(mailbox.key, "reconnect_required", error.message, now());
      return { outcome: "reconnect_required", reason: error.message };
    }
    // a temporary failure: the cursor didn't move, so the next notice or reconciliation replays from it
    throw error;
  }
}

async function recover(
  mailbox: Mailbox,
  deps: { api: MailboxApi; tracked: TrackedConversations; store: ReplyStore; effects: readonly InboundEffect[] },
  now: () => Date
): Promise<ProcessResult> {
  // the restart point is taken first: anything arriving while threads are read is picked up from it next time
  const restartAt = await deps.api.currentHistoryId();
  const recorded: InboundRecord[] = [];
  for (const conversation of await deps.tracked.open(mailbox, new Date(now().getTime() - RECOVERY_WINDOW_MS))) {
    if (!conversation.threadId) continue;
    const ids = await deps.api.threadMessageIds(conversation.threadId);
    if (ids === "gone") continue;
    for (const id of ids) {
      const record = await consider(mailbox, id, deps);
      if (record) recorded.push(record);
    }
  }
  await deps.store.advanceCursor(mailbox.key, restartAt, now());
  return { outcome: "processed", recorded, historyId: restartAt, recovered: true };
}
