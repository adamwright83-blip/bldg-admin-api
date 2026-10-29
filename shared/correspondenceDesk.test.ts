import { describe, expect, it } from "vitest";
import {
  TESSA_PARK_FIXTURE,
  buildSableRecall,
  composeRookDraft,
  deskStateLabel,
  draftReady,
  extractPromise,
  recallLines,
  whyNow,
  type RecallEntry,
} from "./correspondenceDesk";

const draft = (at: string, text: string): RecallEntry => ({ at, kind: "operator_message", text, authority: "record", source: `Your saved message (som_${at.slice(8, 10)})` });
const opened = (at: string, text: string): RecallEntry => ({ at, kind: "handoff_opened", text, authority: "record", source: "Opened in your messaging app (som_1)" });
const reported = (at: string, text: string): RecallEntry => ({ at, kind: "reported_sent", text, authority: "operator_reported", source: "You reported sending it (som_1)" });
const observed = (at: string, text: string): RecallEntry => ({ at, kind: "observed_sent", text, authority: "observed", source: "Provider receipt SM1" });
const reply = (at: string, text: string, replyClass?: RecallEntry["replyClass"], extra: Partial<RecallEntry> = {}): RecallEntry => ({
  at,
  kind: "reply",
  text,
  authority: "operator_reported",
  source: "Reply you recorded (por_1)",
  replyClass,
  ...extra,
});
const PROMISED = "Hi Rae! I'll follow up next week about a pickup.";

describe("Sable keeps what was sent apart from what never left", () => {
  it("quotes a promise as 'you said' only when it went out (reported or observed)", () => {
    const r = buildSableRecall(TESSA_PARK_FIXTURE.recallEntries);
    expect(r.promise?.quote).toBe("I'll follow up with you next week about another pickup.");
    expect(r.promise?.at.startsWith("2026-10-21")).toBe(true);
    expect(r.promise?.source).toMatch(/fixture/i);
    expect(r.promise?.heard).toBe("reported");
    expect(buildSableRecall([observed("2026-10-21T10:00:00Z", PROMISED)]).promise?.heard).toBe("observed");
  });

  it("a promise in a saved draft is not 'you said': it is an unsent draft, and nothing is recorded as sent", () => {
    const r = buildSableRecall([draft("2026-10-20T10:00:00Z", PROMISED)]);
    expect(r.promise).toBeNull();
    expect(r.unsentPromise).toMatchObject({ quote: "I'll follow up next week about a pickup.", state: "draft" });
    expect(r.lastSent).toBeNull();
    expect(r.unknowns).toEqual(["Nothing you wrote to them is recorded as sent."]);
    expect(recallLines(r).map(l => l.tag)).toEqual(["A draft you saved, never sent"]);
  });

  it("a message opened in the messaging app but never reported sent is not a send either", () => {
    const r = buildSableRecall([draft("2026-10-20T10:00:00Z", PROMISED), opened("2026-10-21T18:00:00Z", PROMISED)]);
    expect(r.promise).toBeNull();
    expect(r.unsentPromise?.state).toBe("opened");
    expect(r.unknowns[0]).toMatch(/opened a message .* isn't recorded as sent/);
  });

  it("the same words, later reported sent, are the promise and are not also shown as an unsent draft", () => {
    const r = buildSableRecall([draft("2026-10-20T10:00:00Z", PROMISED), opened("2026-10-21T18:00:00Z", PROMISED), reported("2026-10-21T18:02:00Z", PROMISED)]);
    expect(r.promise?.heard).toBe("reported");
    expect(r.unsentPromise).toBeNull();
    expect(recallLines(r).map(l => l.tag)).toEqual(["You reported sending"]);
  });

  it("a newer promise that only exists in a draft is kept apart from the one that went out", () => {
    const r = buildSableRecall([
      reported("2026-10-01T10:00:00Z", "Hi Rae, I'll check in after your trip."),
      draft("2026-10-20T10:00:00Z", "Hi Rae, I'll text you Friday about the comforter."),
    ]);
    expect(r.promise?.quote).toBe("I'll check in after your trip.");
    expect(r.unsentPromise).toMatchObject({ quote: "I'll text you Friday about the comforter.", state: "draft" });
  });

  it("says what is not known, and never treats a reported send as observed, or the desk as seeing orders", () => {
    const r = buildSableRecall(TESSA_PARK_FIXTURE.recallEntries);
    expect(r.unknowns).toContain("No reply recorded since.");
    expect(r.unknowns.join(" ")).toMatch(/reported by you/);
    expect(r.unknowns.join(" ")).toMatch(/can't see orders/);
    expect(r.replyRecorded).toBe(false);
    expect(buildSableRecall([]).unknowns).toEqual(["No earlier message to this customer is on record."]);
  });
});

describe("Rook writes only what the record supports", () => {
  it("honours a promise that went out, and invents nothing", () => {
    const { mode, draft: text, note } = composeRookDraft({ displayName: "Tessa Park", recall: buildSableRecall(TESSA_PARK_FIXTURE.recallEntries) });
    expect(mode).toBe("draft");
    expect(text).toBe("Hi Tessa, following up as promised about your next laundry pickup. Would you like me to help arrange one this week?");
    expect(note).toBe("Kept it short. Sable found the promise.");
  });

  it("never says 'as promised' for a promise the customer never received", () => {
    for (const entries of [[draft("2026-10-20T10:00:00Z", PROMISED)], [opened("2026-10-21T18:00:00Z", PROMISED)]]) {
      const rook = composeRookDraft({ displayName: "Rae Kim", recall: buildSableRecall(entries), fallback: "Hi Rae, it's Laundry Farm. Would you like a pickup this week?" });
      expect(rook.draft).not.toMatch(/promise/i);
      expect(rook.draft).toBe("Hi Rae, it's Laundry Farm. Would you like a pickup this week?");
      expect(rook.note).toMatch(/never went out/);
    }
  });

  it("writes nothing at all to someone who opted out, whenever they said it", () => {
    const optOut = buildSableRecall([reported("2026-10-01T10:00:00Z", PROMISED), reply("2026-10-02T10:00:00Z", "STOP", "opt_out"), reported("2026-10-21T10:00:00Z", "Hi Rae")]);
    const rook = composeRookDraft({ displayName: "Rae Kim", recall: optOut });
    expect(rook).toMatchObject({ mode: "none", draft: "" });
    expect(draftReady(rook.mode, "Hi Rae, one more thing", "Rae Kim")).toBe(false);
    // the reply service's opt-out flag counts even if the words were read some other way
    expect(composeRookDraft({ displayName: "Rae Kim", recall: buildSableRecall([reply("2026-10-02T10:00:00Z", "please remove me", "question", { optedOut: true })]) }).mode).toBe("none");
  });

  it("holds off after a 'not now', even after a later message of yours", () => {
    for (const entries of [
      [reported("2026-10-01T10:00:00Z", PROMISED), reply("2026-10-02T10:00:00Z", "Not right now, maybe next month", "not_now")],
      [reply("2026-09-02T10:00:00Z", "Not right now", "not_now"), reported("2026-10-21T10:00:00Z", "Hi Rae, checking in")],
    ]) {
      const rook = composeRookDraft({ displayName: "Rae Kim", recall: buildSableRecall(entries) });
      expect(rook.mode).toBe("hold");
      expect(rook.draft).toBe("");
      expect(rook.note).toMatch(/won't push/);
    }
  });

  it("never pitches a pickup after a complaint; it offers the careful reply the reply service prepared, for review", () => {
    const prepared = "Hi Rae, thank you for telling me directly. I want to review what happened personally.";
    const rook = composeRookDraft({
      displayName: "Rae Kim",
      recall: buildSableRecall([reported("2026-10-01T10:00:00Z", PROMISED), reply("2026-10-02T10:00:00Z", "My shirts came back damaged", "complaint", { preparedReply: prepared })]),
    });
    expect(rook.mode).toBe("review");
    expect(rook.draft).toBe(prepared);
    expect(rook.draft).not.toMatch(/pickup/i);
  });

  it("leaves a question to the operator: no answer is invented, and a bare greeting cannot be sent", () => {
    const rook = composeRookDraft({
      displayName: "Rae Kim",
      recall: buildSableRecall([reported("2026-10-01T10:00:00Z", PROMISED), reply("2026-10-02T10:00:00Z", "How much is a comforter?", "question")]),
    });
    expect(rook).toMatchObject({ mode: "review", draft: "Hi Rae, " });
    expect(rook.note).toMatch(/only you can answer/);
    expect(draftReady(rook.mode, rook.draft, "Rae Kim")).toBe(false);
    expect(draftReady(rook.mode, "Hi Rae, a comforter is $25.", "Rae Kim")).toBe(true);
  });

  it("does not promise a day the customer suggested, or answer their question about the pickup", () => {
    for (const text of ["Yes please, Thursday?", "Thursday morning works", "Yes, can you come early?"]) {
      const rook = composeRookDraft({ displayName: "Tessa Park", recall: buildSableRecall([...TESSA_PARK_FIXTURE.recallEntries, reply("2026-10-23T10:00:00Z", text, "pickup_interest")]) });
      expect(rook.mode).toBe("review");
      expect(rook.draft).toBe("Hi Tessa, ");
      expect(rook.draft).not.toMatch(/thursday|pickup/i);
    }
  });

  it("asks only 'when' after a plain yes to a pickup", () => {
    const rook = composeRookDraft({ displayName: "Tessa Park", recall: buildSableRecall([...TESSA_PARK_FIXTURE.recallEntries, reply("2026-10-23T10:00:00Z", "Yes please, I'd love a pickup", "pickup_interest")]) });
    expect(rook.mode).toBe("draft");
    expect(rook.draft).toBe("Hi Tessa, happy to set that up. What day and time work best for you?");
  });

  it("does not guess at a reply it cannot read", () => {
    for (const r of [reply("2026-10-23T10:00:00Z", "ok"), reply("2026-10-23T10:00:00Z", "", undefined)]) {
      const rook = composeRookDraft({ displayName: "Tessa Park", recall: buildSableRecall([...TESSA_PARK_FIXTURE.recallEntries, r]) });
      expect(rook.mode).toBe("review");
      expect(rook.draft).toBe("Hi Tessa, ");
    }
  });

  it("checks back in after the operator has answered and heard nothing since", () => {
    const rook = composeRookDraft({
      displayName: "Rae Kim",
      recall: buildSableRecall([reply("2026-10-02T10:00:00Z", "How much is a comforter?", "question"), reported("2026-10-03T10:00:00Z", "It's $25!")]),
    });
    expect(rook.mode).toBe("draft");
    expect(rook.draft).toMatch(/checking back in/);
  });
});

describe("the desk's words", () => {
  it("finds a promise only when the operator committed to a next step", () => {
    expect(extractPromise("I'll follow up with you next week about another pickup.")).toBeTruthy();
    expect(extractPromise("We will check back in tomorrow.")).toBeTruthy();
    expect(extractPromise("Thanks for being a customer!")).toBeNull();
    expect(extractPromise(null)).toBeNull();
  });

  it("labels each state for what it is: opening Messages is not sending, a reported send is not observed", () => {
    expect(deskStateLabel({ saved: false, message: null, replyObserved: false })).toBe("Draft prepared. Nothing has been sent.");
    expect(deskStateLabel({ saved: true, message: null, replyObserved: false })).toBe("Saved for later. Nothing has been sent.");
    expect(deskStateLabel({ saved: false, message: "saved_draft", replyObserved: false })).toBe("Saved draft. Nothing has been sent.");
    expect(deskStateLabel({ saved: false, message: "compose_handoff_opened", replyObserved: false })).toMatch(/Not sent until you send it/);
    expect(deskStateLabel({ saved: false, message: "operator_reported_sent", replyObserved: false })).toMatch(/Not independently observed/);
    expect(deskStateLabel({ saved: false, message: "operator_reported_sent", replyObserved: true })).toBe("A reply is recorded.");
  });

  it("explains why now from the order record alone", () => {
    expect(whyNow(TESSA_PARK_FIXTURE.customer)).toBe("4 paid orders, then nothing since August 28 (62 days).");
  });
});
