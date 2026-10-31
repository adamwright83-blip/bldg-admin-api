import { describe, expect, it } from "vitest";
import type { MailItem } from "../understanding/sources";
import { awaitingOpeningLine } from "../../../shared/firstTenMinutesKnowledge";
import { clearAwaitingRepliesCache, computeAwaitingReplies, readAwaitingReplies, refreshAwaitingRepliesInBackground } from "./awaitingReplies";

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

describe("who wrote back, and what changed while the person was away", () => {
  it("lists people she'd written to who answered, newest first, one each; not strangers, not automated mail", async () => {
    const { computeRecentReplies } = await import("./awaitingReplies");
    const { sinceLastVisitLine } = await import("../../../shared/firstTenMinutesKnowledge");
    const sent = [
      mail({ from: NINA, to: ["elena@larkspurhotel.example"], days: 6, text: "Would Friday suit?" }),
      mail({ from: NINA, to: ["teo@marsh.example"], days: 9, text: "Shall I keep it going?", toName: "Teo Marsh" }),
    ];
    const received = [
      mail({ from: "elena@larkspurhotel.example", to: [NINA], days: 3, text: "Yes, Friday is perfect." }),
      mail({ from: "elena@larkspurhotel.example", to: [NINA], days: 1, text: "And two vases please." }),
      mail({ from: "teo@marsh.example", to: [NINA], days: 2, text: "Keep it going." }),
      // a stranger she never wrote to, and a newsletter: not replies
      mail({ from: "newcomer@shop.example", to: [NINA], days: 1, text: "Hello!" }),
      mail({ from: "teo@marsh.example", to: [NINA], days: 1, text: "Out of office", automated: true }),
      // Teo wrote before she ever wrote to him: not a reply to her
      mail({ from: "teo@marsh.example", to: [NINA], days: 12, text: "Hi" }),
    ];
    received[0].from.name = "Elena Ruiz";
    received[1].from.name = "Elena Ruiz";
    received[2].from.name = "Teo Marsh";
    const replies = computeRecentReplies({ sent, received, ownerEmail: NINA });
    expect(replies.map(reply => [reply.person.address, reply.snippet])).toEqual([
      ["elena@larkspurhotel.example", "And two vases please."],
      ["teo@marsh.example", "Keep it going."],
    ]);
    const awaiting = { checkedAt: now.toISOString(), account: NINA, items: [], replies, unavailable: null, scanned: { sent: 2, received: 6, days: 30 } };
    // never been to the desk before: nothing to say about "since"
    expect(sinceLastVisitLine(awaiting, null)).toBeNull();
    expect(sinceLastVisitLine(awaiting, daysAgo(4))).toBe("Since you were last here, Elena Ruiz and Teo Marsh wrote back.");
    expect(sinceLastVisitLine(awaiting, new Date(now.getTime() - 1.5 * 86_400_000))).toBe("Since you were last here, Elena Ruiz wrote back.");
    expect(sinceLastVisitLine(awaiting, now)).toBeNull();
  });

  it("moves the last-seen mark only as far as mail was read", async () => {
    const { nextLastSeenMark } = await import("../../../shared/firstTenMinutesKnowledge");
    const read = (at: Date, unavailable: string | null = null) => ({ checkedAt: at.toISOString(), account: NINA, items: [], replies: [], unavailable, scanned: { sent: 0, received: 0, days: 30 } });
    const cachedAt = new Date(now.getTime() - 8 * 60_000);
    // first visit with a read: the mark starts at that read, not at "now"
    expect(nextLastSeenMark(read(cachedAt), null)).toBe(cachedAt.getTime());
    // Gmail timed out or wasn't readable: the mark stays where it was
    expect(nextLastSeenMark(null, daysAgo(2))).toBeNull();
    expect(nextLastSeenMark(read(now, "Gmail couldn't be read just now."), daysAgo(2))).toBeNull();
    // a read older than the mark never moves it back
    expect(nextLastSeenMark(read(daysAgo(3)), daysAgo(2))).toBeNull();
    expect(nextLastSeenMark(read(cachedAt), daysAgo(2))).toBe(cachedAt.getTime());
  });
});

describe("reading the waiting list", () => {
  it("reads once per workspace at a time, and a background refresh goes through the same read", async () => {
    clearAwaitingRepliesCache();
    let calls = 0;
    let release: (value: null) => void = () => undefined;
    const journeyFor = () => {
      calls += 1;
      return new Promise<null>(resolve => (release = resolve));
    };
    const first = readAwaitingReplies("df_one", { journeyFor });
    const second = readAwaitingReplies("df_one", { journeyFor });
    refreshAwaitingRepliesInBackground("df_one", { journeyFor });
    await Promise.resolve();
    expect(calls).toBe(1);
    release(null);
    expect(await first).toBeNull();
    expect(await second).toBeNull();
    // finished: the next look reads again
    const third = readAwaitingReplies("df_one", { journeyFor });
    await Promise.resolve();
    expect(calls).toBe(2);
    release(null);
    expect(await third).toBeNull();
  });
});
