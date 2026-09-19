import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  assertSpend: vi.fn(),
  trackUsage: vi.fn(),
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
vi.mock("./env", () => ({
  ENV: { anthropicApiKey: "test-key", anthropicModel: "claude-test" },
}));
vi.mock("../agents/costTracking", () => ({
  assertAiSpendAvailable: mocks.assertSpend,
  trackModelUsage: mocks.trackUsage,
}));

import { invokeLLM, invokeTextLLM, TextLLMInvocationError } from "./llm";

describe("E — shared Anthropic LLM behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertSpend.mockResolvedValue(undefined);
    mocks.trackUsage.mockResolvedValue(undefined);
  });

  it("keeps structured invokeLLM schema-required and tool-backed", async () => {
    await expect(
      invokeLLM({ messages: [{ role: "user", content: "hello" }] })
    ).rejects.toThrow("requires outputSchema");
    mocks.create.mockResolvedValue({
      id: "msg-1",
      model: "claude-test",
      stop_reason: "tool_use",
      content: [{ type: "tool_use", name: "answer", input: { ok: true } }],
      usage: { input_tokens: 3, output_tokens: 2 },
    });
    const result = await invokeLLM({
      messages: [{ role: "user", content: "hello" }],
      outputSchema: { name: "answer", schema: { type: "object" } },
    });
    expect(result.choices[0].message.content).toBe('{"ok":true}');
    expect(mocks.create.mock.calls[0][0].tool_choice).toMatchObject({
      name: "answer",
    });
  });

  it("returns ordinary assistant text and preserves spend and usage tracking", async () => {
    mocks.create.mockResolvedValue({
      id: "msg-text",
      model: "claude-test",
      stop_reason: "end_turn",
      content: [{ type: "text", text: "A normal spoken answer." }],
      usage: { input_tokens: 7, output_tokens: 5 },
    });
    await expect(
      invokeTextLLM({
        tenantId: "tenant-1",
        maxTokens: 180,
        temperature: 0.1,
        messages: [
          { role: "system", content: "System" },
          { role: "user", content: "User" },
        ],
      })
    ).resolves.toBe("A normal spoken answer.");
    expect(mocks.assertSpend).toHaveBeenCalledWith("tenant-1");
    expect(mocks.trackUsage).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      modelUsed: "claude-test",
      inputTokens: 7,
      outputTokens: 5,
    });
    expect(mocks.create.mock.calls[0][0]).not.toHaveProperty("tools");
  });

  it("fails closed with a typed error for unsupported roles and spend denial", async () => {
    await expect(
      invokeTextLLM({ messages: [{ role: "tool", content: "no" }] })
    ).rejects.toMatchObject({
      name: "TextLLMInvocationError",
      code: "invalid_request",
    });
    mocks.assertSpend.mockRejectedValueOnce(new Error("limit"));
    await expect(
      invokeTextLLM({ messages: [{ role: "user", content: "hello" }] })
    ).rejects.toBeInstanceOf(TextLLMInvocationError);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  // PR1 Claire Intelligence Repair: invokeTextLLM must support real
  // alternating system/user/assistant history, not just a single user turn.
  it("accepts assistant messages and preserves user/assistant order to the Anthropic adapter", async () => {
    mocks.create.mockResolvedValue({
      id: "msg-hist",
      model: "claude-test",
      stop_reason: "end_turn",
      content: [{ type: "text", text: "Continuing the thread." }],
      usage: { input_tokens: 10, output_tokens: 4 },
    });
    await invokeTextLLM({
      tenantId: "tenant-1",
      messages: [
        { role: "system", content: "System prompt" },
        { role: "user", content: "turn 1 user" },
        { role: "assistant", content: "turn 1 assistant" },
        { role: "user", content: "turn 2 user" },
      ],
    });
    const call = mocks.create.mock.calls[0][0];
    expect(call.messages).toEqual([
      { role: "user", content: "turn 1 user" },
      { role: "assistant", content: "turn 1 assistant" },
      { role: "user", content: "turn 2 user" },
    ]);
    expect(call.system).toBe("System prompt");
  });

  // A prior assistant hallucination is conversation history to the model,
  // never re-injected as verified truth — this is enforced by the caller
  // (Claire's fact inventory outranks prior text), but the transport layer
  // must not silently collapse assistant turns into "user" or drop them.
  it("does not merge or drop assistant turns when relaying multi-turn history", async () => {
    mocks.create.mockResolvedValue({
      id: "msg-hist-2",
      model: "claude-test",
      stop_reason: "end_turn",
      content: [{ type: "text", text: "ok" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    await invokeTextLLM({
      messages: [
        { role: "user", content: "u1" },
        { role: "assistant", content: "a1 (unverified claim)" },
        { role: "user", content: "u2" },
        { role: "assistant", content: "a2" },
        { role: "user", content: "u3" },
      ],
    });
    const roles = mocks.create.mock.calls[0][0].messages.map(
      (m: { role: string }) => m.role
    );
    expect(roles).toEqual(["user", "assistant", "user", "assistant", "user"]);
  });

  // Claire Intelligence Repair Part 2, Slice B (corrective pass): omitting
  // `temperature` from the caller's params used to do nothing at this
  // boundary -- `?? 0` put it right back before the request reached
  // `client.messages.create`. These tests assert what actually leaves the
  // process, not what a caller's params object looked like.
  describe("omitTemperature / disableThinking reach the provider boundary", () => {
    beforeEach(() => {
      mocks.create.mockResolvedValue({
        id: "msg-boundary",
        model: "claude-test",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "ok" }],
        usage: { input_tokens: 1, output_tokens: 1 },
      });
    });

    it("invokeTextLLM sends no temperature field at all when omitTemperature is set", async () => {
      await invokeTextLLM({
        model: "claude-sonnet-5",
        temperature: 0.6,
        omitTemperature: true,
        messages: [{ role: "user", content: "hi" }],
      });
      const request = mocks.create.mock.calls[0][0];
      expect(request.model).toBe("claude-sonnet-5");
      expect(request).not.toHaveProperty("temperature");
    });

    it("invokeTextLLM still sends an explicit temperature for a caller that doesn't opt out — unrelated callers are unaffected", async () => {
      await invokeTextLLM({
        model: "claude-sonnet-4-6",
        temperature: 0.6,
        messages: [{ role: "user", content: "hi" }],
      });
      const request = mocks.create.mock.calls[0][0];
      expect(request.model).toBe("claude-sonnet-4-6");
      expect(request.temperature).toBe(0.6);
    });

    it("invokeTextLLM defaults to temperature 0 exactly as before when neither flag is passed", async () => {
      await invokeTextLLM({ messages: [{ role: "user", content: "hi" }] });
      expect(mocks.create.mock.calls[0][0].temperature).toBe(0);
    });

    it("invokeTextLLM sends thinking: disabled when disableThinking is set, and nothing otherwise", async () => {
      await invokeTextLLM({
        model: "claude-sonnet-5",
        omitTemperature: true,
        disableThinking: true,
        messages: [{ role: "user", content: "hi" }],
      });
      expect(mocks.create.mock.calls[0][0].thinking).toEqual({ type: "disabled" });

      await invokeTextLLM({ messages: [{ role: "user", content: "hi" }] });
      expect(mocks.create.mock.calls[1][0]).not.toHaveProperty("thinking");
    });

    it("invokeLLM (the tool-calling path) honors omitTemperature and disableThinking the same way", async () => {
      mocks.create.mockResolvedValue({
        id: "msg-boundary-2",
        model: "claude-test",
        stop_reason: "tool_use",
        content: [{ type: "tool_use", name: "answer", input: { ok: true } }],
        usage: { input_tokens: 1, output_tokens: 1 },
      });
      await invokeLLM({
        model: "claude-opus-5",
        temperature: 0,
        omitTemperature: true,
        disableThinking: true,
        messages: [{ role: "user", content: "hi" }],
        outputSchema: { name: "answer", schema: { type: "object" } },
      });
      const request = mocks.create.mock.calls[0][0];
      expect(request.model).toBe("claude-opus-5");
      expect(request).not.toHaveProperty("temperature");
      expect(request.thinking).toEqual({ type: "disabled" });
    });
  });
});
