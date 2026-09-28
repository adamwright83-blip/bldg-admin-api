import { describe, expect, it } from "vitest";
import { pendingMapRefreshTargets } from "./mapRefresh";

describe("pending map refresh", () => {
  it("retries only a refreshed customer truth whose map is still pending", () => {
    const targets = pendingMapRefreshTargets([
      { tenantId: "a", requestId: "1", receiptJson: { customerTruth: "refreshed", map: "pending" } },
      { tenantId: "a", requestId: "1", receiptJson: { customerTruth: "refreshed", map: "pending" } },
      { tenantId: "a", requestId: "2", receiptJson: { customerTruth: "refreshed", map: "refreshed" } },
      { tenantId: "a", requestId: "3", receiptJson: { customerTruth: "refreshed", map: "failed" } },
      { tenantId: "a", requestId: "4", receiptJson: { status: "cancelled", customerTruth: "refreshed", map: "pending" } },
      { tenantId: "a", requestId: "5", receiptJson: { customerTruth: "failed", map: "pending" } },
    ]);
    expect(targets.map(row => row.requestId)).toEqual(["1"]);
  });
});
