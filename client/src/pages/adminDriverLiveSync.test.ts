import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("admin operations to live sync", () => {
  it("keeps pickup/dropoff invalidation in the operational admin surface", () => {
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
    expect(driverSource).toContain('import ProductShell from "@/product/ProductShell"');
    expect(driverSource).toContain("return <ProductShell />");
    expect(driverSource).not.toContain("updateStatus.useMutation");
  });
});
