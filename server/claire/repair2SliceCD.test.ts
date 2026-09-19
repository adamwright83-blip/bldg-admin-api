import { describe, expect, it, vi } from "vitest";
import type { EncyclopediaAnswer } from "./knowledge/encyclopediaAgent";
import { decideClaireAnswerRoute, utteranceHasMultipleAsks } from "./answerRouter";
import { classifyClaireAnswerClass } from "./answerPathTelemetry";
import { runClaireTurn, type ClaireTurnDeps, type ClaireTurnState, type ClaireTurnTraceForTest } from "./turn/claireTurn";

/**
 * Claire Intelligence Repair Part 2, Slice C+D corrective pass.
 *
 * Routing authority is decideClaireAnswerRoute / encyclopedia.fullyAnswers.
 * JUDGMENT_CLAUSE / classifyClaireAnswerClass are telemetry only.
 */

const NOW = new Date("2026-09-15T16:00:00Z");

function turnDeps(overrides: Partial<ClaireTurnDeps> = {}): ClaireTurnDeps {
  return {
    now: () => NOW,
    timeZone: () => "America/Los_Angeles",
    business: { now: () => NOW, timeZone: () => "America/Los_Angeles", plan: async () => null, runQuery: vi.fn() as never },
    commitment: vi.fn(async () => ({ kind: "not_applicable" as const })) as never,
    followUp: vi.fn(async () => "Brief follow-up.") as never,
    extractModel: null,
    loadExisting: async () => [],
    commit: vi.fn() as never,
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
    watchBoard: undefined,
    doctrineTurn: undefined,
    ...overrides,
  };
}

const MINIMAL_BRIEF = "Two commercial stops today; The Louise is the one that matters.";
const MINIMAL_CONTEXT = {
  businessDate: "2026-09-15",
  actorId: "adam-admin",
  macroGoalKnown: false,
  blockers: [],
  relevantTimeline: [],
} as never;

const LOUISE_HISTORY = {
  account: { id: 1, name: "The Louise", kind: "account" } as never,
  missions: [],
  events: [],
  fieldVisits: [{ missionId: 1, arrivedAt: "2026-09-08T18:00:00Z", departedAt: "2026-09-08T18:30:00Z", notes: "Toured the basement laundry room." }],
  outcomes: [],
  followUps: [],
  pipelineStage: null,
  pipelineId: null,
  contacts: [],
  dayLineMentions: [],
  conversationMentions: [],
};

function encyclopediaAnswer(partial: EncyclopediaAnswer): EncyclopediaAnswer {
  return partial;
}

async function turnFor(
  utterance: string,
  overrides: Partial<ClaireTurnDeps> = {},
  state: ClaireTurnState = {},
  conversational = true
) {
  let trace: ClaireTurnTraceForTest | null = null;
  const result = await runClaireTurn(
    {
      tenantId: "default",
      operatorUserId: "adam-admin",
      dayDirectorActorId: "1",
      surface: "voice",
      utterance,
      state,
      conversationKey: "claire-call:slice-cd",
      ...(conversational ? { brief: MINIMAL_BRIEF, context: MINIMAL_CONTEXT } : {}),
    },
    turnDeps({ ...overrides, onTurnTrace: value => { trace = value; } })
  );
  return { result, trace: trace as ClaireTurnTraceForTest | null };
}

describe("Slice C+D router — completeness is typed, not inferred from phrases", () => {
  it("a reader cannot terminate after answering just one clause of a compound request", () => {
    const utterance = "How many unpaid orders are there, and is it worth another visit?";
    expect(utteranceHasMultipleAsks(utterance)).toBe(true);
    const decision = decideClaireAnswerRoute({
      utterance,
      encyclopedia: null,
      localMatches: [{ path: "unpaid_orders", source: "unpaid_orders", mayTerminate: true }],
      loadedEvidence: [{ source: "unpaid_orders", text: "Nothing waiting on payment." }],
      briefingWorkItems: 0,
      briefingQuestions: 0,
    });
    expect(decision.outcome).toBe("retrieval_plus_synthesis");
    expect(decision.path).toBeUndefined();
  });

  it("judgment wording absent from JUDGMENT_CLAUSE still synthesizes", () => {
    const utterance = "Why do property managers keep stalling on this?";
    expect(classifyClaireAnswerClass(utterance)).toBe("fact_only");
    const decision = decideClaireAnswerRoute({
      utterance,
      encyclopedia: { kind: "no_retrieval_needed", fullyAnswers: false },
      localMatches: [],
      briefingWorkItems: 0,
      briefingQuestions: 0,
    });
    expect(decision.outcome).toBe("judgment_synthesis_no_retrieval");
  });
});

describe("Slice C+D — encyclopedia planner completeness", () => {
  it("a judgment_only plan with no calls never produces refusal prose", async () => {
    const { answerWithEncyclopedia } = await import("./knowledge/encyclopediaAgent");
    const plan = vi.fn(async () => ({
      choices: [{ message: { content: JSON.stringify({ calls: [], answerable: "judgment_only", missing: "", fullyAnswers: false }) } }],
    }));
    const result: EncyclopediaAnswer = await answerWithEncyclopedia(
      {
        tenantId: "default",
        operatorUserId: "adam-admin",
        dayDirectorActorId: "1",
        utterance: "Should I push for the full building or start with a pilot floor?",
        surface: "voice",
        history: [],
        now: NOW,
        timeZone: "America/Los_Angeles",
      },
      { invoke: plan as never }
    );
    expect(result).toEqual({ kind: "no_retrieval_needed", fullyAnswers: false });
  });

  it("an unsupported_fact plan still speaks a truthful refusal on a single-clause fact", async () => {
    const { answerWithEncyclopedia } = await import("./knowledge/encyclopediaAgent");
    const plan = vi.fn(async () => ({
      choices: [{
        message: {
          content: JSON.stringify({
            calls: [],
            answerable: "unsupported_fact",
            missing: "a signed lease term for The Louise",
            fullyAnswers: false,
          }),
        },
      }],
    }));
    const result = await answerWithEncyclopedia(
      {
        tenantId: "default",
        operatorUserId: "adam-admin",
        dayDirectorActorId: "1",
        utterance: "What's the lease term at The Louise?",
        surface: "voice",
        history: [],
        now: NOW,
        timeZone: "America/Los_Angeles",
      },
      { invoke: plan as never }
    );
    expect(result.kind).toBe("unsupported_fact");
    expect(result.fullyAnswers).toBe(true);
    expect(result).toMatchObject({ text: expect.stringContaining("a signed lease term for The Louise") });
  });

  it("retrieved records on a compound utterance cannot set fullyAnswers true", async () => {
    const { answerWithEncyclopedia } = await import("./knowledge/encyclopediaAgent");
    const plan = vi.fn(async () => ({
      choices: [{
        message: {
          content: JSON.stringify({
            calls: [{ tool: "unpaid_orders", question: "", name: "", day: "today", terms: [] }],
            answerable: "records",
            missing: "",
            fullyAnswers: true,
          }),
        },
      }],
    }));
    const result = await answerWithEncyclopedia(
      {
        tenantId: "default",
        operatorUserId: "adam-admin",
        dayDirectorActorId: "1",
        utterance: "How many unpaid orders are there, and is it worth another visit?",
        surface: "voice",
        history: [],
        now: NOW,
        timeZone: "America/Los_Angeles",
      },
      {
        invoke: plan as never,
        runTool: vi.fn(async () => ({ tool: "unpaid_orders" as const, text: "Nothing waiting on payment." })) as never,
      }
    );
    expect(result.kind).toBe("answered");
    expect(result.fullyAnswers).toBe(false);
  });
});

describe("Slice C+D — simple factual questions stay deterministic", () => {
  it("a simple fact-only question still terminates deterministically, without calling the model", async () => {
    const followUp = vi.fn(async () => "should not be called");
    const { result, trace } = await turnFor(
      "How many unpaid orders are there?",
      {
        unpaid: vi.fn(async () => ({ orders: [], total: 0 })) as never,
        followUp: followUp as never,
      }
    );
    expect(followUp).not.toHaveBeenCalled();
    expect(trace?.path).toBe("unpaid_orders");
    expect(trace?.synthesisRequired).toBe(false);
    expect(trace?.routeOutcome).toBe("deterministic_final");
    expect(result.speak).toBeTruthy();
  });

  it("call-memory fact-only answers from quoted history without synthesis", async () => {
    const followUp = vi.fn(async () => "should not be called");
    const { result, trace } = await turnFor("What did I tell you about The Louise?", {
      searchMemory: vi.fn(async () => [
        { speaker: "OPERATOR", text: "The Louise wants a quote before month end.", occurredAt: NOW },
      ]) as never,
      followUp: followUp as never,
    });
    expect(followUp).not.toHaveBeenCalled();
    expect(trace?.path).toBe("memory_quote");
    expect(trace?.memorySearched).toBe(true);
    expect(result.speak).toContain("The Louise wants a quote");
  });
});

describe("Slice C+D — judgment and blended turns synthesize the full utterance", () => {
  it("judgment wording the old regex misses still reaches Claire", async () => {
    const followUp = vi.fn(async () => "They stall because a no is safer than a yes they cannot unwind.");
    const { result, trace } = await turnFor("Why do property managers keep stalling on this?", {
      followUp: followUp as never,
    });
    expect(classifyClaireAnswerClass("Why do property managers keep stalling on this?")).toBe("fact_only");
    expect(followUp).toHaveBeenCalledTimes(1);
    expect(followUp.mock.calls[0]![0]).toMatchObject({
      utterance: "Why do property managers keep stalling on this?",
    });
    expect(trace?.path).toBe("follow_up_model");
    expect(trace?.synthesisRequired).toBe(true);
    expect(trace?.needs_synthesis).toBe(true);
    expect(result.speak).toContain("stall");
  });

  it("the first previously-broken probe: full utterance + account history evidence", async () => {
    const UTTERANCE = "What happened at The Louise last time, and what should I do?";
    const followUp = vi.fn(async () => "Last time you toured the basement. I'd follow up with a proposal this week.");
    const { result, trace } = await turnFor(UTTERANCE, {
      accounts: async () => [{ id: 1, name: "The Louise", kind: "account" } as never],
      accountHistory: vi.fn(async () => LOUISE_HISTORY) as never,
      followUp: followUp as never,
    });
    expect(followUp).toHaveBeenCalledTimes(1);
    const call = followUp.mock.calls[0]![0] as { utterance: string; retrievedEvidence?: Array<{ source: string; text: string }> };
    expect(call.utterance).toBe(UTTERANCE);
    expect(call.retrievedEvidence?.some(item => item.source === "account_history")).toBe(true);
    expect(trace?.path).toBe("follow_up_model");
    expect(trace?.synthesisRequired).toBe(true);
    expect(result.speak).toContain("proposal");
  });

  it("the second previously-broken probe: full utterance + business-query evidence", async () => {
    const UTTERANCE = "How many orders did they place, and is it worth another visit?";
    const followUp = vi.fn(async () => "They placed 4 orders. I'd say it's worth another visit.");
    const { result, trace } = await turnFor(UTTERANCE, {
      business: {
        now: () => NOW,
        timeZone: () => "America/Los_Angeles",
        plan: async () => null,
        runQuery: vi.fn(async () => ({ status: "ok" as const, data: { kind: "scalar" as const, value: 4 } })) as never,
      },
      followUp: followUp as never,
    });
    expect(followUp).toHaveBeenCalledTimes(1);
    expect(followUp.mock.calls[0]![0]).toMatchObject({ utterance: UTTERANCE });
    expect(trace?.path).toBe("follow_up_model");
    expect(result.speak).toContain("worth another visit");
  });

  it("call-memory + judgment retrieves then synthesizes", async () => {
    const UTTERANCE = "What did I tell you about The Louise, and what should I do?";
    const followUp = vi.fn(async () => "You said they want a quote. Send it this week.");
    const { trace } = await turnFor(UTTERANCE, {
      searchMemory: vi.fn(async () => [
        { speaker: "OPERATOR", text: "The Louise wants a quote.", occurredAt: NOW },
      ]) as never,
      followUp: followUp as never,
    });
    expect(followUp).toHaveBeenCalledTimes(1);
    const call = followUp.mock.calls[0]![0] as { utterance: string; retrievedEvidence?: Array<{ source: string; text: string }> };
    expect(call.utterance).toBe(UTTERANCE);
    expect(call.retrievedEvidence?.some(item => item.source === "call_memory")).toBe(true);
    expect(trace?.path).toBe("follow_up_model");
    expect(trace?.memorySearched).toBe(true);
  });

  it("account-history + judgment synthesizes", async () => {
    const followUp = vi.fn(async () => "They asked for a formal quote — send it before Friday.");
    const { result, trace } = await turnFor("What's the history with The Louise, and should I send a quote?", {
      accounts: async () => [{ id: 1, name: "The Louise", kind: "account" } as never],
      accountHistory: vi.fn(async () => LOUISE_HISTORY) as never,
      followUp: followUp as never,
    });
    expect(trace?.evidenceSources).toContain("account_history");
    expect(result.speak).toContain("formal quote");
  });

  it("encyclopedia tool evidence + judgment synthesizes rather than terminating on retrieval", async () => {
    const UTTERANCE = "What do we know about their pricing objection, and how should I handle it?";
    const encyclopedia = vi.fn(async () => encyclopediaAnswer({
      kind: "answered",
      text: "No pricing objection is recorded.",
      fullyAnswers: false,
      evidence: [{ source: "account", text: "No pricing objection is recorded." }],
    }));
    const followUp = vi.fn(async () => "Nothing is on record. I'd ask what they compared you against.");
    const { result, trace } = await turnFor(UTTERANCE, {
      encyclopedia: encyclopedia as never,
      followUp: followUp as never,
    });
    expect(encyclopedia).toHaveBeenCalled();
    expect(followUp).toHaveBeenCalledTimes(1);
    expect(followUp.mock.calls[0]![0]).toMatchObject({ utterance: UTTERANCE });
    expect(trace?.path).toBe("follow_up_model");
    expect(result.speak).toContain("compared");
  });
});

describe("Slice C+D — mixed briefing preserves work and still synthesizes", () => {
  it("mixed work item + judgment preserves both", async () => {
    const UTTERANCE = "Deliver towels to OPUS LA. Should I go back to The Louise?";
    const followUp = vi.fn(async () => "Yes — go back to The Louise after the towel drop.");
    const { result, trace } = await turnFor(UTTERANCE, { followUp: followUp as never });
    expect(result.kind).toBe("briefing_proposed");
    expect(followUp).toHaveBeenCalledTimes(1);
    expect(followUp.mock.calls[0]![0]).toMatchObject({ utterance: UTTERANCE });
    expect(result.speak.toLowerCase()).toMatch(/towel|opus/i);
    expect(result.speak).toContain("go back to The Louise");
    expect(trace?.routeOutcome).toBe("briefing_plus_synthesis");
  });

  it("mixed work item + fact + judgment preserves all parts", async () => {
    const UTTERANCE = "Tomorrow return John's laundry. What happened with The Louise last time, and should I stop there too?";
    const followUp = vi.fn(async () => "You toured the basement last time. Yes, stop there after John's return.");
    const { result } = await turnFor(UTTERANCE, {
      accounts: async () => [{ id: 1, name: "The Louise", kind: "account" } as never],
      accountHistory: vi.fn(async () => LOUISE_HISTORY) as never,
      followUp: followUp as never,
    });
    expect(result.kind).toBe("briefing_proposed");
    expect(followUp).toHaveBeenCalledTimes(1);
    expect(followUp.mock.calls[0]![0]).toMatchObject({ utterance: UTTERANCE });
    expect(result.speak.toLowerCase()).toMatch(/john|return/i);
    expect(result.speak).toContain("stop there");
  });
});

describe("Slice C+D — unsupported facts stay truthful without discarding judgment", () => {
  it("a fact-only unsupported business fact still speaks a refusal, not a guess", async () => {
    const encyclopedia = vi.fn(async () => encyclopediaAnswer({
      kind: "unsupported_fact",
      text: "I can't answer that from Goldline's records: a signed lease term for The Louise.",
      fullyAnswers: true,
      evidence: [{ source: "unsupported_fact", text: "I can't answer that from Goldline's records: a signed lease term for The Louise." }],
    }));
    const followUp = vi.fn(async () => "should not be called");
    const { result, trace } = await turnFor("What's the lease term at The Louise?", {
      encyclopedia: encyclopedia as never,
      followUp: followUp as never,
    });
    expect(followUp).not.toHaveBeenCalled();
    expect(trace?.path).toBe("fallback");
    expect(trace?.fallbackReason).toBe("unsupported_fact");
    expect(result.speak).toContain("a signed lease term for The Louise");
  });

  it("unsupported fact + answerable judgment still synthesizes the judgment", async () => {
    const UTTERANCE = "What's the lease term at The Louise, and should I still pitch them?";
    const encyclopedia = vi.fn(async () => encyclopediaAnswer({
      kind: "unsupported_fact",
      text: "I can't answer that from Goldline's records: a signed lease term for The Louise.",
      fullyAnswers: false,
      evidence: [{ source: "unsupported_fact", text: "I can't answer that from Goldline's records: a signed lease term for The Louise." }],
    }));
    const followUp = vi.fn(async () => "I don't have the lease term on record. I'd still pitch — the last visit went well.");
    const { result, trace } = await turnFor(UTTERANCE, {
      encyclopedia: encyclopedia as never,
      followUp: followUp as never,
    });
    expect(followUp).toHaveBeenCalledTimes(1);
    expect(followUp.mock.calls[0]![0]).toMatchObject({ utterance: UTTERANCE });
    expect(trace?.path).toBe("follow_up_model");
    expect(result.speak).toContain("still pitch");
  });
});

describe("Slice C+D — existing personal/canon routing and unrelated consumers", () => {
  it("personal canon recovery still attributes guard_recovery", async () => {
    const followUp = vi.fn(async (input: { onGeneration?: (diagnostic: unknown) => void }) => {
      input.onGeneration?.({
        kind: "follow_up",
        source: "fallback",
        answerOrigin: "canon_render",
        failureReason: "ungrounded_personal_specificity_canon_rendered",
        modelRequested: "claude-sonnet-4-6",
      });
      return "Rendered from canon.";
    });
    const { trace } = await turnFor("Where exactly did you grow up?", { followUp: followUp as never });
    expect(trace?.path).toBe("guard_recovery");
    expect(trace?.fallbackReason).toBe("ungrounded_personal_specificity_canon_rendered");
  });

  it("no non-Claire model consumer file was touched by this slice", async () => {
    const { readFileSync } = await import("node:fs");
    for (const file of [
      "server/dayDirector/dayDirectorService.ts",
      "server/claire/analysis/conversationEvaluator.ts",
      "server/salesIntel/salesIntelExtraction.ts",
      "server/goldlineWorld/fieldJournalProcessingService.ts",
    ]) {
      expect(readFileSync(file, "utf8")).toContain("ENV.anthropicModel");
    }
  });
});
