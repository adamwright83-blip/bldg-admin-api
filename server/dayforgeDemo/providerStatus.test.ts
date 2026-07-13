import { describe, expect, it } from "vitest";
import {
  emailProviderStatus,
  getDayforgeProviderStatus,
  googleProviderStatus,
  printProviderStatus,
  smsProviderStatus,
  stripeProviderStatus,
} from "./providerStatus";

describe("DayForge demo provider status", () => {
  it("reports NOT_CONFIGURED for every provider when no env vars are set", () => {
    const status = getDayforgeProviderStatus({});
    expect(status.google).toBe("NOT_CONFIGURED");
    expect(status.stripe).toBe("NOT_CONFIGURED");
    expect(status.email).toBe("NOT_CONFIGURED");
    expect(status.sms).toBe("NOT_CONFIGURED");
    // Print always reports the honest fallback state -- there is no
    // dedicated print/label provider in this repo.
    expect(status.print).toBe("BROWSER_PDF_FALLBACK");
  });

  it("reports google LIVE only when GOOGLE_MAPS_API_KEY is present", () => {
    expect(googleProviderStatus({})).toBe("NOT_CONFIGURED");
    expect(googleProviderStatus({ GOOGLE_MAPS_API_KEY: "  " })).toBe(
      "NOT_CONFIGURED"
    );
    expect(googleProviderStatus({ GOOGLE_MAPS_API_KEY: "abc123" })).toBe(
      "LIVE"
    );
  });

  it("distinguishes stripe TEST vs LIVE by key prefix, and requires a real-length key", () => {
    expect(
      stripeProviderStatus({ DAYFORGE_BILLING_STRIPE_SECRET_KEY: "sk_test_short" })
    ).toBe("NOT_CONFIGURED");
    expect(
      stripeProviderStatus({
        DAYFORGE_BILLING_STRIPE_SECRET_KEY: "sk_test_1234567890123456789",
      })
    ).toBe("TEST");
    expect(
      stripeProviderStatus({
        DAYFORGE_BILLING_STRIPE_SECRET_KEY: "sk_live_1234567890123456789",
      })
    ).toBe("LIVE");
  });

  it("requires all three AgentMail env vars before reporting email as LIVE", () => {
    expect(
      emailProviderStatus({
        AGENTMAIL_API_KEY: "key",
        AGENTMAIL_VENDOR_INBOX_ID: "inbox",
      })
    ).toBe("NOT_CONFIGURED");
    expect(
      emailProviderStatus({
        AGENTMAIL_API_KEY: "key",
        AGENTMAIL_VENDOR_INBOX_ID: "inbox",
        AGENTMAIL_VENDOR_INBOX_EMAIL: "inbox@example.com",
      })
    ).toBe("LIVE");
  });

  it("requires all three Twilio env vars before reporting sms as LIVE", () => {
    expect(
      smsProviderStatus({
        TWILIO_ACCOUNT_SID: "sid",
        TWILIO_AUTH_TOKEN: "token",
      })
    ).toBe("NOT_CONFIGURED");
    expect(
      smsProviderStatus({
        TWILIO_ACCOUNT_SID: "sid",
        TWILIO_AUTH_TOKEN: "token",
        TWILIO_PHONE_NUMBER: "+15555550100",
      })
    ).toBe("LIVE");
  });

  it("print status never varies with env -- it always reflects the real fallback", () => {
    expect(printProviderStatus()).toBe("BROWSER_PDF_FALLBACK");
  });
});
