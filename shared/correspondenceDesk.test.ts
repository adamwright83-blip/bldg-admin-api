import { describe, expect, it } from "vitest";
import { TESSA_PARK_FIXTURE, buildSableRecall, composeRookDraft, deskStateLabel, extractPromise, whyNow, type RecallEntry } from "./correspondenceDesk";

describe("Rook's correspondence desk", () => {
  it("Sable quotes the promise in the operator's own words, with its date and source", () => {
    const r = buildSableRecall(TESSA_PARK_FIXTURE.recallEntries);
    expect(r.promise?.quote).toBe("I'll follow up with you next week about another pickup.");
    expect(r.promise?.at.startsWith("2026-10-21")).toBe(true);
    expect(r.promise?.source).toMatch(/fixture/i);
    expect(r.promise?.authority).toBe("operator_reported");
  });

  it("Sable says what is not known, and never treats a reported send as observed", () => {
    const r = buildSableRecall(TESSA_PARK_FIXTURE.recallEntries);
    expect(r.unknowns).toContain("No reply recorded since.");
    expect(r.unknowns.join(" ")).toMatch(/reported by you/);
    expect(r.replyRecorded).toBe(false);
  });

  it("Rook's draft honours the promise and invents nothing", () => {
    const r = buildSableRecall(TESSA_PARK_FIXTURE.recallEntries);
    const { draft, note } = composeRookDraft({ displayName: "Tessa Park", recall: r });
    expect(draft).toBe("Hi Tessa, following up as promised about your next laundry pickup. Would you like me to help arrange one this week?");
    expect(note).toBe("Kept it short. Sable found the promise.");
  });

  it("Rook does not claim a promise when there was none, and starts plainly when there is no history", () => {
    const noPromise: RecallEntry[] = [{ at: "2026-10-01T10:00:00Z", kind: "operator_message", text: "Hi! Hope the week is going well.", authority: "record", source: "saved" }];
    expect(composeRookDraft({ displayName: "Ana Ruiz", recall: buildSableRecall(noPromise) }).draft).not.toMatch(/promised/);
    const empty = buildSableRecall([]);
    expect(empty.unknowns).toEqual(["No earlier message to this customer is on record."]);
    expect(composeRookDraft({ displayName: "Ana Ruiz", recall: empty, fallback: "Hi Ana, it's Laundry Farm." }).draft).toBe("Hi Ana, it's Laundry Farm.");
  });

  it("a recorded reply leads, and is not called revenue", () => {
    const entries: RecallEntry[] = [
      ...TESSA_PARK_FIXTURE.recallEntries,
      { at: "2026-10-23T10:00:00Z", kind: "reply", text: "Yes please, Thursday?", authority: "operator_reported", source: "Reply you recorded" },
    ];
    const r = buildSableRecall(entries);
    expect(r.replyRecorded).toBe(true);
    expect(r.unknowns).not.toContain("No reply recorded since.");
    expect(composeRookDraft({ displayName: "Tessa Park", recall: r }).draft).toMatch(/thanks for getting back/);
    expect(deskStateLabel({ saved: false, message: "operator_reported_sent", replyObserved: true, orderObserved: false })).toBe("A reply is recorded.");
  });

  it("finds a promise only when the operator committed to a next step", () => {
    expect(extractPromise("I'll follow up with you next week about another pickup.")).toBeTruthy();
    expect(extractPromise("We will check back in tomorrow.")).toBeTruthy();
    expect(extractPromise("Thanks for being a customer!")).toBeNull();
    expect(extractPromise(null)).toBeNull();
  });

  it("labels each state for what it is: opening Messages is not sending, a reported send is not observed", () => {
    expect(deskStateLabel({ saved: false, message: null, replyObserved: false, orderObserved: false })).toBe("Draft prepared. Nothing has been sent.");
    expect(deskStateLabel({ saved: true, message: null, replyObserved: false, orderObserved: false })).toBe("Saved for later. Nothing has been sent.");
    expect(deskStateLabel({ saved: false, message: "compose_handoff_opened", replyObserved: false, orderObserved: false })).toMatch(/Not sent until you send it/);
    expect(deskStateLabel({ saved: false, message: "operator_reported_sent", replyObserved: false, orderObserved: false })).toMatch(/Not independently observed/);
    expect(deskStateLabel({ saved: false, message: null, replyObserved: false, orderObserved: true })).toMatch(/not credited to the message/);
  });

  it("explains why now from the order record alone", () => {
    expect(whyNow(TESSA_PARK_FIXTURE.customer)).toBe("4 paid orders, then nothing since August 28 (62 days).");
  });
});
