import { describe, expect, it, vi } from "vitest";
import { computeIdempotencyKey, VendorContactAttemptStore } from "./vendorContactAttemptStore";

const MOCK_DRAFT_ROW = {
  id: "draft-1",
  tenant_id: "default",
  source_key: "service_request:155",
  candidate_id: null,
  lead_id: "lead-1",
  lane: "maps_producer",
  channel: "email",
  recipient_snapshot: "vendor@example.com",
  subject_rendered: "Availability check",
  body_rendered: "Hi vendor, ...",
  body_hash: "a".repeat(64),
  template_key: "vendor_availability_request_v0",
  template_version: "v0",
  founder_escalation_present: 1,
  forbidden_claims_scan_json: [],
  draft_status: "draft_ready",
  created_by: "admin",
  created_at: new Date("2026-06-24T00:00:00.000Z"),
  updated_at: new Date("2026-06-24T00:00:00.000Z"),
};

const MOCK_ATTEMPT_ROW = {
  id: "attempt-1",
  tenant_id: "default",
  outreach_draft_id: "draft-1",
  source_key: "service_request:155",
  service_request_id: null,
  candidate_id: null,
  lead_id: "lead-1",
  lane: "maps_producer",
  channel: "email",
  recipient_snapshot: "vendor@example.com",
  draft_subject: "Availability check",
  draft_body_snapshot: "Hi vendor, ...",
  draft_body_hash: "a".repeat(64),
  template_key: "vendor_availability_request_v0",
  template_version: "v0",
  founder_escalation_present: 1,
  forbidden_claims_scan_json: [],
  send_gate_result_json: { allowed: true, reasons: [] },
  automation_mode: "noop_provider",
  provider_adapter: "noop_email",
  provider_attempt_id: null,
  status: "response_pending",
  status_history_json: [{ status: "response_pending", at: "2026-06-24T00:00:00.000Z", actor: "admin" }],
  latest_reply_json: null,
  latest_terms_packet_json: null,
  live_provider_invoked: 0,
  outreach_sent_by_held: 0,
  provider_responded: 0,
  provider_accepted: 0,
  booking_confirmed: 0,
  payment_authorized: 0,
  dispatched: 0,
  idempotency_key: "fixed-idempotency-key",
  occurred_at: null,
  sent_at: null,
  created_by: "admin",
  created_at: new Date("2026-06-24T00:00:00.000Z"),
  updated_at: new Date("2026-06-24T00:00:00.000Z"),
};

function makeConnection(opts: { selectRows?: Array<Record<string, unknown>> } = {}) {
  const execute = vi.fn().mockImplementation((sql: string) => {
    if (/^SELECT/i.test(sql.trim())) {
      return Promise.resolve([opts.selectRows ?? [], []]);
    }
    return Promise.resolve([{ affectedRows: 1 }, []]);
  });
  return {
    execute,
    beginTransaction: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
    release: vi.fn(),
  };
}

function attemptCreateInput(overrides?: Partial<Parameters<VendorContactAttemptStore["createOrReuseAttempt"]>[0]>) {
  return {
    tenantId: "default",
    sourceKey: "service_request:155",
    leadId: "lead-1",
    lane: "maps_producer",
    channel: "email",
    recipientSnapshot: "vendor@example.com",
    founderEscalationPresent: true,
    forbiddenClaimsScanJson: [],
    sendGateResultJson: { allowed: true, reasons: [] },
    automationMode: "noop_provider",
    providerAdapter: "noop_email",
    status: "response_pending",
    statusHistoryJson: [{ status: "response_pending", at: "2026-06-24T00:00:00.000Z", actor: "admin" }],
    draftBodyHash: "a".repeat(64),
    createdBy: "admin",
    ...overrides,
  };
}

describe("computeIdempotencyKey", () => {
  it("is deterministic for identical inputs", () => {
    const a = computeIdempotencyKey({ sourceKey: "service_request:155", leadId: "lead-1", channel: "email", draftBodyHash: "x", automationMode: "noop_provider" });
    const b = computeIdempotencyKey({ sourceKey: "service_request:155", leadId: "lead-1", channel: "email", draftBodyHash: "x", automationMode: "noop_provider" });
    expect(a).toBe(b);
  });

  it("differs when any input changes", () => {
    const a = computeIdempotencyKey({ sourceKey: "service_request:155", leadId: "lead-1", channel: "email", draftBodyHash: "x", automationMode: "noop_provider" });
    const b = computeIdempotencyKey({ sourceKey: "service_request:155", leadId: "lead-1", channel: "sms_if_allowed", draftBodyHash: "x", automationMode: "noop_provider" });
    expect(a).not.toBe(b);
  });
});

describe("VendorContactAttemptStore -- createDraft", () => {
  it("creates a durable draft and writes only to vendor_contact_drafts", async () => {
    const execute = vi.fn().mockResolvedValue([{ affectedRows: 1 }, []]);
    const pool = { execute };
    const store = new VendorContactAttemptStore(pool as any);

    const draft = await store.createDraft({
      tenantId: "default",
      sourceKey: "service_request:155",
      leadId: "lead-1",
      lane: "maps_producer",
      channel: "email",
      bodyRendered: "Hi vendor, ...",
      bodyHash: "a".repeat(64),
      founderEscalationPresent: true,
      forbiddenClaimsScanJson: [],
      createdBy: "admin",
    });

    expect(draft.id).toBeTruthy();
    expect(draft.draftStatus).toBe("draft_ready");
    expect(draft.bodyHash).toBe("a".repeat(64));
    expect(execute).toHaveBeenCalledOnce();
    expect(String(execute.mock.calls[0][0])).toMatch(/INSERT INTO vendor_contact_drafts/i);
  });
});

describe("VendorContactAttemptStore -- createOrReuseAttempt", () => {
  it("creates a durable no-op attempt with the send gate snapshot and provider result stored", async () => {
    const connection = makeConnection({ selectRows: [] });
    const pool = { getConnection: vi.fn().mockResolvedValue(connection) };
    const store = new VendorContactAttemptStore(pool as any);

    const { attempt, reused } = await store.createOrReuseAttempt(attemptCreateInput());

    expect(reused).toBe(false);
    expect(attempt.sourceKey).toBe("service_request:155");
    expect(attempt.leadId).toBe("lead-1");
    expect(attempt.channel).toBe("email");
    expect(attempt.status).toBe("response_pending");
    expect(attempt.sendGateResultJson).toEqual({ allowed: true, reasons: [] });
    expect(attempt.providerAdapter).toBe("noop_email");
    expect(connection.commit).toHaveBeenCalledOnce();
    const insertCalls = connection.execute.mock.calls.filter(([sql]) => /INSERT/i.test(String(sql)));
    expect(insertCalls).toHaveLength(1);
    expect(String(insertCalls[0][0])).toMatch(/INSERT INTO vendor_contact_attempts/i);
  });

  it("hardcodes all truth fields false on create", async () => {
    const connection = makeConnection({ selectRows: [] });
    const pool = { getConnection: vi.fn().mockResolvedValue(connection) };
    const store = new VendorContactAttemptStore(pool as any);

    const { attempt } = await store.createOrReuseAttempt(attemptCreateInput());

    expect(attempt.liveProviderInvoked).toBe(false);
    expect(attempt.outreachSentByHeld).toBe(false);
    expect(attempt.providerResponded).toBe(false);
    expect(attempt.providerAccepted).toBe(false);
    expect(attempt.bookingConfirmed).toBe(false);
    expect(attempt.paymentAuthorized).toBe(false);
    expect(attempt.dispatched).toBe(false);

    const insertCall = connection.execute.mock.calls.find(([sql]) => /INSERT/i.test(String(sql)));
    expect(String(insertCall![0])).toMatch(/VALUES.*0, 0, 0, 0, 0, 0, 0/s);
  });

  it("returns the existing attempt and does not insert a second row for the same idempotency key", async () => {
    const connection = makeConnection({ selectRows: [MOCK_ATTEMPT_ROW] });
    const pool = { getConnection: vi.fn().mockResolvedValue(connection) };
    const store = new VendorContactAttemptStore(pool as any);

    const { attempt, reused } = await store.createOrReuseAttempt(attemptCreateInput());

    expect(reused).toBe(true);
    expect(attempt.id).toBe("attempt-1");
    const insertCalls = connection.execute.mock.calls.filter(([sql]) => /INSERT/i.test(String(sql)));
    expect(insertCalls).toHaveLength(0);
    expect(connection.commit).toHaveBeenCalledOnce();
  });
});

describe("VendorContactAttemptStore -- recordReplyAndTerms", () => {
  it("sets providerResponded true but never providerAccepted, booking, payment, or dispatch", async () => {
    const connection = makeConnection({ selectRows: [MOCK_ATTEMPT_ROW] });
    const pool = { getConnection: vi.fn().mockResolvedValue(connection) };
    const store = new VendorContactAttemptStore(pool as any);

    const updated = await store.recordReplyAndTerms({
      tenantId: "default",
      attemptId: "attempt-1",
      latestReplyJson: { classification: "available" },
      latestTermsPacketJson: { availabilityStatus: "available" },
      nextStatus: "interpreted",
      actor: "admin",
    });

    expect(updated.providerResponded).toBe(true);
    expect(updated.providerAccepted).toBe(false);
    expect(updated.bookingConfirmed).toBe(false);
    expect(updated.paymentAuthorized).toBe(false);
    expect(updated.dispatched).toBe(false);
    expect(updated.status).toBe("interpreted");

    const updateCall = connection.execute.mock.calls.find(([sql]) => /^\s*UPDATE/i.test(String(sql)));
    expect(updateCall).toBeTruthy();
    expect(String(updateCall![0])).not.toMatch(/provider_accepted|booking_confirmed|payment_authorized|dispatched/i);
  });

  it("appends to the status history rather than replacing it", async () => {
    const connection = makeConnection({ selectRows: [MOCK_ATTEMPT_ROW] });
    const pool = { getConnection: vi.fn().mockResolvedValue(connection) };
    const store = new VendorContactAttemptStore(pool as any);

    const updated = await store.recordReplyAndTerms({
      tenantId: "default",
      attemptId: "attempt-1",
      latestReplyJson: { classification: "available" },
      latestTermsPacketJson: { availabilityStatus: "available" },
      nextStatus: "interpreted",
      actor: "admin",
    });

    expect(updated.statusHistoryJson).toHaveLength(2);
    expect(updated.statusHistoryJson[0]).toMatchObject({ status: "response_pending" });
    expect(updated.statusHistoryJson[1]).toMatchObject({ status: "interpreted", actor: "admin" });
  });

  it("fails closed when the attempt does not exist", async () => {
    const connection = makeConnection({ selectRows: [] });
    const pool = { getConnection: vi.fn().mockResolvedValue(connection) };
    const store = new VendorContactAttemptStore(pool as any);

    await expect(store.recordReplyAndTerms({
      tenantId: "default", attemptId: "missing", latestReplyJson: {}, latestTermsPacketJson: {},
      nextStatus: "interpreted", actor: "admin",
    })).rejects.toThrow(/not found/i);
    expect(connection.rollback).toHaveBeenCalledOnce();
  });
});

describe("VendorContactAttemptStore -- audit feed", () => {
  it("getAttemptById returns the mapped attempt", async () => {
    const execute = vi.fn().mockResolvedValue([[MOCK_ATTEMPT_ROW], []]);
    const pool = { execute };
    const store = new VendorContactAttemptStore(pool as any);

    const attempt = await store.getAttemptById("default", "attempt-1");
    expect(attempt?.id).toBe("attempt-1");
    expect(attempt?.statusHistoryJson).toHaveLength(1);
  });

  it("getAttemptById returns null when not found", async () => {
    const execute = vi.fn().mockResolvedValue([[], []]);
    const pool = { execute };
    const store = new VendorContactAttemptStore(pool as any);

    expect(await store.getAttemptById("default", "missing")).toBeNull();
  });

  it("listAttemptsBySourceKey scopes the query by tenant and sourceKey", async () => {
    const execute = vi.fn().mockResolvedValue([[MOCK_ATTEMPT_ROW], []]);
    const pool = { execute };
    const store = new VendorContactAttemptStore(pool as any);

    const attempts = await store.listAttemptsBySourceKey("default", "service_request:155");
    expect(attempts).toHaveLength(1);
    expect(execute).toHaveBeenCalledWith(expect.stringMatching(/WHERE tenant_id = \? AND source_key = \?/), ["default", "service_request:155", 50]);
  });

  it("listAttemptsByCandidateId scopes the query by tenant and candidateId", async () => {
    const execute = vi.fn().mockResolvedValue([[{ ...MOCK_ATTEMPT_ROW, candidate_id: "candidate-1" }], []]);
    const pool = { execute };
    const store = new VendorContactAttemptStore(pool as any);

    const attempts = await store.listAttemptsByCandidateId("default", "candidate-1");
    expect(attempts).toHaveLength(1);
    expect(execute).toHaveBeenCalledWith(expect.stringMatching(/WHERE tenant_id = \? AND candidate_id = \?/), ["default", "candidate-1", 50]);
  });

  it("listRecentAttempts limits safely and returns a cursor only when the page is full", async () => {
    const rows = Array.from({ length: 3 }, (_, index) => ({ ...MOCK_ATTEMPT_ROW, id: `attempt-${index}` }));
    const execute = vi.fn().mockResolvedValue([rows, []]);
    const pool = { execute };
    const store = new VendorContactAttemptStore(pool as any);

    const page = await store.listRecentAttempts({ tenantId: "default", limit: 3 });
    expect(page.attempts).toHaveLength(3);
    expect(page.nextCursor).toBe(MOCK_ATTEMPT_ROW.created_at.toISOString());
  });

  it("listRecentAttempts clamps an out-of-range limit", async () => {
    const execute = vi.fn().mockResolvedValue([[], []]);
    const pool = { execute };
    const store = new VendorContactAttemptStore(pool as any);

    await store.listRecentAttempts({ tenantId: "default", limit: 10000 });
    expect(execute).toHaveBeenCalledWith(expect.any(String), ["default", 250]);
  });

  it("round-trips JSON fields correctly", async () => {
    const execute = vi.fn().mockResolvedValue([[{
      ...MOCK_ATTEMPT_ROW,
      forbidden_claims_scan_json: JSON.stringify(["forbidden_truth_claim_detected"]),
      send_gate_result_json: JSON.stringify({ allowed: false, reasons: ["contact_method_required"] }),
      status_history_json: JSON.stringify([{ status: "blocked", at: "2026-06-24T00:00:00.000Z", actor: "admin" }]),
      latest_reply_json: JSON.stringify({ classification: "unavailable" }),
      latest_terms_packet_json: JSON.stringify({ availabilityStatus: "unavailable" }),
    }], []]);
    const pool = { execute };
    const store = new VendorContactAttemptStore(pool as any);

    const attempt = await store.getAttemptById("default", "attempt-1");
    expect(attempt?.forbiddenClaimsScanJson).toEqual(["forbidden_truth_claim_detected"]);
    expect(attempt?.sendGateResultJson).toEqual({ allowed: false, reasons: ["contact_method_required"] });
    expect(attempt?.statusHistoryJson).toEqual([{ status: "blocked", at: "2026-06-24T00:00:00.000Z", actor: "admin" }]);
    expect(attempt?.latestReplyJson).toEqual({ classification: "unavailable" });
    expect(attempt?.latestTermsPacketJson).toEqual({ availabilityStatus: "unavailable" });
  });

  it("getDraftById returns the mapped draft", async () => {
    const execute = vi.fn().mockResolvedValue([[MOCK_DRAFT_ROW], []]);
    const pool = { execute };
    const store = new VendorContactAttemptStore(pool as any);

    const draft = await store.getDraftById("default", "draft-1");
    expect(draft?.id).toBe("draft-1");
    expect(draft?.bodyHash).toBe(MOCK_DRAFT_ROW.body_hash);
  });

  it("getDraftById returns null when not found", async () => {
    const execute = vi.fn().mockResolvedValue([[], []]);
    const pool = { execute };
    const store = new VendorContactAttemptStore(pool as any);

    expect(await store.getDraftById("default", "missing")).toBeNull();
  });
});

describe("VendorContactAttemptStore -- recordLiveSendResult", () => {
  it("sets liveProviderInvoked and outreachSentByHeld, never touching acceptance/booking/payment/dispatch", async () => {
    const connection = makeConnection({ selectRows: [MOCK_ATTEMPT_ROW] });
    const pool = { getConnection: vi.fn().mockResolvedValue(connection) };
    const store = new VendorContactAttemptStore(pool as any);

    const updated = await store.recordLiveSendResult({
      tenantId: "default",
      attemptId: "attempt-1",
      providerAdapter: "agentmail",
      providerAttemptId: "msg_123",
      liveProviderInvoked: true,
      outreachSentByHeld: true,
      nextStatus: "response_pending",
      actor: "admin",
    });

    expect(updated.providerAdapter).toBe("agentmail");
    expect(updated.providerAttemptId).toBe("msg_123");
    expect(updated.liveProviderInvoked).toBe(true);
    expect(updated.outreachSentByHeld).toBe(true);
    expect(updated.status).toBe("response_pending");
    expect(updated.providerAccepted).toBe(false);
    expect(updated.bookingConfirmed).toBe(false);
    expect(updated.paymentAuthorized).toBe(false);
    expect(updated.dispatched).toBe(false);

    const updateCall = connection.execute.mock.calls.find(([sql]) => /^\s*UPDATE/i.test(String(sql)));
    expect(String(updateCall![0])).not.toMatch(/provider_accepted|booking_confirmed|payment_authorized|dispatched/i);
  });

  it("does not set outreachSentByHeld when the live send was rejected", async () => {
    const connection = makeConnection({ selectRows: [MOCK_ATTEMPT_ROW] });
    const pool = { getConnection: vi.fn().mockResolvedValue(connection) };
    const store = new VendorContactAttemptStore(pool as any);

    const updated = await store.recordLiveSendResult({
      tenantId: "default",
      attemptId: "attempt-1",
      providerAdapter: "agentmail",
      providerAttemptId: null,
      liveProviderInvoked: true,
      outreachSentByHeld: false,
      nextStatus: "blocked",
      actor: "admin",
    });

    expect(updated.liveProviderInvoked).toBe(true);
    expect(updated.outreachSentByHeld).toBe(false);
    expect(updated.status).toBe("blocked");
  });

  it("fails closed when the attempt does not exist", async () => {
    const connection = makeConnection({ selectRows: [] });
    const pool = { getConnection: vi.fn().mockResolvedValue(connection) };
    const store = new VendorContactAttemptStore(pool as any);

    await expect(store.recordLiveSendResult({
      tenantId: "default", attemptId: "missing", providerAdapter: "agentmail", providerAttemptId: null,
      liveProviderInvoked: true, outreachSentByHeld: false, nextStatus: "blocked", actor: "admin",
    })).rejects.toThrow(/not found/i);
    expect(connection.rollback).toHaveBeenCalledOnce();
  });
});

describe("VendorContactAttemptStore -- getAttemptByProviderAttemptId", () => {
  it("returns the attempt matching the outbound provider message id, with no tenant filter", async () => {
    const execute = vi.fn().mockResolvedValue([[MOCK_ATTEMPT_ROW], []]);
    const pool = { execute };
    const store = new VendorContactAttemptStore(pool as any);

    const attempt = await store.getAttemptByProviderAttemptId("msg_outbound_123");
    expect(attempt?.id).toBe("attempt-1");
    expect(execute).toHaveBeenCalledWith(expect.stringMatching(/WHERE provider_attempt_id = \?/), ["msg_outbound_123"]);
    expect(String(execute.mock.calls[0][0])).not.toMatch(/tenant_id\s*=\s*\?/);
  });

  it("returns null when no attempt matches", async () => {
    const execute = vi.fn().mockResolvedValue([[], []]);
    const pool = { execute };
    const store = new VendorContactAttemptStore(pool as any);

    expect(await store.getAttemptByProviderAttemptId("msg_unknown")).toBeNull();
  });
});
