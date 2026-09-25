import { describe, expect, it } from "vitest";
import { nativeOrderToTruth } from "./customerOrderTruth";
import { deriveProgressFromOrderTruth } from "../claire/progression/paidOrderProgress";

function native(overrides: Partial<Parameters<typeof nativeOrderToTruth>[0]> = {}) {
  return {
    id: 101,
    status: "ready",
    createdAt: new Date("2026-09-24T17:00:00.000Z"),
    firstName: "Test",
    lastName: "Customer",
    phone: "3235550101",
    email: "test@example.com",
    address: "100 Test St",
    unit: null,
    buildingSlug: null,
    bldgUserId: null,
    paid: true,
    stripePaymentIntentId: null,
    total: "42.00",
    ...overrides,
  };
}

describe("customer order economic truth", () => {
  it("does not treat a native paid flag without Stripe evidence as a paid order", () => {
    const record = nativeOrderToTruth(native());
    expect(record).not.toBeNull();
    expect(record?.paid).toBe(false);
  });

  it("treats a native order as paid when the paid flag and Stripe evidence agree", () => {
    const record = nativeOrderToTruth(
      native({ stripePaymentIntentId: "pi_verified_123" })
    );
    expect(record).not.toBeNull();
    expect(record?.paid).toBe(true);
  });

  it("does not mint paying-customer progression from an unverified native paid flag", () => {
    const unverified = nativeOrderToTruth(native())!;
    const verified = nativeOrderToTruth(
      native({
        id: 102,
        createdAt: new Date("2026-09-24T18:00:00.000Z"),
        stripePaymentIntentId: "pi_verified_456",
      })
    )!;

    const before = deriveProgressFromOrderTruth(
      new Map([["phone:3235550101", [unverified]]]),
      { emitFrom: new Date("2026-09-01T00:00:00.000Z") }
    );
    expect(before).toEqual([]);

    const after = deriveProgressFromOrderTruth(
      new Map([["phone:3235550101", [unverified, verified]]]),
      { emitFrom: new Date("2026-09-01T00:00:00.000Z") }
    );
    expect(after).toHaveLength(1);
    expect(after[0]?.kind).toBe("new_paying_customer");
    expect(after[0]?.sourceId).toBe("laundry_butler:102");
  });
});
