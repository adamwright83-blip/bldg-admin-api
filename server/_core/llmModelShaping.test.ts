import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn(), stream: vi.fn() }));

vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error {
    status?: number;
  }
  return {
    default: class Anthropic {
      messages = { create: mocks.create, stream: mocks.stream };
    },
    APIError,
    AuthenticationError: class extends APIError {},
    RateLimitError: class extends APIError {},
  };
});
vi.mock("./env", () => ({ ENV: { anthropicApiKey: "test-key", anthropicModel: "claude-sonnet-5-5" } }));
vi.mock("../agents/costTracking", () => ({
  assertAiSpendAvailable: vi.fn(async () => undefined),
  trackModelUsage: vi.fn(async () => undefined),
}));

import { invokeLLM, invokeTextLLM } from "./llm";

const toolResponse = (model: string) => ({
  id: "msg",
  model,
  stop_reason: "tool_use",
  content: [{ type: "tool_use", name: "answer", input: { ok: true } }],
  usage: { input_tokens: 1, output_tokens: 1 },
});
const textResponse = (model: string) => ({
  id: "msg",
  model,
  stop_reason: "end_turn",
  content: [{ type: "text", text: "Hello." }],
  usage: { input_tokens: 1, output_tokens: 1 },
});

describe("provider boundary shapes every request for the model it calls", () => {
  beforeEach(() => vi.clearAllMocks());

  it("Sonnet 5.5 structured: auto tool choice + strict tool, no temperature, between_tools thinking", async () => {
    mocks.create.mockResolvedValue(toolResponse("claude-sonnet-5-5"));
    await invokeLLM({
      model: "claude-sonnet-5-5",
      temperature: 0,
      disableThinking: true,
      messages: [{ role: "system", content: "sys" }, { role: "user", content: "hi" }],
      outputSchema: { name: "answer", schema: { type: "object" } },
    });
    const body = mocks.create.mock.calls[0]![0];
    expect(body.tool_choice).toEqual({ type: "auto", disable_parallel_tool_use: true });
    expect(body.tools[0].strict).toBe(true);
    expect(body.system).toContain("Answer only by calling the answer tool");
    expect(body).not.toHaveProperty("temperature");
    expect(body.thinking).toEqual({ type: "between_tools" });
  });

  it("Opus 5.5 text: never sends disabled thinking; uses low effort", async () => {
    mocks.create.mockResolvedValue(textResponse("claude-opus-5-5"));
    await invokeTextLLM({ model: "claude-opus-5-5", temperature: 0.6, disableThinking: true, messages: [{ role: "user", content: "hi" }] });
    const body = mocks.create.mock.calls[0]![0];
    expect(body).not.toHaveProperty("thinking");
    expect(body).not.toHaveProperty("temperature");
    expect(body.output_config).toEqual({ effort: "low" });
  });

  it("Haiku 5.5 structured: forced tool kept, thinking disabled, no temperature", async () => {
    mocks.create.mockResolvedValue(toolResponse("claude-haiku-5-5"));
    await invokeLLM({ model: "claude-haiku-5-5", temperature: 0, messages: [{ role: "user", content: "hi" }], outputSchema: { name: "answer", schema: { type: "object" } } });
    const body = mocks.create.mock.calls[0]![0];
    expect(body.tool_choice).toEqual({ type: "tool", name: "answer", disable_parallel_tool_use: true });
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body).not.toHaveProperty("temperature");
  });

  it("a caller that never asked about thinking still gets no reasoning latency on Sonnet 5.5", async () => {
    mocks.create.mockResolvedValue(textResponse("claude-sonnet-5-5"));
    await invokeTextLLM({ messages: [{ role: "user", content: "hi" }] });
    const body = mocks.create.mock.calls[0]![0];
    expect(body.model).toBe("claude-sonnet-5-5");
    expect(body.thinking).toEqual({ type: "between_tools" });
    expect(body).not.toHaveProperty("temperature");
  });
});
