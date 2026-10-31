import { and, eq, ne, sql } from "drizzle-orm";
import { int, mysqlTable, timestamp, varchar, char } from "drizzle-orm/mysql-core";
import { getDb } from "../../db";
import { isMysqlDuplicateKeyError } from "../../mysqlErrors";
import type { SendLedger, SendRecord, SendStatus } from "./gmailSend";

/** drizzle/0157_gmail_sends.sql: one row per message sent from a person's own Gmail, by idempotency key. */
export const gmailSends = mysqlTable("gmail_sends", {
  sendKey: varchar("send_key", { length: 191 }).primaryKey(),
  actor: varchar("actor", { length: 64 }).notNull(),
  accountEmail: varchar("account_email", { length: 320 }).notNull(),
  recipient: varchar("recipient", { length: 320 }).notNull(),
  subject: varchar("subject", { length: 500 }).notNull(),
  approvalDigest: char("approval_digest", { length: 64 }).notNull(),
  approvedBy: varchar("approved_by", { length: 191 }).notNull(),
  approvedAt: timestamp("approved_at").notNull(),
  rfc822MessageId: varchar("rfc822_message_id", { length: 191 }).notNull(),
  status: varchar("status", { length: 16 }).$type<SendStatus>().notNull(),
  gmailMessageId: varchar("gmail_message_id", { length: 191 }),
  gmailThreadId: varchar("gmail_thread_id", { length: 191 }),
  attempts: int("attempts").notNull().default(1),
  lastAttemptAt: timestamp("last_attempt_at").notNull(),
  sentAt: timestamp("sent_at"),
  failure: varchar("failure", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

async function db() {
  const database = await getDb();
  if (!database) throw new Error("Database not available");
  return database;
}

type Row = typeof gmailSends.$inferSelect;
const record = (row: Row): SendRecord => ({
  key: row.sendKey,
  actor: row.actor,
  accountEmail: row.accountEmail,
  recipient: row.recipient,
  subject: row.subject,
  digest: row.approvalDigest,
  approvedBy: row.approvedBy,
  approvedAt: row.approvedAt,
  rfc822MessageId: row.rfc822MessageId,
  status: row.status,
  gmailMessageId: row.gmailMessageId,
  gmailThreadId: row.gmailThreadId,
  attempts: row.attempts,
  lastAttemptAt: row.lastAttemptAt,
  sentAt: row.sentAt,
  failure: row.failure,
});

/** The ledger in MySQL. A claim is the insert itself, and a retry a conditional update, so two callers can't both send. */
export const gmailSendLedger: SendLedger = {
  async find(key) {
    const [row] = await (await db()).select().from(gmailSends).where(eq(gmailSends.sendKey, key)).limit(1);
    return row ? record(row) : null;
  },
  async claim(value) {
    try {
      await (await db()).insert(gmailSends).values({
        sendKey: value.key,
        actor: value.actor,
        accountEmail: value.accountEmail,
        recipient: value.recipient,
        subject: value.subject,
        approvalDigest: value.digest,
        approvedBy: value.approvedBy,
        approvedAt: value.approvedAt,
        rfc822MessageId: value.rfc822MessageId,
        status: value.status,
        attempts: value.attempts,
        lastAttemptAt: value.lastAttemptAt,
      });
      return true;
    } catch (error) {
      if (isMysqlDuplicateKeyError(error)) return false;
      throw error;
    }
  },
  async retry(key, from, message, at) {
    const result: unknown = await (await db())
      .update(gmailSends)
      .set({
        status: "sending",
        recipient: message.recipient,
        subject: message.subject,
        approvalDigest: message.digest,
        approvedBy: message.approvedBy,
        approvedAt: message.approvedAt,
        attempts: sql`${gmailSends.attempts} + 1`,
        lastAttemptAt: at,
        failure: null,
      })
      .where(and(eq(gmailSends.sendKey, key), eq(gmailSends.status, from)));
    const header = result as { affectedRows?: number; [0]?: { affectedRows?: number } };
    return (header.affectedRows ?? header[0]?.affectedRows ?? 0) === 1;
  },
  async settle(key, outcome) {
    await (await db())
      .update(gmailSends)
      .set({ status: outcome.status, gmailMessageId: outcome.gmailMessageId, gmailThreadId: outcome.gmailThreadId, sentAt: outcome.sentAt, failure: outcome.failure })
      // a send Google confirmed is never written back to anything less
      .where(outcome.status === "sent" ? eq(gmailSends.sendKey, key) : and(eq(gmailSends.sendKey, key), ne(gmailSends.status, "sent")));
  },
};
