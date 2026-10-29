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

  it("the action binds to the item in its own clause (adversarial: name in one clause, action for another item in the next)", () => {
    const pham = { rowId: "r-pham", rowTitle: "Session with the Pham sisters" };
    const opus = { rowId: "r-opus", rowTitle: "Pickup at OPUS" };
    const twoSentences = "I didn't say anything about the Pham session. Take the OPUS pickup off tomorrow.";
    expect(authorizeExistingRowChange({ op: "remove", ...pham, quote: twoSentences, lastClaireText: null }).ok).toBe(false);
    expect(authorizeExistingRowChange({ op: "remove", ...opus, quote: twoSentences, lastClaireText: null })).toEqual({ ok: true });
    const comma = "I didn't say anything about the Pham session, take the OPUS pickup off tomorrow.";
    expect(authorizeExistingRowChange({ op: "remove", ...pham, quote: comma, lastClaireText: null }).ok).toBe(false);
    expect(authorizeExistingRowChange({ op: "remove", ...opus, quote: comma, lastClaireText: null })).toEqual({ ok: true });
    // A shared verb over a list is one clause: both authorized.
    const shared = "Take the Pham session and the OPUS pickup off tomorrow.";
    expect(authorizeExistingRowChange({ op: "remove", ...pham, quote: shared, lastClaireText: null })).toEqual({ ok: true });
    expect(authorizeExistingRowChange({ op: "remove", ...opus, quote: shared, lastClaireText: null })).toEqual({ ok: true });
    // Mixed actions in one breath each bind to their own item.
    const mixed = "The Chadwick pitch is done, and move the OPUS pickup to Friday.";
    expect(authorizeExistingRowChange({ op: "complete", rowId: "r-c", rowTitle: "Pitch The Chadwick in person", quote: mixed, lastClaireText: null })).toEqual({ ok: true });
    expect(authorizeExistingRowChange({ op: "remove", ...opus, quote: mixed, lastClaireText: null }).ok).toBe(false);
    expect(authorizeExistingRowChange({ op: "move", ...opus, quote: mixed, lastClaireText: null, toDay: "friday" })).toEqual({ ok: true });
  });

  it("a bare yes authorizes the offer's sentence, not every task Claire mentioned", async () => {
    const { offerText } = await import("./authorization");
    const line = "Tomorrow has the Pham session and the SAT grading. Want me to take the Pham session off tomorrow?";
    expect(offerText(line)).toBe("Want me to take the Pham session off tomorrow?");
    expect(authorizeExistingRowChange({ op: "remove", rowId: "r-pham", rowTitle: "Session with the Pham sisters", quote: offerText(line)!, lastClaireText: line })).toEqual({ ok: true });
    expect(authorizeExistingRowChange({ op: "remove", rowId: "r-sat", rowTitle: "Grade the SAT practice tests", quote: offerText(line)!, lastClaireText: line }).ok).toBe(false);
    expect(changesOutsideOffer(line, ["Grade the SAT practice tests"])).toEqual(["Grade the SAT practice tests"]);
    expect(changesOutsideOffer(line, ["Session with the Pham sisters"])).toEqual([]);
  });

  it("'it' refers to the item the operator named in their own earlier sentence (run 20, locksmith)", () => {
    const lindqvist = { rowId: "r-l", rowTitle: "Master key system quote for the Lindqvist building" };
    expect(authorizeExistingRowChange({ op: "remove", ...lindqvist, quote: "Lindqvist master key quote tomorrow. The property manager cancelled. Take it off tomorrow entirely.", lastClaireText: "What's the second change?" })).toEqual({ ok: true });
    // The referent still does not reach an item named only in a LATER clause, nor one never named.
    const panic = { rowId: "r-p", rowTitle: "Install the panic bar at St. Brendan's parish hall" };
    expect(authorizeExistingRowChange({ op: "remove", ...panic, quote: "Lindqvist master key quote tomorrow. The property manager cancelled. Take it off tomorrow entirely.", lastClaireText: "What's the second change?" }).ok).toBe(false);
  });

  it("'put it back where it was' after Claire moved the item is a move of that item (run 22)", () => {
    const louise = { rowId: "r-dt", rowTitle: "Regulate the dryer timers at The Louise laundry room" };
    expect(authorizeExistingRowChange({ op: "move", ...louise, quote: "Hmm, no, wait. Put it back where it was.", lastClaireText: "Done. The Louise dryer timer job moved from Saturday to tomorrow, Friday the 30th.", toDay: "Saturday" })).toEqual({ ok: true });
    expect(authorizeExistingRowChange({ op: "move", ...louise, quote: "Undo that.", lastClaireText: "Done. The Louise dryer timer job moved from Saturday to tomorrow.", toDay: "Saturday" })).toEqual({ ok: true });
  });

  it("a family name said in the singular names the row titled in the plural (sealed run 27, Bergstrom key)", async () => {
    const { namesWork, nameForm } = await import("./authorization");
    const key = { rowId: "r-key", rowTitle: "Pick up the spare key from the Bergstroms" };
    expect(namesWork("Right, the Bergstrom key. I did that this afternoon, mark it done.", key.rowTitle)).toBe(true);
    expect(authorizeExistingRowChange({ op: "complete", ...key, quote: "Right, the Bergstrom key. I did that this afternoon, mark it done.", lastClaireText: null })).toEqual({ ok: true });
    // The other direction too: a plural in speech against a singular title.
    expect(namesWork("Take the Kesslers off tomorrow", "Mow and edge at the Kessler residence")).toBe(true);
    // Short words are never folded, so one name cannot become another.
    expect(nameForm("bergstroms")).toBe("bergstrom");
    expect(nameForm("bergstrom's")).toBe("bergstrom");
    expect(nameForm("opus")).toBe("opus");
    expect(nameForm("gentiles'")).toBe("gentile");
    expect(nameForm("class")).toBe("class");
    expect(namesWork("mark the Berg job done", key.rowTitle)).toBe(false);
  });

  it("a question about an existing item is not an instruction to change it", () => {
    expect(authorizeExistingRowChange({ op: "remove", rowId: "r-l", rowTitle: "Interview with the Whole Dog magazine writer", quote: "What's the deal with the magazine interview?", lastClaireText: null }).ok).toBe(false);
  });
});
