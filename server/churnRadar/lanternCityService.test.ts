import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  preferCleanCloudBindingEvidence,
  resolveLanternCustomerBinding,
} from "./lanternCityService";

const OPUS_ADDRESS = "3545 Wilshire Blvd, Los Angeles, CA 90010";

describe("Lantern City CleanCloud placement", () => {
  it("places a CleanCloud customer from the order address without a numeric id", () => {
    const binding = resolveLanternCustomerBinding({
      lastOrderId: null,
      orderSource: "cleancloud",
      externalOrderRef: "cc-44",
      nativeOrder: null,
      cleanCloudOrder: { address: OPUS_ADDRESS, buildingSlug: null },
    });
    expect(binding).toMatchObject({
      resolved: true,
      buildingId: "opus_la",
      basis: "address",
    });
  });

  it("reports order_not_found when the CleanCloud order row is missing", () => {
    expect(
      resolveLanternCustomerBinding({
        lastOrderId: null,
        orderSource: "cleancloud",
        externalOrderRef: "cc-missing",
        nativeOrder: null,
        cleanCloudOrder: null,
      })
    ).toEqual({
      resolved: false,
      buildingId: null,
      reason: "order_not_found",
    });
  });

  it("still returns no_last_order when there is neither a native id nor a CleanCloud ref", () => {
    expect(
      resolveLanternCustomerBinding({
        lastOrderId: null,
        orderSource: "native",
        externalOrderRef: null,
        nativeOrder: null,
        cleanCloudOrder: null,
      })
    ).toEqual({
      resolved: false,
      buildingId: null,
      reason: "no_last_order",
    });
  });

  it("does not invent a building when the found row has no address or slug", () => {
    expect(
      resolveLanternCustomerBinding({
        lastOrderId: null,
        orderSource: "cleancloud",
        externalOrderRef: "cc-44",
        nativeOrder: null,
        cleanCloudOrder: { address: null, buildingSlug: null },
      })
    ).toEqual({
      resolved: false,
      buildingId: null,
      reason: "no_building_evidence",
    });
  });

  it("prefers the revenue row's address and does not mix in a conflicting sales slug", () => {
    const chosen = preferCleanCloudBindingEvidence([
      {
        cleancloudOrderId: "cc-44",
        sourceReportType: "orders_sales",
        address: "somewhere else",
        buildingSlug: "centuryparkeast",
      },
      {
        cleancloudOrderId: "cc-44",
        sourceReportType: "orders_revenue",
        address: OPUS_ADDRESS,
        buildingSlug: null,
      },
    ]);
    expect(chosen.get("cc-44")).toEqual({
      address: OPUS_ADDRESS,
      buildingSlug: null,
    });
  });

  it("loads CleanCloud placement evidence for this tenant only", () => {
    const source = readFileSync(new URL("./lanternCityService.ts", import.meta.url), "utf8");
    expect(source).toContain("eq(cleancloudPaidOrders.tenantId, tenantId)");
    expect(source).toContain("cleancloudPaidOrders.cleancloudOrderId");
    expect(source).toContain("COALESCE(${orders.tenantId}, 'default') = ${tenantId}");
    expect(source).not.toContain("customer_reactivated");
  });
});
