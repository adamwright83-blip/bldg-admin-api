import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ logAgentEvent: vi.fn() }));
vi.mock("../agents/agentEvents", () => ({
  logAgentEvent: mocks.logAgentEvent,
}));

import {
  getClaireGenerationStats,
  recordClaireGeneration,
} from "./generationTelemetry";

describe("F — Claire fallback telemetry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.logAgentEvent.mockResolvedValue(1);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
  });

  it("records model and fallback sources and exposes a fallback-rate signal", async () => {
    const tenantId = `telemetry-${Date.now()}`;
    await recordClaireGeneration({
      tenantId,
      diagnostic: {
        kind: "opening_brief",
        source: "model",
        failureReason: null,
      },
      latencyMs: 10,
    });
    await recordClaireGeneration({
      tenantId,
      diagnostic: {
        kind: "opening_brief",
        source: "fallback",
        failureReason: "provider_failure",
      },
      latencyMs: 20,
    });
    expect(mocks.logAgentEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        toolName: "claire_opening_brief_generation",
        status: "success",
        outputJson: expect.objectContaining({
          source: "model",
          fallbackRate: 0,
        }),
      })
    );
    expect(mocks.logAgentEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        status: "failed",
        errorMessage: "provider_failure",
        outputJson: expect.objectContaining({
          source: "fallback",
          fallbackRate: 0.5,
        }),
      })
    );
    expect(getClaireGenerationStats(tenantId)).toContainEqual({
      kind: "opening_brief",
      attempts: 2,
      fallbacks: 1,
      fallbackRate: 0.5,
    });
  });
});
