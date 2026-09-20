import { describe, expect, it, vi } from "vitest";
import type { BusinessQuery, BusinessQueryResult } from "../../analytics/businessQuery";
import type { OrderBrief } from "../../analytics/businessMetrics";
import { interpretTurn } from "./interpretTurn";
import { pendingItemIdentity, syncPendingReminderIdentity } from "./pendingIdentity";
import { runClaireTurn, type ClaireTurnDeps, type ClaireTurnState } from "./claireTurn";
import type { ParsedBriefing } from "../briefing/briefingTypes";
import { speakBusinessResult } from "../business/businessSpeech";
import { renderResponsePlan } from "./responsePlan";
import { planRoute } from "./routePlan";

/**
 * Stateful kernel corpus. Turns share one ClaireTurnState. These are not isolated
 * unit cases with a fresh interpreter each time — continuation, pending lifecycle,
 * and reminder identity require the prior turn to still be alive.
 */

const NOW = new Date("2026-09-20T18:00:00Z");
const T13_BOARD = "GUMBALL did not run today. Text Andrew is on the line. Mission 6. Synthetic verification follow-up.";

const LOUISE = {
  id: 11,
  name: "The Louise",
  accountType: "luxury_hotel",
  contacts: [{ name: "Dana", title: "General Manager" }],
};

function orderBrief(name: string, iso: string, cents: number, key: string): OrderBrief {
  return {
    eventKey: key,
    orderNumber: key,
    date: iso.slice(0, 10),
    occurredAt: iso,
    cents,
    source: "cleancloud",
    businessLine: "laundry_farm",
    processor: "clearent",
    building: null,
    serviceType: "wash_fold",
    summary: null,
    customerName: name,
    address: null,
    ingestedAt: iso,
  };
}

const SALES: OrderBrief[] = [
  orderBrief("Thomas Hartmann", "2026-09-19T17:00:00.000Z", 18_500, "o-thomas"),
  orderBrief("Carol Wexler", "2026-09-18T17:00:00.000Z", 12_00, "o-carol"),
  orderBrief("Spencer Hale", "2026-09-17T17:00:00.000Z", 42_00, "o-spencer"),
  orderBrief("Rebecca Stone", "2026-09-16T17:00:00.000Z", 55_00, "o-rebecca"),
  orderBrief("Todd Ames", "2026-09-15T17:00:00.000Z", 61_18, "o-todd"),
  orderBrief("Sophie Tran", "2026-09-14T17:00:00.000Z", 33_00, "o-sophie"),
  orderBrief("Sean Cohen", "2026-09-13T17:00:00.000Z", 21_00, "o-sean"),
  orderBrief("Maria Lopez", "2026-09-12T17:00:00.000Z", 19_00, "o-maria"),
];

function okOrders(query: BusinessQuery, orders: OrderBrief[]): BusinessQueryResult {
  return {
    status: "ok",
    query,
    period: { kind: "all_time", start: "2020-01-01", end: "2026-09-20", label: "all time" } as never,
    comparisonPeriod: null,
    coverage: {
      completeness: { missing: [], connected: ["native", "cleancloud"] } as never,
      loadedSources: ["native", "cleancloud"],
      failedSources: [],
      unverifiedNativeCount: 0,
      unverifiedNativeCents: 0,
      overlap: { orders: 0, cents: 0 } as never,
      serviceFilterUnclassified: null,
      lineage: null,
      union: null,
    },
    data: { kind: "orders", ordering: query.rank === "earliest" ? "earliest" : "latest", orders },
  };
}

function emptyHistory() {
  return {
    account: LOUISE,
    missions: [],
    events: [],
    fieldVisits: [],
    outcomes: [],
    followUps: [],
    pipelineStage: null,
    pipelineId: null,
    contacts: [{ name: "Dana", title: "General Manager", relationshipType: "decision_maker" as const }],
    dayLineMentions: [],
    conversationMentions: [],
  };
}

function briefing(title: string, people: string[], businessDate: string): ParsedBriefing {
  return {
    items: [
      {
        kind: "new_work",
        title,
        quote: title,
        businessDate,
        timing: { kind: "none" },
        quantity: null,
        people,
        place: null,
        needs: null,
        existing: null,
      },
    ],
    context: [],
    questions: [],
    unparsed: [],
  };
}

function kernel(over: Partial<ClaireTurnDeps> = {}) {
  const state: ClaireTurnState = {};
  const board = vi.fn(async () => ({ brief: T13_BOARD }));
  const seen: BusinessQuery[] = [];
  const runQuery = vi.fn(async (_tenant: string, query: BusinessQuery) => {
    seen.push(query);
    if (query.metric === "latest_sales" || query.metric === "biggest_orders") {
      return okOrders(query, SALES.slice(0, Math.max(1, query.limit)));
    }
    return {
      status: "unavailable" as const,
      query,
      period: { kind: "all_time", start: "2020-01-01", end: "2026-09-20", label: "all time" } as never,
      comparisonPeriod: null,
      reason: "test",
    };
  });
  const accountHistory = (over.accountHistory ?? vi.fn(async () => emptyHistory())) as ClaireTurnDeps["accountHistory"];
  const dayWork = (over.dayWork ?? vi.fn()) as ClaireTurnDeps["dayWork"];
  const deps = (extra: Partial<ClaireTurnDeps> = {}): ClaireTurnDeps => ({
    now: () => NOW,
    timeZone: () => "America/Los_Angeles",
    business: {
      now: () => NOW,
      timeZone: () => "America/Los_Angeles",
      plan: async () => null,
      runQuery: runQuery as never,
      loadBindings: async () => ({
        laundry_butler: {
          state: "bound" as const,
          lastSuccessAt: NOW,
          coverageRanges: [{ from: "2020-01-01", to: "2099-12-31", completedAt: NOW, basis: "economic_event" as const, provenance: "test_fixture" as const }],
          latestAttempt: null,
          isSystemOfRecord: true,
        },
        cleancloud: {
          state: "bound" as const,
          lastSuccessAt: NOW,
          coverageRanges: [{ from: "2020-01-01", to: "2099-12-31", completedAt: NOW, basis: "economic_event" as const, provenance: "test_fixture" as const }],
          latestAttempt: null,
          isSystemOfRecord: false,
        },
      }),
    },
    commitment: vi.fn(async () => ({ kind: "not_applicable" as const })) as never,
    followUp: vi.fn(async () => "Model filler that must not invent a morning board.") as never,
    extractModel: null,
    loadExisting: async () => [],
    commit: vi.fn() as never,
    campaign: async () => null,
    vocabulary: async () => [],
    accounts: async () => [LOUISE],
    accountHistory,
    commitFollowUp: vi.fn() as never,
    dayWork,
    unpaid: vi.fn() as never,
    searchMemory: vi.fn(async () => []) as never,
    memoryBetween: vi.fn(async () => []) as never,
    encyclopedia: null,
    watchBoard: board as never,
    doctrineTurn: undefined,
    classifyPriorClaim: (async () => false) as never,
    rerunBusinessQuery: runQuery as never,
    classifierBudgetMs: 30,
    ...over,
    ...extra,
  });
  const say = (utterance: string, extra: Partial<ClaireTurnDeps> = {}) =>
    runClaireTurn(
      {
        tenantId: "default",
        operatorUserId: "adam-admin",
        dayDirectorActorId: "1",
        surface: "voice",
        utterance,
        state,
        conversationKey: "call:kernel-corpus",
        allowFragmentWait: false,
        brief: "b",
        context: { businessDate: "2026-09-20", actorId: "adam-admin", macroGoalKnown: false, blockers: [], relevantTimeline: [] } as never,
      },
      deps(extra)
    );
  return { state, say, board, seen, runQuery, accountHistory, dayWork };
}

describe("A. mixed morning utterances are not the board", () => {
  it.each([
    "Good morning.",
    "Good morning — what should I know today?",
    "What should I know today?",
  ])("broad check-in may take the board: %s", async utterance => {
    const h = kernel();
    await h.say(utterance);
    expect(h.board).toHaveBeenCalled();
  });

  it.each([
    "Good morning, I need to call the dry cleaner and deliver towels today.",
    "Good morning, I need to call Dana.",
    "Morning. Before anything else, add towels to today's route.",
    "Good morning, I need to call Dana and deliver towels.",
  ])("greeting + work is NOT the board: %s", async utterance => {
    const h = kernel();
    const result = await h.say(utterance);
    expect(interpretTurn(utterance).broadBriefingRequest).toBe(false);
    expect(h.board).not.toHaveBeenCalled();
    expect(result.speak).not.toMatch(/GUMBALL did not run|Andrew Molina|Mission 6|Synthetic verification/i);
  });
});

describe("B. pending briefing corrections revise, they do not destroy", () => {
  it("REPRODUCTION: 'No, I meant call Dana Wednesday' revises Tuesday rather than dropping the draft", async () => {
    const h = kernel();
    h.state.pendingBriefing = { parsed: briefing("Call Dana", ["Dana"], "2026-09-22"), createdAt: NOW.getTime() };
    const result = await h.say("No, I meant call Dana Wednesday.");
    expect(h.state.pendingBriefing).toBeTruthy();
    expect(h.state.pendingBriefing!.parsed.items[0]!.businessDate).toBe("2026-09-23");
    expect(result.kind).toBe("briefing_proposed");
    expect(result.speak).toMatch(/Wednesday|Moved/i);
    const proposal = result.responsePlan?.segments.find(segment => segment.type === "ActionProposalSegment");
    expect(proposal?.type === "ActionProposalSegment" ? proposal.authoritySource : null).toBe("pending_lifecycle");
    expect(interpretTurn("No, I meant call Dana Wednesday.").mayProposeWork).toBe(false);
    expect(result.speak).toBe(renderResponsePlan(result.responsePlan!).speak);
  });

  it("Wait, change Dana to Wednesday revises the held briefing", async () => {
    const h = kernel();
    h.state.pendingBriefing = { parsed: briefing("Call Dana", ["Dana"], "2026-09-22"), createdAt: NOW.getTime() };
    const result = await h.say("Wait, change Dana to Wednesday.");
    expect(h.state.pendingBriefing).toBeTruthy();
    expect(h.state.pendingBriefing!.parsed.items[0]!.businessDate).toBe("2026-09-23");
    expect(result.kind).toBe("briefing_proposed");
  });

  it("a refusal still cancels", async () => {
    const h = kernel();
    h.state.pendingBriefing = { parsed: briefing("Call Dana", ["Dana"], "2026-09-22"), createdAt: NOW.getTime() };
    await h.say("Never mind.");
    expect(h.state.pendingBriefing).toBeFalsy();
  });

  it("a topic correction supersedes a proposal without requiring a briefing", async () => {
    const h = kernel();
    h.state.pendingProposal = { title: "Call Dana at The Louise", sourceText: "x" } as never;
    await h.say("No, I meant I want to talk it through.");
    expect(h.state.pendingProposal).toBeFalsy();
  });
});

describe("C. pendingReminded is per pending item", () => {
  it("REPRODUCTION: reminding about A does not suppress a later reminder about B", async () => {
    const h = kernel();
    h.state.pendingProposal = { title: "Review revenue", sourceText: "a" } as never;
    const first = await h.say("What should I do about The Louise?");
    expect(first.speak).toMatch(/still holding/i);
    h.state.pendingProposal = { title: "Call Dana", sourceText: "b" } as never;
    syncPendingReminderIdentity(h.state);
    expect(pendingItemIdentity(h.state)).toMatch(/Call Dana/);
    expect(h.state.pendingReminded).toBe(false);
    const second = await h.say("What should I do about OPUS?");
    expect(second.speak).toMatch(/still holding "Call Dana"/i);
  });
});

describe("D. ordered query continuation is structural", () => {
  it("last five sales then 'the other four' does not restart at Thomas", async () => {
    const h = kernel();
    const first = await h.say("Give me my last five sales.");
    expect(first.speak).toMatch(/Thomas/i);
    expect(first.responsePlan?.segments.some(segment => segment.type === "BusinessFactSegment")).toBe(true);
    const second = await h.say("What were the other four?");
    expect(second.speak).not.toMatch(/Thomas/i);
    expect(second.speak).toMatch(/Carol|Spencer|Rebecca|Todd|Sophie|Sean|Maria/i);
    expect(h.state.analytics?.orderedQuery?.delivered.length).toBeGreaterThan(1);
  });

  it.each([
    "What were my last five sales?",
    "Give me the five most recent orders.",
  ])("list variants ask for five: %s", async utterance => {
    const h = kernel();
    await h.say(utterance);
    expect(h.seen.some(query => query.metric === "latest_sales" && query.limit === 5)).toBe(true);
  });

  it("'What came before Thomas?' does not return Thomas", async () => {
    const h = kernel();
    await h.say("What were my last five sales?");
    const result = await h.say("What came before Thomas?");
    expect(result.speak).not.toMatch(/Thomas Hartmann/i);
    expect(result.speak).toMatch(/Carol|Spencer|Rebecca|Todd|Sophie/i);
  });

  it("exclusion survives into execution", async () => {
    const h = kernel();
    await h.say("What were my last five sales?");
    await h.say("Don't tell me about Thomas.");
    const again = await h.say("Okay, now the other four.");
    expect(again.speak).not.toMatch(/Thomas/i);
  });

  it("I asked for five, what about the rest continues the same query", async () => {
    const h = kernel();
    await h.say("Give me my last five sales.");
    const rest = await h.say("I asked for five, what about the rest?");
    expect(rest.speak).not.toMatch(/I don't have a record that answers that/i);
  });
});

describe("E. Dana resolves to The Louise, never Dana Tuesday or the board", () => {
  it.each([
    "What should I do about Dana Tuesday?",
    "What should I do with Dana on Tuesday?",
    "Dana at The Louise — what should I do Tuesday?",
    "What about Dana tomorrow?",
  ])("scoped judgment stays on Dana/Louise: %s", async utterance => {
    const h = kernel();
    const result = await h.say(utterance);
    expect(h.board).not.toHaveBeenCalled();
    expect(result.speak).not.toMatch(/GUMBALL did not run|Andrew Molina|Mission 6|Synthetic verification/i);
    expect(result.speak).toMatch(/Dana|Louise/i);
    expect(result.kind).not.toBe("briefing_proposed");
  });

  it("runClaireTurn recommends from retrieved Dana/Louise state without mutating", async () => {
    const history = {
      ...emptyHistory(),
      fieldVisits: [{ missionId: 1, arrivedAt: "2026-09-10T18:00:00.000Z", departedAt: null, notes: "Left the sample set" }],
      followUps: [
        {
          id: "fu-louise",
          pipelineId: 8,
          status: "open",
          dueAt: "2026-09-22T17:00:00.000Z",
          note: "Bring the revised rate card and confirm Tuesday access",
          completedAt: null,
        },
      ],
    };
    const h = kernel({ accountHistory: vi.fn(async () => history) as never });
    const result = await h.say("What should I do about Dana Tuesday?");
    expect(h.board).not.toHaveBeenCalled();
    expect(h.dayWork).not.toHaveBeenCalled();
    expect(result.kind).toBe("answered");
    expect(result.mutationReceipts ?? []).toEqual([]);
    expect(result.kind).not.toBe("briefing_proposed");
    expect(result.speak).toMatch(/Dana/i);
    expect(result.speak).toMatch(/Louise/i);
    expect(result.speak).toMatch(/rate card|follow-up|Tuesday/i);
    expect(result.speak).not.toMatch(/GUMBALL|Andrew Molina|Mission 6/i);
    expect(result.responsePlan?.segments.some(segment => segment.type === "BusinessJudgmentSegment")).toBe(true);
    expect(result.responsePlan?.segments.some(segment => segment.type === "ActionConfirmationSegment")).toBe(false);
    expect(result.speak).toBe(renderResponsePlan(result.responsePlan!).speak);
  });

  it("'I need to call Dana Tuesday' may propose work and does not commit", async () => {
    const h = kernel();
    const result = await h.say("I need to call Dana Tuesday.");
    expect(interpretTurn("I need to call Dana Tuesday.").mayProposeWork).toBe(true);
    expect(result.kind === "briefing_saved" ? result.mutationReceipts : undefined).toBeUndefined();
    expect(h.board).not.toHaveBeenCalled();
  });

  it("'What happens if I call Dana Tuesday?' is not a mutation", async () => {
    const h = kernel();
    const result = await h.say("What happens if I call Dana Tuesday?");
    expect(result.kind).not.toBe("briefing_proposed");
    expect(interpretTurn("What happens if I call Dana Tuesday?").mayProposeWork).toBe(false);
  });
});

describe("F. prior claims: correctness outranks wording", () => {
  it.each([
    "Are you sure?",
    "Check that again.",
    "Verify those numbers.",
    "I asked you for revenue — are you sure those numbers are correct?",
  ])("is a correctness challenge: %s", utterance => {
    const turn = interpretTurn(utterance);
    expect(turn.correctnessChallenge).toBe(true);
    expect(turn.queryRefinement).toBe(false);
  });

  it("Where did that number come from? is provenance, not a reread challenge", () => {
    const turn = interpretTurn("Where did that number come from?");
    expect(turn.provenanceQuestion).toBe(true);
    expect(turn.correctnessChallenge).toBe(false);
  });

  it("STATEFUL: 'I asked you for five sales — are you sure' rereads rather than refining", async () => {
    const h = kernel();
    await h.say("What were my last five sales?");
    const receiptId = h.state.claimReceipts?.[0]?.id ?? null;
    const before = h.runQuery.mock.calls.length;
    const result = await h.say("I asked you for five sales — are you sure those numbers are right?", {
      classifyPriorClaim: (async () => ({ probe: true, receiptId, ambiguous: false, assertsFact: true })) as never,
    });
    expect(h.runQuery.mock.calls.length).toBeGreaterThan(before);
    expect(result.speak).not.toMatch(/Sophie Tran|the other four/i);
  });
});

describe("G. call control", () => {
  it.each(["I'm good.", "Got it.", "That's enough detail."])("does not hang up: %s", async utterance => {
    const h = kernel();
    const result = await h.say(utterance);
    expect(result.endCall).toBeFalsy();
    expect(interpretTurn(utterance).callControl).toBe("continue");
  });

  it.each(["I gotta go.", "I got to go.", "I need to run."])("ends the call: %s", async utterance => {
    const h = kernel();
    const result = await h.say(utterance);
    expect(result.endCall).toBe(true);
    expect(result.speak).not.toMatch(/blank slate|what's the plan/i);
  });

  it("mixed departure answers minimally then ends", async () => {
    const h = kernel();
    const result = await h.say("Dana hasn't replied, but I gotta go.");
    expect(result.endCall).toBe(true);
    expect(result.speak).not.toMatch(/blank slate|what's the plan/i);
  });
});

describe("H. typed response plan is real", () => {
  it("a business list answer is not an action proposal", async () => {
    const h = kernel();
    const result = await h.say("What were my last five sales?");
    expect(result.responsePlan).toBeTruthy();
    expect(result.responsePlan!.segments.some(segment => segment.type === "ActionProposalSegment")).toBe(false);
    expect(result.responsePlan!.segments.some(segment => segment.type === "BusinessFactSegment")).toBe(true);
    expect(result.responsePlan!.interpretation.mayProposeWork).toBe(false);
  });

  it("Dana judgment is a BusinessJudgmentSegment with no mutation authority", async () => {
    const h = kernel();
    const result = await h.say("What should I do about Dana Tuesday?");
    expect(result.responsePlan?.segments.some(segment => segment.type === "BusinessJudgmentSegment")).toBe(true);
    const judgment = result.responsePlan?.segments.find(segment => segment.type === "BusinessJudgmentSegment");
    if (judgment?.type === "BusinessJudgmentSegment") {
      expect(judgment.mutationAuthority).toBe(false);
      expect(judgment.contactName).toMatch(/Dana/i);
    }
  });

  it("an authorized work turn may propose; a judgment turn may not", () => {
    expect(interpretTurn("I should call Dana Tuesday.").mayProposeWork).toBe(true);
    expect(interpretTurn("Can you remind me to call Dana Tuesday.").mayProposeWork).toBe(true);
    expect(interpretTurn("Call Dana Tuesday.").mayProposeWork).toBe(true);
    expect(interpretTurn("What should I do about Dana Tuesday?").mayProposeWork).toBe(false);
  });
});

describe("I. mutations bite", () => {
  it("MUTATION: treating any morning prefix as broad would swallow work", () => {
    const mixed = "Good morning, I need to call the dry cleaner and deliver towels today.";
    expect(interpretTurn(mixed).broadBriefingRequest).toBe(false);
    expect(interpretTurn(mixed).operatorWorkCommitment).toBe(true);
  });

  it("MUTATION: a conversation-wide reminded flag would skip proposal B", () => {
    const state: ClaireTurnState = {
      pendingProposal: { title: "A", sourceText: "a" } as never,
      pendingReminded: true,
      pendingReminderKey: "proposal:A:a",
    };
    state.pendingProposal = { title: "B", sourceText: "b" } as never;
    syncPendingReminderIdentity(state);
    expect(state.pendingReminded).toBe(false);
    expect(state.pendingReminderKey).toBe("proposal:B:b");
  });

  it("MUTATION: forcing conversation as the top-level route blocks the Dana business path", async () => {
    const h = kernel();
    const natural = planRoute(interpretTurn("What should I do about Dana Tuesday?"), {
      proactiveMorning: false,
      holdingBriefing: false,
      holdingProposal: false,
      holdingFollowUp: false,
      pendingHints: [],
    });
    expect(natural.primary).toBe("business");
    const blocked = await h.say("What should I do about Dana Tuesday?", {
      planRoute: () => ({
        primary: "conversation",
        also: [],
        board: false,
        priorClaim: "none",
        pending: "none",
        callEnd: false,
        continuePriorQuery: false,
      }),
    });
    expect(h.accountHistory).not.toHaveBeenCalled();
    expect(h.board).not.toHaveBeenCalled();
    expect(blocked.responsePlan?.route.primary).toBe("conversation");
    expect(blocked.speak).not.toMatch(/Louise/i);
  });

  it("MUTATION: forcing continuePriorQuery false blocks ordered-query continuation", async () => {
    const h = kernel();
    await h.say("Give me my last five sales.");
    const second = await h.say("What were the other four?", {
      planRoute: () => ({
        primary: "business",
        also: [],
        board: false,
        priorClaim: "none",
        pending: "none",
        callEnd: false,
        continuePriorQuery: false,
      }),
    });
    expect(h.state.analytics?.orderedQuery?.presented.some(item => /Thomas/i.test(item.customerName ?? ""))).toBe(true);
    expect(second.speak).not.toMatch(/Carol Wexler/i);
  });

  it("final speak is rendered from the ResponsePlan", async () => {
    const h = kernel();
    const result = await h.say("What were my last five sales?");
    expect(result.responsePlan).toBeTruthy();
    expect(result.speak).toBe(renderResponsePlan(result.responsePlan!).speak);
    expect(result.responsePlan!.segments.some(segment => segment.type === "BusinessFactSegment")).toBe(true);
  });
});

describe("J. ordered query presented vs resolved", () => {
  it("query of five, speech of Thomas only, then the other four returns the unspoken four", async () => {
    const h = kernel({
      business: {
        now: () => NOW,
        timeZone: () => "America/Los_Angeles",
        plan: async () => null,
        runQuery: (async (_tenant: string, query: BusinessQuery) => {
          if (query.metric === "latest_sales" || query.metric === "biggest_orders") {
            return okOrders(query, SALES.slice(0, Math.max(1, query.limit)));
          }
          return {
            status: "unavailable" as const,
            query,
            period: { kind: "all_time", start: "2020-01-01", end: "2026-09-20", label: "all time" } as never,
            comparisonPeriod: null,
            reason: "test",
          };
        }) as never,
        speakResult: (result, context) => {
          if (result.status === "ok" && result.data.kind === "orders" && !context.refinement) {
            const thomas = result.data.orders.find(order => /Thomas/i.test(order.customerName ?? ""));
            if (thomas && result.data.orders.length > 1) {
              return {
                text: `The newest sale I have is $185.00 for Thomas Hartmann, paid Friday.`,
                facts: ["185.00"],
                disclosures: [],
                presentedOrders: [thomas],
              };
            }
          }
          return speakBusinessResult(result, context);
        },
        loadBindings: async () => ({
          laundry_butler: {
            state: "bound" as const,
            lastSuccessAt: NOW,
            coverageRanges: [{ from: "2020-01-01", to: "2099-12-31", completedAt: NOW, basis: "economic_event" as const, provenance: "test_fixture" as const }],
            latestAttempt: null,
            isSystemOfRecord: true,
          },
          cleancloud: {
            state: "bound" as const,
            lastSuccessAt: NOW,
            coverageRanges: [{ from: "2020-01-01", to: "2099-12-31", completedAt: NOW, basis: "economic_event" as const, provenance: "test_fixture" as const }],
            latestAttempt: null,
            isSystemOfRecord: false,
          },
        }),
      },
    });
    const first = await h.say("Give me my last five sales.");
    expect(first.speak).toMatch(/Thomas/i);
    expect(first.speak).not.toMatch(/Carol|Spencer|Rebecca|Todd/i);
    expect(h.state.analytics?.orderedQuery?.resolved).toHaveLength(5);
    expect(h.state.analytics?.orderedQuery?.presented).toHaveLength(1);
    const second = await h.say("What were the other four?");
    expect(second.speak).not.toMatch(/Thomas/i);
    expect(second.speak).toMatch(/Carol/i);
    expect(second.speak).toMatch(/Spencer/i);
    expect(second.speak).toMatch(/Rebecca/i);
    expect(second.speak).toMatch(/Todd/i);
    expect(second.speak).not.toMatch(/Sophie|Sean|Maria/i);
  });

  it("exclusions survive the same query and reset on a new query", async () => {
    const h = kernel();
    await h.say("What were my last five sales?");
    await h.say("Don't tell me about Thomas.");
    expect(h.state.analytics?.orderedQuery?.exclusions.join(" ")).toMatch(/Thomas/i);
    const continued = await h.say("Okay, now the other four.");
    expect(continued.speak).not.toMatch(/Thomas/i);
    const fresh = await h.say("What were my last five sales?");
    expect(h.state.analytics?.orderedQuery?.exclusions).toEqual([]);
    expect(fresh.speak).toMatch(/Thomas/i);
  });
});
