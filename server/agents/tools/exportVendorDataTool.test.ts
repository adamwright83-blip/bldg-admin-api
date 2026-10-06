import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  createVendorDataExport: vi.fn(),
  getOrdersByVendorId: vi.fn(),
  getVendorProfileByVendorId: vi.fn(),
  listVendorServices: vi.fn(),
}));

vi.mock("../../db", () => ({
  createVendorDataExport: db.createVendorDataExport,
  getOrdersByVendorId: db.getOrdersByVendorId,
  getVendorProfileByVendorId: db.getVendorProfileByVendorId,
  listVendorServices: db.listVendorServices,
}));

import { exportVendorDataTool } from "./exportVendorDataTool";

const ctx = {
  tenantId: "tenant-a",
  agentType: "vendor_agent" as const,
  actorType: "vendor" as const,
  actorId: "vendor-user-1",
};

describe("vendor data export tenant authority", () => {
  beforeEach(() => {
    db.createVendorDataExport.mockReset();
    db.getOrdersByVendorId.mockReset();
    db.getVendorProfileByVendorId.mockReset();
    db.listVendorServices.mockReset();
    db.createVendorDataExport.mockResolvedValue(9);
  });

  it("refuses a vendor id that has no tenant-owned profile", async () => {
    db.getVendorProfileByVendorId.mockResolvedValue(undefined);

    await expect(
      exportVendorDataTool.execute({ vendorId: 77, exportType: "clients" }, ctx)
    ).rejects.toThrow("Vendor does not belong to tenant");

    expect(db.getOrdersByVendorId).not.toHaveBeenCalled();
    expect(db.createVendorDataExport).not.toHaveBeenCalled();
  });

  it("filters legacy global order reads back to the execution tenant", async () => {
    db.getVendorProfileByVendorId.mockResolvedValue({
      tenantId: "tenant-a",
      vendorId: 77,
    });
    db.getOrdersByVendorId.mockResolvedValue([
      {
        id: 1,
        tenantId: "tenant-a",
        firstName: "Alice",
        lastName: "A",
        phone: "111",
        email: "a@example.test",
      },
      {
        id: 2,
        tenantId: "tenant-b",
        firstName: "Bob",
        lastName: "B",
        phone: "222",
        email: "b@example.test",
      },
    ]);

    const result = await exportVendorDataTool.execute(
      { vendorId: 77, exportType: "clients" },
      ctx
    );

    const created = db.createVendorDataExport.mock.calls[0]?.[0];
    expect(decodeURIComponent(created.exportUrl)).toContain("Alice");
    expect(decodeURIComponent(created.exportUrl)).not.toContain("Bob");
    expect(result.output.includesOtherVendorData).toBe(false);
  });
});
