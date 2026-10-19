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

  it("Sonnet 5.5 structured: constrained JSON output (no tools), no temperature, between_tools thinking", async () => {
    mocks.create.mockResolvedValue({ ...textResponse("claude-sonnet-5-5"), content: [{ type: "text", text: '{"ok":true}' }] });
    const result = await invokeLLM({
      model: "claude-sonnet-5-5",
      temperature: 0,
      disableThinking: true,
      messages: [{ role: "system", content: "sys" }, { role: "user", content: "hi" }],
      outputSchema: {
        name: "answer",
        schema: { type: "object", required: ["ok", "n"], properties: { ok: { type: "boolean" }, n: { type: "integer", minimum: 0 }, inner: { type: "object", properties: { a: { type: "string", maxLength: 3 } } } } },
      },
    });
    const body = mocks.create.mock.calls[0]![0];
    expect(body).not.toHaveProperty("tools");
    expect(body).not.toHaveProperty("tool_choice");
    expect(body.output_config.format.type).toBe("json_schema");
    const sent = body.output_config.format.schema;
    expect(sent.additionalProperties).toBe(false);
    expect(sent.required).toEqual(["ok", "n"]);
    expect(sent.properties.n).toEqual({ type: "integer" });
    expect(sent.properties.inner.additionalProperties).toBe(false);
    expect(sent.properties.inner.properties.a).toEqual({ type: "string" });
    expect(body).not.toHaveProperty("temperature");
    expect(body.thinking).toEqual({ type: "between_tools" });
    expect(result.choices[0]!.message.content).toBe('{"ok":true}');
  });

  it("Opus 5.5 structured: JSON output keeps the low-effort setting", async () => {
    mocks.create.mockResolvedValue({ ...textResponse("claude-opus-5-5"), content: [{ type: "text", text: '{"ok":true}' }] });
    await invokeLLM({ model: "claude-opus-5-5", messages: [{ role: "user", content: "hi" }], outputSchema: { name: "answer", schema: { type: "object", properties: { ok: { type: "boolean" } } } } });
    const body = mocks.create.mock.calls[0]![0];
    expect(body.output_config.effort).toBe("low");
    expect(body.output_config.format.type).toBe("json_schema");
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
