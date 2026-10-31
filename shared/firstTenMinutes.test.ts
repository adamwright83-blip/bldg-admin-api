import { describe, expect, it } from "vitest";
import {
  CONNECT_ERRORS,
  CONNECTION_INCLUDES,
  connectErrorCode,
  firstTenShownTo,
  grantedGoogleProducts,
  isJoystickSignupMode,
  isJourneyStage,
  parseFirstTenMode,
} from "./firstTenMinutes";
import { EXAMPLE_BUSINESS, EXAMPLE_CONNECTION } from "./firstTenMinutesExample";

describe("first ten minutes contracts", () => {
  it("shows the experience only when the flag opens it to this browser", () => {
    expect(firstTenShownTo(parseFirstTenMode(undefined), true)).toBe(false);
    expect(firstTenShownTo("preview", false)).toBe(false);
    expect(firstTenShownTo("preview", true)).toBe(true);
    expect(firstTenShownTo("on", false)).toBe(true);
  });

  it("treats both JOYSTICK signup modes as JOYSTICK and nothing else", () => {
    expect(isJoystickSignupMode("joystick_generic")).toBe(true);
    expect(isJoystickSignupMode("joystick_first_ten")).toBe(true);
    expect(isJoystickSignupMode("legacy_laundry")).toBe(false);
    expect(isJoystickSignupMode(null)).toBe(false);
  });

  it("reads which Google products were granted", () => {
    expect(
      grantedGoogleProducts([
        "openid",
        "https://www.googleapis.com/auth/calendar.readonly",
        "https://www.googleapis.com/auth/gmail.readonly",
      ])
    ).toEqual(["gmail", "calendar"]);
  });

  it("only maps known connection errors, so nothing from the URL is echoed", () => {
    expect(connectErrorCode("scopes")).toBe("scopes");
    expect(connectErrorCode("<script>")).toBeNull();
    expect(connectErrorCode("toString")).toBeNull();
    expect(Object.keys(CONNECT_ERRORS).sort()).toEqual(["cancelled", "expired", "failed", "other_account", "scopes", "send_permission"]);
    expect(isJourneyStage("crew")).toBe(true);
    expect(isJourneyStage("anything")).toBe(false);
  });

  it("says plainly that nothing is sent, and never promises what the code doesn't do", () => {
    for (const includes of Object.values(CONNECTION_INCLUDES)) {
      const all = [...includes.reads, ...includes.never, ...includes.kept, ...includes.stop].join(" ");
      expect(all).not.toMatch(/\bwe (will )?send\b|automatically sen[dt]|on your behalf, we/i);
    }
    expect(CONNECTION_INCLUDES.google.never.join(" ")).toMatch(/read-only/);
    expect(CONNECTION_INCLUDES.google.kept.join(" ")).toMatch(/Anthropic/);
    expect(CONNECTION_INCLUDES.slack.never.join(" ")).toMatch(/read-only/);
  });

  it("keeps the example on a reserved domain that can never be a real inbox", () => {
    expect(EXAMPLE_BUSINESS.email.endsWith(".example")).toBe(true);
    expect(EXAMPLE_CONNECTION.account).toBe(EXAMPLE_BUSINESS.email);
  });
});
