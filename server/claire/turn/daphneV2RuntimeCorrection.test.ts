import { describe, expect, it, vi } from "vitest";
import { runClaireTurn, type ClaireTurnDeps, type ClaireTurnState } from "./claireTurn";
import { safeClaireBrainV3Fallback } from "./brainV3";

function context() {
  return {
    businessDate: "2026-10-07",
    actorId: "adam",
    macroGoalKnown: false,
    blockers: [],
    relevantTimeline: [],
  } as never;
}

function depsForRuntimeLoop(memory: { concise: boolean }) {
  const events: string[] = [];
  const capture = vi.fn(async (input: { utterance: string }) => {
    events.push("capture");
    if (/shorter|concise|brief/i.test(input.utterance)) memory.concise = true;
    return {
      status: memory.concise ? "persisted" as const : "no_match" as const,
      corrections: memory.concise
        ? [{ preferenceKey: "response_detail" as const, value: 0.2, evidenceText: input.utterance }]
        : [],
      observationIds: memory.concise ? ["obs-1"] : [],
    };
  });
  const load = vi.fn(async () => {
    events.push("load");
    return memory.concise
      ? {
          cardGeneratedAt: "2026-10-07T19:00:00.000Z",
          evidenceCount: 1,
          promptSection:
            "DAPHNE V2 USER-ADAPTATION CONTEXT. Declared response detail preference: 0.20 on [0,1].",
        }
      : null;
  });
  const followUp = vi.fn(async (input: { daphnePromptSection?: string | null }) => {
    events.push("followUp");
    return input.daphnePromptSection?.includes("0.20")
      ? "Do the highest-value follow-up first."
      : "I would start by reviewing the full situation and then deciding which follow-up deserves attention first.";
  });

  const overrides: Partial<ClaireTurnDeps> = {
    now: () => new Date("2026-10-07T12:00:00-07:00"),
    timeZone: () => "America/Los_Angeles",
    business: {
      now: () => new Date("2026-10-07T12:00:00-07:00"),
      timeZone: () => "America/Los_Angeles",
      plan: async () => null,
      runQuery: vi.fn() as never,
    },
    commitment: vi.fn(async () => ({ kind: "not_applicable" as const })) as never,
    followUp: followUp as never,
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
    watchBoard: vi.fn(async () => ({ brief: "" })) as never,
    recoveryObligations: async () => [],
    doctrineTurn: undefined,
    classifyPriorClaim: (async () => null) as never,
    rerunBusinessQuery: vi.fn() as never,
    operatorContextShadowEnabled: () => false,
    loadOperatorAdaptationDecision: async () => null,
    captureDaphneV2PreferenceCorrections: capture as never,
    loadDaphneV2Guidance: load,
    brainV3: vi.fn(async (input: any) => {
      const text = String(input.utterance ?? "");
      if (/what should i do/i.test(text)) {
        return {
          ...safeClaireBrainV3Fallback(),
          act: "question",
          rationale: "Question for Daphne runtime correction acceptance test.",
        };
      }
      if (/shorter|concise|brief/i.test(text)) {
        return {
          ...safeClaireBrainV3Fallback(),
          act: "correction",
          rationale: "Explicit style correction.",
        };
      }
      return safeClaireBrainV3Fallback();
    }) as never,
  };

  return { events, capture, load, followUp, overrides };
}

describe("Daphne V2 real Claire correction loop", () => {
  it("persists Turn A correction before reloading Daphne and changes the next call's generated response", async () => {
    const memory = { concise: false };
    const h = depsForRuntimeLoop(memory);

    await runClaireTurn(
      {
        tenantId: "tenant-a",
        operatorUserId: "adam",
        dayDirectorActorId: "1",
        surface: "text",
        utterance: "Keep your answers shorter from now on.",
        state: {} as ClaireTurnState,
        conversationKey: "call-a",
        brief: "b",
        context: context(),
      },
      h.overrides
    );

    expect(memory.concise).toBe(true);
    const captureIndex = h.events.indexOf("capture");
    const loadIndex = h.events.indexOf("load");
    expect(captureIndex).toBeGreaterThanOrEqual(0);
    expect(loadIndex).toBeGreaterThan(captureIndex);

    h.events.length = 0;
    const nextCall = await runClaireTurn(
      {
        tenantId: "tenant-a",
        operatorUserId: "adam",
        dayDirectorActorId: "1",
        surface: "text",
        utterance: "What should I do about The Louise?",
        state: {} as ClaireTurnState,
        conversationKey: "call-b",
        brief: "b",
        context: context(),
      },
      h.overrides
    );

    expect(h.load).toHaveBeenCalled();
    expect(h.followUp).toHaveBeenCalledWith(
      expect.objectContaining({
        daphnePromptSection: expect.stringContaining(
          "Declared response detail preference: 0.20"
        ),
      })
    );
    expect(nextCall.speak).toBe("Do the highest-value follow-up first.");
  });
});
