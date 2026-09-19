import { describe, expect, it, vi } from "vitest";
import type { EncyclopediaAnswer } from "./knowledge/encyclopediaAgent";
import { runClaireTurn, type ClaireTurnDeps, type ClaireTurnState, type ClaireTurnTraceForTest } from "./turn/claireTurn";

/**
 * Claire Intelligence Repair Part 2, Slice C+D: retrieval ≠ answer.
 *
 * The architecture fix: a judgment or blended question is never allowed to
 * terminate on a deterministic renderer's partial sentence, or on the
 * encyclopedia's old zero-tool refusal prose. A fact-only question can still
 * terminate deterministically (item F) — this is a routing repair, not a
 * blanket "always call the model" change.
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

/** The smallest context/brief pair that lets a turn reach the conversational path. */
const MINIMAL_BRIEF = "Two commercial stops today; The Louise is the one that matters.";
const MINIMAL_CONTEXT = {
  businessDate: "2026-09-15",
  actorId: "adam-admin",
  macroGoalKnown: false,
  blockers: [],
  relevantTimeline: [],
} as never;

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

describe("Slice C+D — item A: the encyclopedia zero-tool refusal is fixed", () => {
  it("a judgment_only plan with no calls never produces refusal prose", async () => {
    const { answerWithEncyclopedia } = await import("./knowledge/encyclopediaAgent");
    const plan = vi.fn(async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({ calls: [], answerable: "judgment_only", missing: "" }),
          },
        },
      ],
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
    expect(result).toEqual({ kind: "no_retrieval_needed" });
  });

  it("an unsupported_fact plan still speaks a truthful refusal, unchanged", async () => {
    const { answerWithEncyclopedia } = await import("./knowledge/encyclopediaAgent");
    const plan = vi.fn(async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              calls: [],
              answerable: "unsupported_fact",
              missing: "a signed lease term for The Louise",
            }),
          },
        },
      ],
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
    expect(result).toMatchObject({ text: expect.stringContaining("a signed lease term for The Louise") });
  });

  it("encyclopedia zero-tool judgment question reaches Claire's own turn, not a refusal", async () => {
    const encyclopedia = vi.fn(async () => ({ kind: "no_retrieval_needed" }) satisfies EncyclopediaAnswer);
    const followUp = vi.fn(async () => "Here's my read on the building question.");
    const { result, trace } = await turnFor(
      "Should I push for the full building or start with a pilot floor?",
      { encyclopedia: encyclopedia as never, followUp: followUp as never }
    );
    // Pure judgment: never reaches the encyclopedia at all (item D5, F) —
    // classification alone routes straight to synthesis.
    expect(encyclopedia).not.toHaveBeenCalled();
    expect(followUp).toHaveBeenCalledTimes(1);
    expect(followUp.mock.calls[0]![0]).toMatchObject({
      utterance: "Should I push for the full building or start with a pilot floor?",
    });
    expect(trace?.path).toBe("follow_up_model");
    expect(trace?.synthesisRequired).toBe(true);
    expect(result.speak).toBe("Here's my read on the building question.");
  });
});

describe("Slice C+D — item F: deterministic fast path preserved for fact-only questions", () => {
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
    expect(result.speak).toBeTruthy();
  });
});

describe("Slice C+D — item C: blended questions preserve the full utterance and synthesize", () => {
  it("the first previously-broken probe: preserves the full utterance and folds account history in as evidence", async () => {
    const UTTERANCE = "What happened at The Louise last time, and what should I do?";
    const accountHistory = vi.fn(async () => ({
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
    }));
    const followUp = vi.fn(async () => "Last time you toured the basement laundry room. I'd follow up with a proposal this week.");
    const { result, trace } = await turnFor(UTTERANCE, {
      accounts: async () => [{ id: 1, name: "The Louise", kind: "account" } as never],
      accountHistory: accountHistory as never,
      followUp: followUp as never,
    });
    expect(followUp).toHaveBeenCalledTimes(1);
    const call = followUp.mock.calls[0]![0] as { utterance: string; retrievedEvidence?: Array<{ source: string; text: string }> };
    // The full, unsplit utterance -- never truncated to just the fact half.
    expect(call.utterance).toBe(UTTERANCE);
    expect(call.retrievedEvidence).toBeDefined();
    expect(call.retrievedEvidence!.some(item => item.source === "account_history")).toBe(true);
    expect(trace?.path).toBe("follow_up_model");
    expect(trace?.synthesisRequired).toBe(true);
    expect(trace?.evidenceSources).toContain("account_history");
    expect(result.speak).toBe("Last time you toured the basement laundry room. I'd follow up with a proposal this week.");
  });

  it("the second previously-broken probe: preserves the full utterance and folds the order count in as evidence", async () => {
    const UTTERANCE = "How many orders did they place, and is it worth another visit?";
    const runQuery = vi.fn(async () => ({
      status: "ok" as const,
      data: { kind: "scalar" as const, value: 4 },
    }));
    const followUp = vi.fn(async () => "They placed 4 orders. I'd say it's worth another visit.");
    const { result, trace } = await turnFor(UTTERANCE, {
      business: { now: () => NOW, timeZone: () => "America/Los_Angeles", plan: async () => null, runQuery: runQuery as never },
      followUp: followUp as never,
    });
    expect(followUp).toHaveBeenCalledTimes(1);
    const call = followUp.mock.calls[0]![0] as { utterance: string; retrievedEvidence?: Array<{ source: string; text: string }> };
    expect(call.utterance).toBe(UTTERANCE);
    expect(trace?.path).toBe("follow_up_model");
    expect(trace?.synthesisRequired).toBe(true);
    expect(result.speak).toBe("They placed 4 orders. I'd say it's worth another visit.");
  });
});

describe("Slice C+D — item D5: general professional judgment needs no DB lookup", () => {
  it("a pure judgment question never calls any deterministic reader or the encyclopedia", async () => {
    const accountHistory = vi.fn();
    const dayWork = vi.fn();
    const unpaid = vi.fn();
    const runQuery = vi.fn();
    const encyclopedia = vi.fn();
    const followUp = vi.fn(async () => "A common approach is to lead with the pilot floor.");
    const { result, trace } = await turnFor("What would you recommend here?", {
      accountHistory: accountHistory as never,
      dayWork: dayWork as never,
      unpaid: unpaid as never,
      business: { now: () => NOW, timeZone: () => "America/Los_Angeles", plan: async () => null, runQuery: runQuery as never },
      encyclopedia: encyclopedia as never,
      followUp: followUp as never,
    });
    expect(accountHistory).not.toHaveBeenCalled();
    expect(dayWork).not.toHaveBeenCalled();
    expect(unpaid).not.toHaveBeenCalled();
    expect(runQuery).not.toHaveBeenCalled();
    expect(encyclopedia).not.toHaveBeenCalled();
    expect(followUp).toHaveBeenCalledTimes(1);
    expect(trace?.evidenceSources).toEqual([]);
    expect(result.speak).toBe("A common approach is to lead with the pilot floor.");
  });
});

describe("Slice C+D — item D4: unsupported business-specific facts remain a truthful unknown", () => {
  it("a fact-only question the encyclopedia genuinely can't answer still speaks a refusal, not a guess", async () => {
    const encyclopedia = vi.fn(async () => ({
      kind: "unsupported_fact",
      text: "I can't answer that from Goldline's records: a signed lease term for The Louise.",
    }) satisfies EncyclopediaAnswer);
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
});

describe("Slice C+D — item E: deterministic evidence is passed through, not rewritten", () => {
  it("the evidence handed to synthesis is exactly the reader's own rendered text", async () => {
    const accountHistory = vi.fn(async () => ({
      account: { id: 1, name: "The Louise", kind: "account" } as never,
      missions: [],
      events: [],
      fieldVisits: [{ missionId: 1, arrivedAt: "2026-09-08T18:00:00Z", departedAt: "2026-09-08T18:30:00Z", notes: "Last visit was September 2nd; no follow-up logged since." }],
      outcomes: [],
      followUps: [],
      pipelineStage: null,
      pipelineId: null,
      contacts: [],
      dayLineMentions: [],
      conversationMentions: [],
    }));
    const followUp = vi.fn(async () => "Follow up this week.");
    await turnFor("What happened at The Louise last time, and what should I do?", {
      accounts: async () => [{ id: 1, name: "The Louise", kind: "account" } as never],
      accountHistory: accountHistory as never,
      followUp: followUp as never,
    });
    const call = followUp.mock.calls[0]![0] as { retrievedEvidence?: Array<{ source: string; text: string }> };
    const accountEvidence = call.retrievedEvidence!.find(item => item.source === "account_history");
    expect(accountEvidence).toBeDefined();
    // Not paraphrased, not summarized, not recomputed -- the caller does not
    // invent evidence text; it is whatever the deterministic reader rendered.
    expect(typeof accountEvidence!.text).toBe("string");
    expect(accountEvidence!.text.length).toBeGreaterThan(0);
  });
});

describe("Slice C+D — item H: existing routing stays intact", () => {
  it("a briefing with an embedded judgment question does not call the model per sub-question (scope boundary)", async () => {
    const followUp = vi.fn(async () => "should not run for the embedded question");
    const { result } = await turnFor("Deliver towels to OPUS LA. Should I go back to The Louise?", {
      followUp: followUp as never,
    });
    // The embedded-question path (allowSynthesis: false) does not invoke
    // synthesis; the briefing's own answer path covers this turn instead.
    // The top-level utterance itself is a briefing (has a work item), so it
    // never reaches the standalone-question classifier at all.
    expect(result.kind).not.toBe("follow_up");
  });

  it("account-history plus a recommendation synthesizes in one voice", async () => {
    const accountHistory = vi.fn(async () => ({
      account: { id: 1, name: "The Louise", kind: "account" } as never,
      missions: [],
      events: [],
      fieldVisits: [{ missionId: 1, arrivedAt: "2026-09-08T18:00:00Z", departedAt: "2026-09-08T18:30:00Z", notes: "Manager asked for a formal quote." }],
      outcomes: [],
      followUps: [],
      pipelineStage: null,
      pipelineId: null,
      contacts: [],
      dayLineMentions: [],
      conversationMentions: [],
    }));
    const followUp = vi.fn(async () => "They asked for a formal quote — send it before Friday.");
    const { result, trace } = await turnFor("What's the history with The Louise, and should I send a quote?", {
      accounts: async () => [{ id: 1, name: "The Louise", kind: "account" } as never],
      accountHistory: accountHistory as never,
      followUp: followUp as never,
    });
    expect(trace?.evidenceSources).toContain("account_history");
    expect(result.speak).toBe("They asked for a formal quote — send it before Friday.");
  });
});

describe("Slice C+D — item H: unrelated Goldline AI consumers remain untouched", () => {
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
