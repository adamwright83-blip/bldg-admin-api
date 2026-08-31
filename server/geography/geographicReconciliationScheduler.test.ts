import { describe, expect, it, vi } from "vitest";
import { triggerAutomaticGeographicReconciliation } from "./geographicReconciliationScheduler";

describe("automatic geographic reconciliation", () => {
  it("uses a bounded batch and coalesces overlapping runs", async () => {
    let release!: () => void;
    const reconcile = vi.fn(
      () => new Promise<void>(resolve => {
        release = resolve;
      })
    );

    const first = triggerAutomaticGeographicReconciliation(reconcile);
    const second = triggerAutomaticGeographicReconciliation(reconcile);
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(reconcile).toHaveBeenCalledWith({ tenantId: "default", batchSize: 10 });
    expect(second).toBe(first);

    release();
    await first;
  });

  it("contains provider failures so geography never blocks business writes", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(
      triggerAutomaticGeographicReconciliation(async () => {
        throw new Error("provider unavailable");
      })
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("customer/order writes remain available"),
      "provider unavailable"
    );
    warn.mockRestore();
  });
});

