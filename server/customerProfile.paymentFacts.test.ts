import { describe, expect, it } from "vitest";
import type { Order } from "../drizzle/schema";
import type { AuthorityReceipt } from "./platform/authority/authorityReceipt";
import { buildCustomerProfile } from "./customerProfile";

function order(total: string | null): Order {
  return {
    id: 7,
    tenantId: "default",
    phone: "3105550100",
    firstName: "Ada",
    lastName: "Lane",
    email: null,
    unit: null,
    address: "1 Main St",
    buildingSlug: null,
    total,
    paid: true,
    stripePaymentIntentId: "pi_test",
    createdAt: new Date("2026-05-12T12:00:00Z"),
    status: "delivered",
    serviceType: "wash_fold",
    portalJwt: null,
    bldgUserId: null,
  } as Order;
}

function receipt(cents: number | null): AuthorityReceipt {
  return {
    id: "ar_7",
    tenantId: "default",
    claimType: "payment_verified",
    subjectType: "order",
    subjectId: "7",
    sourceType: "stripe_payment_intent",
    sourceRef: "pi_test",
    actorType: "system",
    actorId: null,
    evidenceClass: "authoritative_external",
    verificationClass: "VERIFIED",
    admissionPolicy: "stripe_amount_received_v1",
    occurredAt: "2026-05-12T12:00:00.000Z",
    admittedAt: "2026-05-12T12:01:00.000Z",
    metadata:
      cents == null
        ? null
        : {
            captureEvidence: "stripe_amount_received_v1",
            capturedCurrency: "usd",
            capturedAmountCents: cents,
          },
    idempotencyKey: "k",
  };
}

describe("customer profile payment facts", () => {
  it("keeps the order total, captured cents, and unpaid amount distinct", () => {
    const profile = buildCustomerProfile("3105550100", [order("90.00")], new Map([[7, receipt(4200)]]));
    expect(profile?.orders[0]).toMatchObject({
      orderTotalCents: 9000,
      capturedCents: 4200,
      unpaidCents: 4800,
      paymentAdmission: "admitted",
      paymentEvidence: { authorityReceiptId: "ar_7", sourceRef: "pi_test" },
    });
  });

  it("does not invent captured cents when the receipt has no capture evidence", () => {
    const admitted = buildCustomerProfile("3105550100", [order("90.00")], new Map([[7, receipt(null)]]));
    expect(admitted?.orders[0]).toMatchObject({
      orderTotalCents: 9000,
      capturedCents: null,
      unpaidCents: null,
      paymentAdmission: "admitted",
    });
    const missing = buildCustomerProfile("3105550100", [order("90.00")]);
    expect(missing?.orders[0]).toMatchObject({
      capturedCents: null,
      unpaidCents: null,
      paymentAdmission: "not_admitted",
      paymentEvidence: null,
    });
  });
});
