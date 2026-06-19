import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captureAuthorizedPaymentIntent,
  createAuthorizationPaymentIntent,
  createVendorTransfer,
  marketplacePaymentsEnabled,
  marketplacePaymentsWorkerEnabled,
} from "./marketplaceStripeAdapter";

const ORIGINAL_ENABLED = process.env.MARKETPLACE_PAYMENTS_ENABLED;
const ORIGINAL_WORKER_ENABLED = process.env.MARKETPLACE_PAYMENTS_WORKER_ENABLED;

afterEach(() => {
  if (ORIGINAL_ENABLED === undefined) delete process.env.MARKETPLACE_PAYMENTS_ENABLED;
  else process.env.MARKETPLACE_PAYMENTS_ENABLED = ORIGINAL_ENABLED;
  if (ORIGINAL_WORKER_ENABLED === undefined) delete process.env.MARKETPLACE_PAYMENTS_WORKER_ENABLED;
  else process.env.MARKETPLACE_PAYMENTS_WORKER_ENABLED = ORIGINAL_WORKER_ENABLED;
});

describe("Marketplace Stripe adapter feature flags", () => {
  it("defaults both flags to disabled", () => {
    delete process.env.MARKETPLACE_PAYMENTS_ENABLED;
    delete process.env.MARKETPLACE_PAYMENTS_WORKER_ENABLED;
    expect(marketplacePaymentsEnabled()).toBe(false);
    expect(marketplacePaymentsWorkerEnabled()).toBe(false);
  });

  it("refuses to create a live authorization PaymentIntent when disabled, without ever resolving a Stripe client", async () => {
    delete process.env.MARKETPLACE_PAYMENTS_ENABLED;
    const getStripe = vi.fn();
    await expect(
      createAuthorizationPaymentIntent(
        { idempotencyKey: "key-1", customerId: "cus_1", paymentMethodId: "pm_1", amountCents: 1_000, currency: "usd", metadata: {} },
        { getStripe },
      ),
    ).rejects.toThrow(/MARKETPLACE_PAYMENTS_ENABLED is not set/);
    expect(getStripe).not.toHaveBeenCalled();
  });

  it("refuses to capture when disabled, without resolving a Stripe client", async () => {
    delete process.env.MARKETPLACE_PAYMENTS_ENABLED;
    const getStripe = vi.fn();
    await expect(
      captureAuthorizedPaymentIntent({ idempotencyKey: "key-2", paymentIntentId: "pi_1" }, { getStripe }),
    ).rejects.toThrow(/MARKETPLACE_PAYMENTS_ENABLED is not set/);
    expect(getStripe).not.toHaveBeenCalled();
  });

  it("refuses to create a vendor transfer when disabled, without resolving a Stripe client", async () => {
    delete process.env.MARKETPLACE_PAYMENTS_ENABLED;
    const getStripe = vi.fn();
    await expect(
      createVendorTransfer(
        { idempotencyKey: "key-3", destinationAccountId: "acct_1", amountCents: 1_000, currency: "usd", metadata: {} },
        { getStripe },
      ),
    ).rejects.toThrow(/MARKETPLACE_PAYMENTS_ENABLED is not set/);
    expect(getStripe).not.toHaveBeenCalled();
  });

  it("requires an explicit idempotency key even when enabled", async () => {
    process.env.MARKETPLACE_PAYMENTS_ENABLED = "true";
    const getStripe = vi.fn();
    await expect(
      createAuthorizationPaymentIntent(
        { idempotencyKey: "", customerId: "cus_1", paymentMethodId: "pm_1", amountCents: 1_000, currency: "usd", metadata: {} },
        { getStripe },
      ),
    ).rejects.toThrow(/requires an explicit idempotencyKey/);
    expect(getStripe).not.toHaveBeenCalled();
  });

  it("uses an injected mocked Stripe client only, never a live network call, when enabled", async () => {
    process.env.MARKETPLACE_PAYMENTS_ENABLED = "true";
    const create = vi.fn().mockResolvedValue({ id: "pi_mock", status: "requires_capture" });
    const getStripe = vi.fn().mockReturnValue({ paymentIntents: { create } });
    const result = await createAuthorizationPaymentIntent(
      { idempotencyKey: "key-4", customerId: "cus_1", paymentMethodId: "pm_1", amountCents: 1_000, currency: "usd", metadata: {} },
      { getStripe },
    );
    expect(result).toEqual({ id: "pi_mock", status: "requires_capture" });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ capture_method: "manual", confirm: true, off_session: true }),
      { idempotencyKey: "key-4" },
    );
  });
});
