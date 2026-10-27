import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  authorizedGeographyTenants,
  lastGeographicReconciliationOutcomes,
  reconcileAuthorizedGeographyTenants,
  resetGeographicReconciliationStateForTest,
  triggerAutomaticGeographicReconciliation,
} from "./geographicReconciliationScheduler";

beforeEach(() => resetGeographicReconciliationStateForTest());

describe("automatic geographic reconciliation", () => {
  it("uses a bounded batch and coalesces overlapping runs for the same tenant", async () => {
    let release!: () => void;
    const reconcile = vi.fn(
      () => new Promise<void>(resolve => {
        release = resolve;
      })
    );
    const first = triggerAutomaticGeographicReconciliation(reconcile, "laundry_farm");
    const second = triggerAutomaticGeographicReconciliation(reconcile, "laundry_farm");
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(reconcile).toHaveBeenCalledWith({ tenantId: "laundry_farm", batchSize: 10 });
    expect(second).toBe(first);
    release();
    await first;
  });

  it("does not let one tenant's running pass block another tenant", async () => {
    const reconcile = vi.fn(async () => undefined);
    let release!: () => void;
    const slow = vi.fn(() => new Promise<void>(r => { release = r; }));
    const a = triggerAutomaticGeographicReconciliation(slow, "default");
    await triggerAutomaticGeographicReconciliation(reconcile, "laundry_farm");
    expect(reconcile).toHaveBeenCalledWith({ tenantId: "laundry_farm", batchSize: 10 });
    release();
    await a;
  });

  it("contains provider failures and records which tenant failed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(
      triggerAutomaticGeographicReconciliation(async () => {
        throw new Error("provider unavailable");
      }, "laundry_farm")
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("tenant laundry_farm"),
      "provider unavailable"
    );
    expect(lastGeographicReconciliationOutcomes()).toEqual([
      expect.objectContaining({ tenantId: "laundry_farm", ok: false, error: "provider unavailable" }),
    ]);
    warn.mockRestore();
  });

  it("retries a failed tenant on the next pass", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const reconcile = vi.fn().mockRejectedValueOnce(new Error("429")).mockResolvedValueOnce(undefined);
    await reconcileAuthorizedGeographyTenants(reconcile, ["laundry_farm"]);
    await reconcileAuthorizedGeographyTenants(reconcile, ["laundry_farm"]);
    expect(reconcile).toHaveBeenCalledTimes(2);
    expect(lastGeographicReconciliationOutcomes()[0]).toMatchObject({ tenantId: "laundry_farm", ok: true });
    warn.mockRestore();
  });

  it("runs only authorized tenants, in isolation, and a failure does not stop the next", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const calls: string[] = [];
    await reconcileAuthorizedGeographyTenants(
      async ({ tenantId }) => {
        calls.push(tenantId);
        if (tenantId === "default") throw new Error("boom");
      },
      ["default", "laundry_farm"]
    );
    expect(calls).toEqual(["default", "laundry_farm"]);
    warn.mockRestore();
  });
});

describe("authorizedGeographyTenants", () => {
  it("keeps the legacy single tenant only when nothing is configured", () => {
    expect(authorizedGeographyTenants(undefined)).toEqual(["default"]);
  });
  it("parses an explicit list, trims, and dedupes", () => {
    expect(authorizedGeographyTenants(" default, laundry_farm ,default")).toEqual(["default", "laundry_farm"]);
  });
  it("an explicitly empty list authorizes nothing (no silent default)", () => {
    expect(authorizedGeographyTenants("")).toEqual([]);
  });
});
