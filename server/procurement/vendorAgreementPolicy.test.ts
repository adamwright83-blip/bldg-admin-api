import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { LegalDocumentPolicyView } from "./legalTemplatePolicy";
import { canSignVendorAgreement, canUseSignedVendorAgreement, type VendorAgreementPolicyView } from "./vendorAgreementPolicy";

const now = new Date("2026-06-19T12:00:00Z");
const hash = "a".repeat(64);
const bodyHash = "b".repeat(64);
const legal: LegalDocumentPolicyView = {
  documentKey: "vendor_agreement", version: "v1", status: "approved", bodyHash, termsHash: hash,
  approvedAt: new Date("2026-06-01T00:00:00Z"), effectiveAt: new Date("2026-06-02T00:00:00Z"), retiredAt: null,
};
const agreement = (status: VendorAgreementPolicyView["status"] = "signed"): VendorAgreementPolicyView => ({
  status, legalDocumentKey: "vendor_agreement", legalDocumentVersion: "v1", termsVersion: "terms-v1",
  termsHash: hash, bodyHash, renderedAgreementHash: "c".repeat(64),
  signedAt: status === "signed" ? new Date("2026-06-18T00:00:00Z") : null,
  revokedAt: status === "revoked" ? new Date("2026-06-18T01:00:00Z") : null,
  expiresAt: new Date("2026-07-01T00:00:00Z"),
});

describe("vendor agreement policy", () => {
  it("allows exact usable legal documents to be signed from draft or pending review", () => {
    expect(canSignVendorAgreement({ agreement: agreement("draft"), legalDocument: legal, now }).allowed).toBe(true);
    expect(canSignVendorAgreement({ agreement: agreement("pending_vendor_review"), legalDocument: legal, now }).allowed).toBe(true);
  });

  it.each(["draft", "pending_vendor_review", "revoked", "expired", "rejected"] as const)(
    "fails closed for %s agreements", status => {
      expect(canUseSignedVendorAgreement({ agreement: agreement(status), legalDocument: legal, now }).usable).toBe(false);
    });

  it("requires signed_at and exact terms/body hashes", () => {
    expect(canUseSignedVendorAgreement({ agreement: { ...agreement(), signedAt: null }, legalDocument: legal, now }).usable).toBe(false);
    expect(canUseSignedVendorAgreement({ agreement: { ...agreement(), termsHash: "d".repeat(64) }, legalDocument: legal, now }).usable).toBe(false);
    expect(canUseSignedVendorAgreement({ agreement: { ...agreement(), bodyHash: "e".repeat(64) }, legalDocument: legal, now }).usable).toBe(false);
  });

  it("rejects retired legal documents and expired agreements", () => {
    expect(canUseSignedVendorAgreement({ agreement: agreement(), legalDocument: { ...legal, status: "retired",
      retiredAt: new Date("2026-06-18T00:00:00Z") }, now }).usable).toBe(false);
    expect(canUseSignedVendorAgreement({ agreement: { ...agreement(), expiresAt: now }, legalDocument: legal, now }).usable).toBe(false);
  });

  it("accepts a signed, current, unrevoked exact agreement without activating execution", () => {
    expect(canUseSignedVendorAgreement({ agreement: agreement(), legalDocument: legal, now })).toEqual({
      usable: true, reasons: [], dispatchReady: false, paymentReady: false,
    });
  });

  it("keeps the schema agreement-specific and free of legacy/payment/execution fields", async () => {
    const sql = await readFile(new URL("../../procurement/migrations/0010_vendor_agreement_onboarding.sql", import.meta.url), "utf8");
    expect(sql).toContain("`vendor_agreement_status` enum('draft','pending_vendor_review','signed','revoked','expired','rejected')");
    expect(sql).toContain("`terms_version`");
    expect(sql).toContain("`terms_hash`");
    expect(sql).toContain("`signature_evidence_json`");
    expect(sql).toContain("`signed_at`");
    expect(sql).not.toMatch(/`vendor_id`|`acceptance_status`|stripe_connect|`dispatch_id`|`payment_method_id`/i);
    expect(sql).not.toMatch(/INSERT\s+INTO/i);
  });

  it("store writes only vendor agreement tables", async () => {
    const store = await readFile(new URL("./vendorAgreementStore.ts", import.meta.url), "utf8");
    const writes = [...store.matchAll(/(?:INSERT\s+INTO|UPDATE)\s+([a-z_]+)/gi)].map(match => match[1]);
    expect(new Set(writes)).toEqual(new Set(["vendor_agreements", "vendor_agreement_events"]));
    expect(store).not.toMatch(/vendorProfiles|vendorServices|stripe|fetch\(|axios|twilio|sendgrid/i);
  });
});
