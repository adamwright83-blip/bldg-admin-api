import { describe, expect, it } from "vitest";
import {
  defaultDayforgeDestination,
  validateInternalReturnTo,
} from "./dayforgeContinuation";

describe("DayForge internal continuation validation", () => {
  it("preserves a normal application-relative destination", () => {
    expect(
      validateInternalReturnTo("/commercial-missions?missionId=42#timeline")
    ).toBe("/commercial-missions?missionId=42#timeline");
  });

  it.each([
    "https://evil.example/steal",
    "//evil.example/steal",
    "/\\evil.example",
    "/%2f%2fevil.example",
    "/%5cevil.example",
    "javascript:alert(1)",
    "data:text/html,boom",
    "/dayforge-today\u0000",
    "/dayforge-login",
    "/dayforge-onboarding",
    "/julydemo",
  ])("rejects unsafe or looping destination %s", value => {
    expect(validateInternalReturnTo(value)).toBeNull();
  });

  it("removes secret-bearing parameters and fragments", () => {
    expect(
      validateInternalReturnTo(
        "/driver/sales-mission/42?handoff=secret&view=brief#continuation=secret"
      )
    ).toBe("/driver/sales-mission/42?view=brief");
  });

  it("strips adjacent legacy preview and OAuth secrets without iterator skips", () => {
    expect(
      validateInternalReturnTo(
        "/dayforge?preview=session-a&token=secret&code=oauth&state=nonce&tab=missions"
      )
    ).toBe("/dayforge?tab=missions");
  });

  it("rejects oversized paths", () => {
    expect(validateInternalReturnTo(`/${"x".repeat(2_048)}`)).toBeNull();
  });

  it("uses DayForge Today as the explicit default", () => {
    expect(defaultDayforgeDestination()).toEqual({
      destination: "/dayforge-today",
      destinationKind: "dayforge_today",
    });
  });
});
