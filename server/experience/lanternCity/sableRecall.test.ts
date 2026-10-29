import { describe, expect, it } from "vitest";
import { recallEntriesFromRows } from "./sableRecall";
import { buildSableRecall } from "../../../shared/correspondenceDesk";

const d = (iso: string) => new Date(iso);

describe("Sable's recall from the existing records", () => {
  const rows = {
    messages: [
      { id: "som_1", status: "pending", externalMessageId: null, dispatchedAt: null, createdAt: d("2026-10-20T17:00:00Z"), currentMessageBody: "Hi Rae, I'll follow up next week about a pickup." },
    ],
    revisions: [
      { messageId: "som_1", revisionNumber: 1, messageBody: "Hi Rae, checking in.", createdAt: d("2026-10-20T17:00:00Z") },
      { messageId: "som_1", revisionNumber: 2, messageBody: "Hi Rae, I'll follow up next week about a pickup.", createdAt: d("2026-10-20T17:05:00Z") },
    ],
    handoffs: [
      { messageId: "som_1", revisionCount: 2, handoffState: "compose_opened", invokedAt: d("2026-10-21T18:00:00Z") },
      { messageId: "som_1", revisionCount: 2, handoffState: "operator_reported_sent", invokedAt: d("2026-10-21T18:02:00Z") },
    ],
    replies: [{ id: "por_1", direction: "inbound", source: "operator_reported", replyText: "Maybe later", reportedAt: d("2026-10-24T09:00:00Z") }],
  };

  it("labels every entry with no more authority than its row has", () => {
    const entries = recallEntriesFromRows(rows);
    const byKind = Object.fromEntries(entries.map(e => [e.kind, e]));
    expect(byKind.operator_message.authority).toBe("record");
    expect(byKind.operator_message.text).toBe("Hi Rae, I'll follow up next week about a pickup.");
    expect(byKind.handoff_opened.authority).toBe("record");
    expect(byKind.reported_sent.authority).toBe("operator_reported");
    expect(byKind.reported_sent.text).toBe("Hi Rae, I'll follow up next week about a pickup.");
    expect(byKind.reply.authority).toBe("operator_reported");
    expect(entries.some(e => e.kind === "observed_sent")).toBe(false);
  });

  it("only a provider receipt or an observed outbound row is an observed send", () => {
    const dispatchedNoReceipt = recallEntriesFromRows({ ...rows, messages: [{ ...rows.messages[0], status: "dispatched", dispatchedAt: d("2026-10-21T18:03:00Z") }] });
    expect(dispatchedNoReceipt.some(e => e.kind === "observed_sent")).toBe(false);
    const withReceipt = recallEntriesFromRows({ ...rows, messages: [{ ...rows.messages[0], status: "dispatched", externalMessageId: "SM123", dispatchedAt: d("2026-10-21T18:03:00Z") }] });
    expect(withReceipt.find(e => e.kind === "observed_sent")?.authority).toBe("observed");
    const reportedOutbound = recallEntriesFromRows({ ...rows, replies: [{ id: "por_2", direction: "outbound", source: "operator_reported", replyText: "x", reportedAt: d("2026-10-21T18:03:00Z") }] });
    expect(reportedOutbound.some(e => e.kind === "observed_sent")).toBe(false);
  });

  it("Sable quotes the promise from what was reported sent, and sees the reply", () => {
    const recall = buildSableRecall(recallEntriesFromRows(rows));
    expect(recall.promise?.quote).toBe("I'll follow up next week about a pickup.");
    expect(recall.promise?.heard).toBe("reported");
    expect(recall.replyRecorded).toBe(true);
  });

  it("a saved message that was never opened or reported is only a draft: no promise is quoted from it", () => {
    const recall = buildSableRecall(recallEntriesFromRows({ ...rows, handoffs: [], replies: [] }));
    expect(recall.promise).toBeNull();
    expect(recall.unsentPromise?.state).toBe("draft");
    expect(recall.lastSent).toBeNull();
  });

  it("carries the reply service's reading of each reply, and its opt-out, without re-guessing it", () => {
    const entries = recallEntriesFromRows({
      ...rows,
      replies: [
        { id: "por_1", direction: "inbound", source: "operator_reported", replyText: "Maybe later", reportedAt: d("2026-10-24T09:00:00Z"), classification: "not_now", permissionEffect: "none", preparedFollowUpDraft: null },
        { id: "por_2", direction: "inbound", source: "provider_webhook", replyText: "stop", reportedAt: d("2026-10-25T09:00:00Z"), classification: "opt_out", permissionEffect: "opted_out", preparedFollowUpDraft: null },
        { id: "por_3", direction: "inbound", source: "operator_reported", replyText: "hmm", reportedAt: d("2026-10-26T09:00:00Z"), classification: "something_new", permissionEffect: "none", preparedFollowUpDraft: null },
      ],
    });
    const replies = entries.filter(e => e.kind === "reply");
    expect(replies.map(e => e.replyClass)).toEqual(["not_now", "opt_out", undefined]);
    expect(replies.map(e => e.optedOut)).toEqual([false, true, false]);
    expect(buildSableRecall(entries).optedOut).toBe(true);
  });

  it("a provider-receipted send carries the words it went out with, so a promise in it counts as heard", () => {
    const withReceipt = recallEntriesFromRows({
      ...rows,
      handoffs: [],
      messages: [{ ...rows.messages[0], status: "dispatched", externalMessageId: "SM123", dispatchedAt: d("2026-10-21T18:03:00Z") }],
    });
    expect(withReceipt.find(e => e.kind === "observed_sent")?.text).toBe("Hi Rae, I'll follow up next week about a pickup.");
    expect(buildSableRecall(withReceipt).promise?.heard).toBe("observed");
  });
});
