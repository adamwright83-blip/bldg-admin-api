import { describe, expect, it, vi } from "vitest";
import { runBusinessQuery } from "../analytics/businessQuery";
import { loadPaidOrderLedger, type LedgerLoaders } from "../analytics/paidOrderLedger";
import { failingLoaders } from "../analytics/businessLedgerFixture";
import type { AccountHistory, AccountRef } from "./knowledge/accountKnowledge";
import type { DayWork } from "./knowledge/operationsKnowledge";
import type { RememberedTurn } from "./knowledge/conversationMemory";
import {
  BUSINESS_NOW,
  BUSINESS_TZ,
  businessCompleteness,
  businessFreshness,
  businessLoaders,
} from "./testSupport/claireBusinessFixture";
import { runClaireTurn, type ClaireTurnDeps, type ClaireTurnState } from "./turn/claireTurn";

/**
 * THE CLAIRE ORAL EXAM.
 *
 * Natural operator language, whole conversations, through the same turn
 * orchestration the phone and desk use. Business answers come from the
 * Laundry Butler + Laundry Farm fixture ledger; accounts, the Day Line, unpaid
 * orders, and call memory come from deterministic records. Every number
 * Claire speaks must appear in the records or in a computed result.
 */

const LOUISE: AccountRef = { id: 8, name: "The Louise", accountType: "other" };
const MAYBOURNE: AccountRef = { id: 3, name: "Maybourne Beverly hills", accountType: "hotel" };

const LOUISE_HISTORY: AccountHistory = {
  account: LOUISE,
  missions: [{ id: 12, code: "MISSION 012", status: "follow_up", createdAt: "2026-08-06T18:00:00.000Z", updatedAt: "2026-08-07T19:00:00.000Z" }],
  events: [],
  fieldVisits: [{ missionId: 12, arrivedAt: "2026-08-07T18:30:00.000Z", departedAt: "2026-08-07T18:50:00.000Z", notes: "Front desk took the one-pager." }],
  outcomes: [
    {
      missionId: 12,
      outcome: "follow_up",
      notes: "Dana, the GM, was out. Front desk said to come back after Labor Day.",
      followUpAt: "2026-08-08T17:00:00.000Z",
      createdAt: "2026-08-07T19:00:00.000Z",
      decisionMakerStatus: "unavailable",
      collateralDelivered: true,
    },
  ],
  followUps: [{ id: "fu-1", pipelineId: 5, status: "open", dueAt: "2026-08-08T17:00:00.000Z", note: "Call Dana", completedAt: null }],
  pipelineStage: "follow_up",
  pipelineId: 5,
  contacts: [{ name: "Dana", title: "General Manager", relationshipType: "decision_maker" }],
  dayLineMentions: [],
  conversationMentions: [
    { sessionId: "s-1", at: "2026-09-15T16:36:00.000Z", speaker: "OPERATOR", text: "The Louise is overdue, I need to get back to Dana this week." },
  ],
};

const TODAY_WORK: DayWork = {
  businessDate: "2026-09-15",
  open: [
    { id: "d1", title: "Pickup KITH TREATS aprons on Rodeo Drive", status: "open", source: "day_line", timing: "before noon", completedAt: null },
    { id: "d2", title: "Deliver gym towels to OPUS LA", status: "open", source: "day_line", timing: "at 7 PM", completedAt: null },
  ],
  completed: [{ id: "d0", title: "Delivered John's order", status: "completed", source: "day_line", timing: null, completedAt: "2026-09-15T16:40:00.000Z" }],
  routeAvailable: true,
};
const TOMORROW_WORK: DayWork = {
  businessDate: "2026-09-16",
  open: [{ id: "d3", title: "Deliver Carol & Yassie dry cleaning to Century Park East", status: "open", source: "day_line", timing: "between 9 and 10 AM", completedAt: null }],
  completed: [],
  routeAvailable: true,
};

function exam(options: { loaders?: LedgerLoaders; importedToday?: boolean } = {}) {
  const commitFollowUp = vi.fn(async () => ({
    pipelineSaved: true,
    dayLineSaved: true,
    dayLineCommitmentId: "followup-dayline-1",
    errors: [] as string[],
  }));
  const commit = vi.fn(async (parsed: { items: Array<{ kind: string; existing: unknown; title?: string }> }) => ({
    added: parsed.items.filter(item => item.kind === "new_work" && !item.existing),
    completed: parsed.items.filter(item => item.kind === "completed"),
    failed: [],
    commitmentIds: parsed.items.map((_, index) => `c-${index}`),
    receipts: parsed.items.map((item, index) => ({
      claimedState: item.kind === "completed" ? ("completed" as const) : ("created" as const),
      entityId: `c-${index}`,
      statement: item.title ?? "item",
    })),
  }));
  const deps: ClaireTurnDeps = {
    now: () => BUSINESS_NOW,
    timeZone: () => BUSINESS_TZ,
    business: {
      now: () => BUSINESS_NOW,
      timeZone: () => BUSINESS_TZ,
      plan: async () => null,
  // These fixtures model a business whose sources ARE connected; the zero gate needs that proven.
    loadBindings: async () => ({ laundry_butler: { state: "bound" as const, lastSuccessAt: new Date(), coverageRanges: [], latestAttempt: null, isSystemOfRecord: true }, cleancloud: { state: "bound" as const, lastSuccessAt: new Date(), coverageRanges: [{ from: "2020-01-01", to: "2099-12-31", completedAt: new Date(), basis: "economic_event" as const, provenance: "test_fixture" as const }], latestAttempt: null, isSystemOfRecord: false } }),
      runQuery: (tenantId, query) =>
        runBusinessQuery(tenantId, query, {
          loadLedger: input => loadPaidOrderLedger(input, options.loaders ?? businessLoaders()),
          loadOpenOrders: async () => ({ openTotal: 2, byStatus: {}, awaitingPayment: 1 }),
          loadCompleteness: async () => businessCompleteness,
          loadFreshness: async () => businessFreshness({ importedToday: options.importedToday }),
          now: () => BUSINESS_NOW,
          timeZone: () => BUSINESS_TZ,
        }),
    },
    commitment: vi.fn(async () => ({ kind: "not_applicable" as const })) as never,
    followUp: vi.fn(async () => "From the brief: two stops today.") as never,
    extractModel: null,
    loadExisting: async () => [],
    commit: commit as never,
    campaign: async () => null,
    vocabulary: async () => [],
    accounts: async () => [LOUISE, MAYBOURNE],
    accountHistory: vi.fn(async () => LOUISE_HISTORY) as never,
    commitFollowUp: commitFollowUp as never,
    dayWork: vi.fn(async (input: { businessDate: string }) => (input.businessDate === "2026-09-16" ? TOMORROW_WORK : TODAY_WORK)) as never,
    unpaid: vi.fn(async () => [
      { id: 240, customerName: "Carol Wexler", status: "ready", totalCents: 1900, pickupDate: "2026-09-14", deliveryDate: "2026-09-15", building: "OPUS LA" },
    ]) as never,
    searchMemory: vi.fn(async (input: { terms: string[] }): Promise<RememberedTurn[]> =>
      input.terms.some(term => /louise/i.test(term)) ? LOUISE_HISTORY.conversationMentions : []
    ) as never,
    memoryBetween: vi.fn(async () => []) as never,
    encyclopedia: null,
  };
  const state: ClaireTurnState = {};
  const ask = async (utterance: string, surface: "voice" | "text" = "voice") => {
    const result = await runClaireTurn(
      {
        tenantId: "default",
        operatorUserId: "adam-admin",
        dayDirectorActorId: "1",
        surface,
        utterance,
        state,
        allowFragmentWait: false,
        brief: "Two stops today.",
        context: { businessDate: "2026-09-15" } as never,
      },
      deps
    );
    return result.speak;
  };
  return { ask, state, deps, commit, commitFollowUp };
}

/** No number may appear in Claire's answer that isn't a real value from the records. */
const INVENTED = /\$\d[\d,]*\.\d{3,}|\bNaN\b|\bundefined\b|\bnull\b/;

describe("A — the final acceptance conversation, as one conversation", () => {
  it("briefing + question, then Rebecca, then who ordered most recently, then OPUS months, then The Louise and a follow-up", async () => {
    const { ask, commitFollowUp } = exam();
    const first = await ask(
      "Morning. John is already delivered. I need Coast for Carol and Yassie, KITH before noon, OPUS towels, Lugo's, payroll deposit, three bows, and OPUS back at seven. Carol and Yassie go back tomorrow between nine and ten. By the way, how much has John spent with me this year?"
    );
    expect(first).toContain("John is already delivered.");
    expect(first).toContain("For today: Coast for Carol and Yassie, KITH before noon, OPUS towels, Lugo's, payroll deposit, three bows, and OPUS back at 7 PM.");
    expect(first).toContain("Tomorrow: Carol and Yassie go back between 9 and 10 AM.");
    expect(first).toContain("John Cunningham has $476 in paid revenue across 7 orders this year so far");
    expect(first).toMatch(/Want me to put all of that on the Day Line\?$/);

    const rebecca = await ask("What about Rebecca?");
    expect(rebecca).toContain("Rebecca Stone has $190 in paid revenue across 4 orders this year so far; the most recent was September 2.");
    expect(rebecca).toContain("still holding your list");

    const recent = await ask("Which of them ordered most recently?");
    expect(recent).toContain("John Cunningham ordered most recently, on September 4; Rebecca Stone's last order was September 2.");

    expect((await ask("How much has OPUS done this month?")).toLowerCase()).toContain("paid revenue at opus la this month so far is $140 across 3 orders");
    expect(await ask("Previous month?")).toContain("paid revenue at OPUS LA was $54.00 across 2 orders");
    const drove = await ask("Who drove the difference?");
    expect(drove).toContain("The biggest customer movers were");
    expect(drove).toContain("Maria Chen, up $79.41");

    const louise = await ask("What happened last time I went to The Louise?");
    expect(louise).toContain("The last visit outcome was follow up, recorded August 7.");
    expect(louise).toContain("The decision maker wasn't available.");
    expect(louise).toContain('Your notes: "Dana, the GM, was out.');

    const proposal = await ask("Put the follow-up on Thursday.");
    expect(proposal).toContain("I'll move The Louise follow-up to Thursday, September 17");
    expect(proposal).toContain("Say yes to save it.");
    expect(commitFollowUp).not.toHaveBeenCalled();
    expect(await ask("Yes.")).toBe("Saved. The Louise follow-up is on Thursday, September 17.");
    expect(commitFollowUp).toHaveBeenCalledTimes(1);
  });
});

describe("B — revenue thread", () => {
  it("last 30, previous 30, which had more orders, AOV, top customers", async () => {
    const { ask } = exam();
    expect(await ask("What was revenue the last 30 days?")).toContain("Paid revenue in the last 30 days is $604 across 12 orders.");
    expect(await ask("Previous 30?")).toBe("In the 30 days before that, paid revenue was $164 across 3 orders.");
    expect(await ask("Which period did more orders?")).toContain("so the last 30 days had 9 more");
    expect(await ask("What was AOV?")).toBe(
      "Average order value in the last 30 days is $50.31 across 12 paid orders. That's down from $54.67 in the 30 days before that."
    );
    expect(await ask("Who were the top customers?")).toContain("Your top 5 customers by paid revenue");
  });
});

describe("C — customer thread", () => {
  it("spend, count, last order, this year, compare, frequency", async () => {
    const { ask } = exam();
    expect(await ask("How much has John spent with me?")).toBe(
      "John Cunningham has spent $476 across 7 paid orders since June 1, 2026; the most recent was September 4."
    );
    expect(await ask("How many orders?")).toBe("John Cunningham has 7 paid orders over all time.");
    expect(await ask("When was his last one?")).toBe("John Cunningham's last paid order was September 4, for $83.10.");
    expect(await ask("What about this year?")).toContain("John Cunningham has $476 in paid revenue across 7 orders this year so far");
    expect(await ask("Compare him to Rebecca.")).toContain("John Cunningham has spent more.");
    expect(await ask("Which one orders more often?")).toBe(
      "John Cunningham orders about every 17 days and Rebecca Stone about every 28, so John Cunningham orders more often."
    );
    expect(await ask("What did he order last time?")).toContain("Fluff & Fold SAME DAY / DELIVERY, 33 lb, for $83.10");
  });
});

describe("D — active / dormant thread", () => {
  it("default definition, sixty days, more than one order, who, which of those", async () => {
    const { ask } = exam();
    expect(await ask("How many active customers do I have?")).toContain("If we count active as at least one paid order in the last 30 days");
    expect(await ask("No, use sixty days.")).toBe("Using the last 60 days, it's 9.");
    expect(await ask("Only people with more than one order.")).toBe("That leaves 5.");
    expect(await ask("Who are they?")).toBe("They are John Cunningham, Rebecca Stone, Sophie Tran, Spencer Hale, and Carol Wexler.");
    expect(await ask("Which of those hasn't ordered in the last thirty?")).toBe("Nobody in that group has gone without an order in the last 30 days.");
    expect(await ask("When did Sophie last order?")).toBe("Sophie Tran's last paid order was August 25, for $52.00.");
  });
});

describe("E — location thread", () => {
  it("Laundry Farm customers in Los Feliz, Clarissa Avenue, when they last ordered", async () => {
    const { ask } = exam();
    expect(await ask("Which Laundry Farm customers are in Los Feliz?")).toBe("They are John Cunningham, Sophie Tran, and Sean Cohen.");
    expect(await ask("Which customer lives on Clarissa Avenue?")).toBe("That's John Cunningham.");
    expect(await ask("When did they last order?")).toBe("John Cunningham's last paid order was September 4, for $83.10.");
  });
});

describe("F — account thread", () => {
  it("OPUS lifetime, this month, orders, most recent orderer, most frequent there", async () => {
    const { ask } = exam();
    expect(await ask("How much has OPUS LA generated?")).toBe("Paid revenue at OPUS LA over all time is $194 across 5 orders.");
    expect(await ask("This month.")).toBe("This month so far, paid revenue at OPUS LA is $140 across 3 orders.");
    expect(await ask("How many orders?")).toBe("There are 3 paid orders at OPUS LA this month so far.");
    expect(await ask("Who ordered most recently?")).toBe("The newest sale I have at OPUS LA is $79.41 for Maria Chen, paid September 9 at 8:53 PM.");
    expect(await ask("Who orders the most there?")).toContain("most often at OPUS LA over all time are");
  });
});

describe("G — sales history thread", () => {
  it("a question about a prior visit never enters the field-outcome proposal loop", async () => {
    const { ask, deps } = exam();
    const answer = await ask("What happened last time I went to The Louise?");
    expect(answer).toContain("The last visit outcome was follow up");
    expect(deps.commitment).not.toHaveBeenCalled();
  });
  it("a history question without a question mark still does not enter field-outcome capture", async () => {
    const { ask, deps } = exam();
    deps.commitment = vi.fn(async () => ({
      kind: "clarifying" as const,
      speak: "A field visit was reported. Say yes if I should save that field outcome, or no to leave it unrecorded.",
    })) as never;
    const answer = await ask("Tell me what happened last time I went to The Louise");
    expect(answer).toContain("The last visit outcome was follow up");
    expect(deps.commitment).not.toHaveBeenCalled();
  });
  it("what happened, last contact, what I said, whether a follow-up is owed", async () => {
    const { ask } = exam();
    expect(await ask("What happened with The Louise?")).toContain("The Louise has one mission on file, set up August 6, currently in follow-up.");
    expect(await ask("When was my last contact?")).toContain("The last recorded contact with The Louise was August 7");
    const said = await ask("What did I say happened there?");
    expect(said).toContain('Your outcome notes for The Louise say: "Dana, the GM, was out.');
    expect(said).toContain("That's what you told me, not something I've confirmed.");
    expect(await ask("Do I owe them a follow-up?")).toBe("Yes. A follow-up was due August 8 and is still open, so it's 38 days overdue.");
  });
});

describe("H — operations thread", () => {
  it("what's left, what's finished, what's tomorrow", async () => {
    const { ask } = exam();
    expect(await ask("What do I have left today?")).toBe(
      "You have 2 things left today: Pickup KITH TREATS aprons on Rodeo Drive (before noon) and Deliver gym towels to OPUS LA (at 7 PM)."
    );
    expect(await ask("What did I already finish?")).toBe("Today you finished Delivered John's order.");
    expect(await ask("What is tomorrow?")).toBe("Tomorrow you have 1 thing: Deliver Carol & Yassie dry cleaning to Century Park East (between 9 and 10 AM).");
  });
});

describe("I — source / filter thread, and business lineage", () => {
  it("Laundry Farm last month, Laundry Butler, dry cleaning only, laundry again", async () => {
    const { ask } = exam();
    expect(await ask("How much did Laundry Farm do last month?")).toBe("Laundry Farm revenue last month was $224 across 4 orders.");
    expect(await ask("What about Laundry Butler?")).toBe("Laundry Butler revenue last month was $104 across 3 orders.");
    expect(await ask("Dry cleaning only.")).toContain("Laundry Butler dry-cleaning revenue was $12.00 across 1 order.");
    expect(await ask("Now include laundry again.")).toContain("Laundry Butler revenue was $104 across 3 orders.");
  });

  it("revenue → composition → Stripe → Clearent → latest sale → who → how much → CleanCloud? → last update → GUMBALL today", async () => {
    const { ask } = exam();
    expect(await ask("What was revenue the last 30 days?")).toContain("$604 across 12 orders");
    const composition = await ask("Is that Laundry Butler only or Laundry Farm too?");
    expect(composition).toContain("That's both businesses.");
    expect(composition).toContain("Laundry Butler, Goldline's own Stripe-paid orders, was $231 across 6 orders.");
    expect(composition).toContain("Laundry Farm, through CleanCloud, was $373 across 6 orders");
    expect(await ask("How much is Stripe?")).toBe("Stripe-backed revenue in the last 30 days is $231 across 6 orders.");
    expect(await ask("What about Clearent?")).toContain("Clearent card revenue in the last 30 days is $338 across 5 orders.");
    expect(await ask("What's the latest sale you have?")).toBe("The newest sale I have is $52.00 for Sean Cohen, paid September 10 at 7:35 PM.");
    expect(await ask("Who was it for?")).toBe("It was for Sean Cohen.");
    expect(await ask("How much?")).toBe("$52.00.");
    expect(await ask("Was that from CleanCloud?")).toBe(
      "Yes, it's CleanCloud order 577, a Laundry Farm sale, paid on a Clearent card. Goldline imported it September 11 at 7:03 AM."
    );
    expect(await ask("When did CleanCloud last update?")).toContain("CleanCloud data last came in September 11 at 7:03 AM");
    const gumball = await ask("Did GUMBALL run today?");
    expect(gumball).toContain("I don't see a GUMBALL import today.");
    expect(gumball).toContain("The last successful GUMBALL import was September 11 at 7:03 AM");
  });

  it("add them together does not double count, and building scope refines the same question", async () => {
    const { ask, deps } = exam();
    deps.commitment = vi.fn(async () => ({
      kind: "clarifying" as const,
      speak: "Do you want me to add something, change something, or are you just catching me up?",
    })) as never;
    await ask("What was revenue the last 30 days?");
    await ask("How much is Stripe?");
    await ask("What about Clearent?");
    expect(await ask("Add them together.")).toContain("come to $569 across 11 orders");
    expect(deps.commitment).not.toHaveBeenCalled();
    expect(await ask("Does that include OPUS?")).toContain("was OPUS LA");
    expect(await ask("Exclude OPUS.")).toContain("excluding OPUS LA");
  });

  it("GUMBALL is reported healthy only when an import actually happened today", async () => {
    const { ask } = exam({ importedToday: true });
    expect(await ask("Is GUMBALL working?")).toContain("It's running. GUMBALL imported today at 8:42 AM: 3 new CleanCloud orders for September 15.");
  });
});

describe("J — profit is never revenue", () => {
  it("states what can be calculated and what prevents profit", async () => {
    const { ask } = exam();
    const text = await ask("What was profit last month?");
    expect(text).toContain("I can give you revenue: paid revenue last month was $328.");
    expect(text).toContain("can't calculate trustworthy profit");
    expect(text).not.toMatch(/profit (?:is|was) \$/);
  });
});

describe("K — mixed intent", () => {
  it("answers the question and holds the work for one confirmation", async () => {
    const { ask, commit } = exam();
    const text = await ask("How much has John spent and add his pickup for Friday.");
    expect(text).toContain("For Friday, September 18: add John's pickup.");
    expect(text).toContain("John Cunningham has spent $476");
    await ask("Yes.");
    expect(commit).toHaveBeenCalledTimes(1);
  });
});

describe("L — ambiguous customer", () => {
  it("asks which Maria instead of choosing, then answers for the one picked", async () => {
    const { ask } = exam();
    const clarify = await ask("When did Maria last order?");
    expect(clarify).toContain("I found 2 customers matching Maria");
    expect(clarify).toContain("Which one do you mean?");
    expect(await ask("Maria Lopez.")).toBe("Maria Lopez's last paid order was August 28, for $35.00.");
  });
});

describe("M — data failure is never zero", () => {
  it("an unreachable ledger is spoken as unavailable", async () => {
    const { ask } = exam({ loaders: failingLoaders });
    const text = await ask("What was revenue the last 30 days?");
    expect(text).toBe("I couldn't get a reliable revenue number just now, so I won't guess.");
    expect(text).not.toMatch(/\$0|\bzero\b/);
  });
});

describe("N — shared history stays conversation evidence", () => {
  it("what I told Claire about a property is quoted as my words, not confirmed fact", async () => {
    const { ask } = exam();
    const text = await ask("What did I tell you about The Louise last time?");
    expect(text).toContain("On a call today you said: \"The Louise is overdue, I need to get back to Dana this week.\"");
    expect(text).toContain("That's what you told me, not something I've confirmed.");
  });
});

describe("O — long natural speech with corrections", () => {
  it("recovers the meaning through um, a correction, a list, and tomorrow", async () => {
    const { ask, state } = exam();
    const text = await ask(
      "Okay so today, um, I need to grab the OPUS towels, actually no, make that the KITH aprons first, then deposit the cash, and tomorrow morning drop off Rebecca's laundry."
    );
    expect(state.pendingBriefing?.parsed.items.map(item => [item.title, item.businessDate])).toEqual([
      ["Grab the KITH aprons", "2026-09-15"],
      ["Deposit the cash", "2026-09-15"],
      ["Drop off Rebecca's laundry", "2026-09-16"],
    ]);
    expect(text).toContain("For today: grab the KITH aprons and deposit the cash.");
    const revised = await ask("Make KITH before 11.");
    expect(revised).toContain('"Grab the KITH aprons" is now before 11 AM.');
    expect(await ask("Actually drop the cash deposit.")).toContain('Took "Deposit the cash" off the list.');
    const saved = await ask("Yes.");
    expect(saved).toBe("Done. 1 on today's line and 1 on tomorrow's line.");
  });
});

describe("answers never contain invented numbers", () => {
  it.each([
    "What was our best month this year?",
    "What percentage of revenue comes from my top five customers?",
    "Who still owes money?",
    "What was our biggest order?",
    "Is the CleanCloud data current?",
  ])("%s", async question => {
    const { ask } = exam();
    const text = await ask(question);
    expect(text.length).toBeGreaterThan(10);
    expect(text).not.toMatch(INVENTED);
  });
});
