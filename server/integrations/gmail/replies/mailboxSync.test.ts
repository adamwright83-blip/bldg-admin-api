import { describe, expect, it } from "vitest";
import { syncOperatorMailboxes, type MailboxSyncStore } from "./replyService";
import type { WatchedMailbox } from "./replyStore";

const NOW = new Date("2026-10-31T12:00:00Z");

function fakeStore(rows: WatchedMailbox[]) {
  const calls: string[] = [];
  const store: MailboxSyncStore = {
    all: async () => rows,
    create: async input => void calls.push(`create ${input.key} ${input.email}`),
    replaceAccount: async (key, email) => void calls.push(`replace ${key} ${email}`),
    reactivate: async key => void calls.push(`reactivate ${key}`),
    setStatus: async (key, status) => void calls.push(`${status} ${key}`),
  };
  return { store, calls };
}

const mailbox = (over: Partial<WatchedMailbox>): WatchedMailbox => ({
  key: "operator:t1",
  tenantId: "t1",
  email: "nina@flowers.example",
  historyId: "500",
  status: "active",
  watchExpiresAt: null,
  source: "operator_gmail",
  statusChangedAt: new Date("2026-10-30T10:00:00Z"),
  ...over,
});
const connection = (over: Partial<{ connectedEmail: string | null; updatedAt: Date | null }> = {}) => async () => [
  { tenantId: "t1", connectedEmail: "nina@flowers.example", updatedAt: new Date("2026-10-29T10:00:00Z"), ...over },
];

describe("the watched mailboxes follow the Gmail connections (#782 review)", () => {
  it("reconnecting after Google ended access watches the mailbox again, keeping its cursor", async () => {
    const { store, calls } = fakeStore([mailbox({ status: "reconnect_required" })]);
    await syncOperatorMailboxes({ connections: connection({ updatedAt: new Date("2026-10-31T09:00:00Z") }), store, now: () => NOW });
    expect(calls).toEqual(["reactivate operator:t1"]);
  });

  it("the same stale credentials are not retried: no reactivation without a newer connection", async () => {
    const { store, calls } = fakeStore([mailbox({ status: "reconnect_required" })]);
    await syncOperatorMailboxes({ connections: connection(), store, now: () => NOW });
    expect(calls).toEqual([]);
  });

  it("a connection removed and made again is watched again", async () => {
    const { store, calls } = fakeStore([mailbox({ status: "disconnected" })]);
    await syncOperatorMailboxes({ connections: connection({ updatedAt: new Date("2026-10-31T09:00:00Z") }), store, now: () => NOW });
    expect(calls).toEqual(["reactivate operator:t1"]);
  });

  it("a different account on the tenant starts fresh rather than inheriting the old cursor and watch", async () => {
    const { store, calls } = fakeStore([mailbox({})]);
    await syncOperatorMailboxes({ connections: connection({ connectedEmail: "Nina.New@Flowers.example" }), store, now: () => NOW });
    expect(calls).toEqual(["replace operator:t1 nina.new@flowers.example"]);
  });

  it("new connections are watched; removed ones are disconnected once", async () => {
    const created = fakeStore([]);
    await syncOperatorMailboxes({ connections: connection(), store: created.store, now: () => NOW });
    expect(created.calls).toEqual(["create operator:t1 nina@flowers.example"]);
    const removed = fakeStore([mailbox({}), mailbox({ key: "operator:t2", tenantId: "t2", status: "disconnected" })]);
    await syncOperatorMailboxes({ connections: async () => [], store: removed.store, now: () => NOW });
    expect(removed.calls).toEqual(["disconnected operator:t1"]);
  });
});
