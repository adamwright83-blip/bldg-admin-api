/**
 * Brain V2 PRIMARY — one continuous conversation, every turn answered by V2.
 *
 * The real perception and executive run on every turn. Retrieval readers, the
 * speaking organ, Daphne, and the Day Line adapter are injected so the test can
 * see exactly what V2 asked each of them to do. Legacy Claire is never called:
 * `runClaireTurn` is mocked to throw if anything reaches it.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../turn/claireTurn", async importOriginal => {
  const actual = await importOriginal<typeof import("../../turn/claireTurn")>();
  return {
    ...actual,
    runClaireTurn: vi.fn(async () => {
      throw new Error("legacy Claire must not answer a Brain V2 primary turn");
    }),
  };
});

import { runClaireTurn } from "../../turn/claireTurn";
import type { ClaireTurnResult } from "../../turn/claireTurn";
import type { BusinessQueryResult } from "../../../analytics/businessQuery";
import type { BusinessMemoryDeps } from "../businessMemory/adapter";
import type { ExecutiveActionGrant } from "../contracts/grants";
import {
  runClaireV2PrimaryTurn,
  isClaireBrainV2PrimaryEnabled,
  unlicensedFigures,
  V2_RECOVERY_SPEECH,
  type ClaireV2PrimaryDeps,
  type ClaireV2PrimaryInput,
  type ClaireV2PrimaryState,
} from "../live/primaryTurn";
import type { LegacyComparison } from "../live/legacyShadow";

const period = {
  spec: { kind: "all_time" },
  start: "2026-01-01",
  end: "2026-10-18",
  startUtc: new Date("2026-01-01"),
  endExclusiveUtc: new Date("2026-10-19"),
  days: 291,
  timeZone: "America/Los_Angeles",
  label: "all time",
} as never;

function order(key: string, name: string, cents: number, date: string) {
  return {
    eventKey: key,
    orderNumber: key.toUpperCase(),
    date,
    occurredAt: `${date}T10:00:00.000Z`,
    cents,
    source: "laundry_butler",
    businessLine: null,
    processor: null,
    building: null,
    serviceType: null,
    summary: null,
    customerName: name,
    address: null,
    ingestedAt: null,
  };
}

function salesResult(query: BusinessQueryResult["query"]): BusinessQueryResult {
  return {
    status: "ok",
    query,
    period,
    comparisonPeriod: null,
    coverage: {
      completeness: "complete",
      loadedSources: ["laundry_butler"],
      failedSources: [],
      unverifiedNativeCount: 0,
      unverifiedNativeCents: 0,
      overlap: {},
      serviceFilterUnclassified: null,
      lineage: null,
      union: null,
    },
    data: {
      kind: "orders",
      ordering: "latest",
      orders: [
        order("evt-1", "Thomas", 4200, "2026-10-18"),
        order("evt-2", "Dana", 3100, "2026-10-17"),
        order("evt-3", "Priya", 2900, "2026-10-16"),
        order("evt-4", "Marcus", 2500, "2026-10-15"),
        order("evt-5", "Lena", 2100, "2026-10-14"),
      ],
    },
  } as unknown as BusinessQueryResult;
}

const business: BusinessMemoryDeps = {
  runQuery: vi.fn(async (_tenant, query) => salesResult(query)),
  listAccounts: async () => [],
  listContacts: async () => [],
  loadHistory: async ({ account }) =>
    ({
      account,
      missions: [],
      events: [],
      fieldVisits: [],
      outcomes: [],
      followUps: [],
      pipelineStage: null,
      pipelineId: null,
      contacts: [],
      dayLineMentions: [],
      conversationMentions: [],
    }) as never,
  loadOpenOrders: async () => [],
  loadOperations: async ({ businessDate }) => ({ businessDate, open: [], completed: [], routeAvailable: true }) as never,
  verifyClaim: async receipt =>
    ({
      receipt,
      outcome: "verified",
      resolution: "fresh_query",
      evidenceChanged: false,
      freshAnswer: receipt.answerText,
    }) as never,
};

const context = {
  businessDate: "2026-10-19",
  actorId: "adam-admin",
  macroGoalKnown: true,
  relevantTimeline: [],
  blockers: [],
  nextFixedCommitment: null,
  clock: { localTime: "9:05 AM", tomorrowBusinessDate: "2026-10-20" },
} as never;

type Harness = {
  deps: ClaireV2PrimaryDeps;
  speak: ReturnType<typeof vi.fn>;
  executeGrant: ReturnType<typeof vi.fn>;
  capturePreference: ReturnType<typeof vi.fn>;
  commitPendingDisclosures: ReturnType<typeof vi.fn>;
  interpret: ReturnType<typeof vi.fn>;
  comparisons: LegacyComparison[];
};

function harness(): Harness {
  const comparisons: LegacyComparison[] = [];
  const speak = vi.fn(async (input: { utterance: string }) => `Composed reply to: ${input.utterance}`);
  const executeGrant = vi.fn(async (grant: ExecutiveActionGrant, state: ClaireV2PrimaryState): Promise<ClaireTurnResult> => {
    if (grant.actionClass === "propose_day_line") {
      state.pendingBriefing = { parsed: { items: [{ kind: "new_work", title: grant.scope.titles?.[0] ?? "work" }] } as never, createdAt: Date.now() };
      return { speak: `I can add "${grant.scope.titles?.[0]}" to your Day Line. Want it saved?`, kind: "briefing_proposed", actionIds: [] };
    }
    state.pendingBriefing = null;
    const receipt = { claimedState: "created", entityId: "commitment-1", statement: "Call Dana is on Tuesday's Day Line." };
    return {
      speak: "",
      receiptBackedCommit: "Saved. Call Dana is on Tuesday's Day Line.",
      mutationReceipts: [receipt as never],
      kind: "briefing_saved",
      actionIds: ["commitment-1"],
    };
  });
  const capturePreference = vi.fn(async () => ({ status: "disabled" as const, corrections: [], observationIds: [], readbackVerified: false }));
  const commitPendingDisclosures = vi.fn(async () => undefined);
  const interpret = vi.fn(async () => ({
    target: "open_conversation",
    act: "question",
    workDisposition: "none",
    dayLineDisposition: "none",
    priorClaim: "none",
    weeklyDisposition: "none",
    identityTopic: "none",
    broadBriefingRequest: false,
    canonicalWork: null,
    referent: null,
    rationale: "test",
  }));
  const deps: ClaireV2PrimaryDeps = {
    now: () => new Date("2026-10-19T16:05:00.000Z"),
    speak: speak as never,
    interpretPerception: async ({ utterance }) => ({
      turnKind: /focus on|should i|grow/i.test(utterance)
        ? "business_judgment_or_strategy"
        : /weekend|yourself|go on/i.test(utterance)
          ? "personal_question_to_claire"
          : /sales/i.test(utterance)
            ? "business_list_question"
            : /bye/i.test(utterance)
              ? "leave_taking"
              : /^yes/i.test(utterance)
                ? "acknowledgement"
                : /need to/i.test(utterance)
                  ? "work_instruction"
                  : "unclear",
      endsConversation: /bye/i.test(utterance),
    }),
    planBusinessQuery: undefined,
    liveDeps: { business },
    executeGrant: executeGrant as never,
    routeWeekly: vi.fn(async () => null),
    beginWeekly: vi.fn(async () => "Let's open the week."),
    ingestDaphne: vi.fn(async () => ({ status: "persisted" })),
    capturePreference: capturePreference as never,
    loadDaphneGuidance: vi.fn(async () => ({
      cardGeneratedAt: "2026-10-19T00:00:00.000Z",
      evidenceCount: 3,
      promptSection: "DAPHNE V2 USER-ADAPTATION CONTEXT. Declared response detail preference: 0.20.",
      responseDetail: 0.2,
    })),
    commitPendingDisclosures,
    legacyShadow: {
      interpret: interpret as never,
      record: async comparison => {
        comparisons.push(comparison);
      },
      env: {} as NodeJS.ProcessEnv,
    },
  };
  return { deps, speak, executeGrant, capturePreference, commitPendingDisclosures, interpret, comparisons };
}

function turnInput(state: ClaireV2PrimaryState, utterance: string, over: Partial<ClaireV2PrimaryInput> = {}): ClaireV2PrimaryInput {
  return {
    authority: { authorized: true, tenantId: "laundry_farm", operatorUserId: "adam-admin", role: "owner", basis: "verified_membership" },
    tenantId: "laundry_farm",
    operatorUserId: "adam-admin",
    dayDirectorActorId: "42",
    surface: "voice",
    utterance,
    state,
    conversationKey: "claire-call:v2-primary",
    conversationId: "v2-primary",
    timeZone: "America/Los_Angeles",
    businessDate: "2026-10-19",
    brief: "Morning. Two pickups today.",
    context,
    allowFragmentWait: false,
    ...over,
  };
}

async function flushShadow(): Promise<void> {
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
}

describe("Brain V2 primary — flag", () => {
  it("is off unless explicitly enabled (rollback is the flag)", () => {
    expect(isClaireBrainV2PrimaryEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(isClaireBrainV2PrimaryEnabled({ CLAIRE_BRAIN_V2_PRIMARY: "0" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(isClaireBrainV2PrimaryEnabled({ CLAIRE_BRAIN_V2_PRIMARY: "1" } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });
});

describe("Brain V2 primary — a complete multi-turn call", () => {
  let h: Harness;
  let state: ClaireV2PrimaryState;
  beforeEach(() => {
    h = harness();
    state = {};
    vi.mocked(runClaireTurn).mockClear();
  });

  it("answers business, analysis, personal, correction, proposal, confirmation, and goodbye — all from V2", async () => {
    // 1. Business analytics: authoritative reader, deterministic V2 speech, receipt kept.
    const sales = await runClaireV2PrimaryTurn(turnInput(state, "What were my last five sales?"), h.deps);
    expect(sales.brainV2.origin).toBe("brain_v2");
    expect(sales.brainV2.composition).toBe("deterministic");
    expect(sales.speak).toMatch(/Thomas/);
    expect(h.speak).not.toHaveBeenCalled();
    expect(state.claimReceipts?.at(-1)?.answerPath).toBe("business_reader");

    // 2. Strategic judgment: V2 decides, the speaking organ phrases from V2's frame.
    const advice = await runClaireV2PrimaryTurn(turnInput(state, "What do you think I should focus on this week to grow revenue?"), h.deps);
    expect(advice.brainV2.origin).toBe("brain_v2");
    expect(advice.brainV2.composition).toBe("composed");
    const adviceCall = h.speak.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(adviceCall.semanticAuthority).toBe("brain_v2");
    expect(adviceCall.daphnePromptSection).toMatch(/DAPHNE V2/);
    expect((adviceCall.recentTurns as Array<{ text: string }>).some(turn => /Thomas/.test(turn.text))).toBe(true);

    // 3. Personal conversation reaches the guarded personal organ through V2.
    const personal = await runClaireV2PrimaryTurn(turnInput(state, "How was your weekend?"), h.deps);
    expect(personal.brainV2.origin).toBe("brain_v2");
    expect(["composed", "deterministic"]).toContain(personal.brainV2.composition);

    // 4. Day Line proposal: V2 mints the grant; the adapter executes it exactly once.
    const proposal = await runClaireV2PrimaryTurn(turnInput(state, "I need to call Dana Tuesday."), h.deps);
    expect(proposal.brainV2.composition).toBe("action");
    expect(proposal.brainV2.actionClasses).toContain("propose_day_line");
    expect(h.executeGrant).toHaveBeenCalledTimes(1);
    expect(state.pendingBriefing).toBeTruthy();

    // 5. Confirmation binds to the pending lifecycle and returns a receipt-backed commit.
    const confirm = await runClaireV2PrimaryTurn(turnInput(state, "Yes."), h.deps);
    expect(confirm.brainV2.actionClasses).toContain("commit_briefing");
    expect(confirm.speak).toMatch(/Saved/);
    expect(confirm.actionIds).toEqual(["commitment-1"]);
    expect(state.pendingBriefing).toBeNull();

    // 6. Ending the conversation is V2 call control.
    const bye = await runClaireV2PrimaryTurn(turnInput(state, "Okay, that's everything. Bye."), h.deps);
    expect(bye.endCall).toBe(true);
    expect(bye.brainV2.origin).toBe("brain_v2");

    // Legacy Claire never answered, and observed every turn read-only.
    expect(runClaireTurn).not.toHaveBeenCalled();
    await flushShadow();
    expect(h.comparisons.length).toBe(6);
    expect(h.comparisons.every(comparison => comparison.v1.available)).toBe(true);
    // The observer saw copies, never the live state object.
    for (const call of h.interpret.mock.calls) {
      expect((call[0] as { recentTurns: unknown }).recentTurns).not.toBe(state.history);
    }
    expect(state.history?.filter(entry => entry.speaker === "claire")).toHaveLength(6);
  });

  it("saves an explicit style correction through Daphne and confirms only after readback", async () => {
    h.capturePreference.mockResolvedValueOnce({
      status: "persisted",
      corrections: [{ preferenceKey: "response_detail", value: 0.2 }],
      observationIds: ["obs-1"],
      readbackVerified: true,
    } as never);
    const result = await runClaireV2PrimaryTurn(turnInput(state, "Keep your answers shorter from now on."), h.deps);
    expect(result.brainV2.composition).toBe("preference");
    expect(result.speak).toBe("Got it. I'll keep my answers shorter from now on.");
  });

  it("does not consume a pending personal disclosure when the last reply was interrupted", async () => {
    state.history = [
      { speaker: "operator", text: "Tell me about yourself.", at: 1 },
      { speaker: "claire", text: "I grew up near the coast and", at: 2, delivery: "interrupted" },
    ];
    await runClaireV2PrimaryTurn(turnInput(state, "Sorry, go on, what were you saying?"), h.deps);
    expect(h.commitPendingDisclosures).not.toHaveBeenCalled();
    const call = h.speak.mock.calls.at(-1)?.[0] as { recentTurns?: Array<{ text: string }> } | undefined;
    if (call) expect(call.recentTurns?.some(turn => /Playback interrupted/.test(turn.text))).toBe(true);
  });

  it("holds an unfinished spoken fragment instead of answering it", async () => {
    const held = await runClaireV2PrimaryTurn(turnInput(state, "The desired timing is", { allowFragmentWait: true }), h.deps);
    expect(held.listenOnly).toBe(true);
    expect(state.pendingFragment).toBe("The desired timing is");
    expect(h.speak).not.toHaveBeenCalled();
    expect(h.executeGrant).not.toHaveBeenCalled();
  });

  it("answers its own failure instead of handing the turn to legacy Claire", async () => {
    const broken: ClaireV2PrimaryDeps = {
      ...h.deps,
      liveDeps: { business: { ...business, runQuery: async () => { throw new Error("reader down"); } } },
      speak: (async () => { throw new Error("organ down"); }) as never,
    };
    const result = await runClaireV2PrimaryTurn(turnInput(state, "What do you think I should focus on this week to grow revenue?"), broken);
    expect(result.brainV2.origin).toBe("brain_v2");
    expect(result.speak).toBe(V2_RECOVERY_SPEECH);
    expect(runClaireTurn).not.toHaveBeenCalled();
  });

  it("refuses composed speech that invents a dollar figure", async () => {
    h.speak.mockResolvedValueOnce("You should push wash-and-fold; it made $9,999 last week.");
    const result = await runClaireV2PrimaryTurn(turnInput(state, "What do you think I should focus on this week to grow revenue?"), h.deps);
    expect(result.speak).not.toMatch(/9,999/);
  });

  it("runs Desk (text) turns through the same V2 primary path", async () => {
    const result = await runClaireV2PrimaryTurn(turnInput(state, "What were my last five sales?", { surface: "text" }), h.deps);
    expect(result.brainV2.origin).toBe("brain_v2");
    expect(result.speak).toMatch(/Thomas/);
  });
});

describe("Brain V2 primary — scheduled and Desk planning sessions", () => {
  it("routes agenda turns to the conductor and strategy questions to V2's composer", async () => {
    const h = harness();
    const showrunner = vi.fn(async ({ state }: { state: never }) => ({ state, end: false, speak: "Noted. Anything else from today?" }));
    const deps = { ...h.deps, showrunner: showrunner as never };
    const state: ClaireV2PrimaryState = { showrunner: { purpose: "evening_debrief", turns: 0 } as never };
    const report = await runClaireV2PrimaryTurn(turnInput(state, "Pickups went fine today, the Opus run was late."), deps);
    expect(report.brainV2.composition).toBe("showrunner");
    expect(report.brainV2.origin).toBe("brain_v2");
    expect(showrunner).toHaveBeenCalledTimes(1);
    const advice = await runClaireV2PrimaryTurn(turnInput(state, "What do you think I should focus on this week to grow revenue?"), deps);
    expect(advice.brainV2.composition).toBe("composed");
    expect(showrunner).toHaveBeenCalledTimes(1);
    expect(runClaireTurn).not.toHaveBeenCalled();
  });
});

describe("Brain V2 primary — review regressions", () => {
  it("a refused pending item is cleared, so a later 'okay' cannot commit it", async () => {
    const h = harness();
    const state: ClaireV2PrimaryState = {};
    await runClaireV2PrimaryTurn(turnInput(state, "I need to call Dana Tuesday."), h.deps);
    expect(state.pendingBriefing).toBeTruthy();
    await runClaireV2PrimaryTurn(turnInput(state, "No."), h.deps);
    expect(state.pendingBriefing).toBeNull();
    const later = await runClaireV2PrimaryTurn(turnInput(state, "Okay."), h.deps);
    expect(later.brainV2.actionClasses).not.toContain("commit_briefing");
    expect(h.executeGrant).toHaveBeenCalledTimes(1);
  });

  it("ordinary answers during an active weekly interview go back to the interview", async () => {
    const h = harness();
    const routeWeekly = vi.fn(async () => ({ speak: "Tuesday afternoon it is. What's Wednesday for?" }));
    const deps = { ...h.deps, routeWeekly: routeWeekly as never };
    const state: ClaireV2PrimaryState = { sessionKind: "weekly_planning", weeklyPlanningWeekStart: "2026-10-19" };
    const answer = await runClaireV2PrimaryTurn(turnInput(state, "Tuesday afternoon"), deps);
    expect(answer.brainV2.composition).toBe("weekly");
    expect(routeWeekly).toHaveBeenCalledWith(expect.objectContaining({ intent: "weekly_continue" }));
    // A business question still leaves the interview for V2's own answer.
    const sales = await runClaireV2PrimaryTurn(turnInput(state, "What were my last five sales?"), deps);
    expect(sales.brainV2.composition).toBe("deterministic");
    expect(routeWeekly).toHaveBeenCalledTimes(1);
  });
});

describe("Brain V2 primary — a named period is never substituted", () => {
  const lastWeekPlanner = async () => ({
    metric: "latest_sales", limit: 5, customerName: null, rank: null, filters: null, serviceType: null,
    listMembers: true, period: { kind: "last_week" }, comparison: null, minOrders: 1, groupBy: null,
  }) as never;

  it("answers last week's sales from a last-week query", async () => {
    const h = harness();
    const runQuery = vi.mocked(business.runQuery);
    runQuery.mockClear();
    // Phrased so it stays on the tenant ledger reader rather than the company view.
    const result = await runClaireV2PrimaryTurn(turnInput({}, "Show me the latest sales from last week."), { ...h.deps, planBusinessQuery: lastWeekPlanner });
    expect(runQuery.mock.calls.some(call => (call[1] as { period: { kind: string } }).period.kind === "last_week")).toBe(true);
    expect(result.speak).not.toMatch(/can't verify last week/);
    expect(result.brainV2.composition).toBe("deterministic");
  });

  it("says it cannot verify last week instead of answering a different window", async () => {
    const h = harness();
    const thirtyDays = async () => ({
      metric: "latest_sales", limit: 5, customerName: null, rank: null, filters: null, serviceType: null,
      listMembers: true, period: { kind: "trailing_days", days: 30 }, comparison: null, minOrders: 1, groupBy: null,
    }) as never;
    const result = await runClaireV2PrimaryTurn(turnInput({}, "Show me the latest sales from last week."), { ...h.deps, planBusinessQuery: thirtyDays });
    expect(result.speak).toBe("I can't verify last week from what I have right now, so I won't give you a different period instead.");
    expect(result.speak).not.toMatch(/Thomas|30 days/);
  });

  it("asks the speaking organ once more when it returns its generic fallback", async () => {
    const h = harness();
    const { conservativeClaireFollowUp } = await import("../../preDriveConversation");
    h.speak.mockResolvedValueOnce(conservativeClaireFollowUp({
      utterance: "What do you think I should focus on this week to grow revenue?",
      brief: "Morning. Two pickups today.",
      context,
    }));
    const result = await runClaireV2PrimaryTurn(turnInput({}, "What do you think I should focus on this week to grow revenue?"), h.deps);
    expect(h.speak).toHaveBeenCalledTimes(2);
    expect(result.speak).toMatch(/^Composed reply/);
  });

  it("does not refuse a strategy question that mentions a period", async () => {
    const h = harness();
    const result = await runClaireV2PrimaryTurn(turnInput({}, "What do you think I should focus on this week to grow revenue?"), h.deps);
    expect(result.brainV2.composition).toBe("composed");
  });
});

describe("unlicensedFigures", () => {
  it("allows figures present in evidence and flags invented ones", () => {
    expect(unlicensedFigures("Revenue was $1,240 and 12% up.", "Revenue: $1,240 total, up 12% on last week.")).toEqual([]);
    expect(unlicensedFigures("That's $500.", "Revenue: 1,240 cents")).toEqual(["500"]);
    expect(unlicensedFigures("About 40% more.", "nothing numeric")).toEqual(["40%"]);
  });
});
