import { describe, expect, it } from "vitest";
import type { MailItem } from "../understanding/sources";
import { awaitingOpeningLine } from "../../../shared/firstTenMinutesKnowledge";
import { computeAwaitingReplies } from "./awaitingReplies";

const NINA = "nina@wildrootflowers.example";
const now = new Date("2026-11-02T17:00:00Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);
let n = 0;

function mail(input: { from: string; to: string[]; days: number; text: string; thread?: string; subject?: string; automated?: boolean; toName?: string }): MailItem {
  n += 1;
  return {
    provider: "gmail",
    id: `m${n}`,
    threadId: input.thread ?? `t${n}`,
    at: daysAgo(input.days),
    from: { name: null, email: input.from },
    to: input.to.map(email => ({ name: email === "elena@larkspurhotel.example" ? "Elena Ruiz" : (input.toName ?? null), email })),
    subject: input.subject ?? "Re: Friday flowers?",
    text: input.text,
    sentByOwner: input.from === NINA,
    automated: Boolean(input.automated),
    attachments: [],
    url: `https://mail.google.com/mail/u/0/#all/m${n}`,
  };
}

const compute = (sent: MailItem[], received: MailItem[]) => computeAwaitingReplies({ sent, received, ownerEmail: NINA, now });

describe("who the person is waiting to hear back from", () => {
  it("counts a question nobody has answered, with the real message it rests on", () => {
    const sent = mail({ from: NINA, to: ["elena@larkspurhotel.example"], days: 4, text: "We now have a weekly Friday delivery. Is that still something you're looking for?" });
    const [item] = compute([sent], []);
    expect(item).toMatchObject({ person: { name: "Elena Ruiz", address: "elena@larkspurhotel.example" }, waitingDays: 4, asked: true, messageId: sent.id, threadId: sent.threadId, url: sent.url });
    expect(item.lastLine).toContain("weekly Friday delivery");
    expect(awaitingOpeningLine({ checkedAt: now.toISOString(), account: NINA, items: [item], unavailable: null, scanned: { sent: 1, received: 0, days: 30 } })).toBe(
      "You're waiting to hear back from Elena Ruiz (4 days)."
    );
  });

  it("stops counting once they write back, by address or in the same thread", () => {
    const asked = mail({ from: NINA, to: ["elena@larkspurhotel.example"], days: 4, text: "Would Friday suit?", thread: "th-a" });
    expect(compute([asked], [mail({ from: "elena@larkspurhotel.example", to: [NINA], days: 2, text: "Yes" })])).toHaveLength(0);
    // someone else from the hotel answers in the same thread
    expect(compute([asked], [mail({ from: "frontdesk@larkspurhotel.example", to: [NINA], days: 1, text: "Yes", thread: "th-a" })])).toHaveLength(0);
    // an answer from before she asked doesn't count as an answer
    expect(compute([asked], [mail({ from: "elena@larkspurhotel.example", to: [NINA], days: 10, text: "Hi" })])).toHaveLength(1);
    // an out-of-office is not an answer
    expect(compute([asked], [mail({ from: "elena@larkspurhotel.example", to: [NINA], days: 3, text: "I'm away", automated: true })])).toHaveLength(1);
  });

  it("leaves out what isn't waiting on anyone: too recent, too old, automated addresses, herself, a thank-you to a stranger", () => {
    expect(compute([mail({ from: NINA, to: ["elena@larkspurhotel.example"], days: 1, text: "Would Friday suit?" })], [])).toHaveLength(0);
    expect(compute([mail({ from: NINA, to: ["elena@larkspurhotel.example"], days: 31, text: "Would Friday suit?" })], [])).toHaveLength(0);
    expect(compute([mail({ from: NINA, to: ["no-reply@stripe.example"], days: 4, text: "Can you refund?" })], [])).toHaveLength(0);
    expect(compute([mail({ from: NINA, to: [NINA], days: 4, text: "Note to self?" })], [])).toHaveLength(0);
    expect(compute([mail({ from: NINA, to: ["sam@okafor.example"], days: 4, text: "Thanks so much." })], [])).toHaveLength(0);
    // but a thank-you in a real conversation still waits on them
    const talking = mail({ from: "sam@okafor.example", to: [NINA], days: 9, text: "Here's the venue list" });
    expect(compute([mail({ from: NINA, to: ["sam@okafor.example"], days: 4, text: "Thanks so much, I'll look." })], [talking])).toHaveLength(1);
  });

  it("uses only the latest message to each person, questions first, then the longest wait", () => {
    const sent = [
      mail({ from: NINA, to: ["elena@larkspurhotel.example"], days: 12, text: "Would Friday suit?" }),
      mail({ from: NINA, to: ["elena@larkspurhotel.example"], days: 5, text: "Just checking Friday works?" }),
      mail({ from: NINA, to: ["marcus@bell.example"], days: 20, text: "Here is the quote.", toName: "Marcus Bell" }),
      mail({ from: NINA, to: ["teo@marsh.example"], days: 9, text: "Can I confirm the order?", toName: "Teo Marsh" }),
    ];
    const received = [mail({ from: "marcus@bell.example", to: [NINA], days: 25, text: "Can you quote?" })];
    const items = compute(sent, received);
    expect(items.map(item => [item.person.address, item.waitingDays, item.asked])).toEqual([
      ["teo@marsh.example", 9, true],
      ["elena@larkspurhotel.example", 5, true],
      ["marcus@bell.example", 20, false],
    ]);
    expect(awaitingOpeningLine({ checkedAt: now.toISOString(), account: NINA, items, unavailable: null, scanned: { sent: 4, received: 1, days: 30 } })).toBe(
      "You're waiting to hear back from Teo Marsh (9 days) and Elena Ruiz (5 days) and 1 more."
    );
    expect(awaitingOpeningLine({ checkedAt: now.toISOString(), account: NINA, items: [], unavailable: null, scanned: { sent: 0, received: 0, days: 30 } })).toBeNull();
  });
});
