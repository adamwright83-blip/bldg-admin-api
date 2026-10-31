import { and, desc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { int, mysqlTable, primaryKey, timestamp, varchar } from "drizzle-orm/mysql-core";
import { getDb } from "../../../db";
import { isMysqlDuplicateKeyError } from "../../../mysqlErrors";
import type { GmailPushNotice } from "./pushAuth";
import type { InboundRecord, Mailbox, MailboxStatus, ReplyStore } from "./replyDetection";

/** drizzle/0159_gmail_reply_detection.sql */
export const gmailMailboxWatches = mysqlTable("gmail_mailbox_watches", {
  mailboxKey: varchar("mailbox_key", { length: 191 }).primaryKey(),
  tenantId: varchar("tenant_id", { length: 64 }).notNull(),
  source: varchar("source", { length: 32 }).notNull(),
  accountEmail: varchar("account_email", { length: 320 }).notNull(),
  historyId: varchar("history_id", { length: 32 }),
  status: varchar("status", { length: 24 }).$type<MailboxStatus>().notNull(),
  statusReason: varchar("status_reason", { length: 255 }),
  statusChangedAt: timestamp("status_changed_at"),
  watchExpiresAt: timestamp("watch_expires_at"),
  lastWatchAt: timestamp("last_watch_at"),
  lastNoticeAt: timestamp("last_notice_at"),
  lastProcessedAt: timestamp("last_processed_at"),
  processingUntil: timestamp("processing_until"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export const gmailPushNotices = mysqlTable("gmail_push_notices", {
  pubsubMessageId: varchar("pubsub_message_id", { length: 191 }).primaryKey(),
  accountEmail: varchar("account_email", { length: 320 }).notNull(),
  historyId: varchar("history_id", { length: 32 }).notNull(),
  receivedAt: timestamp("received_at").notNull(),
  processedAt: timestamp("processed_at"),
  outcome: varchar("outcome", { length: 48 }),
  attempts: int("attempts").notNull().default(0),
});

export const gmailInboundMessages = mysqlTable(
  "gmail_inbound_messages",
  {
    mailboxKey: varchar("mailbox_key", { length: 191 }).notNull(),
    gmailMessageId: varchar("gmail_message_id", { length: 191 }).notNull(),
    tenantId: varchar("tenant_id", { length: 64 }).notNull(),
    gmailThreadId: varchar("gmail_thread_id", { length: 191 }).notNull(),
    kind: varchar("kind", { length: 24 }).$type<InboundRecord["kind"]>().notNull(),
    fromAddress: varchar("from_address", { length: 320 }).notNull(),
    subject: varchar("subject", { length: 500 }).notNull(),
    snippet: varchar("snippet", { length: 500 }).notNull(),
    receivedAt: timestamp("received_at").notNull(),
    conversationKind: varchar("conversation_kind", { length: 32 }).notNull(),
    conversationRef: varchar("conversation_ref", { length: 191 }).notNull(),
    effectsAppliedAt: timestamp("effects_applied_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  table => ({ pk: primaryKey({ columns: [table.mailboxKey, table.gmailMessageId] }) })
);

async function db() {
  const database = await getDb();
  if (!database) throw new Error("Database not available");
  return database;
}

const affected = (result: unknown) => {
  const header = result as { affectedRows?: number; [0]?: { affectedRows?: number } };
  return header.affectedRows ?? header[0]?.affectedRows ?? 0;
};

const mailboxOf = (row: typeof gmailMailboxWatches.$inferSelect): Mailbox => ({
  key: row.mailboxKey,
  tenantId: row.tenantId,
  email: row.accountEmail,
  historyId: row.historyId,
  status: row.status,
});
const watchedOf = (row: typeof gmailMailboxWatches.$inferSelect) => ({
  ...mailboxOf(row),
  watchExpiresAt: row.watchExpiresAt,
  source: row.source,
  statusChangedAt: row.statusChangedAt,
});

export const replyStore: ReplyStore = {
  async recordInbound(record) {
    try {
      await (await db()).insert(gmailInboundMessages).values({
        mailboxKey: record.mailboxKey,
        gmailMessageId: record.gmailMessageId,
        tenantId: record.tenantId,
        gmailThreadId: record.gmailThreadId,
        kind: record.kind,
        fromAddress: record.fromAddress.slice(0, 320),
        subject: record.subject.slice(0, 500),
        snippet: record.snippet.slice(0, 500),
        receivedAt: record.receivedAt,
        conversationKind: record.conversation.kind,
        conversationRef: record.conversation.ref,
      });
      return "new";
    } catch (error) {
      if (!isMysqlDuplicateKeyError(error)) throw error;
      const [row] = await (await db())
        .select({ applied: gmailInboundMessages.effectsAppliedAt })
        .from(gmailInboundMessages)
        .where(and(eq(gmailInboundMessages.mailboxKey, record.mailboxKey), eq(gmailInboundMessages.gmailMessageId, record.gmailMessageId)))
        .limit(1);
      return row?.applied ? "done" : "effects_pending";
    }
  },
  async markEffectsApplied(mailboxKey, gmailMessageId, at) {
    await (await db())
      .update(gmailInboundMessages)
      .set({ effectsAppliedAt: at })
      .where(and(eq(gmailInboundMessages.mailboxKey, mailboxKey), eq(gmailInboundMessages.gmailMessageId, gmailMessageId)));
  },
  async advanceCursor(mailboxKey, historyId, at) {
    // forward only: a slower, older pass never moves a newer cursor back
    await (await db())
      .update(gmailMailboxWatches)
      .set({ historyId, lastProcessedAt: at })
      .where(
        and(
          eq(gmailMailboxWatches.mailboxKey, mailboxKey),
          or(isNull(gmailMailboxWatches.historyId), sql`CAST(${gmailMailboxWatches.historyId} AS UNSIGNED) < CAST(${historyId} AS UNSIGNED)`)
        )
      );
  },
  async setStatus(mailboxKey, status, reason, at) {
    await (await db())
      .update(gmailMailboxWatches)
      .set({ status, statusReason: reason?.slice(0, 255) ?? null, statusChangedAt: at, lastProcessedAt: at, ...(status === "active" ? {} : { watchExpiresAt: null }) })
      .where(eq(gmailMailboxWatches.mailboxKey, mailboxKey));
  },
};

export type WatchedMailbox = Mailbox & { watchExpiresAt: Date | null; source: string; statusChangedAt: Date | null };

export const mailboxStore = {
  /** A new mailbox: active, with no cursor and no watch yet. An existing one is left as it is. */
  async create(input: { key: string; tenantId: string; source: string; email: string }, at: Date) {
    try {
      await (await db())
        .insert(gmailMailboxWatches)
        .values({ mailboxKey: input.key, tenantId: input.tenantId, source: input.source, accountEmail: input.email.toLowerCase(), status: "active", statusChangedAt: at });
    } catch (error) {
      if (!isMysqlDuplicateKeyError(error)) throw error;
    }
  },
  /**
   * The tenant connected a different Gmail account: its history is not the old one's. The cursor and the watch are
   * cleared, so the new account gets its own watch and its own starting point.
   */
  async replaceAccount(key: string, email: string, at: Date) {
    await (await db())
      .update(gmailMailboxWatches)
      .set({ accountEmail: email.toLowerCase(), historyId: null, watchExpiresAt: null, lastWatchAt: null, status: "active", statusReason: null, statusChangedAt: at })
      .where(eq(gmailMailboxWatches.mailboxKey, key));
  },
  /** The same account was authorised again: watching resumes from its kept cursor (recovered if it has expired). */
  async reactivate(key: string, at: Date) {
    await (await db())
      .update(gmailMailboxWatches)
      .set({ status: "active", statusReason: null, statusChangedAt: at, watchExpiresAt: null })
      .where(eq(gmailMailboxWatches.mailboxKey, key));
  },
  async find(key: string): Promise<WatchedMailbox | null> {
    const [row] = await (await db()).select().from(gmailMailboxWatches).where(eq(gmailMailboxWatches.mailboxKey, key)).limit(1);
    return row ? watchedOf(row) : null;
  },
  /** Every operator mailbox, whatever its status, for keeping the watched set in line with the connections. */
  async all(): Promise<WatchedMailbox[]> {
    return (await (await db()).select().from(gmailMailboxWatches)).map(watchedOf);
  },
  async byEmail(email: string): Promise<Mailbox[]> {
    const rows = await (await db()).select().from(gmailMailboxWatches).where(eq(gmailMailboxWatches.accountEmail, email.toLowerCase()));
    return rows.map(mailboxOf);
  },
  /** Active mailboxes, for reconciliation and watch renewal. */
  async active(): Promise<WatchedMailbox[]> {
    const rows = await (await db()).select().from(gmailMailboxWatches).where(eq(gmailMailboxWatches.status, "active"));
    return rows.map(watchedOf);
  },
  /** A successful users.watch: the expiry, and the cursor if the mailbox had none yet. */
  async watched(key: string, historyId: string, expiresAt: Date, at: Date) {
    await (await db())
      .update(gmailMailboxWatches)
      .set({ watchExpiresAt: expiresAt, lastWatchAt: at, status: "active", statusReason: null, historyId: sql`COALESCE(${gmailMailboxWatches.historyId}, ${historyId})` })
      .where(eq(gmailMailboxWatches.mailboxKey, key));
  },
  async setStatus(key: string, status: MailboxStatus, reason: string | null, at = new Date()) {
    await (await db())
      .update(gmailMailboxWatches)
      .set({ status, statusReason: reason?.slice(0, 255) ?? null, statusChangedAt: at, ...(status === "active" ? {} : { watchExpiresAt: null }) })
      .where(eq(gmailMailboxWatches.mailboxKey, key));
  },
  /** One pass per mailbox at a time: a conditional claim, released on finish or by expiry after a crash. */
  async claim(key: string, now: Date, forMs: number): Promise<boolean> {
    const result = await (await db())
      .update(gmailMailboxWatches)
      .set({ processingUntil: new Date(now.getTime() + forMs) })
      .where(and(eq(gmailMailboxWatches.mailboxKey, key), or(isNull(gmailMailboxWatches.processingUntil), lt(gmailMailboxWatches.processingUntil, now))));
    return affected(result) === 1;
  },
  async release(key: string) {
    await (await db()).update(gmailMailboxWatches).set({ processingUntil: null }).where(eq(gmailMailboxWatches.mailboxKey, key));
  },
};

export const noticeStore = {
  /** Kept before it is acknowledged, so a crash after the ack loses nothing. False: already received (a redelivery). */
  async receive(notice: GmailPushNotice, at: Date): Promise<boolean> {
    try {
      await (await db())
        .insert(gmailPushNotices)
        .values({ pubsubMessageId: notice.pubsubMessageId, accountEmail: notice.emailAddress, historyId: notice.historyId, receivedAt: at });
      await (await db()).update(gmailMailboxWatches).set({ lastNoticeAt: at }).where(eq(gmailMailboxWatches.accountEmail, notice.emailAddress));
      return true;
    } catch (error) {
      if (isMysqlDuplicateKeyError(error)) return false;
      throw error;
    }
  },
  async settle(pubsubMessageId: string, outcome: string, at: Date) {
    await (await db())
      .update(gmailPushNotices)
      .set({ processedAt: at, outcome: outcome.slice(0, 48), attempts: sql`${gmailPushNotices.attempts} + 1` })
      .where(eq(gmailPushNotices.pubsubMessageId, pubsubMessageId));
  },
  async attempted(pubsubMessageId: string) {
    await (await db())
      .update(gmailPushNotices)
      .set({ attempts: sql`${gmailPushNotices.attempts} + 1` })
      .where(eq(gmailPushNotices.pubsubMessageId, pubsubMessageId));
  },
  /** Notices not yet handled (a restart mid-way, a failed pass), oldest first. */
  async pending(limit: number): Promise<GmailPushNotice[]> {
    const rows = await (await db())
      .select()
      .from(gmailPushNotices)
      .where(and(isNull(gmailPushNotices.processedAt), lt(gmailPushNotices.attempts, 20)))
      .orderBy(gmailPushNotices.receivedAt)
      .limit(limit);
    return rows.map(row => ({ pubsubMessageId: row.pubsubMessageId, emailAddress: row.accountEmail, historyId: row.historyId, publishTime: null }));
  },
};

export type VerifiedInbound = {
  gmailMessageId: string;
  gmailThreadId: string;
  kind: InboundRecord["kind"];
  fromAddress: string;
  subject: string;
  snippet: string;
  receivedAt: Date;
  conversationKind: string;
  conversationRef: string;
};

/** This tenant's recorded inbound messages since `since`, newest first. Tenant-scoped; nothing crosses tenants. */
export async function recentInbound(tenantId: string, since: Date, options: { kinds?: InboundRecord["kind"][]; limit?: number } = {}): Promise<VerifiedInbound[]> {
  const rows = await (await db())
    .select()
    .from(gmailInboundMessages)
    .where(
      and(
        eq(gmailInboundMessages.tenantId, tenantId),
        gte(gmailInboundMessages.receivedAt, since),
        options.kinds?.length ? inArray(gmailInboundMessages.kind, options.kinds) : undefined
      )
    )
    .orderBy(desc(gmailInboundMessages.receivedAt))
    .limit(options.limit ?? 20);
  return rows.map(row => ({
    gmailMessageId: row.gmailMessageId,
    gmailThreadId: row.gmailThreadId,
    kind: row.kind,
    fromAddress: row.fromAddress,
    subject: row.subject,
    snippet: row.snippet,
    receivedAt: row.receivedAt,
    conversationKind: row.conversationKind,
    conversationRef: row.conversationRef,
  }));
}
