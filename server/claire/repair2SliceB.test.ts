import { afterEach, describe, expect, it, vi } from "vitest";
import { claireModelAcceptsSampling, claireModelDefaultsToThinking, claireModelId, claireModelRequest } from "./claireModel";

/**
 * Claire Intelligence Repair Part 2, Slice B.
 *
 * One model authority for every call that participates in answering the
 * operator. These tests prove the contract at each call site, prove the
 * fallback when the Claire-specific override is absent, and prove that
 * unrelated Goldline model consumers are untouched.
 */

const CLAIRE_VAR = "ANTHROPIC_MODEL_CLAIRE";
const GENERIC_VAR = "ANTHROPIC_MODEL";
const previous = { claire: process.env[CLAIRE_VAR], generic: process.env[GENERIC_VAR] };

/**
 * ENV is captured at module load, so the authority is exercised through a
 * fresh module registry rather than by mutating a frozen object.
 */
async function withModelEnv<T>(
  env: { claire?: string; generic?: string },
  work: (modules: {
    claireModelId: typeof claireModelId;
    claireModelRequest: typeof claireModelRequest;
  }) => Promise<T> | T
): Promise<T> {
  vi.resetModules();
  if (env.claire === undefined) delete process.env[CLAIRE_VAR];
  else process.env[CLAIRE_VAR] = env.claire;
  if (env.generic === undefined) delete process.env[GENERIC_VAR];
  else process.env[GENERIC_VAR] = env.generic;
  try {
    return await work(await import("./claireModel"));
  } finally {
    vi.resetModules();
    if (previous.claire === undefined) delete process.env[CLAIRE_VAR];
    else process.env[CLAIRE_VAR] = previous.claire;
    if (previous.generic === undefined) delete process.env[GENERIC_VAR];
    else process.env[GENERIC_VAR] = previous.generic;
  }
}

afterEach(() => {
  vi.resetModules();
});

describe("Slice B — the model authority", () => {
  it("prefers the Claire-specific override", async () => {
    await withModelEnv({ claire: "claude-sonnet-5", generic: "claude-sonnet-4-6" }, mod => {
      expect(mod.claireModelId()).toBe("claude-sonnet-5");
    });
  });

  it("falls back to the generic variable when the Claire override is absent", async () => {
    await withModelEnv({ generic: "claude-sonnet-4-6" }, mod => {
      expect(mod.claireModelId()).toBe("claude-sonnet-4-6");
    });
  });

  it("falls back to the built-in default when neither is set — production's situation before this slice", async () => {
    await withModelEnv({}, mod => {
      expect(mod.claireModelId()).toBe("claude-sonnet-4-6");
    });
  });

  it("omits sampling for models that reject it, and keeps it for models that accept it", () => {
    // Current generation: temperature/top_p/top_k were removed and return 400.
    for (const model of [
      "claude-opus-5",
      "claude-sonnet-5",
      "claude-opus-4-8",
      "claude-opus-4-7",
      "claude-fable-5-1",
    ]) {
      expect(claireModelAcceptsSampling(model)).toBe(false);
    }
    // The model production runs today, and older models, still accept it.
    for (const model of ["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5"]) {
      expect(claireModelAcceptsSampling(model)).toBe(true);
    }
  });

  it("keeps today's request shape byte-for-byte on the model production actually runs", async () => {
    await withModelEnv({}, mod => {
      expect(mod.claireModelRequest(0.6)).toEqual({ model: "claude-sonnet-4-6", temperature: 0.6 });
    });
  });

  it("omits temperature via an explicit flag rather than a value the wrapper will silently default back to 0", async () => {
    await withModelEnv({ claire: "claude-opus-5" }, mod => {
      // Corrective pass: this must be `omitTemperature: true`, not simply
      // the absence of a `temperature` key -- invokeLLM/invokeTextLLM used
      // to default a missing temperature back to 0, so a returned object
      // without the key was indistinguishable from "send temperature 0" at
      // the provider boundary. See server/_core/llm.test.ts for the proof
      // that this flag actually changes the request.
      expect(mod.claireModelRequest(0.6)).toEqual({
        model: "claude-opus-5",
        omitTemperature: true,
        disableThinking: true,
      });
    });
  });

  it("does not disable thinking for a model that keeps today's no-thinking-by-default behavior", async () => {
    await withModelEnv({ claire: "claude-sonnet-4-6" }, mod => {
      expect(mod.claireModelRequest(0.6)).toEqual({ model: "claude-sonnet-4-6", temperature: 0.6 });
    });
  });

  it("identifies exactly the models that default thinking on and can be told to disable it", () => {
    for (const model of ["claude-opus-5", "claude-sonnet-5"]) {
      expect(claireModelDefaultsToThinking(model)).toBe(true);
    }
    // These already run with no thinking by default -- no flag needed.
    for (const model of ["claude-sonnet-4-6", "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6"]) {
      expect(claireModelDefaultsToThinking(model)).toBe(false);
    }
    // These run thinking unconditionally and reject { type: "disabled" }
    // with a 400 -- must never be told to disable it.
    for (const model of ["claude-fable-5", "claude-fable-5-1", "claude-mythos-5", "claude-mythos-5-1"]) {
      expect(claireModelDefaultsToThinking(model)).toBe(false);
    }
  });

  it("a model that both rejects sampling and defaults thinking on gets both flags together", async () => {
    await withModelEnv({ claire: "claude-sonnet-5" }, mod => {
      expect(mod.claireModelRequest(0)).toEqual({
        model: "claude-sonnet-5",
        omitTemperature: true,
        disableThinking: true,
      });
    });
  });
});

describe("Slice B — every Claire answer-path call site uses the authority", () => {
  /** Captures the params of the first model call a Claire entry point makes. */
  function capture() {
    const calls: Array<Record<string, unknown>> = [];
    const invoke = vi.fn(async (params: Record<string, unknown>) => {
      calls.push(params);
      throw new Error("captured");
    });
    return { calls, invoke };
  }

  const CONTEXT = {
    businessDate: "2026-09-15",
    actorId: "adam-admin",
    macroGoalKnown: false,
    blockers: [],
    relevantTimeline: [],
  } as never;

  it("the repaired conversational path", async () => {
    await withModelEnv({ claire: "claude-sonnet-5" }, async () => {
      const { answerClairePreDriveFollowUp } = await import("./preDriveConversation");
      const { calls, invoke } = capture();
      await answerClairePreDriveFollowUp(
        { tenantId: "default", utterance: "What should I do?", brief: "A brief.", context: CONTEXT },
        { invokeText: invoke as never, recordGeneration: (async () => undefined) as never }
      );
      expect(calls[0]?.model).toBe("claude-sonnet-5");
      expect(calls[0]).not.toHaveProperty("temperature");
    });
  });

  it("the opening brief", async () => {
    await withModelEnv({ claire: "claude-sonnet-5" }, async () => {
      const { writeClairePreDriveBrief } = await import("./reasoning");
      const { calls, invoke } = capture();
      await writeClairePreDriveBrief(
        { tenantId: "default", context: CONTEXT },
        { invokeText: invoke as never, recordGeneration: (async () => undefined) as never }
      );
      expect(calls[0]?.model).toBe("claude-sonnet-5");
    });
  });

  it("the encyclopedia planner — the call site PR 1 missed", async () => {
    await withModelEnv({ claire: "claude-sonnet-5" }, async () => {
      const { answerWithEncyclopedia } = await import("./knowledge/encyclopediaAgent");
      const { calls, invoke } = capture();
      await answerWithEncyclopedia(
        {
          tenantId: "default",
          operatorUserId: "adam-admin",
          dayDirectorActorId: "1",
          utterance: "Which vendor did we use?",
          surface: "voice",
          history: [],
          now: new Date("2026-09-15T16:00:00Z"),
          timeZone: "America/Los_Angeles",
        },
        { invoke: invoke as never }
      ).catch(() => null);
      expect(calls[0]?.model).toBe("claude-sonnet-5");
      expect(calls[0]).not.toHaveProperty("temperature");
    });
  });

  it("the encyclopedia rewrite — the other call site PR 1 missed", async () => {
    await withModelEnv({ claire: "claude-sonnet-5" }, async () => {
      const { answerWithEncyclopedia } = await import("./knowledge/encyclopediaAgent");
      const rewrite = capture();
      // A plan with two tool calls, so the rewrite step is reached.
      const plan = vi.fn(async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                calls: [
                  { tool: "unpaid_orders", question: "", name: "", day: "today", terms: [] },
                  { tool: "day_work", question: "", name: "", day: "today", terms: [] },
                ],
                missing: "",
              }),
            },
          },
        ],
      }));
      await answerWithEncyclopedia(
        {
          tenantId: "default",
          operatorUserId: "adam-admin",
          dayDirectorActorId: "1",
          utterance: "What's open and what's left today?",
          surface: "voice",
          history: [],
          now: new Date("2026-09-15T16:00:00Z"),
          timeZone: "America/Los_Angeles",
        },
        {
          invoke: plan as never,
          invokeText: rewrite.invoke as never,
          runTool: (async (call: { tool: string }) => ({ tool: call.tool, text: "A record answer." })) as never,
        }
      );
      expect(rewrite.calls[0]?.model).toBe("claude-sonnet-5");
    });
  });

  it("the business query planner", async () => {
    await withModelEnv({ claire: "claude-sonnet-5" }, async () => {
      const { planBusinessQuestionWithLLM } = await import("./businessConversation");
      const { calls, invoke } = capture();
      await planBusinessQuestionWithLLM(
        { tenantId: "default", utterance: "How did we do?", previous: null, today: "2026-09-15" },
        invoke as never
      );
      expect(calls[0]?.model).toBe("claude-sonnet-5");
    });
  });

  it("the briefing extractor", async () => {
    await withModelEnv({ claire: "claude-sonnet-5" }, async () => {
      const { extractBriefingWithModel } = await import("./briefing/llmBriefing");
      const { calls, invoke } = capture();
      await extractBriefingWithModel(
        {
          tenantId: "default",
          utterance: "Deliver towels and pick up from Coast.",
          clock: { today: "2026-09-15", minutesNow: 540 },
          vocabulary: [],
        } as never,
        { invoke: invoke as never }
      );
      expect(calls[0]?.model).toBe("claude-sonnet-5");
    });
  });

  it("the commitment-loop classifier", async () => {
    await withModelEnv({ claire: "claude-sonnet-5" }, async () => {
      const { classifyVoiceWorkStatement } = await import("./voiceCommitmentLoop");
      const { calls, invoke } = capture();
      // A phrasing the fast path and the heuristics both decline, so the
      // model call is actually reached.
      await classifyVoiceWorkStatement(
        { tenantId: "default", utterance: "The Louise situation is probably worth a look at some point.", campaignSummary: null },
        { invoke: invoke as never }
      );
      expect(calls[0]?.model).toBe("claude-sonnet-5");
    });
  });
});

describe("Slice B — unrelated model consumers are untouched", () => {
  it("leaves non-Claire Goldline consumers on the generic model variable", async () => {
    // These are separate consumers with their own model choices. Converting
    // them would change unrelated behavior and is explicitly out of scope.
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

  it("no Claire answer-path module sends a bare temperature any more", async () => {
    const { readFileSync } = await import("node:fs");
    for (const file of [
      "server/claire/preDriveConversation.ts",
      "server/claire/reasoning.ts",
      "server/claire/knowledge/encyclopediaAgent.ts",
      "server/claire/voiceCommitmentLoop.ts",
    ]) {
      expect(readFileSync(file, "utf8")).not.toMatch(/^\s+temperature: [\d.]+,$/m);
    }
  });
});
