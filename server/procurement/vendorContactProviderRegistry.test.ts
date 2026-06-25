import { describe, expect, it } from "vitest";
import {
  buildProviderReadiness,
  evaluateLiveSendGate,
  inspectEmailProviderCapability,
  inspectNoopProviderCapability,
  inspectWebsiteFormProviderCapability,
  sendContactAttemptViaEmailProvider,
  sendContactAttemptViaWebsiteFormProvider,
} from "./vendorContactProviderRegistry";

describe("provider registry: noop provider", () => {
  it("reports the noop provider as available with no blockers", () => {
    const capability = inspectNoopProviderCapability();
    expect(capability.mode).toBe("noop_provider");
    expect(capability.configured).toBe(true);
    expect(capability.blockedReasons).toEqual([]);
    expect(capability.canSend).toBe(false);
  });
});

describe("provider registry: email provider capability", () => {
  it("reports blocked with missing env vars when none are set", () => {
    const capability = inspectEmailProviderCapability({});
    expect(capability.configured).toBe(false);
    expect(capability.missingEnvVars.length).toBeGreaterThan(0);
    expect(capability.blockedReasons).toContain("email_provider_env_missing");
    expect(capability.canSend).toBe(false);
  });

  it("reports blocked with live_email_canary_disabled when config exists but canary flag is off", () => {
    const capability = inspectEmailProviderCapability({
      VENDOR_OUTREACH_LIVE_FEATURE_FLAG: "true",
      VENDOR_OUTREACH_EMAIL_PROVIDER_ENABLED: "true",
      VENDOR_OUTREACH_EMAIL_CANARY_ENABLED: "false",
      VENDOR_OUTREACH_EMAIL_PROVIDER_API_KEY: "fake-key",
      VENDOR_OUTREACH_EMAIL_FROM_ADDRESS: "vendors@example.com",
    });
    expect(capability.configured).toBe(true);
    expect(capability.canaryEnabled).toBe(false);
    expect(capability.blockedReasons).toContain("live_email_canary_disabled");
  });

  it("still refuses with the permanent Slice 74d block even when fully configured and canary is on", () => {
    const capability = inspectEmailProviderCapability({
      VENDOR_OUTREACH_LIVE_FEATURE_FLAG: "true",
      VENDOR_OUTREACH_EMAIL_PROVIDER_ENABLED: "true",
      VENDOR_OUTREACH_EMAIL_CANARY_ENABLED: "true",
      VENDOR_OUTREACH_EMAIL_PROVIDER_API_KEY: "fake-key",
      VENDOR_OUTREACH_EMAIL_FROM_ADDRESS: "vendors@example.com",
    });
    expect(capability.configured).toBe(true);
    expect(capability.canaryEnabled).toBe(true);
    expect(capability.blockedReasons).not.toContain("email_provider_env_missing");
    expect(capability.blockedReasons).not.toContain("live_email_canary_disabled");
    expect(capability.blockedReasons).toContain("blocked_live_send_not_enabled_for_slice_74d");
    expect(capability.canSend).toBe(false);
  });
});

describe("provider registry: website form provider", () => {
  it("is always unconfigured and never submits a form", () => {
    const capability = inspectWebsiteFormProviderCapability();
    expect(capability.configured).toBe(false);
    expect(capability.canSend).toBe(false);
    expect(capability.blockedReasons).toContain("website_form_automation_not_implemented");
    expect(capability.blockedReasons).toContain("blocked_live_send_not_enabled_for_slice_74d");
  });

  it("sendContactAttemptViaWebsiteFormProvider never submits and always returns blocked", () => {
    const result = sendContactAttemptViaWebsiteFormProvider({ attemptId: "attempt-1" });
    expect(result.sent).toBe(false);
    expect(result.liveProviderInvoked).toBe(false);
    expect(result.status).toBe("blocked");
  });
});

describe("provider registry: gated_provider_future is blocked by default", () => {
  it("evaluateLiveSendGate is always allowed:false, even with a fully passing input", () => {
    const decision = evaluateLiveSendGate({
      sourceKey: "service_request:155",
      category: "dog_grooming",
      sourceAllowlist: ["service_request:155", "dog_grooming"],
      recipient: "vendor@example.com",
      durableDraftId: "draft-1",
      durableAttemptId: "attempt-1",
      idempotencyKey: "idem-1",
      sendGatePassed: true,
      founderEscalationPresent: true,
      forbiddenClaimsDetected: [],
      env: {
        VENDOR_OUTREACH_LIVE_FEATURE_FLAG: "true",
        VENDOR_OUTREACH_EMAIL_PROVIDER_ENABLED: "true",
        VENDOR_OUTREACH_EMAIL_CANARY_ENABLED: "true",
      },
    });
    expect(decision.allowed).toBe(false);
    expect(decision.dryRunOnly).toBe(true);
    expect(decision.noSendPerformed).toBe(true);
    expect(decision.liveSendAllowed).toBe(false);
    expect(decision.reasons).toContain("blocked_live_send_not_enabled_for_slice_74d");
  });

  it("collects every missing precondition when nothing is configured", () => {
    const decision = evaluateLiveSendGate({
      sourceKey: "service_request:155",
      recipient: null,
      durableDraftId: null,
      durableAttemptId: null,
      idempotencyKey: null,
      sendGatePassed: false,
      founderEscalationPresent: false,
      forbiddenClaimsDetected: ["forbidden_truth_claim_detected"],
      env: {},
    });
    expect(decision.reasons).toContain("global_live_outreach_flag_off");
    expect(decision.reasons).toContain("provider_feature_flag_off");
    expect(decision.reasons).toContain("live_email_canary_disabled");
    expect(decision.reasons).toContain("source_not_allowlisted");
    expect(decision.reasons).toContain("recipient_missing_or_invalid");
    expect(decision.reasons).toContain("durable_draft_id_required");
    expect(decision.reasons).toContain("durable_attempt_identity_required");
    expect(decision.reasons).toContain("send_gate_not_passed");
    expect(decision.reasons).toContain("founder_escalation_missing");
    expect(decision.reasons).toContain("forbidden_claims_detected");
  });
});

describe("provider registry: email adapter shell never sends", () => {
  it("sendContactAttemptViaEmailProvider never invokes a live provider and always blocks", () => {
    const result = sendContactAttemptViaEmailProvider({
      attemptId: "attempt-1",
      recipient: "vendor@example.com",
      subject: "Availability check",
      body: "Hi vendor",
    }, {
      VENDOR_OUTREACH_LIVE_FEATURE_FLAG: "true",
      VENDOR_OUTREACH_EMAIL_PROVIDER_ENABLED: "true",
      VENDOR_OUTREACH_EMAIL_CANARY_ENABLED: "true",
      VENDOR_OUTREACH_EMAIL_PROVIDER_API_KEY: "fake-key",
      VENDOR_OUTREACH_EMAIL_FROM_ADDRESS: "vendors@example.com",
    });
    expect(result.sent).toBe(false);
    expect(result.liveProviderInvoked).toBe(false);
    expect(result.status).toBe("blocked");
    expect(result.blockedReasons).toContain("blocked_live_send_not_enabled_for_slice_74d");
  });
});

describe("provider registry: readiness summary", () => {
  it("reports liveSendingEnabled false and a concrete next action", () => {
    const readiness = buildProviderReadiness({});
    expect(readiness.liveSendingEnabled).toBe(false);
    expect(readiness.noop.configured).toBe(true);
    expect(readiness.email.configured).toBe(false);
    expect(readiness.websiteForm.configured).toBe(false);
    expect(readiness.nextRequiredActionForCanary).toMatch(/env vars/i);
  });

  it("never exposes env var values, only names", () => {
    const readiness = buildProviderReadiness({
      VENDOR_OUTREACH_EMAIL_PROVIDER_API_KEY: "super-secret-value-should-never-appear",
    });
    const serialized = JSON.stringify(readiness);
    expect(serialized).not.toContain("super-secret-value-should-never-appear");
  });
});
