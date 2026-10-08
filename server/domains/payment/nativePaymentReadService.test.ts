import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthorityReceipt } from "../../authority/authorityReceipt";
const loader = vi.hoisted(() => vi.fn());
vi.mock("../../authority/authorityReceipt", async importOriginal => ({
  ...(await importOriginal<typeof import("../../authority/authorityReceipt")>()),
  readPaymentAuthorityReceipts: loader,
}));
import {
  hasNativePaymentAuthority,
  readNativePaymentAuthorityReceipts,
  readNativePaymentFacts,
} from "./nativePaymentReadService";

function receipt(overrides: Partial<AuthorityReceipt> = {}): AuthorityReceipt {
  return {
    id: "auth-1",
    tenantId: "tenant-a",
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
    occurredAt: "2026-10-07T00:00:00Z",
    admittedAt: "2026-10-07T00:00:00Z",
    metadata: {},
    idempotencyKey: "payment:101",
    ...overrides,
  };
}
const order = {
  id: 101,
  tenantId: "tenant-a",
  paid: true,
  stripePaymentIntentId: "pi_verified",
};
describe("Payment-owned native paid reader", () => {
  beforeEach(() => {
    loader.mockReset();
    loader.mockResolvedValue([receipt()]);
  });
  it("requires exact admitted evidence, refusing weak flags and mismatched receipts", () => {
    expect(hasNativePaymentAuthority(order)).toBe(false);
    expect(hasNativePaymentAuthority(order, receipt())).toBe(true);
    for (const mismatch of [
      { tenantId: "tenant-b" },
      { subjectId: "102" },
      { sourceRef: "pi_other" },
      { verificationClass: "CLAIMED" as const },
    ]) {
      expect(hasNativePaymentAuthority(order, receipt(mismatch))).toBe(false);
    }
    expect(
      hasNativePaymentAuthority({ ...order, paid: false }, receipt())
    ).toBe(false);
    expect(
      hasNativePaymentAuthority({ ...order, tenantId: null }, receipt())
    ).toBe(false);
  });
  it("groups only explicitly established tenants and never invents default history", async () => {
    const result = await readNativePaymentAuthorityReceipts([
      order,
      { ...order, id: 102, tenantId: "tenant-b" },
      { ...order, id: 103, tenantId: null },
    ]);
    expect([...result.keys()]).toEqual([101]);
    expect(loader.mock.calls.map(([input]) => input.tenantId)).toEqual([
      "tenant-a",
      "tenant-b",
    ]);
  });
  it("retains admitted payment occurrence after the current paid flag changes", async () => {
    const refunded = { ...order, paid: false };
    const receipts = await readNativePaymentAuthorityReceipts([refunded]);
    expect(receipts.has(order.id)).toBe(true);
    expect(hasNativePaymentAuthority(refunded, receipts.get(order.id))).toBe(
      false
    );
    expect((await readNativePaymentFacts([refunded])).has(order.id)).toBe(true);
  });

  it("propagates unavailable admission instead of silently claiming economic truth", async () => {
    loader.mockRejectedValue(new Error("Authority receipts unavailable"));
    await expect(readNativePaymentAuthorityReceipts([order])).rejects.toThrow(
      "unavailable"
    );
  });

  it("projects only admitted occurrence and immutable captured dollars", async () => {
    loader.mockResolvedValue([
      receipt({
        metadata: {
          capturedAmountCents: 4200,
          capturedCurrency: "usd",
          captureEvidence: "stripe_amount_received_v1",
        },
      }),
    ]);
    const facts = await readNativePaymentFacts([order]);
    expect(facts.get(order.id)).toEqual({
      orderId: 101,
      tenantId: "tenant-a",
      paymentIntentId: "pi_verified",
      authorityReceiptId: "auth-1",
      occurredAt: "2026-10-07T00:00:00Z",
      capturedAmountCents: 4200,
    });

    loader.mockResolvedValue([receipt({ metadata: {} })]);
    expect((await readNativePaymentFacts([order])).get(order.id)).toMatchObject({
      capturedAmountCents: null,
    });

    loader.mockResolvedValue([receipt({ sourceRef: "pi_other" })]);
    expect((await readNativePaymentFacts([order])).has(order.id)).toBe(false);
  });
});

describe("captured native amount", () => {
  it("does not infer cents from a receipt without immutable provider capture evidence", async () => {
    const { nativeCapturedAmountCents } = await import(
      "./nativePaymentReadService"
    );
    expect(nativeCapturedAmountCents(undefined)).toBeNull();
    const proof = {
      metadata: {
        capturedAmountCents: 4200,
        capturedCurrency: "usd",
        captureEvidence: "stripe_amount_received_v1",
      },
    } as AuthorityReceipt;
    expect(nativeCapturedAmountCents(proof)).toBe(4200);
    expect(nativeCapturedAmountCents({ ...proof, metadata: {} })).toBeNull();
    expect(
      nativeCapturedAmountCents({
        ...proof,
        metadata: { ...proof.metadata, capturedCurrency: "eur" },
      })
    ).toBeNull();
    expect(
      nativeCapturedAmountCents({
        ...proof,
        metadata: { ...proof.metadata, capturedAmountCents: -1 },
      })
    ).toBeNull();
  });
});
