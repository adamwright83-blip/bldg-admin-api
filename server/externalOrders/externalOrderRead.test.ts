import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  pickupViews: vi.fn(async () => new Map()),
}));
vi.mock("../db", () => ({ getDb: mocks.getDb }));
vi.mock("../integrations/cleancloud/pickups/service", () => ({
  pickupViews: mocks.pickupViews,
}));
import { listExternalOrders } from "./externalOrderService";

describe("external order reads", () => {
  it("keeps the Field Today read free of schema writes before migrations", async () => {
    const execute = vi.fn(() => {
      throw new Error("Read attempted a schema write");
    });
    const orderBy = vi.fn(async () => []);
    const where = vi.fn(() => ({ orderBy }));
    const from = vi.fn(() => ({ where }));
    mocks.getDb.mockResolvedValue({ select: () => ({ from }), execute });

    expect(await listExternalOrders({
      tenantId: "example-tenant",
      scheduledDate: "2026-10-12",
    })).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
    expect(mocks.pickupViews).toHaveBeenCalledWith("example-tenant", []);
  });
});
