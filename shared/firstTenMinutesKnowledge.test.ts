import { describe, expect, it } from "vitest";
import { SIGNUP_KNOWLEDGE_RULE, signupKnowledgeForBriefing, signupOpeningLine, type OnboardingKnowledge } from "./firstTenMinutesKnowledge";

const zone = "America/Los_Angeles";
const now = new Date("2026-11-02T17:00:00Z");

function knowledge(overrides: Partial<OnboardingKnowledge> = {}): OnboardingKnowledge {
  const source = { provider: "gmail" as const, label: "Email from Elena Ruiz", excerpt: "Do you do Friday flowers?", at: "2026-04-19T09:30:00.000Z", who: "Elena Ruiz", url: null };
  return {
    journeyId: "j1",
    readAt: "2026-10-29T16:00:00.000Z",
    business: "Wildroot Flowers",
    owner: "Nina Vale",
    readFrom: [{ provider: "google", account: "nina@wildrootflowers.example", scopes: ["gmail.readonly"] }],
    facts: [
      { id: "f-business", kind: "business", statement: "Wildroot Flowers", status: "confirmed", correction: null, sources: [source], learnedAt: "2026-10-29T16:00:00.000Z" },
      { id: "f-person", kind: "person", statement: "Marcus Bell: you wrote 1, they wrote 1", status: "proposed", correction: null, sources: [source], learnedAt: "2026-10-29T16:00:00.000Z" },
      { id: "f-request", kind: "request", statement: "Elena Ruiz asked: Do you do Friday flowers?", status: "proposed", correction: null, sources: [source], learnedAt: "2026-10-29T16:00:00.000Z" },
      { id: "f-rule", kind: "rule", statement: "Sundays only for weddings.", status: "changed", correction: "Sundays only for weddings.", sources: [source], learnedAt: "2026-10-29T16:00:00.000Z" },
    ],
    portrait: null,
    opportunity: { factId: "f-request", person: { name: "Elena Ruiz", address: "elena@larkspurhotel.example" }, wants: "Friday flowers", askedAt: source.at, subject: "Friday flowers?" },
    message: null,
    ...overrides,
  };
}

const message = (over: Partial<NonNullable<OnboardingKnowledge["message"]>>): OnboardingKnowledge["message"] => ({
  to: { name: "Elena Ruiz", address: "elena@larkspurhotel.example" },
  subject: "Re: Friday flowers?",
  status: "verified_sent",
  sentAt: "2026-10-30T16:00:00.000Z",
  verified: true,
  gmailThreadId: "th",
  reply: { state: "none_seen" },
  ...over,
});

describe("what was learned at signup, as Claire is handed it", () => {
  it("puts the person's own reactions first, then the opportunity's request, and keeps every receipt", () => {
    const briefing = signupKnowledgeForBriefing(knowledge(), zone)!;
    expect(briefing.facts.map(fact => fact.id)).toEqual(["f-rule", "f-request", "f-person"]);
    expect(briefing.facts.every(fact => fact.id && fact.learnedAt === "2026-10-29")).toBe(true);
    expect(briefing.facts[0]).toMatchObject({ status: "changed", statement: "Sundays only for weddings.", source: "Email from Elena Ruiz, 2026-04-19" });
    expect(briefing.readFrom).toEqual(["google (nina@wildrootflowers.example)"]);
    expect(briefing.moreFacts).toBe(0);
    expect(signupKnowledgeForBriefing(null, zone)).toBeNull();
  });

  it("says where the first message stands, plainly, and nothing when the person chose not to send it", () => {
    const line = (m: OnboardingKnowledge["message"]) => signupOpeningLine(signupKnowledgeForBriefing(knowledge({ message: m }), zone), zone, now);
    expect(line(null)).toBeNull();
    expect(line(message({ status: "prepared", sentAt: null, verified: false, reply: { state: "not_sent" } }))).toBe("Your note to Elena Ruiz is still waiting at the table.");
    expect(line(message({ status: "declined", sentAt: null, verified: false, reply: { state: "not_sent" } }))).toBeNull();
    expect(line(message({}))).toBe("Your note to Elena Ruiz went on Friday 30 October; I haven't seen a reply.");
    expect(line(message({ sentAt: "2026-11-02T16:00:00.000Z" }))).toBe("Your note to Elena Ruiz went today; I haven't seen a reply.");
    expect(line(message({ reply: { state: "replied", at: "2026-11-01T18:30:00.000Z" } }))).toBe("Elena Ruiz replied on Sunday 1 November to your note about “Re: Friday flowers?”.");
    expect(line(message({ reply: { state: "bounced", at: "2026-10-30T16:05:00.000Z" } }))).toBe("Your note to Elena Ruiz didn't arrive: the address bounced.");
  });

  it("tells Claire it is history from the person's own accounts, never a customer, sale or booking", () => {
    expect(SIGNUP_KNOWLEDGE_RULE).toMatch(/history, not current business truth/);
    expect(SIGNUP_KNOWLEDGE_RULE).toMatch(/'proposed' fact was only read/);
    expect(SIGNUP_KNOWLEDGE_RULE).toMatch(/'none_seen' means nothing seen, not that no one replied/);
    expect(SIGNUP_KNOWLEDGE_RULE).toMatch(/None of it is a customer, a sale or a booking/);
  });
});
