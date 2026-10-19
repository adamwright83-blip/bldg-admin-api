import { describe, expect, it } from "vitest";
import {
  DEFAULT_ANTHROPIC_MODEL,
  modelAcceptsForcedToolChoice,
  modelAcceptsSampling,
  modelRequestShape,
  normalizeAnthropicModel,
} from "./modelCapabilities";

describe("model request shaping", () => {
  it("defaults to the current-generation Sonnet", () => {
    expect(DEFAULT_ANTHROPIC_MODEL).toBe("claude-sonnet-5-5");
  });

  it("Sonnet 5.5: no temperature, between_tools thinking, no forced tool", () => {
    expect(modelRequestShape("claude-sonnet-5-5", { temperature: 0.6 })).toEqual({ thinking: { type: "between_tools" } });
    expect(modelAcceptsForcedToolChoice("claude-sonnet-5-5")).toBe(false);
  });

  it("Opus 5.5: thinking cannot be disabled, low effort instead", () => {
    expect(modelRequestShape("claude-opus-5-5", { temperature: 0, disableThinking: true })).toEqual({ output_config: { effort: "low" } });
    expect(modelAcceptsForcedToolChoice("claude-opus-5-5")).toBe(false);
  });

  it("Haiku 5.5: disabled thinking, no temperature, forced tool allowed", () => {
    expect(modelRequestShape("claude-haiku-5-5", { temperature: 0 })).toEqual({ thinking: { type: "disabled" } });
    expect(modelAcceptsForcedToolChoice("claude-haiku-5-5")).toBe(true);
  });

  it("previous generation keeps temperature and sends no thinking field", () => {
    expect(modelRequestShape("claude-sonnet-4-6", { temperature: 0.3 })).toEqual({ temperature: 0.3 });
    expect(modelAcceptsSampling("claude-sonnet-4-6")).toBe(true);
  });

  it("retired ids resolve to the current generation", () => {
    expect(normalizeAnthropicModel("claude-sonnet-4-6")).toBe("claude-sonnet-5-5");
    expect(normalizeAnthropicModel("claude-haiku-4-5-20251001")).toBe("claude-haiku-5-5");
    expect(normalizeAnthropicModel("claude-opus-5-5")).toBe("claude-opus-5-5");
  });
});
