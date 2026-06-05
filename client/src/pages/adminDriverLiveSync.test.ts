import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("admin driver to live sync", () => {
  it("driver pickup/dropoff mutations invalidate the Live status lanes", () => {
    const adminSource = readFileSync(new URL("./Admin.tsx", import.meta.url), "utf8");
    const driverSource = readFileSync(new URL("./Driver.tsx", import.meta.url), "utf8");
    const source = `${adminSource}\n${driverSource}`;

    expect(source).toContain("async function invalidateLiveStatuses()");
    expect(source).toContain('utils.admin.listByStatus.invalidate({ status: "new" })');
    expect(source).toContain('utils.admin.listByStatus.invalidate({ status: "collected" })');
    expect(source).toContain('utils.admin.listByStatus.invalidate({ status: "ready" })');
    expect(source).toContain('utils.admin.listByStatus.invalidate({ status: "delivered" })');
    expect(source).toContain("await Promise.all([refetchPickups(), invalidateLiveStatuses()])");
    expect(source).toContain("await Promise.all([refetchDeliveries(), invalidateLiveStatuses()])");
    expect(driverSource).toContain("await Promise.all([pickupQuery.refetch(), deliveryQuery.refetch(), invalidateLiveStatuses()])");
  });
});
