import { describe, expect, it, vi } from "vitest";
import {
  buildAgentMailLabels,
  evaluateAgentMailLiveSendGate,
  inspectAgentMailReadiness,
  renderSafeHtmlFromTextDraft,
  sendVendorEmailViaAgentMail,
  SUPERVISED_CANARY_CONFIRMATION_TEXT,
  type MinimalAgentMailClient,
} from "./agentMailVendorEmailProvider";

const FULL_ENV = {
  HELD_VENDOR_EMAIL_PROVIDER: "agentmail",
  AGENTMAIL_API_KEY: "fake-key",
  AGENTMAIL_VENDOR_INBOX_ID: "held@agentmail.to",
  AGENTMAIL_VENDOR_INBOX_EMAIL: "held@agentmail.to",
  HELD_VENDOR_EMAIL_CANARY_ENABLED: "true",
  HELD_VENDOR_EMAIL_SOURCE_ALLOWLIST: "service_request:155",
  HELD_VENDOR_EMAIL_CATEGORY_ALLOWLIST: "dog_grooming",
};

function gateInput(overrides?: Partial<Parameters<typeof evaluateAgentMailLiveSendGate>[0]>) {
  return {
    sourceKey: "service_request:155",
    category: "dog_grooming",
    recipientEmail: "vendor@example.com",
    durableDraftId: "draft-1",
    durableAttemptId: "attempt-1",
    idempotencyKey: "idem-1",
    sendGatePassed: true,
    founderEscalationPresent: true,
    forbiddenClaimsDetected: [],
    adminConfirmationText: SUPERVISED_CANARY_CONFIRMATION_TEXT,
    env: FULL_ENV,
    ...overrides,
  };
}

describe("AgentMail readiness", () => {
  it("requires AGENTMAIL_API_KEY", () => {
    const readiness = inspectAgentMailReadiness({ ...FULL_ENV, AGENTMAIL_API_KEY: undefined });
    expect(readiness.configured).toBe(false);
    expect(readiness.missingEnvVars).toContain("AGENTMAIL_API_KEY");
    expect(readiness.blockedReasons).toContain("agentmail_env_missing");
  });

  it("requires AGENTMAIL_VENDOR_INBOX_ID", () => {
    const readiness = inspectAgentMailReadiness({ ...FULL_ENV, AGENTMAIL_VENDOR_INBOX_ID: undefined });
    expect(readiness.configured).toBe(false);
    expect(readiness.missingEnvVars).toContain("AGENTMAIL_VENDOR_INBOX_ID");
  });

  it("requires AGENTMAIL_VENDOR_INBOX_EMAIL", () => {
    const readiness = inspectAgentMailReadiness({ ...FULL_ENV, AGENTMAIL_VENDOR_INBOX_EMAIL: undefined });
    expect(readiness.configured).toBe(false);
    expect(readiness.missingEnvVars).toContain("AGENTMAIL_VENDOR_INBOX_EMAIL");
  });

  it("blocks when canary is disabled even with full config", () => {
    const readiness = inspectAgentMailReadiness({ ...FULL_ENV, HELD_VENDOR_EMAIL_CANARY_ENABLED: "false" });
    expect(readiness.configured).toBe(true);
    expect(readiness.canaryEnabled).toBe(false);
    expect(readiness.blockedReasons).toContain("live_email_canary_disabled");
  });

  it("passes readiness when fully configured and canary is on", () => {
    const readiness = inspectAgentMailReadiness(FULL_ENV);
    expect(readiness.configured).toBe(true);
    expect(readiness.canaryEnabled).toBe(true);
    expect(readiness.blockedReasons).toEqual([]);
    expect(readiness.liveSendAllowed).toBe(false);
    expect(readiness.webhooksDeferredTo).toBe("74f");
  });

  it("never returns the actual env var values, only names", () => {
    const readiness = inspectAgentMailReadiness({ ...FULL_ENV, AGENTMAIL_API_KEY: "super-secret-value" });
    const serialized = JSON.stringify(readiness);
    expect(serialized).not.toContain("super-secret-value");
    expect(serialized).not.toContain("fake-key");
  });
});

describe("AgentMail live send gate (always evaluated, never auto-executes)", () => {
  it("allows only when every precondition passes", () => {
    const decision = evaluateAgentMailLiveSendGate(gateInput());
    expect(decision.allowed).toBe(true);
    expect(decision.reasons).toEqual([]);
  });

  it("blocks when sourceKey is not allowlisted", () => {
    const decision = evaluateAgentMailLiveSendGate(gateInput({ sourceKey: "service_request:999" }));
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain("source_not_allowlisted");
  });

  it("blocks when category is not allowlisted", () => {
    const decision = evaluateAgentMailLiveSendGate(gateInput({ category: "car_detailing" }));
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain("category_not_allowlisted");
  });

  it("blocks when the admin confirmation text is missing or wrong", () => {
    const missing = evaluateAgentMailLiveSendGate(gateInput({ adminConfirmationText: "" }));
    expect(missing.reasons).toContain("admin_confirmation_text_mismatch");
    const wrong = evaluateAgentMailLiveSendGate(gateInput({ adminConfirmationText: "send it" }));
    expect(wrong.reasons).toContain("admin_confirmation_text_mismatch");
  });

  it("blocks when canary is disabled", () => {
    const decision = evaluateAgentMailLiveSendGate(gateInput({ env: { ...FULL_ENV, HELD_VENDOR_EMAIL_CANARY_ENABLED: "false" } }));
    expect(decision.reasons).toContain("live_email_canary_disabled");
  });

  it("blocks when env is missing", () => {
    const decision = evaluateAgentMailLiveSendGate(gateInput({ env: {} }));
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain("agentmail_env_missing");
  });

  it("blocks when recipient email is invalid", () => {
    const decision = evaluateAgentMailLiveSendGate(gateInput({ recipientEmail: "not-an-email" }));
    expect(decision.reasons).toContain("recipient_email_invalid");
  });

  it("blocks when forbidden claims are present", () => {
    const decision = evaluateAgentMailLiveSendGate(gateInput({ forbiddenClaimsDetected: ["forbidden_truth_claim_detected"] }));
    expect(decision.reasons).toContain("forbidden_claims_detected");
  });
});

describe("safe HTML generation", () => {
  it("escapes text and converts paragraphs/line breaks only", () => {
    const html = renderSafeHtmlFromTextDraft("Hi there,\n\nNothing is confirmed yet.\nPlease reply.");
    expect(html).toContain("<p>Hi there,</p>");
    expect(html).toContain("Nothing is confirmed yet.<br />Please reply.");
  });

  it("never includes links, images, or tracking pixels", () => {
    const html = renderSafeHtmlFromTextDraft("Speak to HELD founder directly: Adam Wright — 323.807.4661 / Adam@bldg.chat.");
    expect(html).not.toMatch(/<a\s/i);
    expect(html).not.toMatch(/<img\s/i);
    expect(html).not.toMatch(/href=/i);
    expect(html).not.toMatch(/src=/i);
  });

  it("escapes HTML-significant characters", () => {
    const html = renderSafeHtmlFromTextDraft("<script>alert(1)</script> & \"quoted\"");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("buildAgentMailLabels", () => {
  it("builds the expected HELD labels for the first canary", () => {
    const labels = buildAgentMailLabels({ sourceKey: "service_request:155", category: "dog_grooming" });
    expect(labels).toEqual(["held_vendor_outreach", "service_request_155", "dog_grooming", "response_pending", "slice_74e"]);
  });
});

describe("sendVendorEmailViaAgentMail", () => {
  function makeMockClient(sendImpl?: (...args: unknown[]) => Promise<{ messageId?: string; threadId?: string }>): MinimalAgentMailClient {
    return {
      inboxes: {
        messages: {
          send: vi.fn(sendImpl ?? (async () => ({ messageId: "msg_123", threadId: "thread_456" }))),
        },
      },
    };
  }

  it("calls the mocked client exactly once and never touches the real network", async () => {
    const client = makeMockClient();
    const result = await sendVendorEmailViaAgentMail({
      inboxId: "held@agentmail.to",
      inboxEmail: "held@agentmail.to",
      recipientEmail: "vendor@example.com",
      subject: "Availability check",
      textBody: "Hi vendor,\n\nNothing is confirmed yet.",
      labels: buildAgentMailLabels({ sourceKey: "service_request:155", category: "dog_grooming" }),
    }, { client });

    expect(client.inboxes.messages.send).toHaveBeenCalledOnce();
    expect(result.status).toBe("sent");
    expect(result.providerAttemptId).toBe("msg_123");
    expect(result.threadId).toBe("thread_456");
    expect(result.liveProviderInvoked).toBe(true);
  });

  it("sends both text and html", async () => {
    const client = makeMockClient();
    await sendVendorEmailViaAgentMail({
      inboxId: "held@agentmail.to",
      inboxEmail: "held@agentmail.to",
      recipientEmail: "vendor@example.com",
      subject: "Availability check",
      textBody: "Hi vendor,\n\nNothing is confirmed yet.",
    }, { client });

    const callArgs = (client.inboxes.messages.send as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(callArgs.text).toBe("Hi vendor,\n\nNothing is confirmed yet.");
    expect(callArgs.html).toContain("<p>");
    expect(callArgs.html).not.toMatch(/<a\s|<img\s/i);
  });

  it("includes labels only when provided", async () => {
    const client = makeMockClient();
    await sendVendorEmailViaAgentMail({
      inboxId: "held@agentmail.to", inboxEmail: "held@agentmail.to", recipientEmail: "vendor@example.com",
      subject: "Availability check", textBody: "Hi vendor",
      labels: ["held_vendor_outreach"],
    }, { client });
    const callArgs = (client.inboxes.messages.send as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(callArgs.labels).toEqual(["held_vendor_outreach"]);
  });

  it("omits labels when none are provided", async () => {
    const client = makeMockClient();
    await sendVendorEmailViaAgentMail({
      inboxId: "held@agentmail.to", inboxEmail: "held@agentmail.to", recipientEmail: "vendor@example.com",
      subject: "Availability check", textBody: "Hi vendor",
    }, { client });
    const callArgs = (client.inboxes.messages.send as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(callArgs.labels).toBeUndefined();
  });

  it("normalizes a rejected send without throwing and never marks sent", async () => {
    const client = makeMockClient(async () => { throw new Error("AgentMail validation error: bad recipient"); });
    const result = await sendVendorEmailViaAgentMail({
      inboxId: "held@agentmail.to", inboxEmail: "held@agentmail.to", recipientEmail: "vendor@example.com",
      subject: "Availability check", textBody: "Hi vendor",
    }, { client });
    expect(result.status).toBe("rejected");
    expect(result.providerAttemptId).toBeNull();
    expect(result.errorReason).toMatch(/validation error/i);
  });

  it("never logs or returns the API key", async () => {
    const client = makeMockClient();
    const result = await sendVendorEmailViaAgentMail({
      inboxId: "held@agentmail.to", inboxEmail: "held@agentmail.to", recipientEmail: "vendor@example.com",
      subject: "Availability check", textBody: "Hi vendor",
    }, { client, env: { ...FULL_ENV, AGENTMAIL_API_KEY: "super-secret-value" } });
    expect(JSON.stringify(result)).not.toContain("super-secret-value");
  });
});
