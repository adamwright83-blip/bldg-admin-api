import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getOrderById: vi.fn(),
  getVendorById: vi.fn(),
  getVendorForOrder: vi.fn(),
  listVendorCoverage: vi.fn(),
  updateVendorConnectStatus: vi.fn(),
  assignNativeOrderVendor: vi.fn(),
  attachNativeOrderPaymentMethod: vi.fn(),
  findStripeCardByPhone: vi.fn(),
  hasCustomerPaidBefore: vi.fn(),
  ensurePickupCompletedOperationsEventForOrder: vi.fn(),
  prepareNativeStripePaymentTenant: vi.fn(),
  admitNativeStripePayment: vi.fn(),
  attributeOrderFromCampaign: vi.fn(),
  reviseNativeOrder: vi.fn(),
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
  getVendorForOrder: mocks.getVendorForOrder,
  listVendorCoverage: mocks.listVendorCoverage,
  updateVendorConnectStatus: mocks.updateVendorConnectStatus,
  assignNativeOrderVendor: mocks.assignNativeOrderVendor,
  attachNativeOrderPaymentMethod: mocks.attachNativeOrderPaymentMethod,
  findStripeCardByPhone: mocks.findStripeCardByPhone,
  hasCustomerPaidBefore: mocks.hasCustomerPaidBefore,
  reviseNativeOrder: mocks.reviseNativeOrder,
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
      openId: "admin-charge-tester",
      role: "admin",
      tenantId: "tenant-charge-test",
    } as never,
    vendorSession: null,
    tenantId: "tenant-charge-test",
  });
}

describe("chargeCard post-admission fault isolation and failure injection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY_OVERRIDE = "sk_test_post_admission_proof_123456789";
    process.env.JWT_SHARED_SECRET = "super-secret-jwt-signing-key-for-test-suite";

    mocks.getOrderById.mockResolvedValue({
      id: 202,
      tenantId: "tenant-charge-test",
      serviceType: "wash_fold",
      buildingSlug: "building-alpha",
      vendorId: 10,
      stripeCustomerId: "cus_test_202",
      stripePaymentMethodId: "pm_test_202",
      firstName: "Grace",
      lastName: "Hopper",
      phone: "+13105550199",
      weightLbs: "18.5",
      bldgUserId: 88,
    });
    mocks.prepareNativeStripePaymentTenant.mockResolvedValue("tenant-charge-test");
    mocks.getVendorById.mockResolvedValue({
      id: 10,
      name: "Alpha Laundry Co",
      isActive: true,
      stripeConnectAccountId: "acct_connect_alpha",
      platformFeePercent: "12.00",
    });
    mocks.listVendorCoverage.mockResolvedValue([
      {
        isActive: true,
        buildingSlug: "building-alpha",
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
    mocks.hasCustomerPaidBefore.mockResolvedValue(true);
    mocks.createPaymentIntent.mockResolvedValue({
      id: "pi_stripe_confirmed_999",
      created: 1_799_999_999,
      status: "succeeded",
      amount_received: 5200,
      currency: "usd",
      metadata: {
        orderId: "202",
        tenantId: "tenant-charge-test",
      },
    });
    mocks.admitNativeStripePayment.mockResolvedValue({
      receiptId: "rcpt_202",
      status: "succeeded",
      statusDisposition: {
        previousStatus: "new",
        resultingStatus: "processing",
        transitioned: true,
        preservedExistingStatus: false,
        cancelled: false,
      },
    });
    mocks.attributeOrderFromCampaign.mockResolvedValue({
      attributed: true,
    });
    mocks.ensurePickupCompletedOperationsEventForOrder.mockResolvedValue({
      id: "evt_pickup_202",
    });
    mocks.reviseNativeOrder.mockResolvedValue({ success: true });
    mocks.notifyOwner.mockResolvedValue({ success: true });
    mocks.notifyCardCharged.mockResolvedValue({ success: true });
    mocks.writeOrderToSheet.mockResolvedValue(true);
    mocks.createOpsTask.mockResolvedValue({ id: 505 });
    mocks.completeOpsTask.mockResolvedValue({ success: true });
  });

  describe("Stripe failure isolation", () => {
    it("returns success: false and writes no payment receipt when Stripe confirmation fails", async () => {
      mocks.createPaymentIntent.mockRejectedValue(
        new Error("Card was declined by issuing bank")
      );

      const result = await caller().admin.chargeCard({
        orderId: 202,
        amountCents: 5200,
      });

      expect(result).toEqual({
        success: false,
        error: "Card was declined by issuing bank",
      });

      expect(mocks.admitNativeStripePayment).not.toHaveBeenCalled();
      expect(mocks.attributeOrderFromCampaign).not.toHaveBeenCalled();
      expect(
        mocks.ensurePickupCompletedOperationsEventForOrder
      ).not.toHaveBeenCalled();
      expect(mocks.notifyOwner).not.toHaveBeenCalled();
      expect(mocks.notifyCardCharged).not.toHaveBeenCalled();
      expect(mocks.writeOrderToSheet).not.toHaveBeenCalled();
      expect(mocks.createOpsTask).not.toHaveBeenCalled();
    });
  });

  describe("Payment admission failure isolation", () => {
    it("preserves PaymentIntent ID and reports reconciliation without claiming card was declined", async () => {
      mocks.admitNativeStripePayment.mockRejectedValue(
        new Error("Deadlock in authority_receipts insertion")
      );

      const result = await caller().admin.chargeCard({
        orderId: 202,
        amountCents: 5200,
      });

      expect(result.success).toBe(false);
      expect(result.paymentIntentId).toBe("pi_stripe_confirmed_999");
      expect(result.reconciliationRequired).toBe(true);
      expect(result.error).toContain("Deadlock in authority_receipts insertion");
      expect(result.error).toMatch(/reconciliation is required/i);
      expect(result.error).not.toMatch(/card may have been declined/i);

      // Post-admission side effects must not execute
      expect(mocks.attributeOrderFromCampaign).not.toHaveBeenCalled();
      expect(
        mocks.ensurePickupCompletedOperationsEventForOrder
      ).not.toHaveBeenCalled();
      expect(mocks.notifyOwner).not.toHaveBeenCalled();
      expect(mocks.notifyCardCharged).not.toHaveBeenCalled();
      expect(mocks.writeOrderToSheet).not.toHaveBeenCalled();
      expect(mocks.createOpsTask).not.toHaveBeenCalled();
    });

    it("reports reconciliationRequired when status helper throws inside admission transaction", async () => {
      mocks.admitNativeStripePayment.mockRejectedValue(
        new Error("Status transition helper failed: foreign key or lock timeout")
      );

      const result = await caller().admin.chargeCard({
        orderId: 202,
        amountCents: 5200,
      });

      expect(result.success).toBe(false);
      expect(result.paymentIntentId).toBe("pi_stripe_confirmed_999");
      expect(result.reconciliationRequired).toBe(true);
      expect(result.error).toMatch(/reconciliation is required/i);
      expect(result.error).not.toMatch(/card may have been declined/i);
    });
  });

  describe("Orders status decoupling and disposition propagation", () => {
    it("passes orderPatch without status to admitNativeStripePayment and caller receives success: true", async () => {
      const result = await caller().admin.chargeCard({
        orderId: 202,
        amountCents: 5200,
      });

      expect(result.success).toBe(true);
      expect(result.paymentIntentId).toBe("pi_stripe_confirmed_999");
      expect(result.statusDisposition).toEqual({
        previousStatus: "new",
        resultingStatus: "processing",
        transitioned: true,
        preservedExistingStatus: false,
        cancelled: false,
      });

      // Verify that admitNativeStripePayment was called with orderPatch containing NO status
      expect(mocks.admitNativeStripePayment).toHaveBeenCalledWith(
        expect.objectContaining({
          orderPatch: expect.not.objectContaining({
            status: expect.anything(),
          }),
        })
      );
    });

    it("preserves cancelled order, returns success: true with reconciliationRequired: true, and skips pickup completed event", async () => {
      mocks.admitNativeStripePayment.mockResolvedValueOnce({
        receiptId: "rcpt_202_cancelled",
        status: "succeeded",
        statusDisposition: {
          previousStatus: "cancelled",
          resultingStatus: "cancelled",
          transitioned: false,
          preservedExistingStatus: true,
          cancelled: true,
        },
      });

      const result = await caller().admin.chargeCard({
        orderId: 202,
        amountCents: 5200,
      });

      expect(result.success).toBe(true);
      expect(result.paymentIntentId).toBe("pi_stripe_confirmed_999");
      expect(result.reconciliationRequired).toBe(true);
      expect(result.statusDisposition?.cancelled).toBe(true);

      // Must NOT create false pickup completed operations event for cancelled order
      expect(
        mocks.ensurePickupCompletedOperationsEventForOrder
      ).not.toHaveBeenCalled();

      // Receipts, notifications, and sheets still execute
      expect(mocks.writeOrderToSheet).toHaveBeenCalledOnce();
      expect(mocks.notifyOwner).toHaveBeenCalledOnce();
    });

    it("preserves delivered order status and returns success: true without reconciliationRequired", async () => {
      mocks.admitNativeStripePayment.mockResolvedValueOnce({
        receiptId: "rcpt_202_delivered",
        status: "succeeded",
        statusDisposition: {
          previousStatus: "delivered",
          resultingStatus: "delivered",
          transitioned: false,
          preservedExistingStatus: true,
          cancelled: false,
        },
      });

      const result = await caller().admin.chargeCard({
        orderId: 202,
        amountCents: 5200,
      });

      expect(result.success).toBe(true);
      expect(result.paymentIntentId).toBe("pi_stripe_confirmed_999");
      expect(result.reconciliationRequired).toBeUndefined();
      expect(result.statusDisposition?.resultingStatus).toBe("delivered");
      expect(
        mocks.ensurePickupCompletedOperationsEventForOrder
      ).toHaveBeenCalledOnce();
    });
  });

  describe("Post-admission failure injection", () => {
    it("returns success: true and preserves receipt when attributeOrderFromCampaign throws", async () => {
      mocks.attributeOrderFromCampaign.mockRejectedValue(
        new Error("Campaign attribution service timed out")
      );

      const result = await caller().admin.chargeCard({
        orderId: 202,
        amountCents: 5200,
      });

      expect(result.success).toBe(true);
      expect(result.paymentIntentId).toBe("pi_stripe_confirmed_999");
      expect(mocks.admitNativeStripePayment).toHaveBeenCalledOnce();
      expect(mocks.admitNativeStripePayment).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: "tenant-charge-test",
          orderId: 202,
          paymentIntentId: "pi_stripe_confirmed_999",
        })
      );
      // Downstream operations still continue
      expect(
        mocks.ensurePickupCompletedOperationsEventForOrder
      ).toHaveBeenCalledOnce();
      expect(mocks.notifyOwner).toHaveBeenCalledOnce();
      expect(mocks.notifyCardCharged).toHaveBeenCalledOnce();
    });

    it("returns success: true and preserves receipt when ensurePickupCompletedOperationsEventForOrder throws", async () => {
      mocks.ensurePickupCompletedOperationsEventForOrder.mockRejectedValue(
        new Error("Operations event store unavailable")
      );

      const result = await caller().admin.chargeCard({
        orderId: 202,
        amountCents: 5200,
      });

      expect(result.success).toBe(true);
      expect(result.paymentIntentId).toBe("pi_stripe_confirmed_999");
      expect(mocks.admitNativeStripePayment).toHaveBeenCalledOnce();
      expect(mocks.attributeOrderFromCampaign).toHaveBeenCalledOnce();
      // Downstream operations still continue
      expect(mocks.notifyOwner).toHaveBeenCalledOnce();
      expect(mocks.notifyCardCharged).toHaveBeenCalledOnce();
    });

    it("returns success: true and preserves receipt when BOTH attribution and pickup event throw", async () => {
      mocks.attributeOrderFromCampaign.mockRejectedValue(
        new Error("Attribution downstream fail")
      );
      mocks.ensurePickupCompletedOperationsEventForOrder.mockRejectedValue(
        new Error("Operations event downstream fail")
      );

      const result = await caller().admin.chargeCard({
        orderId: 202,
        amountCents: 5200,
      });

      expect(result.success).toBe(true);
      expect(result.paymentIntentId).toBe("pi_stripe_confirmed_999");
      expect(mocks.admitNativeStripePayment).toHaveBeenCalledOnce();
      expect(mocks.notifyOwner).toHaveBeenCalledOnce();
      expect(mocks.notifyCardCharged).toHaveBeenCalledOnce();
    });

    it("returns success: true and preserves receipt when notifyOwner throws", async () => {
      mocks.notifyOwner.mockRejectedValue(new Error("Push notification gateway error"));

      const result = await caller().admin.chargeCard({
        orderId: 202,
        amountCents: 5200,
      });

      expect(result.success).toBe(true);
      expect(result.paymentIntentId).toBe("pi_stripe_confirmed_999");
      expect(mocks.admitNativeStripePayment).toHaveBeenCalledOnce();
      expect(mocks.notifyCardCharged).toHaveBeenCalledOnce();
    });

    it("returns success: true and preserves receipt when notifyCardCharged (SMS) throws", async () => {
      mocks.notifyCardCharged.mockRejectedValue(new Error("Twilio SMS provider rate limited"));

      const result = await caller().admin.chargeCard({
        orderId: 202,
        amountCents: 5200,
      });

      expect(result.success).toBe(true);
      expect(result.paymentIntentId).toBe("pi_stripe_confirmed_999");
      expect(mocks.admitNativeStripePayment).toHaveBeenCalledOnce();
      expect(mocks.writeOrderToSheet).toHaveBeenCalledOnce();
    });

    it("returns success: true and preserves receipt when writeOrderToSheet throws", async () => {
      mocks.writeOrderToSheet.mockRejectedValue(new Error("Google Sheets API 500"));

      const result = await caller().admin.chargeCard({
        orderId: 202,
        amountCents: 5200,
      });

      expect(result.success).toBe(true);
      expect(result.paymentIntentId).toBe("pi_stripe_confirmed_999");
      expect(mocks.admitNativeStripePayment).toHaveBeenCalledOnce();
      expect(mocks.createOpsTask).toHaveBeenCalledOnce();
    });

    it("returns success: true and preserves receipt when createOpsTask throws", async () => {
      mocks.createOpsTask.mockRejectedValue(new Error("Ops task persistence failed"));

      const result = await caller().admin.chargeCard({
        orderId: 202,
        amountCents: 5200,
      });

      expect(result.success).toBe(true);
      expect(result.paymentIntentId).toBe("pi_stripe_confirmed_999");
      expect(mocks.admitNativeStripePayment).toHaveBeenCalledOnce();
    });

    it("returns success: true and preserves receipt when JWT signing secret is missing", async () => {
      delete process.env.JWT_SHARED_SECRET;
      delete process.env.JWT_SECRET;
      delete process.env.APP_SHARED_API_SECRET;

      const result = await caller().admin.chargeCard({
        orderId: 202,
        amountCents: 5200,
      });

      expect(result.success).toBe(true);
      expect(result.paymentIntentId).toBe("pi_stripe_confirmed_999");
      expect(mocks.admitNativeStripePayment).toHaveBeenCalledOnce();
    });
  });
});
