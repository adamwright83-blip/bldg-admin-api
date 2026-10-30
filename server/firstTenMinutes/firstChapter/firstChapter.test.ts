import { describe, expect, it } from "vitest";
import type { DraftView } from "../../../shared/firstTenMinutesChapter";
import { claireAnswer, firstChapterEntry, firstChapterQuestion, knownTimeZone, replyExcerpt } from "../../../shared/firstTenMinutesFirstChapter";
import { asViews, exampleReading } from "../testSupport/exampleReading";
import { chapterOpportunity } from "../chapter/chapter";

const NOW = new Date("2026-10-29T17:00:00Z"); // 10:00 AM in Los Angeles
const LA = { timeZone: "America/Los_Angeles", now: NOW };
const ASTRA = "Hi Elena — you asked earlier this year about Friday flowers. We now have a weekly Friday delivery. Is that still something you're looking for at the hotel?";

async function elena() {
  const { all, opportunities } = await exampleReading();
  return chapterOpportunity(asViews([...all, ...opportunities]))!;
}

function draft(overrides: Partial<DraftView> = {}): DraftView {
  return {
    approach: "still_wanted",
    to: { name: "Elena Ruiz", address: "elena@larkspurhotel.example" },
    subject: "Re: Friday flowers?",
    body: ASTRA,
    edited: false,
    status: "prepared",
    handedOffAt: null,
    reportedSentAt: null,
    verifiedSentAt: null,
    approaches: [],
    ...overrides,
  };
}

describe("your first chapter (Nina)", () => {
  it("is Astra's entry, from what Nina actually did", async () => {
    const opportunity = await elena();
    expect(firstChapterEntry(opportunity, draft())).toBe(
      "You revisited Elena's Friday request and prepared a reply using the weekly service you now offer."
    );
    expect(firstChapterEntry(opportunity, draft({ status: "declined" }))).toBe("You revisited Elena's Friday request and decided the reply could wait.");
    const repairs = { ...opportunity, service: { ...opportunity.service!, name: "Same-day repairs" } };
    expect(firstChapterEntry(repairs, draft())).toBe("You revisited Elena's Friday request and prepared a reply using the same-day repairs you now offer.");
    expect(firstChapterQuestion(opportunity)).toBe("Where did we leave things with Elena?");
  });

  it("has Claire answer exactly: the request, the message as it stands, and only what is known of where it is", async () => {
    const opportunity = await elena();
    expect(claireAnswer(opportunity, draft(), { kind: "unknown" }, { ...LA, lookedInSent: false })).toBe(
      `You picked up Elena's Friday request from April. You kept the reply as it was drafted: “${ASTRA}” It's ready, and it hasn't been sent.`
    );
    // her own words, and her decision
    expect(
      claireAnswer(opportunity, draft({ edited: true, body: "Hi Elena — Friday delivery exists now. Shall I bring a sample?", status: "declined" }), { kind: "unknown" }, { ...LA, lookedInSent: false })
    ).toBe(
      "You picked up Elena's Friday request from April. You put the reply in your own words: “Hi Elena — Friday delivery exists now. Shall I bring a sample?” You decided it could wait. It hasn't been sent."
    );
    // the version she chose
    expect(claireAnswer(opportunity, draft({ approach: "short", body: "Hi Elena — we have a weekly Friday delivery now. Still interested?" }), { kind: "unknown" }, { ...LA, lookedInSent: false })).toContain(
      "You chose the shorter reply: “Hi Elena — we have a weekly Friday delivery now. Still interested?”"
    );
  });

  it("says a message isn't in the Sent folder only when she looked, and gives times in Nina's zone", async () => {
    const opportunity = await elena();
    const opened = draft({ status: "handed_off", handedOffAt: "2026-10-29T17:02:00Z" });
    expect(claireAnswer(opportunity, opened, { kind: "unknown" }, { ...LA, lookedInSent: true })).toContain(
      "You opened it in your Gmail at 10:02 AM. It isn't in your Sent folder, so as far as I can tell it hasn't gone yet."
    );
    expect(claireAnswer(opportunity, opened, { kind: "unknown" }, { ...LA, lookedInSent: false })).toContain(
      "You opened it in your Gmail at 10:02 AM. I couldn't look in your Sent folder just now, so I don't know yet whether it went."
    );
    const told = draft({ status: "reported_sent", handedOffAt: "2026-10-29T17:02:00Z", reportedSentAt: "2026-10-29T17:04:00Z" });
    expect(claireAnswer(opportunity, told, { kind: "none" }, { ...LA, lookedInSent: true })).toContain(
      "You told me you sent it at 10:04 AM. I haven't found it in your Sent folder. Elena hasn't written back yet."
    );
    const sent = draft({ status: "verified_sent", handedOffAt: "2026-10-28T17:02:00Z", verifiedSentAt: "2026-10-28T17:05:00Z" });
    expect(claireAnswer(opportunity, sent, { kind: "replied", at: "2026-10-29T16:12:00Z", excerpt: "Yes — we'd love a Friday standing order." }, { ...LA, lookedInSent: true })).toContain(
      "It's in your Sent folder, sent yesterday at 10:05 AM. Elena wrote back at 9:12 AM: “Yes — we'd love a Friday standing order.”"
    );
    expect(claireAnswer(opportunity, draft({ status: "verified_sent", verifiedSentAt: "2026-10-20T17:05:00Z" }), { kind: "unknown" }, { ...LA, lookedInSent: true })).toContain(
      "It's in your Sent folder, sent on Oct 20 at 10:05 AM."
    );
    // without a zone she gives no times rather than the wrong ones
    expect(claireAnswer(opportunity, sent, { kind: "none" }, { timeZone: null, lookedInSent: true, now: NOW })).toBe(
      `You picked up Elena's Friday request. You kept the reply as it was drafted: “${ASTRA}” It's in your Sent folder. Elena hasn't written back yet.`
    );
    expect(knownTimeZone("Not/AZone")).toBeNull();
    expect(knownTimeZone("America/Los_Angeles")).toBe("America/Los_Angeles");
  });

  it("quotes a reply verbatim: past the greeting, before the quoted history, about a sentence", () => {
    expect(replyExcerpt("Hi Nina,\n\nYes — we'd love a Friday standing order. Could you start next week?\n\nOn Thu, Oct 29, 2026 at 10:05 AM Nina wrote:\n> Hi Elena")).toBe(
      "Yes — we'd love a Friday standing order."
    );
    expect(replyExcerpt("Sounds good! Thanks.\n-- \nElena")).toBe("Sounds good! Thanks.");
    // a price is not the end of a sentence; a short first sentence carries on into the next
    expect(replyExcerpt("We pay $1.50 a stem for the lobby now. Would yours be similar? Let me know.")).toBe(
      "We pay $1.50 a stem for the lobby now. Would yours be similar?"
    );
    expect(replyExcerpt("Hello Nina, yes please.")).toBe("Hello Nina, yes please.");
    expect(replyExcerpt(`${"very ".repeat(40)}long`)).toHaveLength(158);
    expect(replyExcerpt("")).toBe("");
  });
});
