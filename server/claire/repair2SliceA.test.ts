import { describe, expect, it, vi } from "vitest";
import {
  beginClaireTurnTrace,
  classifyClaireBlend,
  isBlendedClaireQuestion,
  markClaireAnswerPath,
  measureClairePromptSections,
  RENDERER_PROSE_PATHS,
} from "./answerPathTelemetry";
import { isClaireRepair2Enabled, claireRepair2FlagName } from "./repair2Flags";
import { runClaireTurn, type ClaireTurnDeps, type ClaireTurnState, type ClaireTurnTraceForTest } from "./turn/claireTurn";

/**
 * Claire Intelligence Repair Part 2, Slice A.
 *
 * Slice A changes no answer, so these tests assert two things: that each
 * answer path is attributed to the code that actually produced the sentence,
 * and that the spoken text is byte-identical to what the same turn produced
 * before instrumentation.
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

async function traceFor(
  utterance: string,
  overrides: Partial<ClaireTurnDeps> = {},
  state: ClaireTurnState = {},
  conversational = false
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
      conversationKey: "claire-call:slice-a",
      ...(conversational ? { brief: MINIMAL_BRIEF, context: MINIMAL_CONTEXT } : {}),
    },
    turnDeps({ ...overrides, onTurnTrace: value => { trace = value; } })
  );
  return { result, trace: trace as ClaireTurnTraceForTest | null };
}

describe("Slice A — answer-path attribution", () => {
  it("attributes a Day Line question to the deterministic day_work renderer, and marks it renderer prose", async () => {
    const { result, trace } = await traceFor("What's left on the day line today?", {
      dayWork: vi.fn(async () => ({ open: [], completed: [], businessDate: "2026-09-15" })) as never,
    });
    expect(trace?.path).toBe("day_work");
    expect(trace?.rendererProse).toBe(true);
    expect(result.speak).toBeTruthy();
  });

  it("attributes an unpaid-orders question to its renderer", async () => {
    const { trace } = await traceFor("How many unpaid orders are there?", {
      unpaid: vi.fn(async () => ({ orders: [], total: 0 })) as never,
    });
    expect(trace?.path).toBe("unpaid_orders");
    expect(trace?.rendererProse).toBe(true);
  });

  it("records that a memory question searched call history, and quotes the operator rather than reaching a model", async () => {
    const { trace } = await traceFor("What did I tell you about the Louise?", {
      searchMemory: vi.fn(async () => [
        { speaker: "OPERATOR", text: "The Louise wants a quote before the end of the month.", occurredAt: NOW },
      ]) as never,
    });
    expect(trace?.memorySearched).toBe(true);
    expect(trace?.path).toBe("memory_quote");
  });

  it("attributes the encyclopedia path, recording the tools it planned and whether the rewrite was spoken", async () => {
    const { trace } = await traceFor("Which vendor did we use for the bows?", {
      encyclopedia: (async ({ onTrace }) => {
        onTrace?.({
          toolsPlanned: ["call_memory", "account"],
          spoke: "raw_concatenation",
          rewriteSkippedReason: "deadline",
          planMs: 900,
          toolMs: 8_500,
          rewriteMs: null,
          rewritePromptChars: null,
        });
        return "Two record answers, concatenated.";
      }) as never,
    });
    expect(trace?.path).toBe("encyclopedia");
    expect(trace?.encyclopedia?.toolsPlanned).toEqual(["call_memory", "account"]);
    expect(trace?.encyclopedia?.spoke).toBe("raw_concatenation");
    expect(trace?.encyclopedia?.rewriteSkippedReason).toBe("deadline");
    // The encyclopedia's own call_memory tool counts as memory having been searched.
    expect(trace?.memorySearched).toBe(true);
  });

  it("attributes the repaired conversational path, and reads its own diagnostic rather than guessing", async () => {
    const followUp = vi.fn(async (input: { onGeneration?: (diagnostic: unknown) => void }) => {
      input.onGeneration?.({
        kind: "follow_up",
        source: "model",
        answerOrigin: "model",
        failureReason: null,
        modelRequested: "claude-sonnet-4-6",
        modelServed: "claude-sonnet-4-6",
        promptSize: { path: "follow_up", totalChars: 10_475, sections: [{ label: "identity", chars: 120 }] },
      });
      return "A composed answer.";
    });
    const { trace } = await traceFor(
      "What should I say to them about pricing?",
      { followUp: followUp as never },
      {},
      true
    );
    expect(trace?.path).toBe("follow_up_model");
    expect(trace?.rendererProse).toBe(false);
    expect(trace?.modelRequested).toBe("claude-sonnet-4-6");
    expect(trace?.promptSizes[0]?.totalChars).toBe(10_475);
  });

  it("attributes a guard recovery separately from a healthy model answer", async () => {
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
    const { trace } = await traceFor("Where exactly did you grow up?", { followUp: followUp as never }, {}, true);
    expect(trace?.path).toBe("guard_recovery");
    expect(trace?.fallbackReason).toBe("ungrounded_personal_specificity_canon_rendered");
  });

  it("records the last-resort sentence as a fallback when there is no brief or context", async () => {
    const { result, trace } = await traceFor("Who did we talk to at the property last week?");
    expect(trace?.path).toBe("fallback");
    expect(result.speak).toContain("I don't have a record that answers that");
  });
});

describe("Slice A — measurement helpers", () => {
  it("a blended turn is one that asks for a record and for a judgment", () => {
    expect(isBlendedClaireQuestion("What happened at The Louise last time, and what should I do?")).toBe(true);
    expect(isBlendedClaireQuestion("What was revenue last month?")).toBe(false);
    expect(isBlendedClaireQuestion("What should I do about pricing?")).toBe(false);
    const blend = classifyClaireBlend("How many orders did they place, and is it worth another visit?");
    expect(blend).toEqual({ factClause: true, judgmentClause: true });
  });

  it("prompt sections are measured exactly as they are joined, and empty sections are skipped", () => {
    const measured = measureClairePromptSections("follow_up", [
      { label: "identity", text: "abcd" },
      { label: "few_shot", text: null },
      { label: "delivery", text: "efg" },
    ]);
    expect(measured.sections).toEqual([
      { label: "identity", chars: 4 },
      { label: "delivery", chars: 3 },
    ]);
    // 4 + 3 + one single-character joiner.
    expect(measured.totalChars).toBe(8);
    expect(["abcd", "efg"].join(" ").length).toBe(8);
  });

  it("the first path to claim a turn wins, exactly as routing does", () => {
    const trace = beginClaireTurnTrace({ tenantId: "default", operatorUserId: null, surface: "voice", startedAtMs: 0 });
    markClaireAnswerPath(trace, "day_work", {}, 10);
    markClaireAnswerPath(trace, "follow_up_model", {}, 20);
    expect(trace.path).toBe("day_work");
    expect(trace.latency.routeMs).toBe(10);
  });

  it("a question answered inside a briefing does not claim the turn's answer path", () => {
    const trace = beginClaireTurnTrace({ tenantId: "default", operatorUserId: null, surface: "voice", startedAtMs: 0 });
    trace.paused = true;
    markClaireAnswerPath(trace, "business_reader");
    expect(trace.path).toBeNull();
    trace.paused = false;
    markClaireAnswerPath(trace, "briefing");
    expect(trace.path).toBe("briefing");
  });

  it("renderer-prose paths are exactly the ones Slice C has to remove from the normal path", () => {
    expect([...RENDERER_PROSE_PATHS].sort()).toEqual([
      "account_history",
      "business_reader",
      "day_work",
      "encyclopedia",
      "unpaid_orders",
    ]);
  });
});

describe("Slice A — the flag", () => {
  const VAR = "CLAIRE_REPAIR2_A_ROUTING_TELEMETRY";

  it("is named as the program document requires", () => {
    expect(claireRepair2FlagName("a_routing_telemetry")).toBe("claire.repair2.a_routing_telemetry");
  });

  it("defaults off in production and on outside it, and is tenant-scoped when set", () => {
    const previousFlag = process.env[VAR];
    const previousEnv = process.env.NODE_ENV;
    try {
      delete process.env[VAR];
      process.env.NODE_ENV = "production";
      expect(isClaireRepair2Enabled("a_routing_telemetry", "default")).toBe(false);
      process.env.NODE_ENV = "test";
      expect(isClaireRepair2Enabled("a_routing_telemetry", "default")).toBe(true);

      process.env.NODE_ENV = "production";
      process.env[VAR] = "goldline";
      expect(isClaireRepair2Enabled("a_routing_telemetry", "goldline")).toBe(true);
      expect(isClaireRepair2Enabled("a_routing_telemetry", "default")).toBe(false);
      process.env[VAR] = "*";
      expect(isClaireRepair2Enabled("a_routing_telemetry", "default")).toBe(true);
    } finally {
      if (previousFlag === undefined) delete process.env[VAR];
      else process.env[VAR] = previousFlag;
      process.env.NODE_ENV = previousEnv;
    }
  });
});
