import { describe, expect, it } from "vitest";
import { isCompletedReplayDate, requireSandboxEnabled, sandboxEnabled } from "./sandboxGate";

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

describe("historical replay business-day gate", () => {
  it("uses the Los Angeles calendar rather than UTC", () => {
    const now = new Date("2026-08-31T06:00:00.000Z"); // Aug 30 at 11pm in LA
    expect(isCompletedReplayDate("2026-08-30", now, "America/Los_Angeles")).toBe(false);
    expect(isCompletedReplayDate("2026-08-29", now, "America/Los_Angeles")).toBe(true);
  });
});
