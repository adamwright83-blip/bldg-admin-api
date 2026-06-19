import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { AuthorityGrantPolicyView } from "./authorityPolicy";
import type { LegalDocumentPolicyView } from "./legalTemplatePolicy";
import type { ProviderAcceptancePolicyView } from "./providerAcceptancePolicy";
import type { VendorAgreementPolicyView } from "./vendorAgreementPolicy";
import { evaluateErrandPurchasePath, type ErrandPurchasePathInput } from "./errandPurchasePathPolicy";

const now = new Date("2026-06-19T12:00:00Z");
const hash = "a".repeat(64);
const bodyHash = "b".repeat(64);
const authority: AuthorityGrantPolicyView = {
  authorityType: "guest_readiness", status: "active", budgetCapCents: 50_000,
  deadlineAt: new Date("2026-06-22T00:00:00Z"), expiresAt: new Date("2026-06-23T00:00:00Z"),
  revokedAt: null, allowedRiskCategories: ["low", "medium"], disallowedCategories: [],
  accessConstraints: { allowedPatterns: ["no_entry", "resident_present"] },
};
const legalDocument: LegalDocumentPolicyView = {
  documentKey: "vendor_agreement", version: "v1", status: "approved", bodyHash, termsHash: hash,
  approvedAt: new Date("2026-06-01T00:00:00Z"), effectiveAt: new Date("2026-06-02T00:00:00Z"), retiredAt: null,
};
const vendorAgreement = (overrides: Partial<VendorAgreementPolicyView> = {}): VendorAgreementPolicyView => ({
  status: "signed", legalDocumentKey: "vendor_agreement", legalDocumentVersion: "v1", termsVersion: "terms-v1",
  termsHash: hash, bodyHash, renderedAgreementHash: "c".repeat(64), signedAt: new Date("2026-06-18T00:00:00Z"),
  revokedAt: null, expiresAt: new Date("2026-07-01T00:00:00Z"), ...overrides,
});
const acceptance = (overrides: Partial<ProviderAcceptancePolicyView> = {}): ProviderAcceptancePolicyView => ({
  acceptanceType: "provider_accepted", acceptanceStatus: "accepted", expiresAt: new Date("2026-06-21T00:00:00Z"),
  serviceWindowStart: new Date("2026-06-20T12:00:00Z"), serviceWindowEnd: new Date("2026-06-20T14:00:00Z"),
  acceptedPriceCents: 10_000, ...overrides,
});
const base = (overrides: Partial<ErrandPurchasePathInput> = {}): ErrandPurchasePathInput => ({
  pathType: "service", authority,
  action: { authorityType: "guest_readiness", category: "laundry", spendCents: 10_000,
    scheduledAt: new Date("2026-06-20T12:00:00Z"), accessPattern: "no_entry" },
  planItem: { feasibilityClassification: "feasible", itemState: "sourcing_required", riskCategory: "low",
    operatorReviewRequired: false, residentApprovalRequired: false },
  residentApprovalGranted: false, providerAcceptanceRequired: true, providerAcceptance: acceptance(),
  vendorInvolved: true, vendorAgreement: vendorAgreement(), legalDocument,
  paymentRequired: true, authorizationState: "authorized", operatorConfirmationGranted: false, now,
  ...overrides,
});

describe("errand purchase path policy", () => {
  it("is review-ready only when every required precondition is satisfied", () => {
    expect(evaluateErrandPurchasePath(base())).toEqual({
      status: "ready_for_operator_execution_review", reviewReady: true, executionReady: false,
      dispatchReady: false, paymentReady: false, reasons: ["all_review_preconditions_satisfied"],
    });
  });

  it("blocks missing, revoked, over-budget, or late authority", () => {
    expect(evaluateErrandPurchasePath(base({ authority: null })).status).toBe("blocked_missing_authority");
    expect(evaluateErrandPurchasePath(base({ authority: { ...authority, status: "revoked" } })).status).toBe("blocked_missing_authority");
    expect(evaluateErrandPurchasePath(base({ action: { ...base().action, spendCents: 60_000 } })).status).toBe("blocked_missing_authority");
    expect(evaluateErrandPurchasePath(base({ action: { ...base().action,
      scheduledAt: new Date("2026-06-24T00:00:00Z") } })).status).toBe("blocked_missing_authority");
  });

  it.each([
    null,
    vendorAgreement({ status: "expired", signedAt: null }),
    vendorAgreement({ status: "revoked", revokedAt: now, signedAt: null }),
  ])("fails closed when vendor agreement is missing or unusable", agreement => {
    expect(evaluateErrandPurchasePath(base({ vendorAgreement: agreement })).status)
      .toBe("blocked_missing_vendor_agreement");
  });

  it("blocks when required provider acceptance or verified booking is missing", () => {
    expect(evaluateErrandPurchasePath(base({ providerAcceptance: null })).status)
      .toBe("blocked_missing_provider_acceptance");
    expect(evaluateErrandPurchasePath(base({ providerAcceptance: acceptance({ acceptedPriceCents: 60_000 }) })).status)
      .toBe("blocked_missing_provider_acceptance");
    expect(evaluateErrandPurchasePath(base({ providerAcceptance: acceptance({ acceptanceStatus: "offered" }) })).status)
      .toBe("blocked_missing_provider_acceptance");
  });

  it("treats payment authorization only as an observed blocking condition", () => {
    const result = evaluateErrandPurchasePath(base({ authorizationState: "authorization_pending" }));
    expect(result.status).toBe("blocked_payment_not_authorized");
    expect(result.paymentReady).toBe(false);
  });

  it("requires operator confirmation for high-risk or review-gated paths", () => {
    expect(evaluateErrandPurchasePath(base({ planItem: { ...base().planItem, riskCategory: "high",
      feasibilityClassification: "feasible_with_risk" } })).status).toBe("requires_operator_confirmation");
    expect(evaluateErrandPurchasePath(base({ planItem: { ...base().planItem,
      itemState: "needs_operator_review", operatorReviewRequired: true } })).status)
      .toBe("requires_operator_confirmation");
    expect(evaluateErrandPurchasePath(base({ planItem: { ...base().planItem,
      itemState: "needs_resident_approval", residentApprovalRequired: true },
      operatorConfirmationGranted: true })).status).toBe("requires_operator_confirmation");
  });

  it("returns unsupported and infeasible for paths with those classifications", () => {
    expect(evaluateErrandPurchasePath(base({ pathType: "unsupported" })).status).toBe("unsupported");
    expect(evaluateErrandPurchasePath(base({ planItem: { ...base().planItem,
      feasibilityClassification: "infeasible", itemState: "unavailable" } })).status).toBe("infeasible");
  });

  it("has no I/O, contact, send, dispatch, or payment side effects", async () => {
    const source = await readFile(new URL("./errandPurchasePathPolicy.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/\b(fetch|axios|execute|query|insert|update|delete)\s*\(/i);
    expect(source).not.toMatch(/twilio|sendgrid|stripe|nodemailer|vendorAgreementStore|marketplacePaymentStore/i);
    expect(source).not.toMatch(/dispatchReady:\s*true|paymentReady:\s*true|executionReady:\s*true/i);
  });
});
