import { describe, expect, it } from "vitest";
import {
  businessLabelForTenant,
  isFailedSyncOutcome,
  operatorConnectionWarning,
  safeAttemptDetail,
} from "./operatorConnectionWarning";

const ZERO = /\$0|\b0 orders\b|\bzero orders\b|\bzero revenue\b/i;

describe("operator connection warnings", () => {
  it("names Laundry Farm and Laundry Butler as separate businesses", () => {
    expect(businessLabelForTenant("laundry_farm")).toBe("Laundry Farm");
    expect(businessLabelForTenant("default")).toBe("Laundry Butler");
    const farm = operatorConnectionWarning({
      tenantId: "laundry_farm",
      gmailStatusKnown: true,
      gmailConfigured: true,
      gmailConnected: false,
    });
    const butler = operatorConnectionWarning({
      tenantId: "default",
      gmailStatusKnown: true,
      gmailConfigured: true,
      gmailConnected: false,
    });
    expect(farm).toContain("Laundry Farm");
    expect(farm).not.toContain("Laundry Butler");
    expect(butler).toContain("Laundry Butler");
    expect(butler).not.toContain("Laundry Farm");
    expect(farm).toMatch(/not a zero/i);
    expect(farm).not.toMatch(ZERO);
    expect(butler).not.toMatch(ZERO);
  });

  it("does not warn when this business's Gmail is connected and the latest sync succeeded", () => {
    expect(
      operatorConnectionWarning({
        tenantId: "laundry_farm",
        gmailStatusKnown: true,
        gmailConfigured: true,
        gmailConnected: true,
        lastAttemptOutcome: "imported",
      })
    ).toBeNull();
  });

  it("keeps a Gmail auth failure as a failure even after a connected flag", () => {
    const text = operatorConnectionWarning({
      tenantId: "laundry_farm",
      gmailStatusKnown: true,
      gmailConfigured: true,
      gmailConnected: true,
      lastAttemptOutcome: "direct_auth_failed",
      lastAttemptMessage: "Jawbreaker Gmail is not connected for this tenant.",
    });
    expect(text).toMatch(/not connected for Laundry Farm/i);
    expect(text).toMatch(/stays a failure/i);
    expect(text).toMatch(/not a zero/i);
    expect(text).not.toMatch(ZERO);
  });

  it("does not turn a missing mailbox into zero revenue while status is still loading", () => {
    expect(
      operatorConnectionWarning({
        tenantId: "laundry_farm",
        gmailStatusKnown: false,
        gmailConfigured: false,
        gmailConnected: false,
      })
    ).toBeNull();
  });

  it("reports other failed outcomes without pasting secrets", () => {
    expect(isFailedSyncOutcome("extension_failed")).toBe(true);
    expect(isFailedSyncOutcome("extension_export")).toBe(false);
    expect(isFailedSyncOutcome("imported")).toBe(false);
    expect(
      safeAttemptDetail("Bearer secret-token https://user:pass@host")
    ).toBeNull();
    const text = operatorConnectionWarning({
      tenantId: "default",
      gmailStatusKnown: true,
      gmailConfigured: true,
      gmailConnected: true,
      lastAttemptOutcome: "extension_failed",
      lastAttemptMessage: "Bearer secret-token",
    });
    expect(text).toBe(
      "The last CleanCloud sync for Laundry Butler failed. A failed sync stays a failure. That is not a zero."
    );
    expect(text).not.toMatch(/secret|token/i);
  });
});
