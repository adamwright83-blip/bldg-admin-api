import { afterEach, describe, expect, it, vi } from "vitest";
import { presidentRuntimeStatus, getPresidentRuntime } from "./runtime";
import { authorizePresidentCallback } from "./agentRuntime";
import { AppPresidentJudgmentProvider } from "./appProvider";

afterEach(() => vi.unstubAllEnvs());
describe("President runtime boundaries", () => {
  it("does not overwrite the evidence-backed capability ledger", () => {
    vi.stubEnv("PRESIDENT_AGENT_TARGETS_JSON", "{}");
    const capabilities = [{ id: "evidence-backed" }];
    const state = { capabilities, ...presidentRuntimeStatus() };
    expect(state.capabilities).toEqual(capabilities);
    expect(state.executionCapabilities).toEqual([]);
  });
  it("fails honestly without configured execution or a structured schema", async () => {
    vi.stubEnv("PRESIDENT_AGENT_TARGETS_JSON", "{}");
    expect(() => getPresidentRuntime()).toThrow("not configured");
    await expect(
      new AppPresidentJudgmentProvider().judge({
        question: "test",
        system: "test",
        evidence: [],
        maxUsd: 1,
      })
    ).rejects.toThrow("explicit output schema");
  });
  it("rejects missing, malformed, wrong and cross-actor callback tokens", () => {
    const tokens = { executor: "secret-token-long-enough" };
    for (const header of [
      undefined,
      "secret-token-long-enough",
      "Bearer wrong",
      "Bearer secret-token-long-enough ",
    ])
      expect(authorizePresidentCallback("executor", header, tokens)).toBe(
        false
      );
    expect(
      authorizePresidentCallback(
        "other-tenant",
        "Bearer secret-token-long-enough",
        tokens
      )
    ).toBe(false);
    expect(
      authorizePresidentCallback(
        "executor",
        "Bearer secret-token-long-enough",
        tokens
      )
    ).toBe(true);
  });
});
