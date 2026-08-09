import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("admin operations to live sync", () => {
  it("keeps pickup/dropoff invalidation in the operational admin surface", () => {
    const adminSource = readFileSync(
      new URL("./Admin.tsx", import.meta.url),
      "utf8"
    );
    const driverSource = readFileSync(
      new URL("./Driver.tsx", import.meta.url),
      "utf8"
    );
    const controllerSource = readFileSync(
      new URL("./driver/GoldlineDriverController.tsx", import.meta.url),
      "utf8"
    );
    const source = `${adminSource}\n${driverSource}\n${controllerSource}`;

    expect(source).toContain("async function invalidateLiveStatuses()");
    expect(source).toContain(
      'utils.admin.listByStatus.invalidate({ status: "new" })'
    );
    expect(source).toContain(
      'utils.admin.listByStatus.invalidate({ status: "collected" })'
    );
    expect(source).toContain(
      'utils.admin.listByStatus.invalidate({ status: "ready" })'
    );
    expect(source).toContain(
      'utils.admin.listByStatus.invalidate({ status: "delivered" })'
    );
    expect(source).toContain(
      "await Promise.all([refetchPickups(), invalidateLiveStatuses()])"
    );
    expect(source).toContain(
      "await Promise.all([refetchDeliveries(), invalidateLiveStatuses()])"
    );
    expect(driverSource).toContain("return <GoldlineDriverController />");
    expect(driverSource).not.toContain("ProductShell");
    expect(controllerSource).toContain("updateStatus.useMutation");
    expect(controllerSource).toContain("await invalidateDriverTruth()");
  });
});
