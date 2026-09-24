import { describe, expect, it, vi } from "vitest";
import { defaultBusinessQuery, type BusinessQueryResult } from "../../analytics/businessQuery";
import { assembleReferencedDayLineWork } from "../briefing/explicitDayLine";
import type { BriefingItem } from "../briefing/briefingTypes";
import type { ExistingWork } from "../briefing/briefingCommit";
import { UNVERIFIABLE_SPEECH } from "../provenance/claimReceipts";
import { explicitOperatorExecutionType } from "../../../shared/objectiveExecution";
import {
  CONTINUATION_MAX_HOLDS,
  looksUnfinished,
  runClaireTurn,
  type ClaireTurnDeps,
  type ClaireTurnResult,
  type ClaireTurnState,
} from "./claireTurn";
import { interpretTurn, priorClaimLaneOpen } from "./interpretTurn";

/**
 * 2026-09-23 production call. Conversation c79a543e-e77c-4196-a8df-ad0138624afc,
 * session 7cea9847-4d06-40b1-9c4d-a512b306f151. The strings are the operator's
 * speech. Do not paraphrase this fixture.
 */

const T1 = "while I'm there, I need to do the Instagram static at";
const T2 = "Just add what I told you to the day line that I'm driving through a laundromat.";
const T3 = "That I'm processing 3 orders, but 1 of the orders is, like, 8 bags. And after that,";
const T4 = "I have to do the Instagram static ad.";
const T5 = "Add all that to the day line. And the Instagram static ad, is a challenge.";
const T6 = "Claire.";
const T7 = "Claire, are you there?";
const T8 = "Claire.";
const T9 = "I want you to I want you to be sure that you put the Instagram static ad creation on the day line as a challenge.";

const UNVERIFIABLE = UNVERIFIABLE_SPEECH;
const NOW = new Date("2026-09-23T17:00:00Z");
const base = {
  tenantId: "default",
  operatorUserId: "adam",
  dayDirectorActorId: "1",
  surface: "voice" as const,
  conversationKey: "claire-call:c79a543e-e77c-4196-a8df-ad0138624afc",
  brief: null,
  context: {
    businessDate: "2026-09-23",
    actorId: "adam",
    macroGoalKnown: false,
    blockers: [],
    relevantTimeline: [],
    clock: { localTime: "10:00 AM", weekday: "Wednesday", businessDate: "2026-09-23", timeZone: "America/Los_Angeles" },
  } as never,
};

type Store = { rows: ExistingWork[] };

function dayLine(store: Store) {
  let seq = 0;
  const loadExisting: ClaireTurnDeps["loadExisting"] = async () => store.rows.map(row => ({ ...row }));
  const commit: ClaireTurnDeps["commit"] = async parsed => {
    const added: BriefingItem[] = [];
    const receipts: Array<{ claimedState: "created" | "updated"; entityId: string; statement: string }> = [];
    const commitmentIds: string[] = [];
    for (const item of parsed.items) {
      if (item.kind !== "new_work") continue;
      if (item.existing) {
        if (item.executionType && item.existing.executionType !== item.executionType) {
          const row = store.rows.find(entry => entry.id === item.existing!.id);
          if (row) row.executionType = item.executionType;
          receipts.push({
            claimedState: "updated",
            entityId: item.existing.id,
            statement: `${item.existing.title} as ${item.executionType}`,
          });
          commitmentIds.push(item.existing.id);
        }
        continue;
      }
      seq += 1;
      const id = `c-${seq}`;
      store.rows.push({
        id,
        title: item.title,
        businessDate: item.businessDate,
        status: "open",
        executionType: item.executionType ?? null,
      });
      added.push(item);
      receipts.push({ claimedState: "created", entityId: id, statement: `Added ${item.title} to the Day Line` });
      commitmentIds.push(id);
    }
    return { added, completed: [], failed: [], commitmentIds, receipts };
  };
  return { loadExisting, commit };
}

function turnDeps(store: Store, over: Partial<ClaireTurnDeps> = {}): Partial<ClaireTurnDeps> {
  const line = dayLine(store);
  return {
    now: () => NOW,
    timeZone: () => "America/Los_Angeles",
    business: { now: () => NOW, timeZone: () => "America/Los_Angeles", plan: async () => null, runQuery: vi.fn() as never },
    commitment: vi.fn(async () => ({ kind: "not_applicable" as const })) as never,
    followUp: vi.fn(async () => "I'm here.") as never,
    extractModel: null,
    loadExisting: line.loadExisting,
    commit: line.commit,
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
    classifyPriorClaim: async ({ utterance }) => {
      throw new Error(`prior-claim classifier ran on ordinary speech: ${utterance}`);
    },
    rerunBusinessQuery: async () => {
      throw new Error("prior-claim rerun ran on ordinary speech");
    },
    ...over,
  };
}

async function say(state: ClaireTurnState, speech: string, deps: Partial<ClaireTurnDeps>): Promise<ClaireTurnResult> {
  const first = await runClaireTurn({ ...base, utterance: speech, state }, deps);
  if (first.listenOnly && looksUnfinished(state.pendingFragment ?? "")) return first;
  if (!first.listenOnly) return first;
  const pending = state.pendingFragment ?? "";
  state.pendingFragment = null;
  state.fragmentHolds = 0;
  return runClaireTurn({ ...base, utterance: pending, state, allowFragmentWait: false }, deps);
}

const clock = { now: NOW, timeZone: "America/Los_Angeles", today: "2026-09-23", minutesNow: 10 * 60 };

describe("2026-09-23 replay", () => {
  it("holds T1, commits the three items once, and rereads the challenge", async () => {
    const store: Store = { rows: [] };
    const deps = turnDeps(store);
    const state: ClaireTurnState = {
      pendingBriefing: {
        createdAt: NOW.getTime(),
        parsed: {
          items: [
            {
              kind: "new_work",
              title: "Call Dana",
              quote: "Call Dana",
              businessDate: "2026-09-23",
              timing: { kind: "none" },
              quantity: null,
              people: ["Dana"],
              place: null,
              needs: null,
              existing: null,
            },
          ],
          context: [],
          questions: [],
          unparsed: [],
          source: "deterministic",
        },
      },
    };
    const spoken: string[] = [];
    const note = (result: ClaireTurnResult) => {
      spoken.push(result.speak);
      expect(result.speak).not.toContain(UNVERIFIABLE);
      expect(result.priorClaimRan).not.toBe(true);
    };

    const t1 = await say(state, T1, deps);
    expect(t1.listenOnly).toBe(true);
    expect(t1.thoughtCompleteness).toBe("incomplete");
    expect(looksUnfinished(t1.assembledUtterance ?? "")).toBe(true);
    note(t1);

    const t2 = await say(state, T2, deps);
    expect(t2.listenOnly).not.toBe(true);
    expect(t2.kind).toBe("briefing_saved");
    expect(t2.speak).not.toMatch(/should i add|say yes or no/i);
    expect(store.rows.some(row => /dana/i.test(row.title))).toBe(false);
    expect(store.rows.some(row => /laundromat/i.test(row.title))).toBe(true);
    expect(state.pendingBriefing).toBeNull();
    note(t2);

    const t3 = await say(state, T3, deps);
    expect(t3.listenOnly).toBe(true);
    expect(t3.thoughtCompleteness).toBe("incomplete");
    expect(t3.speak).not.toMatch(/should i add|say yes or no/i);
    note(t3);

    const t4 = await say(state, T4, deps);
    expect(t4.listenOnly).not.toBe(true);
    const t4Read = interpretTurn(t4.assembledUtterance ?? "");
    expect(t4Read.operatorWorkCommitment).toBe(true);
    expect(t4Read.hasBusinessQuestion).toBe(false);
    expect(priorClaimLaneOpen(t4Read)).toBe(false);
    note(t4);

    const before = store.rows.length;
    const t5 = await say(state, T5, deps);
    expect(t5.kind).toBe("briefing_saved");
    expect(t5.speak).toMatch(/Done\./);
    expect(t5.speak).not.toMatch(/should i add|say yes or no/i);
    expect(store.rows).toHaveLength(3);
    expect(store.rows.length).toBeGreaterThan(before);
    const ad = store.rows.find(row => /instagram/i.test(row.title));
    const driving = store.rows.find(row => /laundromat/i.test(row.title));
    const orders = store.rows.find(row => /bag|order/i.test(row.title) && !/instagram/i.test(row.title));
    expect(driving).toBeTruthy();
    expect(orders).toBeTruthy();
    expect(ad?.executionType).toBe("challenge");
    expect(driving?.executionType ?? null).toBeNull();
    expect(orders?.executionType ?? null).toBeNull();
    note(t5);

    for (const speech of [T6, T7, T8]) {
      const turn = await say(state, speech, deps);
      const read = interpretTurn(speech);
      expect(read.conversationControl).toBe(true);
      expect(read.hasBusinessQuestion).toBe(false);
      expect(priorClaimLaneOpen(read)).toBe(false);
      expect(turn.priorClaimRan).not.toBe(true);
      expect(turn.speak).not.toContain(UNVERIFIABLE);
      spoken.push(turn.speak);
    }

    const count = store.rows.length;
    const t9 = await say(state, T9, deps);
    expect(t9.speak).toMatch(/challenge/i);
    expect(t9.speak).not.toMatch(/should i add|say yes or no/i);
    expect(t9.kind).not.toBe("briefing_saved");
    expect(store.rows).toHaveLength(count);
    expect(store.rows.filter(row => /instagram/i.test(row.title))).toHaveLength(1);
    expect(ad?.executionType).toBe("challenge");
    note(t9);

    expect(spoken.join("\n")).not.toContain(UNVERIFIABLE);
  });

  it("releases an unfinished fragment only after the hold budget", async () => {
    const store: Store = { rows: [] };
    const state: ClaireTurnState = {};
    let last: ClaireTurnResult = { speak: "", kind: "listening", listenOnly: true };
    for (let i = 0; i <= CONTINUATION_MAX_HOLDS; i += 1) {
      last = await runClaireTurn({ ...base, utterance: "and then I need to do the static at", state }, turnDeps(store));
    }
    expect(last.listenOnly).not.toBe(true);
    expect(last.thoughtCompleteness).toBe("forced_flush");
  });

  it("does not infer Challenge from the word ad", () => {
    expect(explicitOperatorExecutionType("I have to do the Instagram static ad.")).toBeNull();
    expect(explicitOperatorExecutionType("today's mission is the route")).toBeNull();
    expect(explicitOperatorExecutionType("The Instagram static ad is a challenge.")).toBe("challenge");
  });
});

describe("assembly of the referenced work", () => {
  it("keeps the three described items and types only the ad", () => {
    const items = assembleReferencedDayLineWork({
      utterance: T5,
      priorOperatorUtterances: [
        "I'm driving through a laundromat.",
        "That I'm processing 3 orders, but 1 of the orders is, like, 8 bags.",
        T4,
      ],
      clock,
      unfinished: looksUnfinished,
    });
    expect(items).toHaveLength(3);
    expect(items.filter(item => item.executionType === "challenge")).toHaveLength(1);
    expect(items.find(item => /instagram/i.test(item.title))?.executionType).toBe("challenge");
    expect(items.find(item => /laundromat/i.test(item.title))?.executionType ?? null).toBeNull();
  });
});

describe("mixed lanes stay mixed", () => {
  it("first-person work is not a pure fact question", () => {
    const turn = interpretTurn(T4);
    expect(turn.operatorWorkCommitment).toBe(true);
    expect(turn.hasBusinessQuestion).toBe(false);
    expect(priorClaimLaneOpen(turn)).toBe(false);
  });

  it("a work declaration plus a question stays both", () => {
    const turn = interpretTurn("I have to call Dana — when did we last talk to her?");
    expect(turn.operatorWorkCommitment).toBe(true);
    expect(turn.hasBusinessQuestion).toBe(true);
  });

  it("attention repair plus a real challenge stays a challenge", () => {
    const turn = interpretTurn("Claire, are you there? Also, check that revenue number again.");
    expect(turn.conversationControl).toBe(true);
    expect(turn.correctnessChallenge).toBe(true);
    expect(priorClaimLaneOpen(turn)).toBe(true);
  });

  it.each(["Claire", "Claire?", "Hey Claire", "Can you hear me?"])("%s is conversation control, not a prior-claim challenge", utterance => {
    const turn = interpretTurn(utterance);
    expect(turn.conversationControl).toBe(true);
    expect(turn.correctnessChallenge).toBe(false);
    expect(turn.hasBusinessQuestion).toBe(false);
    expect(priorClaimLaneOpen(turn)).toBe(false);
  });
});

describe("an existing item is confirmed or updated, never duplicated", () => {
  async function commitUtterance(rows: ExistingWork[], utterance: string) {
    const store: Store = { rows };
    const state: ClaireTurnState = {};
    const result = await say(state, utterance, turnDeps(store));
    return { result, store };
  }

  it("confirms a stored Challenge without writing again", async () => {
    const { result, store } = await commitUtterance(
      [{ id: "ad-1", title: "Instagram static ad", businessDate: "2026-09-23", status: "open", executionType: "challenge" }],
      "Put the Instagram static ad on the day line as a challenge."
    );
    expect(result.speak).toMatch(/challenge/i);
    expect(result.speak).not.toMatch(/should i add|say yes or no/i);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]?.executionType).toBe("challenge");
  });

  it("updates the same item when the stored type is wrong", async () => {
    const { result, store } = await commitUtterance(
      [{ id: "ad-1", title: "Instagram static ad", businessDate: "2026-09-23", status: "open", executionType: "mission" }],
      "Put the Instagram static ad on the day line as a challenge."
    );
    expect(result.kind).toBe("briefing_saved");
    expect(result.speak).toMatch(/Updated:/);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]?.executionType).toBe("challenge");
    expect(result.speak).not.toContain(UNVERIFIABLE);
  });
});

const period = { label: "all time", start: "2020-01-01", end: "2026-09-23" } as never;
const sale = (): BusinessQueryResult => ({
  status: "ok",
  query: defaultBusinessQuery("latest_sales"),
  period,
  comparisonPeriod: null,
  coverage: {
    completeness: "complete",
    loadedSources: ["cleancloud"],
    failedSources: [],
    unverifiedNativeCount: 0,
    unverifiedNativeCents: 0,
    overlap: null,
    serviceFilterUnclassified: null,
    lineage: null,
    union: null,
  } as never,
  data: {
    kind: "orders",
    ordering: "latest",
    orders: [
      {
        eventKey: "cc:584",
        orderNumber: "584",
        date: "2026-09-23",
        occurredAt: "2026-09-23T15:00:00.000Z",
        cents: 120000,
        source: "cleancloud",
        businessLine: null,
        processor: null,
        building: null,
        serviceType: null,
        summary: "Fluff & Fold",
        customerName: "Thomas",
        address: null,
        ingestedAt: null,
      },
    ] as never,
  },
});

function claimHarness(rerun: () => Promise<BusinessQueryResult> = async () => sale()) {
  const current = sale();
  const store: Store = { rows: [] };
  const state: ClaireTurnState = {};
  const deps = turnDeps(store, {
    business: { now: () => NOW, timeZone: () => "America/Los_Angeles", plan: async () => null, runQuery: async () => current },
    classifyPriorClaim: async ({ utterance }) => ({
      probe: /\b(sure|right|where did|come from|check that)\b/i.test(utterance),
      receiptId: null,
      ambiguous: false,
      assertsFact: true,
    }),
    rerunBusinessQuery: rerun,
  });
  return {
    state,
    store,
    say: (speech: string) => say(state, speech, deps),
  };
}

describe("prior-claim truth still holds when the turn is actually a challenge", () => {
  it("verifies a revenue challenge", async () => {
    const h = claimHarness();
    await h.say("Who was my most recent sale?");
    const challenged = await h.say("Are you sure that revenue number is right?");
    expect(challenged.priorClaimRan).toBe(true);
    expect(challenged.speak).toMatch(/checks out|CleanCloud|came from/i);
  });

  it("still answers a provenance question", async () => {
    const h = claimHarness();
    await h.say("Who was my most recent sale?");
    const asked = await h.say("Where did that come from?");
    expect(asked.priorClaimRan).toBe(true);
    expect(asked.speak).toMatch(/came from|CleanCloud/i);
  });

  it("says it cannot verify when the recheck is unavailable", async () => {
    const h = claimHarness(async () => {
      throw new Error("reader down");
    });
    await h.say("Who was my most recent sale?");
    const challenged = await h.say("Are you sure that revenue number is right?");
    expect(challenged.speak).toContain(UNVERIFIABLE);
  });

  it("keeps an explicit provenance/correctness challenge ahead of pending Day Line state", async () => {
    const h = claimHarness();
    await h.say("Who was my most recent sale?");
    h.state.pendingBriefing = {
      createdAt: NOW.getTime(),
      parsed: {
        items: [],
        context: [],
        questions: [],
        unparsed: [],
        source: "deterministic",
      },
    };

    const provenance = await h.say("Where did that come from?");
    expect(provenance.priorClaimRan).toBe(true);
    expect(provenance.speak).toMatch(/came from|CleanCloud/i);
    expect(h.state.pendingBriefing).toBeTruthy();

    const challenged = await h.say("Are you sure?");
    expect(challenged.priorClaimRan).toBe(true);
    expect(challenged.speak).toMatch(/checks out|CleanCloud|came from/i);
    expect(h.state.pendingBriefing).toBeTruthy();
  });

  it("writes the ad and verifies the number on one mixed turn", async () => {
    const h = claimHarness();
    await h.say("Who was my most recent sale?");
    const mixed = await h.say("Add the Instagram ad to my Day Line, and are you sure the revenue number you gave me is right?");
    expect(mixed.priorClaimRan).toBe(true);
    expect(mixed.speak).toMatch(/checks out|CleanCloud|came from/i);
    expect(h.store.rows.some(row => /instagram/i.test(row.title))).toBe(true);
    expect(mixed.speak).toMatch(/Done\./);
  });
});
