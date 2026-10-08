import { describe, expect, it } from "vitest";
import type { AuthorityReceipt } from "../platform/authority/authorityReceipt";
import {
  legacyCommercialPaidCents,
  verifiedCommercialPaidCents,
} from "./commercialPipelineService";

function receipt(sourceRef = "pi_verified"): AuthorityReceipt {
  return {
    id: "auth-1",
    tenantId: "default",
    claimType: "payment_verified",
    subjectType: "order",
    subjectId: "101",
    sourceType: "stripe_payment_intent",
    sourceRef,
    actorType: "system",
    actorId: null,
    evidenceClass: "authoritative_external",
    verificationClass: "VERIFIED",
    admissionPolicy: "native_stripe_payment_v1",
    occurredAt: "2026-10-05T00:00:00.000Z",
    admittedAt: "2026-10-05T00:00:00.000Z",
    metadata: { orderId: 101 },
    idempotencyKey: "payment_verified:order:101",
  };
}

describe("commercial paid-revenue authority shadow", () => {
  const order = {
    paid: true,
    total: "42.50",
    stripePaymentIntentId: "pi_verified",
  };

  it("shows the legacy paid flag calculation without declaring it authoritative", () => {
    expect(legacyCommercialPaidCents(order)).toBe(4250);
  });

  it("accepts cents only when the admitted receipt matches the Stripe evidence", () => {
    expect(verifiedCommercialPaidCents(order, receipt())).toBe(4250);
    expect(verifiedCommercialPaidCents(order, null)).toBe(0);
    expect(verifiedCommercialPaidCents(order, receipt("pi_other"))).toBe(0);
  });

  it("refuses a paid checkbox that has no processor evidence", () => {
    expect(
      verifiedCommercialPaidCents(
        { paid: true, total: "42.50", stripePaymentIntentId: null },
        receipt()
      )
    ).toBe(0);
  });

  it("does not turn an unpaid order into revenue even with a stale receipt", () => {
    expect(
      verifiedCommercialPaidCents(
        { paid: false, total: "42.50", stripePaymentIntentId: "pi_verified" },
        receipt()
      )
    ).toBe(0);
  });
});
