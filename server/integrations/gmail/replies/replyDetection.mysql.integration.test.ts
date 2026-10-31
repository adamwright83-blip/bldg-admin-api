import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { gmailSendLedger } from "../gmailSendLedger";
import { readCustomerReplies } from "./customerReplies";
import { processMailbox, type FetchedMessage, type MailboxApi } from "./replyDetection";
import { gmailPushHandler } from "./replyService";
import { mailboxStore, noticeStore, recentInbound, replyStore } from "./replyStore";
import { followUpVerdict, sentConversations } from "./trackedConversations";
import { executeTool, type ToolContext } from "../../../claire/prototype/tools";

/**
 * Gmail reply detection on real MySQL (migration 0159): a sent message in gmail_sends, a watched mailbox, a reply
 * arriving in its thread through the real stores and conversation matcher (Gmail itself played by a stand-in), a
 * duplicate notice, a replay, the follow-up gate, tenant isolation, Claire's read, and the push endpoint's
 * keep-then-acknowledge. Local or CI disposable database only.
 */
const url = process.env.DATABASE_URL ?? "";
const allowed = (() => {
  try {
    const parsed = new URL(url);
    return ["localhost", "127.0.0.1"].includes(parsed.hostname) && ["/google_integrations_test", "/first_ten_test"].includes(parsed.pathname);
  } catch {
    return false;
  }
})();

const ACCOUNT = "nina@flowers.example";
const KEY = "operator:tenant-replies";
const SEND = "first_ten:replies-journey";
const RFC = "<replies-1@gojoystick.com>";

describe.skipIf(!allowed)("Gmail reply detection on MySQL", () => {
  let connection: mysql.Connection;
  beforeAll(async () => {
    connection = await mysql.createConnection(url);
    for (const table of ["gmail_inbound_messages", "gmail_push_notices", "gmail_mailbox_watches"]) await connection.query(`DELETE FROM ${table}`);
    await connection.query("DELETE FROM gmail_sends WHERE send_key IN (?, ?, ?)", [SEND, "first_ten:other-journey", "first_ten:unowned-journey"]);
    await connection.query("DELETE FROM first_ten_journeys WHERE id IN ('replies-journey', 'other-journey', 'unowned-journey')");
    // the journey that sent it was provisioned into tenant-replies: that tenant owns the conversation
    await connection.query(
      "INSERT INTO first_ten_journeys (id, acquisition_session_id, tenant_id, kind, stage) VALUES ('replies-journey', 'acq-replies', 'tenant-replies', 'own', 'first_chapter')"
    );
    const at = new Date("2026-10-30T10:00:00Z");
    expect(
      await gmailSendLedger.claim({
        key: SEND,
        actor: "first_ten_onboarding",
        accountEmail: ACCOUNT,
        recipient: "elena@larkspurhotel.example",
        subject: "Re: Friday flowers?",
        digest: "d".repeat(64),
        approvedBy: "first_ten_journey:replies-journey",
        approvedAt: at,
        rfc822MessageId: RFC,
        status: "sending",
        gmailMessageId: null,
        gmailThreadId: null,
        attempts: 1,
        lastAttemptAt: at,
        sentAt: null,
        failure: null,
      })
    ).toBe(true);
    await gmailSendLedger.settle(SEND, { status: "sent", gmailMessageId: "g-out", gmailThreadId: "th-elena", sentAt: at, failure: null });
    await mailboxStore.create({ key: KEY, tenantId: "tenant-replies", source: "operator_gmail", email: ACCOUNT }, new Date("2026-10-30T09:00:00Z"));
    await mailboxStore.watched(KEY, "100", new Date("2026-11-06T10:00:00Z"), new Date("2026-10-30T10:00:00Z"));
  });
  afterAll(async () => {
    delete process.env.GMAIL_REPLY_DETECTION;
    delete process.env.GMAIL_REPLY_DETECTION_TENANTS;
    await connection?.end();
  });

  const message = (id: string, threadId: string, headers: Record<string, string>): FetchedMessage => ({
    id,
    threadId,
    internalDate: new Date("2026-10-31T09:00:00Z"),
    labelIds: ["INBOX"],
    headers,
    snippet: id === "m-reply" ? "Yes! Friday works. Could you bring the peonies?" : "something private",
  });
  const api: MailboxApi = {
    async historySince() {
      return { added: [{ id: "m-reply", threadId: "th-elena" }, { id: "m-other", threadId: "th-other" }], historyId: "150" };
    },
    async message(id) {
      return id === "m-reply"
        ? message(id, "th-elena", { From: "Elena Ruiz <elena@larkspurhotel.example>", Subject: "Re: Friday flowers?", "In-Reply-To": RFC })
        : message(id, "th-other", { From: "bob@else.example", Subject: "private lunch plans" });
    },
    async threadMessageIds() {
      return [];
    },
    async currentHistoryId() {
      return "150";
    },
  };

  it("records the reply in JOYSTICK's conversation, and nothing about other mail", async () => {
    const mailbox = (await mailboxStore.find(KEY))!;
    expect(mailbox.historyId).toBe("100");
    const result = await processMailbox(mailbox, "150", { api, tracked: sentConversations, store: replyStore });
    expect(result).toMatchObject({ outcome: "processed", historyId: "150" });
    const [rows] = await connection.query<mysql.RowDataPacket[]>("SELECT * FROM gmail_inbound_messages");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ gmail_message_id: "m-reply", kind: "human_reply", conversation_kind: "gmail_send", conversation_ref: SEND, from_address: "elena@larkspurhotel.example" });
    expect(JSON.stringify(rows)).not.toContain("private");
    expect((await mailboxStore.find(KEY))!.historyId).toBe("150");
  });

  it("a replay records nothing twice, and the cursor never moves back", async () => {
    await processMailbox({ ...(await mailboxStore.find(KEY))!, historyId: "100" }, null, { api, tracked: sentConversations, store: replyStore });
    const [rows] = await connection.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM gmail_inbound_messages");
    expect(rows[0].n).toBe(1);
    await replyStore.advanceCursor(KEY, "120", new Date());
    expect((await mailboxStore.find(KEY))!.historyId).toBe("150");
  });

  it("a follow-up in that conversation is held now that she wrote back", async () => {
    expect(await followUpVerdict({ kind: "gmail_send", ref: SEND })).toMatchObject({ proceed: false, reason: "replied", evidence: { gmailMessageId: "m-reply" } });
    expect(await followUpVerdict({ kind: "gmail_send", ref: "first_ten:someone-else" })).toEqual({ proceed: true });
  });

  it("a different account starts fresh; the same account reconnected keeps its cursor (#782 review)", async () => {
    const key = "operator:tenant-switch";
    await mailboxStore.create({ key, tenantId: "tenant-switch", source: "operator_gmail", email: "old@flowers.example" }, new Date("2026-10-30T09:00:00Z"));
    await mailboxStore.watched(key, "700", new Date("2026-11-06T09:00:00Z"), new Date("2026-10-30T09:00:00Z"));
    await mailboxStore.setStatus(key, "reconnect_required", "invalid_grant", new Date("2026-10-30T12:00:00Z"));
    let row = (await mailboxStore.find(key))!;
    expect(row).toMatchObject({ status: "reconnect_required", historyId: "700", watchExpiresAt: null });
    expect(row.statusChangedAt?.toISOString()).toBe("2026-10-30T12:00:00.000Z");
    await mailboxStore.reactivate(key, new Date("2026-10-31T09:00:00Z"));
    row = (await mailboxStore.find(key))!;
    expect(row).toMatchObject({ status: "active", historyId: "700" });
    await mailboxStore.watched(key, "750", new Date("2026-11-07T09:00:00Z"), new Date("2026-10-31T09:00:00Z"));
    await mailboxStore.replaceAccount(key, "New@Flowers.example", new Date("2026-10-31T10:00:00Z"));
    row = (await mailboxStore.find(key))!;
    expect(row).toMatchObject({ email: "new@flowers.example", status: "active", historyId: null, watchExpiresAt: null });
  });

  it("two tenants watching the same Gmail address: a reply is recorded only for the tenant that owns the conversation", async () => {
    const other = "operator:tenant-intruder";
    await mailboxStore.create({ key: other, tenantId: "tenant-intruder", source: "operator_gmail", email: ACCOUNT }, new Date("2026-10-30T09:00:00Z"));
    await mailboxStore.watched(other, "100", new Date("2026-11-06T10:00:00Z"), new Date("2026-10-30T10:00:00Z"));
    const intruder = (await mailboxStore.find(other))!;
    await processMailbox(intruder, "150", { api, tracked: sentConversations, store: replyStore });
    const [rows] = await connection.query<mysql.RowDataPacket[]>("SELECT mailbox_key, tenant_id FROM gmail_inbound_messages WHERE gmail_message_id = 'm-reply'");
    // before: the second tenant recorded Elena's reply too, and its Claire could read it
    expect(rows.map(row => row.tenant_id)).toEqual(["tenant-replies"]);
    expect(await recentInbound("tenant-intruder", new Date("2026-01-01"))).toEqual([]);
    expect(await sentConversations.open(intruder, new Date("2026-01-01"))).toEqual([]);
  });

  it("a send no tenant owns yet (journey not provisioned) is tracked for nobody", async () => {
    await connection.query(
      "INSERT INTO first_ten_journeys (id, acquisition_session_id, tenant_id, kind, stage) VALUES ('unowned-journey', 'acq-unowned', NULL, 'own', 'first_chapter')"
    );
    const at = new Date("2026-10-30T10:00:00Z");
    await gmailSendLedger.claim({
      key: "first_ten:unowned-journey", actor: "first_ten_onboarding", accountEmail: ACCOUNT, recipient: "x@hotel.example", subject: "Hi", digest: "e".repeat(64),
      approvedBy: "first_ten_journey:unowned-journey", approvedAt: at, rfc822MessageId: "<unowned@gojoystick.com>", status: "sending", gmailMessageId: null,
      gmailThreadId: null, attempts: 1, lastAttemptAt: at, sentAt: null, failure: null,
    });
    await gmailSendLedger.settle("first_ten:unowned-journey", { status: "sent", gmailMessageId: "g-unowned", gmailThreadId: "th-unowned", sentAt: at, failure: null });
    const mailbox = (await mailboxStore.find(KEY))!;
    expect(await sentConversations.match(mailbox, { threadId: "th-unowned", referencedIds: ["<unowned@gojoystick.com>"] })).toBeNull();
    expect((await sentConversations.match(mailbox, { threadId: "th-elena", referencedIds: [] }))?.ref).toBe(SEND);
  });

  it("one pass per mailbox at a time", async () => {
    const now = new Date();
    expect(await mailboxStore.claim(KEY, now, 60_000)).toBe(true);
    expect(await mailboxStore.claim(KEY, now, 60_000)).toBe(false);
    await mailboxStore.release(KEY);
    expect(await mailboxStore.claim(KEY, now, 60_000)).toBe(true);
    await mailboxStore.release(KEY);
  });

  it("Claire reads it for this tenant only, and knows whether replies are watched", async () => {
    process.env.GMAIL_REPLY_DETECTION = "on";
    process.env.GMAIL_REPLY_DETECTION_TENANTS = "tenant-replies";
    // "watching" means a recent read, not just an active row: a pass that found nothing new still counts as a read
    await replyStore.advanceCursor(KEY, "150", new Date("2026-10-31T11:55:00Z"));
    expect((await mailboxStore.find(KEY))!.historyId).toBe("150");
    const stale = await readCustomerReplies("tenant-replies", new Date("2026-10-31T13:00:00Z"));
    expect(stale).toMatchObject({ watching: "not_checked_recently", lastCheckedAt: "2026-10-31T11:55:00.000Z" });
    const view = await readCustomerReplies("tenant-replies", new Date("2026-10-31T12:00:00Z"));
    expect(view.watching).toBe("watching");
    expect(view.replies).toEqual([
      expect.objectContaining({ from: "elena@larkspurhotel.example", kind: "wrote_back", excerpt: "Yes! Friday works. Could you bring the peonies?", conversation: `gmail_send:${SEND}` }),
    ]);
    // through Claire's own tool, as on a call: the verified reply, with its time in the operator's zone
    await replyStore.advanceCursor(KEY, "150", new Date("2026-10-31T18:58:00Z"));
    const claire = await executeTool(
      { tenantId: "tenant-replies", timeZone: "America/Los_Angeles", now: () => new Date("2026-10-31T19:00:00Z") } as unknown as ToolContext,
      "read_customer_replies",
      {}
    );
    expect(claire.output).toMatchObject({
      watching: "watching",
      replies: [expect.objectContaining({ from: "elena@larkspurhotel.example", kind: "wrote_back", when: "today at 2:00 AM" })],
    });
    expect(await recentInbound("another-tenant", new Date("2026-01-01"))).toEqual([]);
    // not in GMAIL_REPLY_DETECTION_TENANTS: off; listed but never connected: not_connected
    expect((await readCustomerReplies("another-tenant", new Date("2026-10-31T12:00:00Z"))).watching).toBe("off");
    process.env.GMAIL_REPLY_DETECTION_TENANTS = "tenant-replies,another-tenant";
    expect((await readCustomerReplies("another-tenant", new Date("2026-10-31T12:00:00Z"))).watching).toBe("not_connected");
    process.env.GMAIL_REPLY_DETECTION_TENANTS = "tenant-replies";
    delete process.env.GMAIL_REPLY_DETECTION;
    expect((await readCustomerReplies("tenant-replies", new Date("2026-10-31T12:00:00Z"))).watching).toBe("off");
  });

  it("the push endpoint keeps a notice before acknowledging it, once per Pub/Sub message", async () => {
    process.env.GMAIL_REPLY_DETECTION = "on";
    process.env.GMAIL_REPLY_DETECTION_TENANTS = "tenant-replies";
    const processed: string[] = [];
    const app = express();
    app.use(express.json());
    app.post(
      "/push",
      gmailPushHandler({
        verify: async header => (header === "Bearer good" ? { ok: true, subject: "sa" } : { ok: false, reason: "bad" }),
        process: async notice => void processed.push(notice.pubsubMessageId),
      })
    );
    const server = http.createServer(app);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/push`;
    const body = JSON.stringify({ message: { data: Buffer.from(JSON.stringify({ emailAddress: ACCOUNT, historyId: 200 })).toString("base64"), messageId: "pm-int-1" } });
    try {
      const post = (auth: string) => fetch(base, { method: "POST", headers: { "content-type": "application/json", authorization: auth }, body });
      expect((await post("Bearer forged")).status).toBe(401);
      expect((await post("Bearer good")).status).toBe(204);
      expect((await post("Bearer good")).status).toBe(204);
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(processed).toEqual(["pm-int-1"]);
      const [rows] = await connection.query<mysql.RowDataPacket[]>("SELECT * FROM gmail_push_notices WHERE pubsub_message_id = 'pm-int-1'");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ account_email: ACCOUNT, history_id: "200", processed_at: null });
      expect(await noticeStore.pending(10)).toEqual([expect.objectContaining({ pubsubMessageId: "pm-int-1" })]);
    } finally {
      await new Promise(resolve => server.close(resolve));
      delete process.env.GMAIL_REPLY_DETECTION;
    }
  });

  it("a leftover watch for a tenant no longer listed: acknowledged, never stored or processed; a listed tenant sharing the address still is", async () => {
    process.env.GMAIL_REPLY_DETECTION = "on";
    const unlisted = "operator:tenant-unlisted";
    const shared = "shared@flowers.example";
    await mailboxStore.create({ key: unlisted, tenantId: "tenant-unlisted", source: "operator_gmail", email: shared }, new Date("2026-10-30T09:00:00Z"));
    const processed: string[] = [];
    const app = express();
    app.use(express.json());
    app.post("/push", gmailPushHandler({ verify: async () => ({ ok: true, subject: "sa" }), process: async notice => void processed.push(notice.pubsubMessageId) }));
    const server = http.createServer(app);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/push`;
    const push = (id: string) =>
      fetch(base, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer good" },
        body: JSON.stringify({ message: { data: Buffer.from(JSON.stringify({ emailAddress: shared, historyId: 300 })).toString("base64"), messageId: id } }),
      });
    const stored = async (id: string) => (await connection.query<mysql.RowDataPacket[]>("SELECT 1 FROM gmail_push_notices WHERE pubsub_message_id = ?", [id]))[0].length;
    try {
      // only an unlisted tenant watches this address: 204, nothing kept, nothing processed
      process.env.GMAIL_REPLY_DETECTION_TENANTS = "tenant-replies";
      expect((await push("pm-unlisted")).status).toBe(204);
      expect(await stored("pm-unlisted")).toBe(0);
      // a paused mailbox of a listed tenant is not wanted either
      await mailboxStore.setStatus(unlisted, "paused", "test");
      process.env.GMAIL_REPLY_DETECTION_TENANTS = "tenant-replies,tenant-unlisted";
      expect((await push("pm-paused")).status).toBe(204);
      expect(await stored("pm-paused")).toBe(0);
      // a listed, active tenant shares the address: still delivered for it
      const listed = "operator:tenant-shared";
      await mailboxStore.create({ key: listed, tenantId: "tenant-shared", source: "operator_gmail", email: shared }, new Date("2026-10-30T09:00:00Z"));
      process.env.GMAIL_REPLY_DETECTION_TENANTS = "tenant-replies,tenant-shared";
      expect((await push("pm-shared")).status).toBe(204);
      expect(await stored("pm-shared")).toBe(1);
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(processed).toEqual(["pm-shared"]);
    } finally {
      await new Promise(resolve => server.close(resolve));
      delete process.env.GMAIL_REPLY_DETECTION;
      delete process.env.GMAIL_REPLY_DETECTION_TENANTS;
    }
  });
});
