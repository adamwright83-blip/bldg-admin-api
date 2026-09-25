import { describe, expect, it, vi } from "vitest";
import { runBusinessQuery } from "../../analytics/businessQuery";
import { loadPaidOrderLedger } from "../../analytics/paidOrderLedger";
import {
  BUSINESS_TZ,
  businessCompleteness,
  businessFreshness,
  businessLoaders,
} from "../testSupport/claireBusinessFixture";
import { runClaireTurn, type ClaireTurnDeps, type ClaireTurnState } from "../turn/claireTurn";
import { commitBriefing, reconcileBriefing, speakBriefingCommit } from "./briefingCommit";
import { briefingClock } from "./briefingTiming";
import type { BriefingItem, ParsedBriefing } from "./briefingTypes";
import { parseBriefingDeterministically } from "./deterministicBriefing";
import { validateModelBriefing } from "./llmBriefing";
import { briefingAdditions, speakBriefingSummary } from "./speakBriefing";
import { reviseBriefing } from "./reviseBriefing";

/**
 * PRODUCTION REGRESSION — Tuesday September 15, 2026, 9:38 AM.
 *
 * Adam read Claire his morning in one turn. Claire heard "Pickup from dry
 * cleaner", asked about that alone, and lost everything else. This briefing
 * must always be understood as one bundle: completed work, today's work with
 * its timing, tomorrow's work, and "It's 9:30am" as the time of day — never
 * as a task time.
 */

const NOW = new Date("2026-09-15T16:38:00.000Z");
const clock = briefingClock(NOW, BUSINESS_TZ);
const TODAY = "2026-09-15";
const TOMORROW = "2026-09-16";

const SEPTEMBER_15_BRIEFING = `Delivered John's order.

It's 9:30am on Tuesday September 15th.

Agenda:

Pickup from two dry cleaning orders from Coast 1hr Dry Cleaners, for Yassie & Carol

Pickup KITH TREATS aprons on Rodeo Drive anytime from now to noon

Pickup OPUS LA gym towels

Drive to Lugos Lavanderia

Deposit laundromat money for payroll

Make three black bows

7pm: Deliver gym towels to OPUS LA

Tomorrow, Wednesday September 16th:

9 - 10am window: Deliver Carol & Yassie dry cleaning orders to Century Park East.`;

const SEPTEMBER_15_SPOKEN = SEPTEMBER_15_BRIEFING.replace(/\n+/g, " ").replace(/\s+/g, " ");

/** The turns the phone actually delivered on that call (claire_conversation_turns 8, 10, 12). */
const PHONE_TURN_8 = "Yes, I have to.  Pick up from the dry cleaners this morning.  For Yazzie and Carol.  And then I have to pick up from kit treats on Rodeo Drive.";
const PHONE_TURN_10 =
  "And create down.  Then I have to drive to lugo's Lavon, Zaria are processing center.  Then I have to deposit laundromat money for payroll.  Then I have to make three black bows while Elizabeth processes orders.  And then I have to deliver Jim towels to  open late.";
const PHONE_TURN_12 = "and then tomorrow morning, I have to deliver  dry cleaning orders, to Century Park, East for Carol and Yazzie.";

function find(parsed: ParsedBriefing, pattern: RegExp): BriefingItem {
  const item = parsed.items.find(candidate => pattern.test(candidate.title));
  if (!item) throw new Error(`no item matching ${pattern}: ${parsed.items.map(i => i.title).join(" | ")}`);
  return item;
}

function expectSeptember15(parsed: ParsedBriefing) {
  const completed = parsed.items.filter(item => item.kind === "completed");
  const today = parsed.items.filter(item => item.kind === "new_work" && item.businessDate === TODAY);
  const tomorrow = parsed.items.filter(item => item.kind === "new_work" && item.businessDate === TOMORROW);
  expect(completed.map(item => item.title)).toEqual(["Delivered John's order"]);
  expect(today).toHaveLength(7);
  expect(tomorrow).toHaveLength(1);

  const coast = find(parsed, /Coast 1hr Dry Cleaners/);
  expect(coast.people).toEqual(expect.arrayContaining(["Yassie", "Carol"]));
  expect(coast.quantity).toBe(2);
  expect(coast.timing.kind).toBe("none");

  expect(find(parsed, /KITH TREATS aprons on Rodeo Drive/).timing).toMatchObject({ kind: "before", end: "12:00" });
  expect(find(parsed, /OPUS LA gym towels/).timing.kind).toBe("none");
  expect(find(parsed, /Lugos Lavanderia/).businessDate).toBe(TODAY);
  expect(find(parsed, /Deposit laundromat money for payroll/).businessDate).toBe(TODAY);
  expect(find(parsed, /Make three black bows/).quantity).toBe(3);
  expect(find(parsed, /Deliver gym towels to OPUS LA/).timing).toMatchObject({ kind: "at", start: "19:00" });

  const delivery = tomorrow[0]!;
  expect(delivery.title).toMatch(/Century Park East/);
  expect(delivery.people).toEqual(expect.arrayContaining(["Carol", "Yassie"]));
  expect(delivery.timing).toMatchObject({ kind: "window", start: "09:00", end: "10:00" });

  // "It's 9:30am" is the time of day, never a task time.
  expect(parsed.context.join(" ")).toMatch(/9:30am/);
  for (const item of parsed.items) {
    expect(JSON.stringify(item.timing)).not.toContain("09:30");
  }
}

describe("September 15 production briefing — understood as one bundle", () => {
  it("typed with line breaks: 1 completed, 7 today, 1 tomorrow, time of day kept as context", () => {
    expectSeptember15(parseBriefingDeterministically(SEPTEMBER_15_BRIEFING, clock));
  });

  it("spoken as one continuous turn: the same understanding as typed", () => {
    expectSeptember15(parseBriefingDeterministically(SEPTEMBER_15_SPOKEN, clock));
  });

  it("Claire says she understood the whole day before asking anything, and asks once", () => {
    const parsed = parseBriefingDeterministically(SEPTEMBER_15_SPOKEN, clock);
    const { text, asksConfirmation } = speakBriefingSummary({ parsed, today: TODAY, surface: "voice" });
    expect(asksConfirmation).toBe(true);
    expect(text).toMatch(/^Got it\. You delivered John's order\. For today: /);
    for (const expected of ["Coast 1hr Dry Cleaners", "KITH TREATS aprons on Rodeo Drive before noon", "OPUS LA gym towels", "Lugos Lavanderia", "payroll", "three black bows", "OPUS LA at 7 PM"]) {
      expect(text).toContain(expected);
    }
    expect(text).toContain("Tomorrow: deliver Carol & Yassie dry cleaning orders to Century Park East between 9 and 10 AM.");
    expect(text.match(/\?/g)).toHaveLength(1);
    expect(text).toMatch(/Want me to put all of that on the Day Line\?$/);
  });

  it("the fragments the phone actually delivered become work, not 'Yes, I have to' or 'For Yazzie and Carol'", () => {
    const turn8 = parseBriefingDeterministically(PHONE_TURN_8, clock);
     expect(turn8.items.map(item => item.title)).toEqual([
      "Pick up from dry cleaners for Yazzie and Carol",
      "Pick up from kit treats on Rodeo Drive",
    ]);
    const turn10 = parseBriefingDeterministically(PHONE_TURN_10, clock);
    expect(turn10.items).toHaveLength(4);
    expect(turn10.unparsed).toEqual(["And create down"]);
    const turn12 = parseBriefingDeterministically(PHONE_TURN_12, clock);
    expect(turn12.items).toHaveLength(1);
    expect(turn12.items[0]).toMatchObject({ businessDate: TOMORROW, place: "Century Park East" });
    expect(turn12.items[0]!.people).toEqual(expect.arrayContaining(["Carol", "Yazzie"]));
  });
});

describe("natural briefing forms", () => {
  it("a customer filter using order as a noun is a question, not work", () => {
    const parsed = parseBriefingDeterministically("Only people with more than one order.", clock);
    expect(parsed.items).toEqual([]);
    expect(parsed.questions).toEqual(["Only people with more than one order"]);
  });
  it("thread arithmetic using add as a verb is a question, not work", () => {
    const together = parseBriefingDeterministically("Add them together.", clock);
    expect(together.items).toEqual([]);
    expect(together.questions).toEqual(["Add them together"]);
    const summed = parseBriefingDeterministically("Sum those.", clock);
    expect(summed.items).toEqual([]);
    expect(summed.questions).toEqual(["Sum those"]);
  });
  it("today X, Y and Z, and tomorrow A", () => {
    const parsed = parseBriefingDeterministically(
      "Today I need to pick up Sophie's comforter, drop off the Maybourne flyers and call Todd, and tomorrow I need to deliver Rebecca's laundry.",
      clock
    );
    expect(parsed.items.filter(item => item.businessDate === TODAY).map(item => item.title)).toEqual([
      "Pick up Sophie's comforter",
      "Drop off the Maybourne flyers",
      "Call Todd",
    ]);
    expect(parsed.items.filter(item => item.businessDate === TOMORROW).map(item => item.title)).toEqual(["Deliver Rebecca's laundry"]);
  });

  it("I already did X. Still need Y and Z.", () => {
    const parsed = parseBriefingDeterministically("I already dropped off the Maybourne flyer. Still need to deposit the cash and order hangers.", clock);
    expect(parsed.items.map(item => [item.kind, item.title])).toEqual([
      ["completed", "I already dropped off the Maybourne flyer"],
      ["new_work", "Deposit the cash"],
      ["new_work", "Order hangers"],
    ]);
  });

  it("before noon A and B, sometime this afternoon C, and at 7 D", () => {
    const parsed = parseBriefingDeterministically(
      "Before noon pick up OPUS towels and swing by Coast, sometime this afternoon restock detergent, and at 7 deliver the towels back to OPUS.",
      clock
    );
    expect(parsed.items.map(item => [item.title, item.timing.kind === "none" ? null : item.timing.label])).toEqual([
      ["Pick up OPUS towels", "before noon"],
      ["Swing by Coast", "before noon"],
      ["Restock detergent", "this afternoon"],
      ["Deliver the towels back to OPUS", "at 7 PM"],
    ]);
  });

  it("long shorthand with names, places, quantities, tomorrow, and a business question", () => {
    const parsed = parseBriefingDeterministically(
      "Morning. John is already delivered. I need Coast for Carol and Yassie, KITH before noon, OPUS towels, Lugo's, payroll deposit, three bows, and OPUS back at seven. Carol and Yassie go back tomorrow between nine and ten. By the way, how much has John spent with me this year?",
      clock
    );
    expect(parsed.items.filter(item => item.kind === "completed").map(item => item.title)).toEqual(["John is already delivered"]);
    expect(parsed.items.filter(item => item.kind === "new_work" && item.businessDate === TODAY)).toHaveLength(7);
    expect(find(parsed, /^KITH$/).timing).toMatchObject({ kind: "before", end: "12:00" });
    expect(find(parsed, /^OPUS back$/).timing).toMatchObject({ kind: "at", start: "19:00" });
    expect(find(parsed, /Carol and Yassie go back/)).toMatchObject({ businessDate: TOMORROW, timing: { kind: "window", start: "09:00", end: "10:00" } });
    expect(parsed.questions).toEqual(["how much has John spent with me this year?"]);
    expect(parsed.items.every(item => item.needs === null)).toBe(true);
  });

  it("a feeling about revenue is not work", () => {
    const parsed = parseBriefingDeterministically("Revenue has been rough lately and I'm frustrated about it, honestly it keeps me up at night.", clock);
    expect(parsed.items).toEqual([]);
  });

  it("one unclear item gets one question without blocking the clear ones", () => {
    const parsed = parseBriefingDeterministically("Pick up the OPUS towels, deliver Rebecca's laundry, and drop it off.", clock);
    const { text } = speakBriefingSummary({ parsed, today: TODAY, surface: "voice" });
    expect(parsed.items).toHaveLength(3);
    expect(text).toContain("pick up the OPUS towels");
    expect(text).toContain('One thing: Which order is "Drop it off" for?');
    expect(text).toMatch(/Want me to put all of that on the Day Line\?$/);
  });
});

describe("existing work and truthful saving", () => {
  it("work already on the Day Line is recognized instead of added again", () => {
    const parsed = parseBriefingDeterministically(SEPTEMBER_15_SPOKEN, clock);
    const reconciled = reconcileBriefing(parsed, [{ id: "c-kith", title: "Pickup KITH TREATS aprons", businessDate: TODAY, status: "open" }], null);
    expect(find(reconciled, /KITH/).existing).toMatchObject({ id: "c-kith", source: "day_line" });
    expect(briefingAdditions(reconciled).some(item => /KITH/.test(item.title))).toBe(false);
    expect(speakBriefingSummary({ parsed: reconciled, today: TODAY, surface: "voice" }).text).toContain("is already on your line");
  });

  it("campaign work is not re-added as new work", () => {
    const parsed = parseBriefingDeterministically("Visit three more Greystar properties and pick up the OPUS towels.", clock);
    const reconciled = reconcileBriefing(parsed, [], { active: true, remainingCount: 7, completedCount: 3 } as never);
    expect(find(reconciled, /Greystar/).existing?.source).toBe("campaign");
  });

  it("commit writes each new item once on its own day, logs done work, and reports only what saved", async () => {
    const parsed = parseBriefingDeterministically(SEPTEMBER_15_SPOKEN, clock);
    const accepted: Array<{ businessDate: string; title: string; promptKey: string }> = [];
    const accept = vi.fn(async (input: { businessDate: string; proposal: { title: string; promptKey: string } }) => {
      accepted.push({ businessDate: input.businessDate, title: input.proposal.title, promptKey: input.proposal.promptKey });
      return { id: `id-${accepted.length}` };
    });
    const complete = vi.fn(async () => ({ ok: true as const, alreadyCompleted: false }));
    const update = vi.fn(async () => ({ ok: true as const, id: "x" }));
    const result = await commitBriefing(parsed, { tenantId: "default", dayDirectorActorId: "1", conversationKey: "call-1" }, {
      accept: accept as never,
      complete: complete as never,
      update: update as never,
    });
    expect(result.added).toHaveLength(8);
    expect(result.completed).toHaveLength(1);
    expect(accepted.filter(entry => entry.businessDate === TOMORROW)).toHaveLength(1);
    expect(new Set(accepted.map(entry => entry.promptKey)).size).toBe(accepted.length);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(speakBriefingCommit(result, TODAY)).toBe("Done. 7 on today's line, 1 on tomorrow's line, and 1 marked done.");

    const again = await commitBriefing(parsed, { tenantId: "default", dayDirectorActorId: "1", conversationKey: "call-1" }, {
      accept: accept as never,
      complete: complete as never,
      update: update as never,
    });
    expect(again.added.map(item => item.title)).toEqual(result.added.map(item => item.title));
    expect(accepted.slice(0, 9).map(entry => entry.promptKey)).toEqual(accepted.slice(9).map(entry => entry.promptKey));
  });

  it("a failed save is spoken as a failure, never as done", async () => {
    const parsed = parseBriefingDeterministically("Pick up OPUS towels and call Todd.", clock);
    const accept = vi.fn(async (input: { proposal: { title: string } }) => {
      if (/Todd/.test(input.proposal.title)) throw new Error("Database not available");
      return { id: "ok-1" };
    });
    const result = await commitBriefing(parsed, { tenantId: "default", dayDirectorActorId: "1", conversationKey: "call-2" }, {
      accept: accept as never,
      complete: vi.fn() as never,
      update: vi.fn(async () => ({ ok: true as const, id: "x" })) as never,
    });
    const spoken = speakBriefingCommit(result, TODAY);
    expect(spoken).toBe("I saved 1 item, but 1 didn't save: Call Todd. Want me to try those again?");
    expect(spoken).not.toMatch(/^Done/);
  });
});

describe("model understanding is only kept where it is grounded in Adam's words", () => {
  it("drops invented work, time-of-day leaks, and unsupported days; allows known names for mishearings", () => {
    const validated = validateModelBriefing(
      {
        items: [
          { kind: "new_work", title: "Deliver gym towels to OPUS LA", quote: "deliver Jim towels to open late", day: "today", date: "", timingWords: "", quantity: 0, people: [], place: "OPUS LA", needs: "" },
          { kind: "new_work", title: "Pick up from Coast", quote: "Pick up from the dry cleaners this morning", day: "today", date: "", timingWords: "9:30am", quantity: 0, people: ["Yazzie", "Carol"], place: "", needs: "" },
          { kind: "new_work", title: "Buy a new van", quote: "buy a new van", day: "today", date: "", timingWords: "", quantity: 1, people: [], place: "", needs: "" },
          { kind: "new_work", title: "Make three black bows", quote: "make three black bows", day: "tomorrow", date: "", timingWords: "", quantity: 3, people: ["Elizabeth", "Madeline"], place: "", needs: "" },
        ],
        context: ["It's 9:30am"],
        questions: ["What is my profit?"],
      },
      {
        tenantId: "default",
        utterance: `It's 9:30am. ${PHONE_TURN_8} ${PHONE_TURN_10}`,
        clock,
        vocabulary: ["OPUS LA", "Coast 1hr Dry Cleaners"],
      }
    );
    expect(validated.items.map(item => item.title)).toEqual(["Deliver gym towels to OPUS LA", "Pick up from Coast", "Make three black bows"]);
    expect(validated.items[1]!.timing).toEqual({ kind: "daypart", label: "this morning" });
    expect(validated.items[2]!.businessDate).toBe(TODAY);
    expect(validated.items[2]!.quantity).toBe(3);
    expect(validated.items[2]!.people).toEqual(["Elizabeth"]);
    expect(validated.questions).toEqual([]);
  });
});

// ── The same call, through Claire's turn orchestration ─────────────────────

function turnDeps(overrides: Partial<ClaireTurnDeps> = {}): ClaireTurnDeps {
  return {
    now: () => NOW,
    timeZone: () => BUSINESS_TZ,
    business: {
      now: () => NOW,
      timeZone: () => BUSINESS_TZ,
      plan: async () => null,
      runQuery: (tenantId, query) =>
        runBusinessQuery(tenantId, query, {
          loadLedger: input => loadPaidOrderLedger(input, businessLoaders()),
          loadOpenOrders: async () => ({ openTotal: 2, byStatus: {}, awaitingPayment: 1 }),
          loadCompleteness: async () => businessCompleteness,
          loadFreshness: async () => businessFreshness(),
          now: () => NOW,
          timeZone: () => BUSINESS_TZ,
        }),
    },
    commitment: vi.fn(async () => ({ kind: "not_applicable" as const })) as never,
    followUp: vi.fn(async () => "Brief follow-up.") as never,
    extractModel: null,
    loadExisting: async () => [],
    commit: vi.fn(async (parsed: ParsedBriefing) => ({
      added: parsed.items.filter(item => item.kind === "new_work" && !item.existing),
      completed: parsed.items.filter(item => item.kind === "completed"),
      failed: [],
      commitmentIds: parsed.items.map((_, index) => `c-${index}`),
      receipts: parsed.items.map((item, index) => ({
        claimedState: item.kind === "completed" ? ("completed" as const) : ("created" as const),
        entityId: `c-${index}`,
        statement: item.title,
      })),
    })) as never,
    campaign: async () => null,
    vocabulary: async () => [],
    accounts: async () => [],
    accountHistory: vi.fn() as never,
    commitFollowUp: vi.fn() as never,
    dayWork: vi.fn() as never,
    unpaid: vi.fn() as never,
    searchMemory: vi.fn(async () => []) as never,
    memoryBetween: vi.fn(async () => []) as never,
    encyclopedia: null,
    ...overrides,
  };
}

function turn(state: ClaireTurnState, utterance: string, deps: ClaireTurnDeps, surface: "voice" | "text" = "voice", allowFragmentWait = false) {
  return runClaireTurn(
    { tenantId: "default", operatorUserId: "adam-admin", dayDirectorActorId: "1", surface, utterance, state, conversationKey: "claire-call:test", allowFragmentWait },
    deps
  );
}

async function speakThenFlush(state: ClaireTurnState, fragments: string[], deps: ClaireTurnDeps) {
  for (const fragment of fragments) {
    const held = await turn(state, fragment, deps, "voice", true);
    if (!held.listenOnly) return held;
  }
  const pending = state.pendingFragment ?? "";
  state.pendingFragment = null;
  state.fragmentHolds = 0;
  return turn(state, pending, deps, "voice", false);
}



describe("September 25 production regression — held day schedule", () => {
  it("delivery language never removes matching held work", () => {
    const held = parseBriefingDeterministically(
      "I have to process Rebecca and Ashley.",
      clock
    );
    expect(held.items.map(item => item.title)).toContain("Process Rebecca and Ashley");

    const revised = reviseBriefing(
      held,
      "Then I have to drive to Opus LA at night to drop off Ashley's order.",
      clock
    );

    expect(revised.changes).toEqual([]);
    expect(revised.parsed.items.map(item => item.title)).toContain("Process Rebecca and Ashley");
  });

  it("additional dictated work extends the held briefing until one final yes saves the whole bundle", async () => {
    const deps = turnDeps();
    const initial = parseBriefingDeterministically(
      "At 9:30 AM I have to pick up from the dry cleaner, and at 10 AM I have to pick up Rebecca.",
      clock
    );
    expect(initial.items).toHaveLength(2);

    const state: ClaireTurnState = {
      pendingBriefing: { parsed: initial, createdAt: NOW.getTime() },
    };

    await turn(
      state,
      "At 10:30 AM, I have to meet Ashley at OPUS LA while I drop off Jim's towels.",
      deps
    );
    await turn(
      state,
      "At 11:15 AM I have to drop off two dry cleaning orders at Century Park East, and at noon I have to drop off Todd in Beverly Hills.",
      deps
    );
    await turn(
      state,
      "At 12:45 PM I have to drop off Malcolm in Koreatown, and then I have to drive to Lugos, and then I have to process Rebecca and Ashley.",
      deps
    );

    const beforeNightRun = state.pendingBriefing?.parsed.items.map(item => item.title) ?? [];
    expect(beforeNightRun).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/dry cleaner/i),
        expect.stringMatching(/Rebecca/i),
        expect.stringMatching(/Ashley.*OPUS|OPUS.*Ashley/i),
        expect.stringMatching(/Century Park East/i),
        expect.stringMatching(/Todd/i),
        expect.stringMatching(/Malcolm/i),
        expect.stringMatching(/Lugos/i),
        expect.stringMatching(/Process Rebecca and Ashley/i),
      ])
    );

    await turn(
      state,
      "Then I have to drive to Opus LA at night to drop off Ashley's order.",
      deps
    );

    const heldItems = state.pendingBriefing?.parsed.items ?? [];
    const heldTitles = heldItems.map(item => item.title);
    expect(heldTitles).toContain("Process Rebecca and Ashley");
    expect(heldItems.some(item => /drop off Ashley's order/i.test(item.quote))).toBe(true);
    expect(heldTitles.length).toBeGreaterThanOrEqual(9);

    const saved = await turn(state, "Yes.", deps);
    expect(saved.kind).toBe("briefing_saved");
    expect(deps.commit).toHaveBeenCalledTimes(1);
    const committed = (deps.commit as ReturnType<typeof vi.fn>).mock.calls[0]![0] as ParsedBriefing;
    expect(committed.items.map(item => item.title)).toEqual(expect.arrayContaining(heldTitles));
    expect(committed.items.length).toBe(heldTitles.length);
    expect(state.pendingBriefing).toBeNull();
  });
});

describe("the September 15 call, replayed through Claire", () => {
  it("one spoken briefing → one summary → one yes → everything saved", async () => {
    const deps = turnDeps();
    const state: ClaireTurnState = {};
    const proposed = await turn(state, SEPTEMBER_15_SPOKEN, deps);
    expect(proposed.kind).toBe("briefing_proposed");
    expect(proposed.speak).toMatch(/^Got it\. You delivered John's order\. For today: /);
    expect(state.pendingBriefing?.parsed.items).toHaveLength(9);
    const saved = await turn(state, "Yes.", deps);
    expect(deps.commit).toHaveBeenCalledTimes(1);
    expect(saved.speak).toBe("Done. 7 on today's line, 1 on tomorrow's line, and 1 marked done.");
    expect(state.pendingBriefing).toBeNull();
  });

  it("the three fragments the phone delivered stitch into one briefing instead of answering mid-thought", async () => {
    const deps = turnDeps();
    const state: ClaireTurnState = {};
    const proposed = await speakThenFlush(state, [PHONE_TURN_8, PHONE_TURN_10, PHONE_TURN_12], deps);
    expect(proposed.kind).toBe("briefing_proposed");
    expect(proposed.speak).not.toMatch(/Sorry/);
    expect(state.pendingBriefing?.parsed.items.length).toBeGreaterThanOrEqual(6);
    expect(state.pendingBriefing?.parsed.items.filter(item => item.businessDate === TOMORROW)).toHaveLength(1);
    await turn(state, "Yes.", deps);
    expect((deps.commit as ReturnType<typeof vi.fn>).mock.calls[0]![0].items.length).toBeGreaterThanOrEqual(6);
  });

  it("a thought cut off at a pause waits for the rest instead of being answered", async () => {
    const deps = turnDeps();
    const state: ClaireTurnState = {};
    const waiting = await turn(state, "Desired timing is.", deps, "voice", true);
    expect(waiting).toMatchObject({ kind: "listening", listenOnly: true, speak: "" });
    const answered = await speakThenFlush(state, ["before noon for the KITH pickup and at 7 deliver the OPUS towels."], deps);
    expect(answered.kind).toBe("briefing_proposed");
    expect(state.history?.[0]?.text).toBe("Desired timing is. before noon for the KITH pickup and at 7 deliver the OPUS towels.");
  });

  it("a single proposal Claire was waiting on is folded into new work, not discarded", async () => {
    const deps = turnDeps();
    const state: ClaireTurnState = {
      pendingProposal: {
        promptKey: "commitment:x",
        title: "Pick up from dry cleaners",
        kind: "operations",
        quantity: 2,
        sourceText: "Pick up from the dry cleaners this morning for Yazzie and Carol.",
        prerequisites: [],
        question: null,
        intelligence: "anthropic",
      },
    };
    const result = await turn(state, PHONE_TURN_10, deps);
    expect(result.kind).toBe("briefing_proposed");
    expect(state.pendingProposal).toBeNull();
    expect(state.pendingBriefing?.parsed.items.map(item => item.title)).toContain("Pick up from dry cleaners");
    expect(deps.commitment).not.toHaveBeenCalled();
  });

  it("'no longer a good opportunity, so we can remove that' is a cancel request, not a 'no'", async () => {
    const commitment = vi.fn(async () => ({ kind: "cancelled" as const, speak: "Took Maybourne off today.", sourceId: "m1" }));
    const deps = turnDeps({ commitment: commitment as never });
    const state: ClaireTurnState = { clarifyingUtterance: "I already. I don't." };
    const result = await turn(state, "Maybourne is no longer a good opportunity, so we can remove that.", deps);
    expect(result.speak).toBe("Took Maybourne off today.");
    expect(commitment).toHaveBeenCalledTimes(1);
    expect(state.clarifyingUtterance).toBeNull();
  });

  it("mixed intent: answers John's spend from the ledger and holds Friday's pickup for confirmation", async () => {
    const deps = turnDeps();
    const state: ClaireTurnState = {};
    const result = await turn(state, "How much has John spent with us, and remind me to pick his laundry up Friday.", deps, "text");
    expect(result.kind).toBe("briefing_saved");
    expect(result.speak).toContain("John Cunningham has spent $476 across 7 paid orders");
    expect(result.speak).toMatch(/Done\./);
    expect(result.speak).not.toMatch(/Want me to put that on the Day Line\?$/);
  });
});
