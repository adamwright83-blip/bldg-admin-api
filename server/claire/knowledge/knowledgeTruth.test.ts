import { describe, expect, it, vi } from "vitest";
import { Speech, speakFreshness } from "../business/businessSpeech";
import { businessFreshness } from "../testSupport/claireBusinessFixture";
import { speakAccountHistory, lastContact, type AccountHistory } from "./accountKnowledge";
import { answerWithEncyclopedia, numbersGrounded } from "./encyclopediaAgent";
import { speakUnpaidOrders } from "./openOrdersKnowledge";

function say(freshness: ReturnType<typeof businessFreshness>, aspect: Parameters<typeof speakFreshness>[1]) {
  const speech = new Speech("voice", "America/Los_Angeles", "2026-09-15");
  speakFreshness(freshness, aspect, speech);
  return speech.text();
}

describe("import health is evidence, not inference", () => {
  it("no import today, attempt log present and empty: most likely didn't run", () => {
    const text = say(businessFreshness(), "gumball_today");
    expect(text).toContain("I don't see a GUMBALL import today.");
    expect(text).toContain("The last successful GUMBALL import was September 11 at 7:03 AM: 4 new CleanCloud orders for September 10.");
    expect(text).toContain("No failed attempt is logged since then either, so it most likely didn't run.");
  });

  it("without an attempt log, Claire says she can't tell whether it failed or didn't run", () => {
    const text = say(businessFreshness({ attemptsLogged: false }), "gumball_today");
    expect(text).toContain("can't tell whether it didn't run or failed before reaching Goldline");
  });

  it("a logged failure today is reported as a failure with its message", () => {
    const freshness = businessFreshness();
    freshness.gumball.attempts = [{ at: "2026-09-15T15:40:00.000Z", outcome: "rejected", message: "Retry payload differs from the original request.", rangeFrom: "2026-09-15", rangeTo: "2026-09-15" }];
    expect(say(freshness, "gumball_working")).toContain(
      "GUMBALL tried today at 8:40 AM but didn't import: Retry payload differs from the original request."
    );
  });

  it("an import today that found nothing new is not 'no activity' and not failure", () => {
    const freshness = businessFreshness({ importedToday: true });
    freshness.gumball.receipts[0] = { ...freshness.gumball.receipts[0]!, inserted: 0, updated: 0 };
    expect(say(freshness, "gumball_today")).toContain("Yes. GUMBALL imported today at 8:42 AM: nothing new for September 15.");
  });

  it("current-ness is measured in days behind", () => {
    expect(say(businessFreshness(), "data_current")).toContain("Not quite. CleanCloud is only current through September 10, 5 days ago.");
  });
});

const LOUISE: AccountHistory = {
  account: { id: 8, name: "The Louise", accountType: "other" },
  missions: [{ id: 12, code: "MISSION 012", status: "candidate", createdAt: "2026-08-06T18:00:00.000Z", updatedAt: "2026-08-06T18:00:00.000Z" }],
  events: [],
  fieldVisits: [],
  outcomes: [],
  followUps: [],
  pipelineStage: null,
  pipelineId: null,
  contacts: [],
  dayLineMentions: [],
  conversationMentions: [],
};

describe("account history keeps provenance", () => {
  it("a mission with no visit is not a pitch and not a contact", () => {
    const options = { timeZone: "America/Los_Angeles", today: "2026-09-15" };
    expect(lastContact(LOUISE)).toBeNull();
    expect(speakAccountHistory(LOUISE, "summary", options)).toBe(
      "The Louise has one mission on file, set up August 6, currently a candidate. No visit has been recorded yet."
    );
    expect(speakAccountHistory(LOUISE, "last_contact", options)).toBe(
      "I don't have a recorded visit or contact with The Louise, only the mission set up August 6."
    );
    expect(speakAccountHistory(LOUISE, "said", options)).toBe("I don't have anything you said or noted about The Louise.");
    expect(speakAccountHistory(LOUISE, "follow_up", options)).toBe("There's no follow-up on record for The Louise.");
  });
});

describe("unpaid orders name amounts only when recorded", () => {
  it("never invents a total for an order without one", () => {
    const text = speakUnpaidOrders(
      [
        { id: 1, customerName: "Carol Wexler", status: "ready", totalCents: 1900, pickupDate: "2026-09-14", deliveryDate: null, building: "OPUS LA" },
        { id: 2, customerName: "Todd Ames", status: "collected", totalCents: 0, pickupDate: "2026-09-15", deliveryDate: null, building: null },
      ],
      "voice"
    );
    expect(text).toBe("2 Goldline orders are waiting on payment: Carol Wexler, $19.00, ready and Todd Ames, no total entered yet, collected. That's $19.00 across the 1 with a total.");
  });
});

describe("the record-lookup answer path cannot add numbers", () => {
  it("numbers must appear in what the records said", () => {
    expect(numbersGrounded("OPUS did $140 this month.", "Paid revenue at OPUS LA this month so far is $140 across 3 orders.")).toBe(true);
    expect(numbersGrounded("OPUS did about $150 this month.", "Paid revenue at OPUS LA this month so far is $140 across 3 orders.")).toBe(false);
  });

  it("an ungrounded rewrite is discarded in favor of the record answers", async () => {
    const invoke = vi.fn(async () => ({
      id: "x",
      created: 0,
      model: "m",
      choices: [
        {
          index: 0,
          finish_reason: "tool_use",
          message: {
            role: "assistant" as const,
            content: JSON.stringify({
              calls: [
                { tool: "business_question", question: "OPUS this month", name: "", day: "today", terms: [] },
                { tool: "unpaid_orders", question: "", name: "", day: "today", terms: [] },
              ],
              answerable: "records",
              missing: "",
            }),
          },
        },
      ],
    }));
    const answer = await answerWithEncyclopedia(
      {
        tenantId: "default",
        operatorUserId: "adam-admin",
        dayDirectorActorId: "1",
        utterance: "Give me OPUS and who owes me",
        surface: "voice",
        history: [],
        now: new Date("2026-09-15T16:40:00Z"),
        timeZone: "America/Los_Angeles",
      },
      {
        invoke: invoke as never,
        invokeText: vi.fn(async () => "OPUS did about $150 and Carol owes $25.") as never,
        runTool: vi.fn(async (call: { tool: string }) =>
          call.tool === "unpaid_orders"
            ? { tool: "unpaid_orders" as const, text: "1 Goldline order is waiting on payment: Carol Wexler, $19.00, ready." }
            : { tool: "business_question" as const, text: "Paid revenue at OPUS LA this month so far is $140 across 3 orders." }
        ) as never,
      }
    );
    expect(answer).toEqual({
      kind: "answered",
      text: "Paid revenue at OPUS LA this month so far is $140 across 3 orders. 1 Goldline order is waiting on payment: Carol Wexler, $19.00, ready.",
    });
  });
});
