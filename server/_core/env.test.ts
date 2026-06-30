import { describe, expect, it } from "vitest";
import { normalizeAnthropicModel } from "./env";

describe("Anthropic model env normalization", () => {
  it("maps the retired Sonnet 4 date-stamped id to the current default alias", () => {
    expect(normalizeAnthropicModel("claude-sonnet-4-20250514")).toBe(
      "claude-sonnet-4-6"
    );
  });

  it("leaves explicit non-retired model ids unchanged", () => {
    expect(normalizeAnthropicModel("claude-opus-4-1")).toBe("claude-opus-4-1");
  });
});
