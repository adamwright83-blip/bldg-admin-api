import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Claire Intelligence Repair Part 2, Slice B (corrective pass).
 *
 * The per-call-site tests in `repair2SliceB.test.ts` intercept at the
 * `invokeText`/`invoke` dependency seam — they prove the model authority is
 * *called*, but not what actually leaves the process. That gap is exactly
 * where the original bug lived: `claireModelRequest()` omitted `temperature`
 * from its return value, but `invokeTextLLM`/`invokeLLM` defaulted a missing
 * `temperature` back to `0` before constructing the Anthropic request, so
 * the wire request still carried `temperature: 0` regardless.
 *
 * This file goes one level lower: it mocks only `@anthropic-ai/sdk` itself
 * (exactly as `server/_core/llm.test.ts` does) and drives a real Claire
 * entry point — `answerClairePreDriveFollowUp` — with no `invokeText`
 * override, so the request is built by the real, unmocked
 * `claireModelRequest()` -> `invokeTextLLM()` -> `client.messages.create()`
 * chain. What `mocks.create` receives is the literal request Anthropic would
 * see.
 */

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  assertSpend: vi.fn(),
  trackUsage: vi.fn(),
}));

const envMock = vi.hoisted(() => ({
  anthropicApiKey: "test-key",
  anthropicModel: "claude-sonnet-4-6",
  anthropicModelClaire: "",
}));

vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error {
    status?: number;
  }
  class AuthenticationError extends APIError {}
  class RateLimitError extends APIError {}
  return {
    default: class Anthropic {
      messages = { create: mocks.create };
    },
    APIError,
    AuthenticationError,
    RateLimitError,
  };
});
vi.mock("../_core/env", () => ({ ENV: envMock }));
vi.mock("../agents/costTracking", () => ({
  assertAiSpendAvailable: mocks.assertSpend,
  trackModelUsage: mocks.trackUsage,
}));

import { answerClairePreDriveFollowUp } from "./preDriveConversation";

const CONTEXT = {
  businessDate: "2026-09-15",
  actorId: "adam-admin",
  macroGoalKnown: false,
  blockers: [],
  relevantTimeline: [],
} as never;

async function askClaire(): Promise<void> {
  mocks.create.mockResolvedValue({
    id: "msg-1",
    model: envMock.anthropicModelClaire || envMock.anthropicModel,
    stop_reason: "end_turn",
    content: [{ type: "text", text: "A composed answer." }],
    usage: { input_tokens: 10, output_tokens: 10 },
  });
  await answerClairePreDriveFollowUp(
    { tenantId: "default", utterance: "What should I do?", brief: "A brief.", context: CONTEXT },
    { recordGeneration: (async () => undefined) as never }
  );
}

describe("Slice B provider boundary — a real Claire request through the real wrapper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertSpend.mockResolvedValue(undefined);
    mocks.trackUsage.mockResolvedValue(undefined);
    envMock.anthropicModelClaire = "";
  });

  it("a Claude Sonnet 5 Claire request reaches the Anthropic client with no temperature property at all", async () => {
    envMock.anthropicModelClaire = "claude-sonnet-5";
    await askClaire();
    const request = mocks.create.mock.calls[0][0];
    expect(request.model).toBe("claude-sonnet-5");
    expect(request).not.toHaveProperty("temperature");
    // Sonnet 5 also defaults extended thinking on; Slice B must not let a
    // model swap silently add reasoning latency.
    expect(request.thinking).toEqual({ type: "disabled" });
  });

  it("a Claude Opus 5 Claire request behaves the same way", async () => {
    envMock.anthropicModelClaire = "claude-opus-5";
    await askClaire();
    const request = mocks.create.mock.calls[0][0];
    expect(request.model).toBe("claude-opus-5");
    expect(request).not.toHaveProperty("temperature");
    expect(request.thinking).toEqual({ type: "disabled" });
  });

  it("today's model — claude-sonnet-4-6 — still reaches the Anthropic client with its existing explicit temperature and no thinking override", async () => {
    // Neither ANTHROPIC_MODEL_CLAIRE nor a different ANTHROPIC_MODEL is set:
    // production's actual situation before this slice.
    await askClaire();
    const request = mocks.create.mock.calls[0][0];
    expect(request.model).toBe("claude-sonnet-4-6");
    expect(request.temperature).toBe(0.6);
    expect(request).not.toHaveProperty("thinking");
  });
});
