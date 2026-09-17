import { describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "../db";
import { loadStrategyCustomerAggregates } from "./snapshotCustomerAggregateLoad";

describe("loadStrategyCustomerAggregates", () => {
  it("returns unavailable when there is no database", async () => {
    vi.mocked(getDb).mockResolvedValueOnce(null as never);
    const load = await loadStrategyCustomerAggregates("t1");
    expect(load).toEqual({
      status: "unavailable",
      reason: "Database not available",
    });
  });

  it("returns unavailable for a missing orders table, not an empty observation", async () => {
    const error = Object.assign(new Error("Table 'x.orders' doesn't exist"), {
      code: "ER_NO_SUCH_TABLE",
      errno: 1146,
    });
    vi.mocked(getDb).mockResolvedValueOnce({
      select: () => {
        throw error;
      },
    } as never);
    const load = await loadStrategyCustomerAggregates("t1");
    expect(load.status).toBe("unavailable");
    if (load.status === "unavailable") {
      expect(load.reason).toMatch(/orders table/);
    }
  });

  it("rethrows unexpected SQL errors instead of treating them as empty", async () => {
    const error = Object.assign(new Error("deadlock"), {
      code: "ER_LOCK_DEADLOCK",
      errno: 1213,
    });
    vi.mocked(getDb).mockResolvedValueOnce({
      select: () => {
        throw error;
      },
    } as never);
    await expect(loadStrategyCustomerAggregates("t1")).rejects.toBe(error);
  });
});
