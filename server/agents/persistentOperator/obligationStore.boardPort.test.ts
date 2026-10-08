import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "../../db";
import { listPersistentOperatorObligationPayloads } from "./obligationStore";

describe("Persistent Operator proactive obligation read port", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fails closed when the database is unavailable", async () => {
    vi.mocked(getDb).mockResolvedValueOnce(null);

    await expect(
      listPersistentOperatorObligationPayloads({
        tenantId: "tenant-1",
        operatorUserId: "operator-1",
      })
    ).rejects.toThrow("Database unavailable");
  });

  it("propagates transient database failures instead of inventing an empty board", async () => {
    const queryError = Object.assign(new Error("Connection lost during query"), {
      code: "PROTOCOL_CONNECTION_LOST",
      errno: 1047,
    });

    vi.mocked(getDb).mockResolvedValueOnce({
      select: () => ({
        from: () => ({
          where: () => Promise.reject(queryError),
        }),
      }),
    } as never);

    await expect(
      listPersistentOperatorObligationPayloads({
        tenantId: "tenant-1",
        operatorUserId: "operator-1",
      })
    ).rejects.toThrow("Connection lost during query");
  });

  it("treats only an unmigrated optional obligation table as empty", async () => {
    const missingTableError = Object.assign(new Error("Table doesn't exist"), {
      code: "ER_NO_SUCH_TABLE",
      errno: 1146,
    });

    vi.mocked(getDb).mockResolvedValueOnce({
      select: () => ({
        from: () => ({
          where: () => Promise.reject(missingTableError),
        }),
      }),
    } as never);

    await expect(
      listPersistentOperatorObligationPayloads({
        tenantId: "tenant-1",
        operatorUserId: "operator-1",
      })
    ).resolves.toEqual([]);
  });

  it("returns the stored obligation payloads for the exact tenant/operator", async () => {
    const fixture = {
      id: "ob-1",
      kind: "sales_follow_up" as const,
      subjectKey: "123",
      status: "scheduled" as const,
      dueDate: "2026-09-29",
      title: "Follow up with client",
      why: "Follow up note",
      draft: null,
      historyIntact: true,
      moveCount: 0,
    };

    vi.mocked(getDb).mockResolvedValueOnce({
      select: () => ({
        from: () => ({
          where: () => Promise.resolve([{ payloadJson: fixture }]),
        }),
      }),
    } as never);

    await expect(
      listPersistentOperatorObligationPayloads({
        tenantId: "tenant-1",
        operatorUserId: "operator-1",
      })
    ).resolves.toEqual([fixture]);
  });
});
