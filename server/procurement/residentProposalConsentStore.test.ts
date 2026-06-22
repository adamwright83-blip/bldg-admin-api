import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { ResidentProposalConsentStore } from "./residentProposalConsentStore";
import type { ResidentProposalPresentationContract } from "./residentProposalPresentationContract";

const READY_CARD: ResidentProposalPresentationContract = {
  proposal_id: "proposal-1", proposal_version_id: "version-1", service_category: "dog_grooming",
  service_label: "Dog grooming", resident_safe_summary: "Dog grooming request",
  vendor_display_name: "Acme Grooming", vendor_source_display_type: "Public business directory",
  offered_window: { start: "2026-06-25T10:00:00.000Z", end: "2026-06-25T11:00:00.000Z", label: "Jun 25, 10-11am" },
  quoted_price: { amount_cents: 13500, currency: "USD", label: "Quoted $135.00" },
  proposal_expiry: "2026-07-01T00:00:00.000Z", readiness: "ready_for_resident",
  truth_language: { availability: "Available, not booked", authority: "Approve HELD to try to book",
    disclaimer: "Nothing is confirmed until provider acceptance is verified" },
  truth_flags: { available_not_booked: true, provider_not_accepted: true, not_paid: true,
    not_dispatched: true, not_completed: true },
  fit: null, reputation: null, evidence_labels: [],
  cta: { visible: true, primary_text: "Let HELD try to book this",
    reassurance: "Nothing is confirmed until the provider accepts.", authority_only: true },
  state_mutated: false, llm_called: false,
};

const CONSENT_ROW = {
  id: "consent-1", proposal_version_id: "version-1", tenant_id: "default", bldg_user_id: 1,
  consent_action: "approve_held_to_try_to_book", copy_version: "v1",
  proposal_version_snapshot_hash: "a".repeat(64), audit_metadata_json: {},
  created_by: "bldg_user:1", consented_at: new Date("2026-06-22T12:00:00.000Z"),
};

function makeExecutor(opts: {
  existingConsentRows?: Array<Record<string, unknown>>;
  hashRows?: Array<Record<string, unknown>>;
} = {}) {
  let consentCallCount = 0;
  return vi.fn().mockImplementation((sql: string) => {
    if (sql.includes("FROM resident_proposal_consents")) {
      consentCallCount += 1;
      // First call (pre-insert idempotency check) uses existingConsentRows; the
      // post-insert re-select always returns the row that was just inserted.
      if (consentCallCount === 1) return Promise.resolve([opts.existingConsentRows ?? [], []]);
      return Promise.resolve([[CONSENT_ROW], []]);
    }
    if (sql.includes("FROM vendor_proposal_versions")) {
      return Promise.resolve([opts.hashRows ?? [{ job_card_snapshot_hash: "a".repeat(64) }], []]);
    }
    return Promise.resolve([{ affectedRows: 1 }, []]);
  });
}

function makeConnection(opts: Parameters<typeof makeExecutor>[0] = {}) {
  const execute = makeExecutor(opts);
  const beginTransaction = vi.fn().mockResolvedValue(undefined);
  const commit = vi.fn().mockResolvedValue(undefined);
  const rollback = vi.fn().mockResolvedValue(undefined);
  const release = vi.fn();
  return { execute, beginTransaction, commit, rollback, release };
}

function makePool(opts: Parameters<typeof makeExecutor>[0] = {}) {
  const connection = makeConnection(opts);
  const execute = makeExecutor(opts);
  return { pool: { execute, getConnection: vi.fn().mockResolvedValue(connection) }, connection };
}

function baseInput() {
  return {
    id: "consent-1", versionId: "version-1", bldgUserId: 1, tenantId: "default",
    createdBy: "bldg_user:1", now: new Date("2026-06-22T12:00:00.000Z"),
  };
}

describe("ResidentProposalConsentStore.recordConsent", () => {
  it("records consent for an eligible proposal", async () => {
    const { pool, connection } = makePool();
    const readStore = { readOwned: vi.fn().mockResolvedValue(READY_CARD) };
    const store = new ResidentProposalConsentStore(pool as never, readStore);

    const { decision, record } = await store.recordConsent(baseInput());

    expect(decision.outcome).toBe("consent_recorded");
    expect(record?.proposalVersionId).toBe("version-1");
    expect(connection.commit).toHaveBeenCalledOnce();
    const insertCalls = connection.execute.mock.calls.filter(([sql]) => /INSERT/i.test(String(sql)));
    expect(insertCalls).toHaveLength(1);
    expect(String(insertCalls[0][0])).toMatch(/INSERT IGNORE INTO resident_proposal_consents/i);
  });

  it("replay returns the existing consent without inserting again", async () => {
    const { pool, connection } = makePool({ existingConsentRows: [CONSENT_ROW] });
    const readStore = { readOwned: vi.fn() };
    const store = new ResidentProposalConsentStore(pool as never, readStore);

    const { decision, record } = await store.recordConsent(baseInput());

    expect(decision.outcome).toBe("consent_already_recorded");
    expect(record?.id).toBe("consent-1");
    expect(readStore.readOwned).not.toHaveBeenCalled();
    expect(connection.beginTransaction).not.toHaveBeenCalled();
  });

  it("refuses a not-owned proposal without writing", async () => {
    const { pool, connection } = makePool();
    const readStore = { readOwned: vi.fn().mockResolvedValue(null) };
    const store = new ResidentProposalConsentStore(pool as never, readStore);

    const { decision, record } = await store.recordConsent(baseInput());

    expect(decision.outcome).toBe("consent_not_allowed");
    expect(record).toBeNull();
    expect(connection.beginTransaction).not.toHaveBeenCalled();
  });

  it("refuses an expired/unavailable/unsafe/not_ready proposal (readOwned already returns null for these)", async () => {
    const { pool } = makePool();
    const readStore = { readOwned: vi.fn().mockResolvedValue(null) };
    const store = new ResidentProposalConsentStore(pool as never, readStore);

    const { decision } = await store.recordConsent(baseInput());
    expect(decision.outcome).toBe("consent_not_allowed");
  });

  it("refuses a superseded proposal (readOwned returns null)", async () => {
    const { pool } = makePool();
    const readStore = { readOwned: vi.fn().mockResolvedValue(null) };
    const store = new ResidentProposalConsentStore(pool as never, readStore);

    const { decision } = await store.recordConsent(baseInput());
    expect(decision.outcome).toBe("consent_not_allowed");
  });

  it("refuses a proposal that is ready but not CTA-eligible", async () => {
    const { pool } = makePool();
    const notCtaEligible = { ...READY_CARD, cta: { ...READY_CARD.cta, visible: false } };
    const readStore = { readOwned: vi.fn().mockResolvedValue(notCtaEligible) };
    const store = new ResidentProposalConsentStore(pool as never, readStore);

    const { decision } = await store.recordConsent(baseInput());
    expect(decision.outcome).toBe("consent_not_allowed");
  });

  it("a forged tenant/bldgUserId cannot retrieve or create another resident's consent", async () => {
    // The store's only identity inputs are the parameters passed in -- which the caller (the
    // HTTP route) derives solely from authenticateResidentAppRequest, never from request body.
    // Here we simulate calling with a different resident's identity and confirm readOwned (the
    // ownership gate) is invoked with that exact identity, not silently widened.
    const { pool } = makePool();
    const readStore = { readOwned: vi.fn().mockResolvedValue(null) };
    const store = new ResidentProposalConsentStore(pool as never, readStore);

    await store.recordConsent({ ...baseInput(), bldgUserId: 999, tenantId: "laundry_farm" });

    expect(readStore.readOwned).toHaveBeenCalledWith(expect.objectContaining({ bldgUserId: 999, tenantId: "laundry_farm" }));
  });

  it("rolls back and throws if the proposal version row vanishes between the eligibility check and the write", async () => {
    const { pool, connection } = makePool({ hashRows: [] });
    const readStore = { readOwned: vi.fn().mockResolvedValue(READY_CARD) };
    const store = new ResidentProposalConsentStore(pool as never, readStore);

    await expect(store.recordConsent(baseInput())).rejects.toThrow(/not found/);
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).not.toHaveBeenCalled();
  });
});

describe("resident proposal consent store source isolation", () => {
  it("writes only to resident_proposal_consents -- never to proposals, gates, outreach, booking, payment, Stripe, dispatch, provider-acceptance, or LLM/agent tables", () => {
    const source = fs.readFileSync("server/procurement/residentProposalConsentStore.ts", "utf8");
    const writeStatements = source.match(/\b(INSERT INTO|INSERT IGNORE INTO|UPDATE\s+\w+|DELETE FROM)\b[^;]*/gi) ?? [];
    expect(writeStatements.length).toBeGreaterThan(0);
    for (const statement of writeStatements) {
      expect(statement).toMatch(/resident_proposal_consents/);
    }
    expect(source).not.toMatch(/\bvendor_outreach/);
    expect(source).not.toMatch(/\bprocurement_operator_gates\b/);
    expect(source).not.toMatch(/\b(orders|payments|stripe)\b/i);
    expect(source).not.toMatch(/\bdispatch\b/i);
    expect(source).not.toMatch(/provider_acceptance/i);
    expect(source).not.toMatch(/\bfetch\(/);
    expect(source).not.toMatch(/\baxios\b/);
    expect(source).not.toMatch(/openai|anthropic|chatgpt/i);
  });

  it("contains no route or worker wiring", () => {
    const source = fs.readFileSync("server/procurement/residentProposalConsentStore.ts", "utf8");
    expect(source).not.toMatch(/router|app\.(get|post|put|delete)/i);
  });
});
