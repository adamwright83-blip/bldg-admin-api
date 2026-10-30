import { describe, expect, it } from "vitest";
import { DRAFT_APPROACHES, approachesFor, askedAbout, composeDraft, lowerFirst, whenAsked } from "../../../shared/firstTenMinutesChapter";
import { asViews, exampleReading } from "../testSupport/exampleReading";
import { chapterOpportunity } from "./chapter";

const NOW = new Date("2026-10-29T17:00:00Z");

async function nina() {
  const { all, opportunities } = await exampleReading();
  return asViews([...all, ...opportunities]);
}

describe("the first chapter (Nina)", () => {
  it("is Elena's Friday request, Nina's reply, the Friday delivery she offers now, and her route past the hotel", async () => {
    const opportunity = chapterOpportunity(await nina());
    expect(opportunity).toMatchObject({
      type: "became_possible",
      person: { name: "Elena Ruiz", address: "elena@larkspurhotel.example" },
      firstName: "Elena",
      request: { quote: "Could you do fresh arrangements every Friday?", subject: "Friday flowers?" },
      reply: { quote: "We're only doing events at the moment. Ask me again once we have a Friday delivery.", missing: "Friday delivery" },
      service: { name: "Weekly Friday delivery" },
      route: { weekday: 5 },
      place: { name: "The Larkspur Hotel", category: "hotel" },
      along: "street",
    });
    expect(opportunity!.request.at.slice(0, 10)).toBe("2026-04-18");
  });

  it("drafts Astra's message, word for word, to the real recipient", async () => {
    const opportunity = chapterOpportunity(await nina())!;
    expect(composeDraft(opportunity, "still_wanted", NOW)).toEqual({
      subject: "Re: Friday flowers?",
      body: "Hi Elena — you asked earlier this year about Friday flowers. We now have a weekly Friday delivery. Is that still something you're looking for at the hotel?",
    });
    expect(composeDraft(opportunity, "offer_start", NOW).body).toBe(
      "Hi Elena — our weekly Friday delivery is up and running now, and the Friday route already goes past the Larkspur Hotel. Would you like to be on it?"
    );
    expect(composeDraft(opportunity, "short", NOW).body).toBe("Hi Elena — we have a weekly Friday delivery now. Still interested?");
  });

  it("claims nothing new when no service is on record: it only picks the conversation up", async () => {
    const opportunity = chapterOpportunity(await nina())!;
    expect(approachesFor(opportunity)).toEqual(DRAFT_APPROACHES);
    const asked = { ...opportunity, service: null };
    expect(approachesFor(asked)).toEqual(["still_wanted", "short"]);
    expect(composeDraft(asked, "still_wanted", NOW).body).toBe(
      "Hi Elena — you asked earlier this year about Friday flowers. Is that still something you're looking for at the hotel?"
    );
    expect(composeDraft(asked, "short", NOW).body).toBe("Hi Elena — still looking for Friday flowers?");
    // and when the request was never answered, the message says so rather than pretending otherwise
    expect(composeDraft({ ...asked, reply: null }, "still_wanted", NOW).body).toBe(
      "Hi Elena — you asked earlier this year about Friday flowers, and I never got back to you. Is that still something you're looking for at the hotel?"
    );
  });

  it("stays with the conversation its draft was written for", async () => {
    const findings = await nina();
    const elena = chapterOpportunity(findings)!;
    expect(chapterOpportunity(findings, { opportunityId: elena.id, recipientAddress: "elena@larkspurhotel.example" })?.id).toBe(elena.id);
    // a later reading or correction never readdresses the message: another conversation, or another person, is no chapter
    expect(chapterOpportunity(findings, { opportunityId: "another-opportunity", recipientAddress: "elena@larkspurhotel.example" })).toBeNull();
    expect(chapterOpportunity(findings, { opportunityId: elena.id, recipientAddress: "someone@else.example" })).toBeNull();
  });

  it("has no chapter when the request it rests on was said to be wrong", async () => {
    const findings = (await nina()).map(finding =>
      finding.payload.kind === "request" && finding.payload.quote.startsWith("Could you do fresh") ? { ...finding, status: "dismissed" as const } : finding
    );
    expect(chapterOpportunity(findings)).toBeNull();
  });

  it("says when and what in plain words", () => {
    expect(whenAsked("2026-10-20T00:00:00Z", NOW)).toBe("recently");
    expect(whenAsked("2026-09-20T00:00:00Z", NOW)).toBe("a few weeks ago");
    expect(whenAsked("2026-04-18T16:12:00Z", NOW)).toBe("earlier this year");
    expect(whenAsked("2025-11-02T00:00:00Z", NOW)).toBe("last year");
    expect(askedAbout("Re: Friday flowers?", "Fresh arrangements every Friday")).toBe("Friday flowers");
    expect(askedAbout("Quick question", "Weekly flowers for the lobby")).toBe("weekly flowers for the lobby");
    expect(askedAbout(null, "A standing order for the restaurant")).toBe("a standing order for the restaurant");
    expect(lowerFirst("Friday delivery")).toBe("Friday delivery");
    expect(lowerFirst("Weekly Friday delivery")).toBe("weekly Friday delivery");
  });
});
