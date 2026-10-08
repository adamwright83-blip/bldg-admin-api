import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthorityReceipt } from "./authorityReceipt";
const loader = vi.hoisted(() => vi.fn());
vi.mock("./authorityReceipt", async importOriginal => ({
  ...(await importOriginal<typeof import("./authorityReceipt")>()),
  readPaymentAuthorityReceipts: loader,
}));
import {
  hasNativePaymentAuthority,
  readNativePaymentAuthorityReceipts,
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
  });

  it("propagates unavailable admission instead of silently claiming economic truth", async () => {
    loader.mockRejectedValue(new Error("Authority receipts unavailable"));
    await expect(readNativePaymentAuthorityReceipts([order])).rejects.toThrow(
      "unavailable"
    );
  });
});
