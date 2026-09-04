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
    expect(driverSource).toMatch(
      // The law is that Driver's default render IS the Goldline controller, with
      // no admin ProductShell redirect. The literal spelling was incidental: it
      // broke when Vehicle Cargo began riding alongside the controller, which is
      // a source-formatting signal rather than a truth signal.
      /return <>?<GoldlineDriverController \/>/
    );
    expect(driverSource).not.toContain("ProductShell");
    expect(controllerSource).toContain("updateStatus.useMutation");
    expect(controllerSource).toContain("await invalidateDriverTruth()");
  });
});
