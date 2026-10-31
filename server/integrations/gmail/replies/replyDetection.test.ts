import { describe, expect, it } from "vitest";
import {
  MailboxAccessError,
  processMailbox,
  type FetchedMessage,
  type InboundRecord,
  type Mailbox,
  type MailboxApi,
  type ReplyStore,
  type TrackedConversation,
  type TrackedConversations,
} from "./replyDetection";

const MAILBOX: Mailbox = { key: "operator:t1", tenantId: "t1", email: "nina@flowers.example", historyId: "100", status: "active" };
const SENT_AT = new Date("2026-10-30T10:00:00Z");
const ELENA: TrackedConversation = { kind: "gmail_send", ref: "first_ten:j1", threadId: "th-elena", rfc822MessageId: "<a1@gojoystick.com>", recipient: "elena@larkspurhotel.example", sentAt: SENT_AT };

const msg = (id: string, threadId: string, headers: Record<string, string>, at = "2026-10-31T09:00:00Z", labelIds = ["INBOX"]): FetchedMessage => ({
  id,
  threadId,
  internalDate: new Date(at),
  labelIds,
  headers,
  snippet: `snippet of ${id}`,
});

function world(options: { history?: Array<{ added: Array<{ id: string; threadId: string }>; historyId: string }> | "expired"; messages: FetchedMessage[]; failOn?: string; threads?: Record<string, string[]>; deny?: boolean }) {
  const calls = { fetched: [] as string[], history: 0 };
  const api: MailboxApi = {
    async historySince(start, pageToken) {
      calls.history += 1;
      if (options.deny) throw new MailboxAccessError("invalid_grant: Token has been expired or revoked.");
      if (options.history === "expired") return "expired";
      const pages = options.history ?? [];
      const index = pageToken ? Number(pageToken) : 0;
      const page = pages[index] ?? { added: [], historyId: start };
      return { ...page, ...(index + 1 < pages.length ? { nextPageToken: String(index + 1) } : {}) };
    },
    async message(id) {
      calls.fetched.push(id);
      if (id === options.failOn) throw new Error("Gmail 503");
      return options.messages.find(m => m.id === id) ?? "gone";
    },
    async threadMessageIds(threadId) {
      return options.threads?.[threadId] ?? "gone";
    },
    async currentHistoryId() {
      return "900";
    },
  };
  const tracked: TrackedConversations = {
    async match(_mailbox, message) {
      return message.threadId === ELENA.threadId || message.referencedIds.includes(ELENA.rfc822MessageId!) ? ELENA : null;
    },
    async open() {
      return [ELENA];
    },
  };
  const rows = new Map<string, { record: InboundRecord; applied: boolean }>();
  const state = { cursor: MAILBOX.historyId as string | null, status: MAILBOX.status as string, reason: null as string | null };
  const store: ReplyStore = {
    async recordInbound(record) {
      const key = `${record.mailboxKey}|${record.gmailMessageId}`;
      const row = rows.get(key);
      if (!row) {
        rows.set(key, { record, applied: false });
        return "new";
      }
      return row.applied ? "done" : "effects_pending";
    },
    async markEffectsApplied(mailboxKey, id) {
      rows.get(`${mailboxKey}|${id}`)!.applied = true;
    },
    async advanceCursor(_key, historyId) {
      if (!state.cursor || BigInt(historyId) > BigInt(state.cursor)) state.cursor = historyId;
    },
    async setStatus(_key, status, reason) {
      state.status = status;
      state.reason = reason;
    },
  };
  return { api, tracked, store, rows, state, calls };
}

const reply = msg("m-reply", "th-elena", { From: "Elena Ruiz <elena@larkspurhotel.example>", Subject: "Re: Friday flowers?" });
const unrelated = msg("m-other", "th-other", { From: "bob@else.example", Subject: "lunch?" });

describe("Gmail reply detection", () => {
  it("records a person's reply in a tracked conversation, ignores everything else, and moves the cursor", async () => {
    const w = world({ history: [{ added: [{ id: "m-reply", threadId: "th-elena" }, { id: "m-other", threadId: "th-other" }], historyId: "150" }], messages: [reply, unrelated] });
    const effects: string[] = [];
    const result = await processMailbox(MAILBOX, "150", { ...w, effects: [async record => void effects.push(record.gmailMessageId)] });
    expect(result).toMatchObject({ outcome: "processed", historyId: "150", recovered: false });
    expect([...w.rows.values()].map(r => r.record)).toEqual([
      expect.objectContaining({ gmailMessageId: "m-reply", kind: "human_reply", fromAddress: "elena@larkspurhotel.example", conversation: { kind: "gmail_send", ref: "first_ten:j1" } }),
    ]);
    // nothing about the unrelated message is kept
    expect(JSON.stringify([...w.rows.values()])).not.toContain("lunch");
    expect(effects).toEqual(["m-reply"]);
    expect(w.state.cursor).toBe("150");
  });

  it("a duplicate or late notice changes nothing; a replay never records twice", async () => {
    const w = world({ history: [{ added: [{ id: "m-reply", threadId: "th-elena" }], historyId: "150" }], messages: [reply] });
    await processMailbox(MAILBOX, "150", w);
    expect(await processMailbox({ ...MAILBOX, historyId: "150" }, "150", w)).toEqual({ outcome: "skipped", reason: "already handled up to this notice" });
    expect(await processMailbox({ ...MAILBOX, historyId: "150" }, "120", w)).toMatchObject({ outcome: "skipped" });
    // the same history read again (a restart before the cursor was saved): still one record
    const again = await processMailbox(MAILBOX, "150", w);
    expect(again).toMatchObject({ outcome: "processed", recorded: [] });
    expect(w.rows.size).toBe(1);
  });

  it("a failed fetch leaves the cursor where it was, and the next pass picks the message up", async () => {
    const w = world({ history: [{ added: [{ id: "m-reply", threadId: "th-elena" }], historyId: "150" }], messages: [reply], failOn: "m-reply" });
    await expect(processMailbox(MAILBOX, "150", w)).rejects.toThrow("Gmail 503");
    expect(w.state.cursor).toBe("100");
    const healed = world({ history: [{ added: [{ id: "m-reply", threadId: "th-elena" }], historyId: "150" }], messages: [reply] });
    expect(await processMailbox(MAILBOX, "150", healed)).toMatchObject({ outcome: "processed", recorded: [expect.objectContaining({ gmailMessageId: "m-reply" })] });
  });

  it("effects that failed mid-way are re-run on the next pass", async () => {
    const w = world({ history: [{ added: [{ id: "m-reply", threadId: "th-elena" }], historyId: "150" }], messages: [reply] });
    let fail = true;
    const applied: string[] = [];
    const effect = async (record: InboundRecord) => {
      if (fail) throw new Error("crash");
      applied.push(record.gmailMessageId);
    };
    await expect(processMailbox(MAILBOX, "150", { ...w, effects: [effect] })).rejects.toThrow("crash");
    fail = false;
    await processMailbox(MAILBOX, null, { ...w, effects: [effect] });
    expect(applied).toEqual(["m-reply"]);
    await processMailbox(MAILBOX, null, { ...w, effects: [effect] });
    expect(applied).toEqual(["m-reply"]);
  });

  it("an expired history cursor is recovered from the tracked threads, then restarted from now", async () => {
    const w = world({ history: "expired", messages: [reply, msg("m-old", "th-elena", { From: "elena@larkspurhotel.example" }, "2026-10-29T09:00:00Z")], threads: { "th-elena": ["m-old", "m-reply"] } });
    const result = await processMailbox(MAILBOX, "999", w);
    expect(result).toMatchObject({ outcome: "processed", recovered: true, historyId: "900" });
    // the message from before JOYSTICK wrote is not an answer to it
    expect([...w.rows.keys()]).toEqual(["operator:t1|m-reply"]);
    expect(w.state.cursor).toBe("900");
  });

  it("auto-replies and bounces are recorded as what they are, never as a person answering", async () => {
    const ooo = msg("m-ooo", "th-elena", { From: "elena@larkspurhotel.example", Subject: "Automatic reply: Friday flowers?", "Auto-Submitted": "auto-replied" });
    const bounce = msg("m-bounce", "th-x", { From: "mailer-daemon@googlemail.com", Subject: "Delivery Status Notification (Failure)", "In-Reply-To": "<a1@gojoystick.com>" });
    const mine = msg("m-mine", "th-elena", { From: "nina@flowers.example", Subject: "Re: Friday flowers?" }, "2026-10-31T09:00:00Z", ["SENT"]);
    const w = world({ history: [{ added: ["m-ooo", "m-bounce", "m-mine"].map(id => ({ id, threadId: "th" })), historyId: "160" }], messages: [ooo, bounce, mine] });
    await processMailbox(MAILBOX, "160", w);
    expect(Object.fromEntries([...w.rows.values()].map(r => [r.record.gmailMessageId, r.record.kind]))).toEqual({ "m-ooo": "auto_reply", "m-bounce": "delivery_failure" });
  });

  it("revoked or expired Google access pauses the mailbox for reconnection; paused mailboxes are left alone", async () => {
    const w = world({ messages: [], deny: true });
    expect(await processMailbox(MAILBOX, "150", w)).toMatchObject({ outcome: "reconnect_required" });
    expect(w.state).toMatchObject({ status: "reconnect_required", cursor: "100" });
    expect(await processMailbox({ ...MAILBOX, status: "reconnect_required" }, "150", w)).toEqual({ outcome: "skipped", reason: "mailbox is reconnect_required" });
    expect(await processMailbox({ ...MAILBOX, status: "disconnected" }, "150", w)).toMatchObject({ outcome: "skipped" });
  });

  it("a message deleted before it could be read is skipped, not retried forever", async () => {
    const w = world({ history: [{ added: [{ id: "m-gone", threadId: "th-elena" }], historyId: "170" }], messages: [] });
    expect(await processMailbox(MAILBOX, "170", w)).toMatchObject({ outcome: "processed", recorded: [] });
    expect(w.state.cursor).toBe("170");
  });

  it("at the page limit the cursor stops at the last page read, never past unread pages (#782 review)", async () => {
    const pages = Array.from({ length: 60 }, (_, index) => ({
      added: index === 55 ? [{ id: "m-reply", threadId: "th-elena" }] : [],
      historyId: "9000",
      lastRecordId: String(200 + index),
    }));
    const w = world({ history: pages, messages: [reply] });
    const first = await processMailbox(MAILBOX, "9000", w);
    // 50 pages read: the cursor is the 50th page's last record, not the mailbox's current 9000
    expect(first).toMatchObject({ outcome: "processed", historyId: "249", more: true });
    expect(w.state.cursor).toBe("249");
    expect(w.rows.size).toBe(0);
  });

  it("reads every page of history before moving the cursor", async () => {
    const second = msg("m-2", "th-elena", { From: "elena@larkspurhotel.example", Subject: "Re: also" }, "2026-10-31T10:00:00Z");
    const w = world({ history: [{ added: [{ id: "m-reply", threadId: "th-elena" }], historyId: "150" }, { added: [{ id: "m-2", threadId: "th-elena" }], historyId: "180" }], messages: [reply, second] });
    const result = await processMailbox(MAILBOX, "180", w);
    expect(result).toMatchObject({ outcome: "processed", historyId: "180" });
    expect(w.rows.size).toBe(2);
  });
});
