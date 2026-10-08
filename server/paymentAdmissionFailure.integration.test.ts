import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getOrderById: vi.fn(),
  getVendorById: vi.fn(),
  listVendorCoverage: vi.fn(),
  updateVendorConnectStatus: vi.fn(),
  hasCustomerPaidBefore: vi.fn(),
  ensurePickupCompletedOperationsEventForOrder: vi.fn(),
  prepareNativeStripePaymentTenant: vi.fn(),
  admitNativeStripePayment: vi.fn(),
  attributeOrderFromCampaign: vi.fn(),
  notifyOwner: vi.fn(),
  notifyCardCharged: vi.fn(),
  writeOrderToSheet: vi.fn(),
  createOpsTask: vi.fn(),
  completeOpsTask: vi.fn(),
  createPaymentIntent: vi.fn(),
  retrieveAccount: vi.fn(),
  retrieveCustomer: vi.fn(),
}));

vi.mock("stripe", () => ({
  default: class {
    paymentIntents = { create: mocks.createPaymentIntent };
    accounts = { retrieve: mocks.retrieveAccount };
    customers = { retrieve: mocks.retrieveCustomer };
  },
}));

vi.mock("./db", async importOriginal => ({
  ...(await importOriginal<any>()),
  getOrderById: mocks.getOrderById,
  getVendorById: mocks.getVendorById,
  listVendorCoverage: mocks.listVendorCoverage,
  updateVendorConnectStatus: mocks.updateVendorConnectStatus,
  hasCustomerPaidBefore: mocks.hasCustomerPaidBefore,
  ensurePickupCompletedOperationsEventForOrder:
    mocks.ensurePickupCompletedOperationsEventForOrder,
}));

vi.mock("./domains/payment/paymentAdmission", () => ({
  prepareNativeStripePaymentTenant: mocks.prepareNativeStripePaymentTenant,
  admitNativeStripePayment: mocks.admitNativeStripePayment,
}));

vi.mock("./commercialCampaigns/commercialAttributionService", async importOriginal => ({
  ...(await importOriginal<any>()),
  attributeOrderFromCampaign: mocks.attributeOrderFromCampaign,
}));

vi.mock("./_core/notification", async importOriginal => ({
  ...(await importOriginal<any>()),
  notifyOwner: mocks.notifyOwner,
}));

vi.mock("./_core/sms", async importOriginal => ({
  ...(await importOriginal<any>()),
  notifyCardCharged: mocks.notifyCardCharged,
}));

vi.mock("./sheets", async importOriginal => ({
  ...(await importOriginal<any>()),
  writeOrderToSheet: mocks.writeOrderToSheet,
}));

vi.mock("./opsTasks", async importOriginal => ({
  ...(await importOriginal<any>()),
  createOpsTask: mocks.createOpsTask,
  completeOpsTask: mocks.completeOpsTask,
}));

import { appRouter } from "./routers";

function caller() {
  return appRouter.createCaller({
    req: {} as never,
    res: {} as never,
    user: {
      openId: "payment-proof-admin",
      role: "admin",
      tenantId: "tenant-a",
    } as never,
    vendorSession: null,
    tenantId: "tenant-a",
  });
}

describe("native Stripe payment durable-admission failure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY_OVERRIDE = "sk_test_payment_authority_proof_123456789";

    mocks.getOrderById.mockResolvedValue({
      id: 101,
      tenantId: "tenant-a",
      serviceType: "wash_fold",
      buildingSlug: "building-a",
      vendorId: 9,
      stripeCustomerId: "cus_101",
      stripePaymentMethodId: "pm_101",
      firstName: "Payment",
      lastName: "Proof",
      phone: "+13235550101",
      weightLbs: "12",
      bldgUserId: 42,
    });
    mocks.prepareNativeStripePaymentTenant.mockResolvedValue("tenant-a");
    mocks.getVendorById.mockResolvedValue({
      id: 9,
      name: "Vendor A",
      isActive: true,
      stripeConnectAccountId: "acct_vendor_a",
      platformFeePercent: "10.00",
    });
    mocks.listVendorCoverage.mockResolvedValue([
      {
        isActive: true,
        buildingSlug: "building-a",
        serviceType: "wash_fold",
        priority: 1,
      },
    ]);
    mocks.retrieveAccount.mockResolvedValue({
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
      requirements: {
        currently_due: [],
        past_due: [],
        disabled_reason: null,
      },
    });
    mocks.hasCustomerPaidBefore.mockResolvedValue(false);
    mocks.createPaymentIntent.mockResolvedValue({
      id: "pi_provider_succeeded",
      created: 1_799_999_900,
    });
    mocks.admitNativeStripePayment.mockRejectedValue(
      new Error("Authority receipt did not persist")
    );
  });

  it("returns failure and does not run post-payment effects when Stripe succeeds but durable admission fails", async () => {
    const result = await caller().admin.chargeCard({
      orderId: 101,
      amountCents: 4500,
    });

    expect(mocks.createPaymentIntent).toHaveBeenCalledOnce();
    expect(mocks.createPaymentIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 4500,
        currency: "usd",
        confirm: true,
        metadata: expect.objectContaining({
          orderId: "101",
          tenantId: "tenant-a",
        }),
      }),
      {
        idempotencyKey: "authority-payment:tenant-a:order:101",
      }
    );
    expect(mocks.admitNativeStripePayment).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-a",
        orderId: 101,
        paymentIntentId: "pi_provider_succeeded",
      })
    );

    expect(result).toEqual({
      success: false,
      error: "Authority receipt did not persist",
    });

    expect(mocks.attributeOrderFromCampaign).not.toHaveBeenCalled();
    expect(
      mocks.ensurePickupCompletedOperationsEventForOrder
    ).not.toHaveBeenCalled();
    expect(mocks.notifyOwner).not.toHaveBeenCalled();
    expect(mocks.notifyCardCharged).not.toHaveBeenCalled();
    expect(mocks.writeOrderToSheet).not.toHaveBeenCalled();
    expect(mocks.createOpsTask).not.toHaveBeenCalled();
    expect(mocks.completeOpsTask).not.toHaveBeenCalled();
  });
});
