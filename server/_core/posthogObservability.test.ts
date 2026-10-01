import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { captureAiGeneration } from "@posthog/ai";
import { describe, expect, it } from "vitest";
import {
  currentLlmObservability,
  llmSessionId,
  llmTraceId,
  runWithLlmObservability,
} from "./llmObservability";
import { emitServerLog, resetServerLogsForTests } from "./posthogLogs";
import { getServerPosthog, posthogBrowserConfig, resetServerPosthogForTests } from "./posthogServer";

describe("PostHog observability", () => {
  it("exposes only the public browser ingestion config", () => {
    const previousToken = process.env.POSTHOG_PROJECT_TOKEN;
    const previousHost = process.env.POSTHOG_HOST;
    const previousSecret = process.env.POSTHOG_SECRET_KEY;
    process.env.POSTHOG_PROJECT_TOKEN = "phc_public_test";
    process.env.POSTHOG_HOST = "https://us.i.posthog.com/";
    process.env.POSTHOG_SECRET_KEY = "phs_must_not_leak";
    expect(posthogBrowserConfig()).toEqual({
      enabled: true,
      key: "phc_public_test",
      host: "https://us.i.posthog.com",
    });
    if (previousToken === undefined) delete process.env.POSTHOG_PROJECT_TOKEN;
    else process.env.POSTHOG_PROJECT_TOKEN = previousToken;
    if (previousHost === undefined) delete process.env.POSTHOG_HOST;
    else process.env.POSTHOG_HOST = previousHost;
    if (previousSecret === undefined) delete process.env.POSTHOG_SECRET_KEY;
    else process.env.POSTHOG_SECRET_KEY = previousSecret;
  });

  it("stays inert when the project token is missing", () => {
    delete process.env.POSTHOG_PROJECT_TOKEN;
    resetServerPosthogForTests();
    resetServerLogsForTests();
    expect(getServerPosthog()).toBeNull();
    expect(() => emitServerLog("error", "ignored", { password: "nope", api_key: "nope" })).not.toThrow();
  });

  it("uses one trace per turn and the real conversation as the session", async () => {
    const loose = llmTraceId({});
    expect(loose).not.toBe(llmTraceId({}));
    await runWithLlmObservability(
      {
        tenantId: "goldline",
        operatorOpenId: "operator-1",
        conversationId: "claire-call:CA123",
        callId: "CA123",
        surface: "voice",
      },
      async () => {
        const context = currentLlmObservability();
        expect(context?.traceId).toBeTruthy();
        expect(llmTraceId(context ?? {})).toBe(llmTraceId(context ?? {}));
        expect(llmSessionId(context ?? {})).toBe("claire-call:CA123");
        expect(llmTraceId(context ?? {})).not.toBe("claire-call:CA123");
        expect(llmTraceId(context ?? {})).not.toBe("CA123");
      }
    );
  });

  it("constructs the OTLP log processor with an exporter option", async () => {
    const processor = new BatchLogRecordProcessor({
      exporter: {
        export: (_items, callback) => callback({ code: 0 }),
        shutdown: async () => undefined,
      },
    });
    await processor.shutdown();
  });

  it("nulls prompt text in privacy mode and keeps model, tokens, latency, and ids", async () => {
    const events: Array<{ distinctId?: string; properties: Record<string, unknown> }> = [];
    const client = {
      capture(event: { distinctId?: string; properties: Record<string, unknown> }) {
        events.push(event);
      },
      privacy_mode: true,
      options: {},
    };
    await captureAiGeneration(client as never, {
      distinctId: "operator-1",
      traceId: "trace-1",
      model: "claude-test",
      provider: "anthropic",
      input: [{ role: "user", content: "secret prompt" }],
      output: [{ role: "assistant", content: "secret answer" }],
      privacyMode: true,
      latency: 0.2,
      usage: { inputTokens: 3, outputTokens: 4 },
      properties: { $ai_session_id: "claire-call:CA123" },
    });
    const props = events[0].properties;
    expect(props.$ai_input).toBeNull();
    expect(props.$ai_output_choices).toBeNull();
    expect(JSON.stringify(events[0])).not.toContain("secret prompt");
    expect(JSON.stringify(events[0])).not.toContain("secret answer");
    expect(props.$ai_input_tokens).toBe(3);
    expect(props.$ai_output_tokens).toBe(4);
    expect(props.$ai_model).toBe("claude-test");
    expect(props.$ai_provider).toBe("anthropic");
    expect(props.$ai_latency).toBe(0.2);
    expect(props.$ai_trace_id).toBe("trace-1");
    expect(props.$ai_session_id).toBe("claire-call:CA123");
    expect(events[0].distinctId).toBe("operator-1");
  });
});
