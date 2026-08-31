import { describe, expect, it } from "vitest";
import { requireSandboxEnabled, sandboxEnabled } from "./sandboxGate";

describe("Goldline Sandbox server gate", () => {
  it("refuses when the flag is absent or false", () => {
    expect(sandboxEnabled({})).toBe(false);
    expect(() => requireSandboxEnabled({ GOLDLINE_SANDBOX_ENABLED: "false" })).toThrow(/disabled/);
  });

  it("opens only for the exact true value", () => {
    expect(sandboxEnabled({ GOLDLINE_SANDBOX_ENABLED: "true" })).toBe(true);
    expect(() => requireSandboxEnabled({ GOLDLINE_SANDBOX_ENABLED: "true" })).not.toThrow();
  });
});

