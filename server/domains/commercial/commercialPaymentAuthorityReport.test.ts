import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AuthorityReceipt } from "../../platform/authority/authorityReceipt";
import { compareCommercialPaymentAuthority } from "./commercialPaymentAuthorityReport";

function receipt(overrides?: Partial<AuthorityReceipt>): AuthorityReceipt {
  return {
    id: "auth-1",
    tenantId: "default",
    claimType: "payment_verified",
    subjectType: "order",
    subjectId: "101",
    sourceType: "stripe_payment_intent",
    sourceRef: "pi_verified",
    actorType: "system",
    actorId: null,
    evidenceClass: "authoritative_external",
    verificationClass: "VERIFIED",
    admissionPolicy: "native_stripe_payment_v1",
    occurredAt: "2026-10-05T00:00:00.000Z",
    admittedAt: "2026-10-05T00:00:00.000Z",
    metadata: { orderId: 101 },
    idempotencyKey: "payment_verified:order:101",
    ...overrides,
  };
}

describe("read-only commercial payment authority report", () => {
  it("matches when the paid order has matching processor evidence and receipt", () => {
    expect(
      compareCommercialPaymentAuthority(
        {
          paid: true,
          total: "42.50",
          stripePaymentIntentId: "pi_verified",
        },
        receipt()
      )
    ).toEqual({
      legacyPaidCents: 4250,
      verifiedPaidCents: 4250,
      matches: true,
      reason: null,
    });
  });

  it("classifies checkbox-only paid state as missing processor evidence", () => {
    expect(
      compareCommercialPaymentAuthority(
        {
          paid: true,
          total: "42.50",
          stripePaymentIntentId: null,
        },
        receipt()
      )
    ).toMatchObject({
      legacyPaidCents: 4250,
      verifiedPaidCents: 0,
      matches: false,
      reason: "missing_processor_evidence",
    });
  });

  it("classifies a missing receipt separately from missing processor evidence", () => {
    expect(
      compareCommercialPaymentAuthority(
        {
          paid: true,
          total: "42.50",
          stripePaymentIntentId: "pi_verified",
        },
        null
      )
    ).toMatchObject({
      legacyPaidCents: 4250,
      verifiedPaidCents: 0,
      matches: false,
      reason: "missing_authority_receipt",
    });
  });

  it("classifies a receipt pointing at a different processor reference", () => {
    expect(
      compareCommercialPaymentAuthority(
        {
          paid: true,
          total: "42.50",
          stripePaymentIntentId: "pi_verified",
        },
        receipt({ sourceRef: "pi_other" })
      )
    ).toMatchObject({
      matches: false,
      reason: "receipt_reference_mismatch",
    });
  });

  it("contains no mutation path or call to the mutating reconciliation function", () => {
    const source = readFileSync(
      new URL("./commercialPaymentAuthorityReport.ts", import.meta.url),
      "utf8"
    );
    for (const forbidden of [
      ".update(",
      ".insert(",
      ".delete(",
      ".transaction(",
      "reconcileCommercialPipelineRevenue(",
    ]) {
      expect(source).not.toContain(forbidden);
    }
    expect(source).toContain("READ-ONLY diagnostic");
    expect(source).toContain(".select(");
  });
});
