import { describe, expect, it, vi } from "vitest";
import { verifyStripePaymentMethodOwnership } from "./residentPaymentMethods";

function stripeStub(paymentMethodCustomer: unknown = "cus_123") {
  return {
    customers: {
      retrieve: vi.fn().mockResolvedValue({ id: "cus_123" }),
    },
    paymentMethods: {
      retrieve: vi.fn().mockResolvedValue({
        id: "pm_123",
        type: "card",
        customer: paymentMethodCustomer,
        card: {
          last4: "4242",
          brand: "visa",
          exp_month: 12,
          exp_year: 2028,
        },
      }),
    },
  } as any;
}

describe("verifyStripePaymentMethodOwnership", () => {
  it("returns safe card metadata when the payment method belongs to the customer", async () => {
    const card = await verifyStripePaymentMethodOwnership(stripeStub(), "cus_123", "pm_123");

    expect(card).toEqual({
      stripeCustomerId: "cus_123",
      stripePaymentMethodId: "pm_123",
      cardLast4: "4242",
      brand: "visa",
      expMonth: 12,
      expYear: 2028,
    });
  });

  it("does not return a card when the payment method belongs to another customer", async () => {
    const card = await verifyStripePaymentMethodOwnership(stripeStub("cus_other"), "cus_123", "pm_123");

    expect(card).toBeNull();
  });
});
