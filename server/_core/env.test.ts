import { describe, expect, it } from "vitest";
import { normalizeAnthropicModel } from "./env";

describe("Anthropic model env normalization", () => {
  it("maps retired Sonnet and Haiku ids to the current generation", () => {
    expect(normalizeAnthropicModel("claude-sonnet-4-20250514")).toBe("claude-sonnet-5-5");
    expect(normalizeAnthropicModel("claude-sonnet-4-6")).toBe("claude-sonnet-5-5");
    expect(normalizeAnthropicModel("claude-haiku-4-5-20251001")).toBe("claude-haiku-5-5");
  });

  it("leaves explicit non-retired model ids unchanged", () => {
    expect(normalizeAnthropicModel("claude-opus-4-1")).toBe("claude-opus-4-1");
  });
});
