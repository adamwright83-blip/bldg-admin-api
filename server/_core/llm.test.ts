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
      invokeTextLLM({ messages: [{ role: "assistant", content: "no" }] })
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
});
