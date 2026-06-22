import { describe, expect, it, vi } from "vitest";
import type { Pool } from "mysql2/promise";
import { VendorProposalReviewStore } from "./vendorProposalReviewStore";

const NOW = new Date("2026-06-22T12:00:00.000Z");

function row(patch: Record<string, unknown> = {}) {
  return {
    proposal_id: "proposal-1", proposal_status: "draft", version_id: "version-1", version: 1,
    review_state: "ready_for_admin_review", expires_at: new Date("2026-06-25T00:00:00.000Z"),
    job_card_source_type: "service_request", job_card_source_id: "12", job_card_snapshot_hash: "a".repeat(64),
    job_card_snapshot_json: { category: "dog_grooming", serviceLabel: "Dog grooming",
      displaySummary: "Groom Theo Friday", rawRequest: "must never be returned",
      residentContext: { residentName: "Adam", buildingSlug: "the-wright", unit: "4B" },
      requestFacts: { requestedDate: "2026-06-26", dog: { name: "Theo", breed: "Poodle" } } },
    eligibility_decision_json: { eligibility_status: "eligible_for_internal_review",
      readiness_reasons: [{ code: "eligible_for_internal_review" }], selected_evidence_id: "evidence-1",
      selected_terms_id: "terms-1", quoted_amount_cents: 8500 },
    fit_decision_json: { fit_status: "strong_match", fit_basis: { safe_to_display: true,
      display_sentence: "I found explicit relevant evidence for poodle, which fits Theo’s request.",
      matched_fields: ["breed"], evidence_ids: ["evidence-1"], confidence: "high",
      reason_codes: ["exact_breed_evidence"] } },
    truth_flags_json: { availability_state: "available_not_booked", booked: false,
      provider_accepted: false, paid: false, dispatched: false, completed: false },
    resident_truth_inputs_json: { availability_label: "Available, not booked",
      approval_cta: "Approve HELD to try to book",
      confirmation_disclaimer: "Nothing is confirmed until provider acceptance is verified" },
    created_by: "operator-1", created_at: NOW, candidate_id: "candidate-1",
    business_name: "Theo Grooming", category: "dog_grooming", response_terms_id: "terms-1",
    availability_status: "available", rate_status: "provided", quoted_amount: "85.00",
    quoted_currency: "USD", rate_unit: "service", confidence: "high", terms_observed_at: NOW,
    terms_expires_at: new Date("2026-06-26T00:00:00.000Z"), ...patch,
  };
}

function storeWith(rows: ReturnType<typeof row>[]) {
  const execute = vi.fn(async () => [rows, []]);
  const query = vi.fn(async () => [[
    { proposal_version_id: "version-1", evidence_snapshot_id: "evidence-1", evidence_role: "eligibility" },
    { proposal_version_id: "version-1", evidence_snapshot_id: "evidence-1", evidence_role: "reputation" },
    { proposal_version_id: "version-1", evidence_snapshot_id: "evidence-1", evidence_role: "request_fit" },
  ], []]);
  return { store: new VendorProposalReviewStore({ execute, query } as unknown as Pool), execute, query };
}

describe("vendor proposal admin-safe read store", () => {
  it("lists safe proposal previews with bounded pagination and evidence roles", async () => {
    const { store } = storeWith([row()]);
    const result = await store.listVersions({ limit: 20, offset: 0, now: NOW });
    expect(result.items[0]).toMatchObject({ readiness: "ready_for_admin_review",
      candidate: { businessName: "Theo Grooming" }, terms: { quotedAmountCents: 8500 },
      truth: { availability: "available_not_booked", providerAccepted: false, paid: false,
        dispatched: false, completed: false } });
    expect(result.items[0].evidenceReferences.map(item => item.evidenceRole))
      .toEqual(["eligibility", "reputation", "request_fit"]);
    expect(JSON.stringify(result)).not.toContain("must never be returned");
    expect(JSON.stringify(result)).not.toContain("job_card_snapshot_json");
  });

  it("reads one version preview", async () => {
    const { store, execute } = storeWith([row()]);
    const result = await store.getVersion("version-1", NOW);
    expect(result?.versionId).toBe("version-1");
    expect(String(execute.mock.calls[0][0])).toContain("WHERE v.id = ?");
  });

  it("marks expired, superseded, unsafe, and not-ready versions clearly", async () => {
    const expired = storeWith([row({ expires_at: new Date("2026-06-21T00:00:00.000Z") })]);
    expect((await expired.store.getVersion("version-1", NOW))?.readiness).toBe("expired");
    const superseded = storeWith([row({ review_state: "superseded" })]);
    expect((await superseded.store.getVersion("version-1", NOW))?.readiness).toBe("superseded");
    const unsafe = storeWith([row({ truth_flags_json: { booked: true } })]);
    expect((await unsafe.store.getVersion("version-1", NOW))?.readiness).toBe("unsafe");
    expect((await unsafe.store.getVersion("version-1", NOW))?.warnings).toContain("truth_contract_unsafe");
    const draft = storeWith([row({ review_state: "draft" })]);
    expect((await draft.store.getVersion("version-1", NOW))?.readiness).toBe("not_ready");
    const unavailable = storeWith([row({ availability_status: "unavailable" })]);
    const unavailableResult = await unavailable.store.getVersion("version-1", NOW);
    expect(unavailableResult?.readiness).toBe("unsafe");
    expect(unavailableResult?.truth.availability).toBe("availability_not_confirmed");
  });

  it("suppresses unsafe fit sentences", async () => {
    const { store } = storeWith([row({ fit_decision_json: { fit_status: "unsafe_to_display",
      fit_basis: { safe_to_display: false, display_sentence: "Unsupported claim" } } })]);
    const result = await store.getVersion("version-1", NOW);
    expect(result?.fit.displaySentence).toBeNull();
    expect(result?.warnings).toContain("fit_decision_unsafe");
  });

  it("uses SELECT only", async () => {
    const { store, execute, query } = storeWith([row()]);
    await store.listVersions({ limit: 20, offset: 0, now: NOW });
    for (const [sql] of [...execute.mock.calls, ...query.mock.calls]) {
      expect(String(sql)).toMatch(/^\s*SELECT/i);
      expect(String(sql)).not.toMatch(/INSERT|UPDATE|DELETE/i);
    }
  });
});
