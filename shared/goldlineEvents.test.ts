import { describe, expect, it } from "vitest";
import {
  GOLDLINE_CLIENT_EVENT_NAMES,
  isGoldlineClientEventName,
  sanitizeDayforgeProductEventProperties,
} from "./dayforgeEvents";

describe("Goldline client event whitelist", () => {
  it("never includes a business-critical event a client could self-report", () => {
    for (const forbidden of [
      "account_won",
      "account_lost",
      "revenue_realized",
      "follow_up_created",
    ]) {
      expect(GOLDLINE_CLIENT_EVENT_NAMES).not.toContain(forbidden);
    }
  });

  it("recognizes only whitelisted names", () => {
    expect(isGoldlineClientEventName("armory_weapon_selected")).toBe(true);
    expect(isGoldlineClientEventName("account_won")).toBe(false);
    expect(isGoldlineClientEventName("not_a_real_event")).toBe(false);
  });
});

describe("Goldline event property sanitization", () => {
  it("strips any key not on the coarse allowlist", () => {
    const sanitized = sanitizeDayforgeProductEventProperties("mission_engaged", {
      sessionId: "s-1",
      missionState: "active",
      archetype: "ANCHOR",
      // Attempted injection of disallowed fields:
      prospectName: "Jane Doe",
      phone: "+15551234567",
      transcript: "full call transcript text",
    });
    expect(sanitized).toEqual({
      sessionId: "s-1",
      missionState: "active",
      archetype: "ANCHOR",
    });
    expect(sanitized).not.toHaveProperty("prospectName");
    expect(sanitized).not.toHaveProperty("phone");
    expect(sanitized).not.toHaveProperty("transcript");
  });

  it("keeps encounter_resolved coarse — archetype and performance only", () => {
    const sanitized = sanitizeDayforgeProductEventProperties("encounter_resolved", {
      sessionId: "s-2",
      archetype: "GHOST",
      performance: "clean",
      objectionText: "they said they already have someone",
    });
    expect(Object.keys(sanitized).sort()).toEqual(["archetype", "performance", "sessionId"]);
  });

  it("keeps verified_capture free of dollar amounts, only a coarse band", () => {
    const sanitized = sanitizeDayforgeProductEventProperties("verified_capture", {
      sessionId: "s-3",
      estimatedValueBand: "verified",
      exactAnnualValueCents: 2_160_000,
    });
    expect(sanitized).toEqual({ sessionId: "s-3", estimatedValueBand: "verified" });
  });
});
