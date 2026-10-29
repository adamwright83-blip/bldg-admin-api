import { describe, expect, it } from "vitest";
import { authorizeExistingRowChange, changesOutsideOffer, isOffer, verifyOperatorAuthorization } from "./authorization";

const turns = [
  "What's the state of my business?",
  "I might swing by the Chadwick next week, we'll see.",
  "Can you add the marketing challenge to the day line tomorrow?",
  "Yeah. Of course. Put them on tomorrow's day line.",
];

describe("verifyOperatorAuthorization", () => {
  it("accepts words the operator actually said", () => {
    expect(verifyOperatorAuthorization({ quote: "add the marketing challenge to the day line tomorrow", operatorTurns: turns, lastClaireText: null })).toMatchObject({ ok: true, bareAck: false });
    expect(verifyOperatorAuthorization({ quote: "Put them on tomorrow's day line.", operatorTurns: turns, lastClaireText: null })).toMatchObject({ ok: true });
  });

  it("refuses words the operator never said: approval cannot be fabricated", () => {
    const verdict = verifyOperatorAuthorization({ quote: "add the Chadwick visit for Tuesday", operatorTurns: turns, lastClaireText: null });
    expect(verdict.ok).toBe(false);
    expect((verdict as { reason: string }).reason).toMatch(/did not say/);
  });

  it("a bare yes binds to an offer, however the offer was punctuated", () => {
    expect(verifyOperatorAuthorization({ quote: "Yes.", operatorTurns: ["Yes."], lastClaireText: "Want me to put the Opus pickup on today?" })).toMatchObject({ ok: true, bareAck: true });
    // Run 11: "I can put it there if you'd like." is an offer with no question mark.
    expect(verifyOperatorAuthorization({ quote: "Yes.", operatorTurns: ["Yes."], lastClaireText: "Saturday looks like a fine spot for Lotus Garden, and I can put it there if you'd like." }).ok).toBe(true);
    const withoutOffer = verifyOperatorAuthorization({ quote: "Yes.", operatorTurns: ["Yes."], lastClaireText: "You did 12 orders last week." });
    expect(withoutOffer.ok).toBe(false);
    expect((withoutOffer as { reason: string }).reason).toMatch(/answers nothing/);
    expect(verifyOperatorAuthorization({ quote: "yes", operatorTurns: ["No, leave it."], lastClaireText: "Want me to add it?" }).ok).toBe(false);
  });

  it("refuses an empty citation", () => {
    expect(verifyOperatorAuthorization({ quote: "", operatorTurns: turns, lastClaireText: null }).ok).toBe(false);
    expect(verifyOperatorAuthorization({ quote: undefined, operatorTurns: turns, lastClaireText: null }).ok).toBe(false);
  });
});

describe("identifyingTokens", () => {
  it("prefers proper names, falls back to non-generic nouns", async () => {
    const { identifyingTokens } = await import("./authorization");
    expect(identifyingTokens("Pitch The Chadwick in person")).toEqual(["chadwick"]);
    expect(identifyingTokens("Follow up with Dana at The Louise")).toEqual(["dana", "louise"]);
    expect(identifyingTokens("Pickup at OPUS")).toEqual(["opus"]);
    expect(identifyingTokens("Renew the business license")).toEqual(["business", "license"]);
  });
});

describe("a bare yes binds only to the work the offer named", () => {
  it("offer named the Dana email: yes writes the Dana email, not a second item", () => {
    const offer = "I'd put it on today. Want me to add \"Email Dana about the Louise contract renewal\" to today's Day Line?";
    expect(changesOutsideOffer(offer, ["Email Dana about the Louise contract renewal"])).toEqual([]);
    expect(changesOutsideOffer(offer, ["Email Dana about the Louise contract renewal", "Call the plumber"])).toEqual(["Call the plumber"]);
    expect(isOffer(offer)).toBe(true);
  });
});

describe("authorizeExistingRowChange: conservative about work that predates the call", () => {
  const row = { rowId: "r-pham", rowTitle: "Session with the Pham sisters" };

  it("'I didn't say anything about the Pham session' names it but asks for nothing: refused", () => {
    const verdict = authorizeExistingRowChange({ op: "remove", ...row, quote: "the Pham sisters? I didn't say anything about the Pham session, that's not something I need on there.", lastClaireText: null });
    expect(verdict.ok).toBe(false);
    expect((verdict as { reason: string }).reason).toMatch(/did not say to take it off/);
  });

  it("an explicit removal naming the item is easy", () => {
    expect(authorizeExistingRowChange({ op: "remove", ...row, quote: "Take the Pham session off tomorrow, they cancelled.", lastClaireText: null })).toEqual({ ok: true });
    expect(authorizeExistingRowChange({ op: "remove", ...row, quote: "Scratch the Pham sisters.", lastClaireText: null })).toEqual({ ok: true });
    expect(authorizeExistingRowChange({ op: "remove", rowId: "r-b", rowTitle: "Drop the invoices at Brightwater Management", quote: "And take the Brightwater invoices off tomorrow. I'm mailing them.", lastClaireText: null })).toEqual({ ok: true });
  });

  it("completion needs the item and the fact that it is done", () => {
    const disposal = { rowId: "r-a", rowTitle: "Replace the garbage disposal at 418 Alvarado, unit 3" };
    expect(authorizeExistingRowChange({ op: "complete", ...disposal, quote: "The Alvarado disposal is done. Did it this morning. Mark it.", lastClaireText: null })).toEqual({ ok: true });
    expect(authorizeExistingRowChange({ op: "complete", ...disposal, quote: "What's happening with the Alvarado disposal?", lastClaireText: null }).ok).toBe(false);
  });

  it("a deferral of the item Claire just named counts: 'I'll do that tomorrow'", () => {
    const pitch = { rowId: "r-w", rowTitle: "Pitch Wilshire Vermont in person" };
    expect(authorizeExistingRowChange({ op: "move", ...pitch, quote: "Okay. I'll do that tomorrow.", lastClaireText: "One thing tonight: pitch Wilshire Vermont in person.", toDay: "tomorrow" })).toEqual({ ok: true });
    // Same words, but Claire's last line named something else: not this row.
    expect(authorizeExistingRowChange({ op: "move", ...pitch, quote: "Okay. I'll do that tomorrow.", lastClaireText: "One thing tonight: visit sageLA.", toDay: "tomorrow" }).ok).toBe(false);
    expect(authorizeExistingRowChange({ op: "move", ...pitch, quote: "Move the Wilshire Vermont pitch to Friday.", lastClaireText: null, toDay: "friday" })).toEqual({ ok: true });
  });

  it("a question about an existing item is not an instruction to change it", () => {
    expect(authorizeExistingRowChange({ op: "remove", rowId: "r-l", rowTitle: "Interview with the Whole Dog magazine writer", quote: "What's the deal with the magazine interview?", lastClaireText: null }).ok).toBe(false);
  });
});
