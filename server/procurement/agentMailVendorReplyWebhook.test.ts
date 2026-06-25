import { describe, expect, it, vi } from "vitest";
import {
  AGENTMAIL_VENDOR_WEBHOOK_SECRET_ENV_VAR,
  processAgentMailVendorReplyWebhook,
  verifyAgentMailWebhookSecret,
} from "./agentMailVendorReplyWebhook";

const SECRET_ENV = { [AGENTMAIL_VENDOR_WEBHOOK_SECRET_ENV_VAR]: "correct-secret-value" };

const MOCK_ATTEMPT = {
  id: "attempt-1",
  tenantId: "default",
  outreachDraftId: "draft-1",
  sourceKey: "service_request:155",
  serviceRequestId: null,
  candidateId: "candidate-1",
  leadId: "lead-1",
  lane: "maps_producer",
  channel: "email",
  recipientSnapshot: "vendor@example.com",
  draftSubject: "Availability check",
  draftBodySnapshot: "Hi vendor,\n\nNothing is confirmed yet.",
  draftBodyHash: "a".repeat(64),
  templateKey: "vendor_availability_request_v0",
  templateVersion: null,
  founderEscalationPresent: true,
  forbiddenClaimsScanJson: { forbiddenClaimsDetected: [], blockingLintRules: [] },
  sendGateResultJson: { allowed: true, reasons: [] },
  automationMode: "gated_provider_future",
  providerAdapter: "agentmail",
  providerAttemptId: "msg_outbound_123",
  status: "response_pending",
  statusHistoryJson: [{ status: "response_pending", at: "2026-06-24T00:00:00.000Z", actor: "admin" }],
  latestReplyJson: null,
  latestTermsPacketJson: null,
  liveProviderInvoked: true,
  outreachSentByHeld: true,
  providerResponded: false,
  providerAccepted: false,
  bookingConfirmed: false,
  paymentAuthorized: false,
  dispatched: false,
  idempotencyKey: "idem-1",
  occurredAt: null,
  sentAt: new Date("2026-06-24T00:00:00.000Z"),
  createdBy: "admin",
  createdAt: new Date("2026-06-24T00:00:00.000Z"),
  updatedAt: new Date("2026-06-24T00:00:00.000Z"),
};

function makeMockStore(overrides?: Record<string, unknown>) {
  return {
    getAttemptByProviderAttemptId: vi.fn().mockResolvedValue(MOCK_ATTEMPT),
    recordReplyAndTerms: vi.fn().mockResolvedValue({ ...MOCK_ATTEMPT, status: "interpreted" }),
    ...overrides,
  };
}

function webhookBody(overrides?: Record<string, unknown>) {
  return JSON.stringify({
    type: "event",
    eventType: "message.received",
    eventId: "evt_123",
    message: {
      messageId: "msg_inbound_456",
      threadId: "thread_789",
      from: "vendor@example.com",
      extractedText: "We have an opening that day and can do it, $110.",
      inReplyTo: "msg_outbound_123",
      references: [],
    },
    ...overrides,
  });
}

describe("verifyAgentMailWebhookSecret", () => {
  it("rejects when no secret is configured", () => {
    const result = verifyAgentMailWebhookSecret({ providedSecret: "anything", env: {} });
    expect(result.authorized).toBe(false);
    expect(result.reason).toBe("webhook_secret_not_configured");
  });

  it("rejects a missing header", () => {
    const result = verifyAgentMailWebhookSecret({ providedSecret: undefined, env: SECRET_ENV });
    expect(result.authorized).toBe(false);
    expect(result.reason).toBe("missing_webhook_secret_header");
  });

  it("rejects an invalid secret using a timing-safe comparison", () => {
    const result = verifyAgentMailWebhookSecret({ providedSecret: "wrong-secret", env: SECRET_ENV });
    expect(result.authorized).toBe(false);
    expect(result.reason).toBe("invalid_webhook_secret");
  });

  it("accepts the correct secret", () => {
    const result = verifyAgentMailWebhookSecret({ providedSecret: "correct-secret-value", env: SECRET_ENV });
    expect(result.authorized).toBe(true);
    expect(result.reason).toBeNull();
  });

  it("never echoes the configured or provided secret in its result", () => {
    const result = verifyAgentMailWebhookSecret({ providedSecret: "wrong-secret", env: SECRET_ENV });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("correct-secret-value");
    expect(serialized).not.toContain("wrong-secret");
  });
});

describe("processAgentMailVendorReplyWebhook -- auth", () => {
  it("rejects missing secret header", async () => {
    const store = makeMockStore();
    const result = await processAgentMailVendorReplyWebhook({
      rawBody: webhookBody(), providedSecret: undefined, store, env: SECRET_ENV,
    });
    expect(result.status).toBe("unauthorized");
    expect(store.getAttemptByProviderAttemptId).not.toHaveBeenCalled();
  });

  it("rejects an invalid secret", async () => {
    const store = makeMockStore();
    const result = await processAgentMailVendorReplyWebhook({
      rawBody: webhookBody(), providedSecret: "wrong", store, env: SECRET_ENV,
    });
    expect(result.status).toBe("unauthorized");
    expect(store.getAttemptByProviderAttemptId).not.toHaveBeenCalled();
  });

  it("accepts a valid secret and proceeds", async () => {
    const store = makeMockStore();
    const result = await processAgentMailVendorReplyWebhook({
      rawBody: webhookBody(), providedSecret: "correct-secret-value", store, env: SECRET_ENV,
    });
    expect(result.status).toBe("processed");
  });

  it("never logs or returns the secret regardless of outcome", async () => {
    const store = makeMockStore();
    const result = await processAgentMailVendorReplyWebhook({
      rawBody: webhookBody(), providedSecret: "wrong", store, env: SECRET_ENV,
    });
    expect(JSON.stringify(result)).not.toContain("correct-secret-value");
  });
});

describe("processAgentMailVendorReplyWebhook -- correlation", () => {
  it("ignores an unmatched inbound reply safely without writing anything", async () => {
    const store = makeMockStore({ getAttemptByProviderAttemptId: vi.fn().mockResolvedValue(null) });
    const result = await processAgentMailVendorReplyWebhook({
      rawBody: webhookBody(), providedSecret: "correct-secret-value", store, env: SECRET_ENV,
    });
    expect(result.status).toBe("unmatched");
    expect(store.recordReplyAndTerms).not.toHaveBeenCalled();
  });

  it("matches by provider message id (inReplyTo) when present", async () => {
    const store = makeMockStore();
    await processAgentMailVendorReplyWebhook({
      rawBody: webhookBody(), providedSecret: "correct-secret-value", store, env: SECRET_ENV,
    });
    expect(store.getAttemptByProviderAttemptId).toHaveBeenCalledWith("msg_outbound_123");
  });

  it("falls back to the most recent references entry when inReplyTo is absent", async () => {
    const store = makeMockStore();
    await processAgentMailVendorReplyWebhook({
      rawBody: webhookBody({ message: { extractedText: "ok", inReplyTo: null, references: ["msg_a", "msg_outbound_123"] } }),
      providedSecret: "correct-secret-value", store, env: SECRET_ENV,
    });
    expect(store.getAttemptByProviderAttemptId).toHaveBeenCalledWith("msg_outbound_123");
  });

  it("does not fabricate a match when no correlation reference exists", async () => {
    const store = makeMockStore();
    const result = await processAgentMailVendorReplyWebhook({
      rawBody: webhookBody({ message: { extractedText: "ok", inReplyTo: null, references: [] } }),
      providedSecret: "correct-secret-value", store, env: SECRET_ENV,
    });
    expect(result.status).toBe("unmatched");
    expect(store.getAttemptByProviderAttemptId).not.toHaveBeenCalled();
  });

  it("never creates a new attempt row -- the store interface it depends on has no create method", async () => {
    const store = makeMockStore();
    expect(store).not.toHaveProperty("createOrReuseAttempt");
    expect(store).not.toHaveProperty("createDraft");
  });

  it("ignores non-message.received event types without writing anything", async () => {
    const store = makeMockStore();
    const result = await processAgentMailVendorReplyWebhook({
      rawBody: webhookBody({ eventType: "message.sent" }), providedSecret: "correct-secret-value", store, env: SECRET_ENV,
    });
    expect(result.status).toBe("ignored_event_type");
    expect(store.recordReplyAndTerms).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON safely", async () => {
    const store = makeMockStore();
    const result = await processAgentMailVendorReplyWebhook({
      rawBody: "not json", providedSecret: "correct-secret-value", store, env: SECRET_ENV,
    });
    expect(result.status).toBe("invalid_payload");
  });
});

describe("processAgentMailVendorReplyWebhook -- persistence", () => {
  it("records latest_reply_json and latest_terms_packet_json, sets provider_responded via the store", async () => {
    const store = makeMockStore();
    const result = await processAgentMailVendorReplyWebhook({
      rawBody: webhookBody(), providedSecret: "correct-secret-value", store, env: SECRET_ENV,
    });
    expect(result.status).toBe("processed");
    expect(store.recordReplyAndTerms).toHaveBeenCalledOnce();
    const call = store.recordReplyAndTerms.mock.calls[0][0];
    expect(call.tenantId).toBe("default");
    expect(call.attemptId).toBe("attempt-1");
    expect(call.latestReplyJson.agentMailEventId).toBe("evt_123");
    expect(call.latestTermsPacketJson).not.toBeNull();
  });

  it("appends to the status timeline exactly once per call", async () => {
    const store = makeMockStore();
    await processAgentMailVendorReplyWebhook({
      rawBody: webhookBody(), providedSecret: "correct-secret-value", store, env: SECRET_ENV,
    });
    expect(store.recordReplyAndTerms).toHaveBeenCalledOnce();
  });

  it("duplicate webhook delivery for the same event id is idempotent and does not call recordReplyAndTerms again", async () => {
    const alreadyProcessedAttempt = { ...MOCK_ATTEMPT, latestReplyJson: { agentMailEventId: "evt_123" } };
    const store = makeMockStore({ getAttemptByProviderAttemptId: vi.fn().mockResolvedValue(alreadyProcessedAttempt) });
    const result = await processAgentMailVendorReplyWebhook({
      rawBody: webhookBody(), providedSecret: "correct-secret-value", store, env: SECRET_ENV,
    });
    expect(result.status).toBe("already_processed");
    expect(store.recordReplyAndTerms).not.toHaveBeenCalled();
  });

  it("a different event id for the same attempt is processed normally, not treated as duplicate", async () => {
    const previouslyProcessedAttempt = { ...MOCK_ATTEMPT, latestReplyJson: { agentMailEventId: "evt_OLD" } };
    const store = makeMockStore({ getAttemptByProviderAttemptId: vi.fn().mockResolvedValue(previouslyProcessedAttempt) });
    const result = await processAgentMailVendorReplyWebhook({
      rawBody: webhookBody({ eventId: "evt_NEW" }), providedSecret: "correct-secret-value", store, env: SECRET_ENV,
    });
    expect(result.status).toBe("processed");
    expect(store.recordReplyAndTerms).toHaveBeenCalledOnce();
  });
});

describe("processAgentMailVendorReplyWebhook -- truth safety", () => {
  it("never sets provider_accepted/booking_confirmed/payment_authorized/dispatched even for an available-sounding reply", async () => {
    const store = makeMockStore();
    const result = await processAgentMailVendorReplyWebhook({
      rawBody: webhookBody({ message: { extractedText: "Yes, we are available and can do it for $110.", inReplyTo: "msg_outbound_123" } }),
      providedSecret: "correct-secret-value", store, env: SECRET_ENV,
    });
    expect(result.status).toBe("processed");
    const call = store.recordReplyAndTerms.mock.calls[0][0];
    expect(call).not.toHaveProperty("providerAccepted");
    expect(call).not.toHaveProperty("bookingConfirmed");
    expect(call).not.toHaveProperty("paymentAuthorized");
    expect(call).not.toHaveProperty("dispatched");
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/"providerAccepted":true/);
    expect(serialized).not.toMatch(/"bookingConfirmed":true/);
    expect(serialized).not.toMatch(/"paymentAuthorized":true/);
    expect(serialized).not.toMatch(/"dispatched":true/);
  });

  it("classifies an available-style reply but still routes to interpreted status, not booked/accepted", async () => {
    const store = makeMockStore();
    const result = await processAgentMailVendorReplyWebhook({
      rawBody: webhookBody({ message: { extractedText: "We have an opening that day and can do it, $110.", inReplyTo: "msg_outbound_123" } }),
      providedSecret: "correct-secret-value", store, env: SECRET_ENV,
    });
    expect(result.status).toBe("processed");
    if (result.status === "processed") {
      expect(result.classification).toBe("available");
    }
    const call = store.recordReplyAndTerms.mock.calls[0][0];
    expect(call.nextStatus).toBe("interpreted");
  });

  it("an ambiguous reply still requires admin review, never auto-marking truth", async () => {
    const store = makeMockStore();
    const result = await processAgentMailVendorReplyWebhook({
      rawBody: webhookBody({ message: { extractedText: "Thanks for reaching out.", inReplyTo: "msg_outbound_123" } }),
      providedSecret: "correct-secret-value", store, env: SECRET_ENV,
    });
    expect(result.status).toBe("processed");
    const call = store.recordReplyAndTerms.mock.calls[0][0];
    expect(call.latestTermsPacketJson?.residentProposalReady).not.toBe(true);
  });
});

describe("processAgentMailVendorReplyWebhook -- isolation", () => {
  it("never invokes any outbound send function; the store interface it uses has no send/createOrReuseAttempt method", async () => {
    const store = makeMockStore();
    await processAgentMailVendorReplyWebhook({
      rawBody: webhookBody(), providedSecret: "correct-secret-value", store, env: SECRET_ENV,
    });
    expect(Object.keys(store)).toEqual(["getAttemptByProviderAttemptId", "recordReplyAndTerms"]);
  });
});
