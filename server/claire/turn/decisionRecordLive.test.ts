import { describe, expect, it, vi } from "vitest";
import type { ClaireBrainV3Interpretation } from "./brainV3";
import {
  defaultClaireTurnDeps,
  runClaireTurn,
  type ClaireTurnDeps,
  type ClaireTurnState,
  type PendingBriefing,
} from "./claireTurn";
import {
  createInMemoryClaireDecisionStore,
  deriveClaireClosedDecisions,
  type ClaireClosedDecisionProvider,
  type ClaireClosedDecisionProviderInput,
  type ClaireDecisionCandidate,
  type ClaireDecisionRecordInput,
  type ClaireTurnType,
} from "./decisionRecord";

const NOW = new Date("2026-10-03T16:00:00.000Z");
const TODAY = "2026-10-03";

function brain(
  patch: Partial<ClaireBrainV3Interpretation> = {}
): ClaireBrainV3Interpretation {
  return {
    target: "open_conversation",
    act: "narration",
    workDisposition: "none",
    dayLineDisposition: "none",
    priorClaim: "none",
    weeklyDisposition: "none",
    identityTopic: "none",
    broadBriefingRequest: false,
    canonicalWork: null,
    referent: null,
    rationale: "live decision fixture",
    ...patch,
  };
}

function pendingBriefing(): PendingBriefing {
  return {
    createdAt: NOW.getTime(),
    parsed: {
      items: [
        {
          kind: "new_work",
          title: "Follow up with The Louise",
          quote: "Follow up with The Louise",
          businessDate: TODAY,
          timing: { kind: "none" },
          quantity: null,
          people: [],
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
  };
}

function fixture(input: {
  state?: ClaireTurnState;
  brain?: ClaireBrainV3Interpretation;
  decisionProvider?: ClaireClosedDecisionProvider;
  allowFragmentWait?: boolean;
  telephonySessionEnded?: boolean;
}) {
  const state: ClaireTurnState = input.state ?? {};
  const decisionStore = createInMemoryClaireDecisionStore();
  const commitment = vi.fn(async () => ({ kind: "not_applicable" as const }));
  const commit = vi.fn(async () => ({
    added: [],
    completed: [],
    failed: [],
    commitmentIds: [],
    receipts: [],
  }));
  const followUp = vi.fn(async () => "CASUAL_CHECK_IN_SENTINEL");
  const doctrineTurn = vi.fn(async () => null);

  const defaults = defaultClaireTurnDeps();
  const deps: ClaireTurnDeps = {
    ...defaults,
    now: () => NOW,
    timeZone: () => "America/Los_Angeles",
    business: {
      now: () => NOW,
      timeZone: () => "America/Los_Angeles",
      plan: async () => null,
      runQuery: vi.fn() as never,
    },
    commitment: commitment as never,
    followUp: followUp as never,
    extractModel: null,
    loadExisting: async () => [],
    commit: commit as never,
    campaign: async () => null,
    markReconciliation: undefined,
    loadWorkdayPlan: undefined,
    weeklyPicture: undefined,
    beginWeekly: undefined,
    scheduleWeeklyCallback: undefined,
    vocabulary: async () => [],
    accounts: async () => [],
    accountHistory: vi.fn() as never,
    commitFollowUp: vi.fn() as never,
    dayWork: vi.fn() as never,
    unpaid: vi.fn() as never,
    searchMemory: vi.fn(async () => []) as never,
    memoryBetween: vi.fn(async () => []) as never,
    encyclopedia: null,
    watchBoard: undefined,
    recoveryObligations: undefined,
    doctrineTurn,
    classifyPriorClaim: (async () => null) as never,
    rerunBusinessQuery: vi.fn() as never,
    classifierBudgetMs: 20,
    brainV3: vi.fn(async () => input.brain ?? brain()) as never,
    decisionStore,
    decisionProvider: input.decisionProvider ?? deriveClaireClosedDecisions,
  };

  const say = (utterance: string) =>
    runClaireTurn(
      {
        tenantId: "tenant-live-decision",
        operatorUserId: "operator-live-decision",
        dayDirectorActorId: "actor-live-decision",
        surface: "voice",
        utterance,
        state,
        conversationKey: "call:live-decision",
        allowFragmentWait: input.allowFragmentWait ?? false,
        telephonySessionEnded: input.telephonySessionEnded,
        context: {
          businessDate: TODAY,
          actorId: "actor-live-decision",
          macroGoalKnown: false,
          blockers: [],
          relevantTimeline: [],
        } as never,
      },
      deps
    );

  return {
    state,
    say,
    decisionStore,
    commitment,
    commit,
    followUp,
    doctrineTurn,
  };
}

function weakTurnTypeProvider(
  selected: ClaireTurnType = "correction"
): ClaireClosedDecisionProvider {
  return async (input: ClaireClosedDecisionProviderInput) => {
    const base = deriveClaireClosedDecisions(input);
    return {
      ...base,
      turnType: {
        ...base.turnType,
        provider: "fake_closed_decision_provider",
        providerSelectedOutput: selected,
        distribution: {
          correction: selected === "correction" ? 0.38 : 0.02,
          new_work: 0.35,
          question: 0.14,
          interruption: 0.08,
          conversation: 0.03,
          unknown: selected === "unknown" ? 1 : 0.02,
        },
        abstained: false,
        abstentionReason: null,
        effectiveOutput: selected,
        fallbackUsed: false,
      },
    };
  };
}

describe("Claire PR1 live closed-decision branch", () => {
  it("clarifies a weak decision, preserves pending work, and never enters casual check-in", async () => {
    const held = pendingBriefing();
    const f = fixture({
      state: { pendingBriefing: held },
      brain: brain({ target: "pending_briefing", act: "correction" }),
      decisionProvider: weakTurnTypeProvider(),
    });

    const result = await f.say("Actually, I meant Dana.");

    expect(result.speak).toBe("Say that last part again.");
    expect(f.state.pendingBriefing).toBe(held);
    expect(f.commit).not.toHaveBeenCalled();
    expect(f.commitment).not.toHaveBeenCalled();
    expect(f.followUp).not.toHaveBeenCalled();
    expect(f.doctrineTurn).not.toHaveBeenCalled();

    const row = f.decisionStore.find(
      "tenant-live-decision",
      "call:live-decision:1",
      "turn_type"
    );
    expect(row?.decision.providerSelectedOutput).toBe("correction");
    expect(row?.decision.abstained).toBe(true);
    expect(row?.decision.abstentionReason).toBe("margin_below_threshold");
    expect(row?.decision.effectiveOutput).toBe("clarify");
    expect(row?.branchExecuted).toBe(true);
  });

  it("keeps a confident provider unknown distinct from abstention but speaks the same repeat request", async () => {
    const f = fixture({
      brain: brain({ act: "unclear" }),
    });

    const result = await f.say("Uh, that thing.");

    expect(result.speak).toBe("Say that last part again.");
    const row = f.decisionStore.find(
      "tenant-live-decision",
      "call:live-decision:1",
      "turn_type"
    );
    expect(row?.decision.providerSelectedOutput).toBe("unknown");
    expect(row?.decision.abstained).toBe(false);
    expect(row?.decision.abstentionReason).toBeNull();
    expect(row?.decision.effectiveOutput).toBe("unknown");
    expect(row?.branchExecuted).toBe(true);
  });

  it("leaves an unrelated pending briefing in place on a correction", async () => {
    const held = pendingBriefing();
    const f = fixture({
      state: { pendingBriefing: held },
      brain: brain({ target: "open_conversation", act: "correction" }),
    });

    await f.say("Actually, I said Dana, not Diane.");

    expect(f.state.pendingBriefing).toBe(held);
    const relationship = f.decisionStore.find(
      "tenant-live-decision",
      "call:live-decision:1",
      "pending_action_relationship"
    );
    expect(relationship?.decision.effectiveOutput).toBe("continues_pending");
    expect(relationship?.branchExecuted).toBe(true);
  });

  it("does not swallow greeting plus work into the casual check-in path", async () => {
    const f = fixture({
      brain: brain({
        act: "action_request",
        workDisposition: "propose",
        canonicalWork: "Call Dana Tuesday",
      }),
    });

    const result = await f.say("Hey Claire, remind me to call Dana Tuesday.");

    expect(
      f.commitment.mock.calls.length > 0 ||
        f.commit.mock.calls.length > 0 ||
        result.kind === "briefing_proposed"
    ).toBe(true);
    expect(f.followUp).not.toHaveBeenCalled();

    const row = f.decisionStore.find(
      "tenant-live-decision",
      "call:live-decision:1",
      "turn_type"
    );
    expect(row?.decision.effectiveOutput).toBe("new_work");
  });

  it("returns listen-only for an incomplete spoken sentence", async () => {
    const f = fixture({
      brain: brain(),
      allowFragmentWait: true,
    });

    const result = await f.say("Desired timing is");

    expect(result.speak).toBe("");
    expect(result.listenOnly).toBe(true);
    expect(result.thoughtCompleteness).toBe("incomplete");
  });

  it("uses telephony session-end evidence rather than a sentence label for the hang-up case", async () => {
    const f = fixture({
      brain: brain({ act: "narration" }),
      telephonySessionEnded: true,
    });

    await f.say("ordinary final transcript");

    const row = f.decisionStore.find(
      "tenant-live-decision",
      "call:live-decision:1",
      "turn_type"
    );
    expect(row?.decision.providerSelectedOutput).toBe("interruption");
    expect(row?.decision.effectiveOutput).toBe("interruption");
    expect(row?.branchExecuted).toBe(true);
  });

  it("lets a second write update an unsealed row, then rejects any write after the branch is sealed", async () => {
    const store = createInMemoryClaireDecisionStore();
    const base = deriveClaireClosedDecisions({
      brain: brain({ act: "correction" }),
      provider: "fixture",
      fallbackUsed: false,
      thoughtCompleteness: "complete",
      hasPendingAction: false,
    });
    const turnId = "call:write-rule:1";
    const first: ClaireDecisionRecordInput = {
      decisionId: "decision-write-rule",
      turnId,
      tenantId: "tenant-write-rule",
      operatorUserId: "operator-write-rule",
      agent: "claire",
      decision: base.turnType,
    };

    await store.write([first]);

    const updatedDecision: ClaireDecisionCandidate<ClaireTurnType> = {
      ...base.turnType,
      providerSelectedOutput: "question",
      distribution: { question: 1 },
      effectiveOutput: "question",
    };
    await store.write([{ ...first, decision: updatedDecision }]);

    expect(
      store.find("tenant-write-rule", turnId, "turn_type")?.decision.effectiveOutput
    ).toBe("question");
    expect(
      store.find("tenant-write-rule", turnId, "turn_type")?.branchExecuted
    ).toBe(false);

    await store.seal({ tenantId: "tenant-write-rule", turnId });

    await expect(
      store.write([{ ...first, decision: base.turnType }])
    ).rejects.toThrow(/already consumed/i);
  });
});
