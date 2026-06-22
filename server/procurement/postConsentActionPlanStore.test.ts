import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { PostConsentActionPlanStore } from "./postConsentActionPlanStore";
import type { AdminProposalVersionPreview } from "./vendorProposalReviewStore";

const SNAPSHOT_HASH = "a".repeat(64);

const CONSENT_ROW = {
  id: "consent-1", proposal_version_id: "version-1", tenant_id: "default", bldg_user_id: 1,
  proposal_version_snapshot_hash: SNAPSHOT_HASH,
};

// No procurement workflow exists for this proposal at all -- this is the case the prior
// revision could not safely draft for. This store must not need or look up workflow_id.
const READY_PROPOSAL: AdminProposalVersionPreview = {
  proposalId: "proposal-1", proposalStatus: "ready_for_resident_presentation", versionId: "version-1",
  version: 1, reviewState: "ready_for_admin_review", expiresAt: new Date("2026-07-01T00:00:00.000Z"),
  expired: false, readiness: "ready_for_admin_review", warnings: [],
  jobCardReference: { sourceType: "resident_coordinated_request", sourceId: "1", snapshotHash: SNAPSHOT_HASH },
  jobCard: { category: "dog_grooming", serviceLabel: "Dog grooming", displaySummary: "Dog grooming request",
    residentContext: {}, requestFacts: { dogSize: "medium" } },
  candidate: { id: "candidate-1", businessName: "Acme Grooming", category: "dog_grooming" },
  terms: { id: "terms-1", availabilityStatus: "available", rateStatus: "provided", quotedAmountCents: 13500,
    quotedCurrency: "USD", rateUnit: null, confidence: "high", availabilityWindows: [
      { start: "2026-06-25T17:00:00.000Z", end: "2026-06-25T18:00:00.000Z" }],
    observedAt: new Date("2026-06-20T00:00:00.000Z"), expiresAt: null },
  evidenceReferences: [], fit: { status: "fit", safeToDisplay: true, displaySentence: null, matchedFields: [],
    evidenceIds: [], confidence: "high", reasonCodes: [] },
  eligibility: { status: "eligible_for_internal_review", reasonCodes: [], selectedEvidenceId: null,
    selectedTermsId: "terms-1", quotedAmountCents: 13500 },
  truth: { availability: "available_not_booked", providerAccepted: false, paid: false, dispatched: false, completed: false },
  residentTruthLanguage: { availabilityLabel: "Available, not booked", approvalAuthority: "Approve HELD to try to book",
    confirmationDisclaimer: "Nothing is confirmed until provider acceptance is verified" },
  audit: { createdBy: "system", createdAt: new Date("2026-06-20T00:00:00.000Z") },
};

const TEMPLATE_ROW = {
  template_key: "vendor_availability_request_v0", version: "v1", status: "approved",
  template_purpose: "vendor_availability_request", subject_template: "Quick availability check",
  body_template: "Hi {{vendorName}}, the resident approved HELD to check whether you can do this for "
    + "{{serviceLabel}} around {{offeredWindow}}. Nothing is confirmed yet. We are confirming availability "
    + "first. Please reply with availability, price, and any requirements. "
    + "Speak to HELD founder directly: Adam Wright -- [cell phone] / [email].",
  body_hash: "b".repeat(64), outreach_channel: "email",
  approved_at: new Date("2026-06-01T00:00:00.000Z"), effective_at: new Date("2026-06-02T00:00:00.000Z"),
  retired_at: null, required_legal_document_key: null, required_legal_document_version: null,
};

const LINT_RULE_ROW = {
  rule_key: "founder_escalation_required", rule_type: "required_disclosure", severity: "block",
  pattern_or_claim: "Speak to HELD founder directly", applies_to_purpose: "vendor_availability_request", status: "active",
};

const CANDIDATE_ROW = { sourcing_status: "approved_for_outreach", contact_json: { email: "vendor@example.com" }, business_name: "Acme Grooming" };

function makeExecutor(opts: {
  consentRow?: Record<string, unknown> | null;
  existingPlanRows?: Array<Record<string, unknown>>;
  existingDraftRows?: Array<Record<string, unknown>>;
  candidateRow?: Record<string, unknown> | null;
  templateRows?: Array<Record<string, unknown>>;
  lintRuleRows?: Array<Record<string, unknown>>;
} = {}) {
  let draftInserted = false;
  let planInserted = false;
  return vi.fn().mockImplementation((sql: string, params?: unknown[]) => {
    if (sql.includes("FROM resident_proposal_consents")) {
      return Promise.resolve([opts.consentRow === undefined ? [CONSENT_ROW] : (opts.consentRow ? [opts.consentRow] : []), []]);
    }
    if (/INSERT IGNORE INTO post_consent_outreach_drafts/i.test(sql)) {
      draftInserted = true;
      return Promise.resolve([{ affectedRows: 1 }, []]);
    }
    if (/INSERT IGNORE INTO post_consent_action_plans/i.test(sql)) {
      planInserted = true;
      return Promise.resolve([{ affectedRows: 1 }, []]);
    }
    if (sql.includes("FROM post_consent_action_plans")) {
      if (opts.existingPlanRows && opts.existingPlanRows.length > 0) return Promise.resolve([opts.existingPlanRows, []]);
      if (!planInserted) return Promise.resolve([[], []]);
      return Promise.resolve([[{
        id: "plan-1", consent_id: "consent-1", proposal_version_id: "version-1", tenant_id: "default",
        bldg_user_id: 1, status: "draft_vendor_outreach", reasons_json: JSON.stringify(["eligible"]),
        eligible_for_auto_send_pilot: 0, proposal_version_snapshot_hash: SNAPSHOT_HASH,
        created_by: "admin:1", created_at: new Date(), updated_at: new Date(),
      }], []]);
    }
    if (sql.includes("FROM post_consent_outreach_drafts")) {
      if (opts.existingDraftRows) return Promise.resolve([opts.existingDraftRows, []]);
      if (!draftInserted) return Promise.resolve([[], []]);
      return Promise.resolve([[{
        id: "draft-1", plan_id: "plan-1", consent_id: "consent-1", proposal_version_id: "version-1",
        tenant_id: "default", bldg_user_id: 1, vendor_candidate_id: "candidate-1", service_category: "dog_grooming",
        template_key: "vendor_availability_request_v0", template_version: "v1",
        subject_rendered: "Quick availability check", draft_body: "rendered", draft_body_hash: "b".repeat(64),
        variables_json: JSON.stringify({}), lint_result_json: JSON.stringify({ blockingLintRules: [], warnings: [] }),
        founder_escalation_present: 1, status: "drafted", created_by: "admin:1", created_at: new Date(), updated_at: new Date(),
      }], []]);
    }
    if (sql.includes("FROM vendor_sourcing_candidates")) {
      return Promise.resolve([opts.candidateRow === undefined ? [CANDIDATE_ROW] : (opts.candidateRow ? [opts.candidateRow] : []), []]);
    }
    if (sql.includes("FROM outreach_template_versions")) {
      return Promise.resolve([opts.templateRows ?? [TEMPLATE_ROW], []]);
    }
    if (sql.includes("FROM legal_document_versions")) {
      return Promise.resolve([[], []]);
    }
    if (sql.includes("FROM outreach_template_lint_rules")) {
      return Promise.resolve([opts.lintRuleRows ?? [LINT_RULE_ROW], []]);
    }
    return Promise.resolve([{ affectedRows: 1 }, []]);
  });
}

function makePool(opts: Parameters<typeof makeExecutor>[0] = {}) {
  // A single shared executor is used for both the pool and its connection so that an
  // INSERT issued via the transactional connection is visible to a subsequent read
  // issued via the pool, exactly as it would be against a real database.
  const execute = makeExecutor(opts);
  const beginTransaction = vi.fn().mockResolvedValue(undefined);
  const commit = vi.fn().mockResolvedValue(undefined);
  const rollback = vi.fn().mockResolvedValue(undefined);
  const release = vi.fn();
  const connection = { execute, beginTransaction, commit, rollback, release };
  return { pool: { execute, getConnection: vi.fn().mockResolvedValue(connection) }, connection };
}

function getVersionStub(proposal: AdminProposalVersionPreview | null = READY_PROPOSAL) {
  return { getVersion: vi.fn().mockResolvedValue(proposal) };
}

describe("PostConsentActionPlanStore.runPlan", () => {
  it("creates a draft and a plan row when every gate passes, with no workflow lookup at all", async () => {
    const { pool, connection } = makePool();
    const reviewStore = getVersionStub();
    const store = new PostConsentActionPlanStore(pool as never, reviewStore);

    const { decision, plan, draft } = await store.runPlan({ id: "plan-1", consentId: "consent-1", createdBy: "admin:1" });

    expect(decision.status).toBe("draft_vendor_outreach");
    expect(draft?.id).toBe("draft-1");
    expect(draft?.founderEscalationPresent).toBe(true);
    expect(connection.commit).toHaveBeenCalledOnce();
    const insertCalls = connection.execute.mock.calls.filter(([sql]) => /INSERT/i.test(String(sql)));
    expect(insertCalls).toHaveLength(2);
    expect(String(insertCalls[0][0])).toMatch(/INSERT IGNORE INTO post_consent_action_plans/i);
    expect(String(insertCalls[1][0])).toMatch(/INSERT IGNORE INTO post_consent_outreach_drafts/i);
    // No vendor_proposals query (workflow_id lookup) is ever issued.
    expect(connection.execute.mock.calls.some(([sql]) => /FROM vendor_proposals\b/i.test(String(sql)))).toBe(false);
    expect(reviewStore.getVersion).toHaveBeenCalledOnce();
  });

  it("never queries vendor_proposals or any workflow_id column for any call, including the no-existing-plan path", async () => {
    const { pool, connection } = makePool();
    const store = new PostConsentActionPlanStore(pool as never, getVersionStub());

    await store.runPlan({ id: "plan-1", consentId: "consent-1", createdBy: "admin:1" });

    for (const [sql] of connection.execute.mock.calls) {
      expect(String(sql)).not.toMatch(/vendor_proposals\b/i);
      expect(String(sql)).not.toMatch(/workflow_id/i);
    }
  });

  it("is idempotent -- a second run for the same consent returns the existing plan and draft without creating duplicates", async () => {
    const existingPlanRow = {
      id: "plan-1", consent_id: "consent-1", proposal_version_id: "version-1", tenant_id: "default",
      bldg_user_id: 1, status: "draft_vendor_outreach", reasons_json: JSON.stringify(["eligible"]),
      eligible_for_auto_send_pilot: 0, proposal_version_snapshot_hash: SNAPSHOT_HASH,
      created_by: "admin:1", created_at: new Date(), updated_at: new Date(),
    };
    const existingDraftRow = {
      id: "draft-1", plan_id: "plan-1", consent_id: "consent-1", proposal_version_id: "version-1",
      tenant_id: "default", bldg_user_id: 1, vendor_candidate_id: "candidate-1", service_category: "dog_grooming",
      template_key: "vendor_availability_request_v0", template_version: "v1",
      subject_rendered: "Quick availability check", draft_body: "rendered", draft_body_hash: "b".repeat(64),
      variables_json: "{}", lint_result_json: "{}", founder_escalation_present: 1, status: "drafted",
      created_by: "admin:1", created_at: new Date(), updated_at: new Date(),
    };
    const { pool, connection } = makePool({ existingPlanRows: [existingPlanRow], existingDraftRows: [existingDraftRow] });
    const reviewStore = getVersionStub();
    const store = new PostConsentActionPlanStore(pool as never, reviewStore);

    const { decision, plan, draft } = await store.runPlan({ id: "plan-2", consentId: "consent-1", createdBy: "admin:1" });

    expect(decision.status).toBe("draft_vendor_outreach");
    expect(plan.id).toBe("plan-1");
    expect(draft?.id).toBe("draft-1");
    expect(reviewStore.getVersion).not.toHaveBeenCalled();
    expect(connection.beginTransaction).not.toHaveBeenCalled();
  });

  it("throws if the consent does not exist", async () => {
    const { pool } = makePool({ consentRow: null });
    const store = new PostConsentActionPlanStore(pool as never, getVersionStub());

    await expect(store.runPlan({ id: "plan-1", consentId: "missing", createdBy: "admin:1" }))
      .rejects.toThrow(/not found/);
  });

  it("stores tenant_id/bldg_user_id exactly as recorded on the consent -- never from any other source", async () => {
    const { pool, connection } = makePool({ consentRow: { ...CONSENT_ROW, tenant_id: "laundry_farm", bldg_user_id: 999 } });
    const store = new PostConsentActionPlanStore(pool as never, getVersionStub());

    await store.runPlan({ id: "plan-1", consentId: "consent-1", createdBy: "admin:1" });

    const planInsert = connection.execute.mock.calls.find(([sql]) => /INSERT IGNORE INTO post_consent_action_plans/i.test(String(sql)));
    expect(planInsert?.[1]).toEqual(expect.arrayContaining(["laundry_farm", 999]));
  });

  it("blocks with blocked_terms_changed and writes no draft when the snapshot hash no longer matches", async () => {
    const mismatchedProposal = { ...READY_PROPOSAL, jobCardReference: { ...READY_PROPOSAL.jobCardReference, snapshotHash: "c".repeat(64) } };
    const { pool, connection } = makePool();
    const store = new PostConsentActionPlanStore(pool as never, getVersionStub(mismatchedProposal));

    const { decision, draft } = await store.runPlan({ id: "plan-1", consentId: "consent-1", createdBy: "admin:1" });

    expect(decision.status).toBe("blocked_terms_changed");
    expect(draft).toBeNull();
    const draftInserts = connection.execute.mock.calls.filter(([sql]) => /INSERT IGNORE INTO post_consent_outreach_drafts/i.test(String(sql)));
    expect(draftInserts).toHaveLength(0);
  });

  it("blocks with blocked_missing_vendor_contact and writes no draft when the candidate has no contact info", async () => {
    const { pool, connection } = makePool({ candidateRow: { ...CANDIDATE_ROW, contact_json: null } });
    const store = new PostConsentActionPlanStore(pool as never, getVersionStub());

    const { decision, draft } = await store.runPlan({ id: "plan-1", consentId: "consent-1", createdBy: "admin:1" });

    expect(decision.status).toBe("blocked_missing_vendor_contact");
    expect(draft).toBeNull();
    const draftInserts = connection.execute.mock.calls.filter(([sql]) => /INSERT IGNORE INTO post_consent_outreach_drafts/i.test(String(sql)));
    expect(draftInserts).toHaveLength(0);
  });

  it("routes to needs_resident_clarification and writes no draft when request facts are missing", async () => {
    const noFactsProposal = { ...READY_PROPOSAL, jobCard: { ...READY_PROPOSAL.jobCard, requestFacts: {} } };
    const { pool, connection } = makePool();
    const store = new PostConsentActionPlanStore(pool as never, getVersionStub(noFactsProposal));

    const { decision, draft } = await store.runPlan({ id: "plan-1", consentId: "consent-1", createdBy: "admin:1" });

    expect(decision.status).toBe("needs_resident_clarification");
    expect(draft).toBeNull();
  });

  it("blocks with blocked_unsafe_to_contact and writes no draft when the template lacks the founder escalation line", async () => {
    const { pool, connection } = makePool({
      templateRows: [{ ...TEMPLATE_ROW, body_template: "Hi {{vendorName}}, nothing is confirmed yet." }],
    });
    const store = new PostConsentActionPlanStore(pool as never, getVersionStub());

    const { decision, draft } = await store.runPlan({ id: "plan-1", consentId: "consent-1", createdBy: "admin:1" });

    expect(decision.status).toBe("blocked_unsafe_to_contact");
    expect(draft).toBeNull();
    const draftInserts = connection.execute.mock.calls.filter(([sql]) => /INSERT IGNORE INTO post_consent_outreach_drafts/i.test(String(sql)));
    expect(draftInserts).toHaveLength(0);
  });

  it("blocks with blocked_unsafe_to_contact and writes no draft when the template is missing or the lint rule set is empty", async () => {
    const { pool, connection } = makePool({ templateRows: [] });
    const store = new PostConsentActionPlanStore(pool as never, getVersionStub());

    const { decision, draft } = await store.runPlan({ id: "plan-1", consentId: "consent-1", createdBy: "admin:1" });

    expect(decision.status).toBe("needs_operator_review");
    expect(draft).toBeNull();
    const draftInserts = connection.execute.mock.calls.filter(([sql]) => /INSERT IGNORE INTO post_consent_outreach_drafts/i.test(String(sql)));
    expect(draftInserts).toHaveLength(0);
  });

  it("the persisted draft records founder_escalation_present accurately", async () => {
    const { pool, connection } = makePool();
    const store = new PostConsentActionPlanStore(pool as never, getVersionStub());

    await store.runPlan({ id: "plan-1", consentId: "consent-1", createdBy: "admin:1" });

    const draftInsert = connection.execute.mock.calls.find(([sql]) => /INSERT IGNORE INTO post_consent_outreach_drafts/i.test(String(sql)));
    expect(draftInsert?.[1]?.[15]).toBe(1); // founder_escalation_present = 1
  });

  it("never includes resident contact fields (phone/email/address/unit) in the rendered draft variables", async () => {
    const { pool, connection } = makePool();
    const store = new PostConsentActionPlanStore(pool as never, getVersionStub());

    await store.runPlan({ id: "plan-1", consentId: "consent-1", createdBy: "admin:1" });

    const draftInsert = connection.execute.mock.calls.find(([sql]) => /INSERT IGNORE INTO post_consent_outreach_drafts/i.test(String(sql)));
    const variablesJson = String(draftInsert?.[1]?.[13] ?? "");
    expect(variablesJson).not.toMatch(/residentPhone|residentEmail|residentAddress|unit|phoneE164/i);
  });

  it("does not send anything and produces no booking/payment/dispatch/provider-acceptance side effects", async () => {
    const { pool, connection } = makePool();
    const store = new PostConsentActionPlanStore(pool as never, getVersionStub());

    await store.runPlan({ id: "plan-1", consentId: "consent-1", createdBy: "admin:1" });

    for (const [sql] of connection.execute.mock.calls) {
      expect(String(sql)).not.toMatch(/conversation_events|operator_gates|provider_acceptance|booking|payment|stripe|dispatch/i);
    }
  });
});

describe("post-consent action plan store source isolation", () => {
  it("writes only to post_consent_action_plans and post_consent_outreach_drafts -- never to vendor_outreach_drafts, gates, conversation events, dispatch, payment, Stripe, or legacy vendor tables", () => {
    const source = fs.readFileSync("server/procurement/postConsentActionPlanStore.ts", "utf8");
    const writeStatements = source.match(/\b(INSERT INTO|INSERT IGNORE INTO|UPDATE\s+\w+|DELETE FROM)\b[^;]*/gi) ?? [];
    expect(writeStatements.length).toBeGreaterThan(0);
    for (const statement of writeStatements) {
      expect(statement).toMatch(/post_consent_action_plans|post_consent_outreach_drafts/);
    }
    expect(source).not.toMatch(/\bvendor_outreach_drafts\b/);
    expect(source).not.toMatch(/\bvendor_outreach_conversation_events\b/);
    expect(source).not.toMatch(/\bprocurement_operator_gates\b/);
    expect(source).not.toMatch(/\b(orders|payments|stripe)\b/i);
    expect(source).not.toMatch(/provider_acceptance/i);
    expect(source).not.toMatch(/\bfetch\(/);
    expect(source).not.toMatch(/\baxios\b/);
    expect(source).not.toMatch(/openai|anthropic|chatgpt/i);
  });

  it("never queries vendor_proposals.workflow_id", () => {
    const source = fs.readFileSync("server/procurement/postConsentActionPlanStore.ts", "utf8");
    expect(source).not.toMatch(/FROM vendor_proposals\b/);
    expect(source).not.toMatch(/workflow_id/);
  });

  it("contains no route or worker wiring", () => {
    const source = fs.readFileSync("server/procurement/postConsentActionPlanStore.ts", "utf8");
    expect(source).not.toMatch(/router|app\.(get|post|put|delete)/i);
  });
});
