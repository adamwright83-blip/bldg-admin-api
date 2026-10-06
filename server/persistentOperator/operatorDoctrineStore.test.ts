import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({
  getDb: vi.fn(),
}));

import { DEFAULT_DOCTRINE } from "../../shared/claireProactive";
import { getDb } from "../db";
import { loadOperatorDoctrine, saveOperatorDoctrine } from "./operatorDoctrineStore";

describe("Persistent Operator doctrine read port", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires tenant and operator authority", async () => {
    await expect(
      loadOperatorDoctrine({ tenantId: "", operatorUserId: "operator-1" })
    ).rejects.toThrow("tenantId is required");
    await expect(
      loadOperatorDoctrine({ tenantId: "tenant-1", operatorUserId: "" })
    ).rejects.toThrow("operator identity is required");
  });

  it("uses the safe default doctrine when advisory persistence is unavailable", async () => {
    vi.mocked(getDb).mockResolvedValueOnce(null);
    await expect(
      loadOperatorDoctrine({
        tenantId: "tenant-1",
        operatorUserId: "operator-1",
      })
    ).resolves.toEqual(DEFAULT_DOCTRINE);
  });

  it("still fails closed when a doctrine write cannot be persisted", async () => {
    vi.mocked(getDb).mockResolvedValueOnce(null);
    await expect(
      saveOperatorDoctrine({
        tenantId: "tenant-1",
        operatorUserId: "operator-1",
        rules: DEFAULT_DOCTRINE,
      })
    ).rejects.toThrow("Database unavailable");
  });

  it("treats only a missing legacy doctrine table as default doctrine", async () => {
    const missing = Object.assign(new Error("Table doesn't exist"), {
      code: "ER_NO_SUCH_TABLE",
      errno: 1146,
    });
    vi.mocked(getDb).mockResolvedValueOnce({
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.reject(missing),
          }),
        }),
      }),
    } as never);

    await expect(
      loadOperatorDoctrine({
        tenantId: "tenant-1",
        operatorUserId: "operator-1",
      })
    ).resolves.toMatchObject({
      skipSalesUntil: null,
    });
  });

  it("propagates transient query failures", async () => {
    const transient = Object.assign(new Error("connection lost"), {
      code: "PROTOCOL_CONNECTION_LOST",
    });
    vi.mocked(getDb).mockResolvedValueOnce({
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.reject(transient),
          }),
        }),
      }),
    } as never);

    await expect(
      loadOperatorDoctrine({
        tenantId: "tenant-1",
        operatorUserId: "operator-1",
      })
    ).rejects.toThrow("connection lost");
  });
});
