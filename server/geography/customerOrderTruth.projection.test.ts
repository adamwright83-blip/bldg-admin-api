import { describe, expect, it } from "vitest";
import {
  CLEANCLOUD_ORDER_TRUTH_COLUMNS,
  NATIVE_ORDER_TRUTH_COLUMNS,
} from "./customerOrderTruth";

describe("customer-order truth projections", () => {
  it("selects only NativeOrderLike columns from orders", () => {
    expect(Object.keys(NATIVE_ORDER_TRUTH_COLUMNS).sort()).toEqual(
      [
        "address",
        "bldgUserId",
        "buildingSlug",
        "createdAt",
        "email",
        "firstName",
        "id",
        "lastName",
        "paid",
        "phone",
        "status",
        "stripePaymentIntentId",
        "total",
        "unit",
      ].sort()
    );
    expect(NATIVE_ORDER_TRUTH_COLUMNS).not.toHaveProperty("heldRawRequestText");
    expect(NATIVE_ORDER_TRUTH_COLUMNS).not.toHaveProperty("heldMetadataJson");
    expect(NATIVE_ORDER_TRUTH_COLUMNS).not.toHaveProperty("paidAt");
    expect(NATIVE_ORDER_TRUTH_COLUMNS).not.toHaveProperty("vendorId");
    expect(NATIVE_ORDER_TRUTH_COLUMNS).toHaveProperty(
      "stripePaymentIntentId"
    );
  });

  it("selects only CleanCloudOrderLike columns from cleancloud_paid_orders", () => {
    expect(Object.keys(CLEANCLOUD_ORDER_TRUTH_COLUMNS).sort()).toEqual(
      [
        "address",
        "buildingResolutionStatus",
        "buildingSlug",
        "cleancloudCustomerId",
        "cleancloudOrderId",
        "createdAt",
        "customerEmail",
        "customerName",
        "customerPhone",
        "paid",
        "paidDateUtc",
        "paymentDateUtc",
        "placedAtUtc",
        "sourceReportType",
        "totalCents",
        "unit",
      ].sort()
    );
    expect(CLEANCLOUD_ORDER_TRUTH_COLUMNS).not.toHaveProperty("rawJson");
    expect(CLEANCLOUD_ORDER_TRUTH_COLUMNS).not.toHaveProperty("summaryText");
    expect(CLEANCLOUD_ORDER_TRUTH_COLUMNS).not.toHaveProperty("paymentType");
  });
});
