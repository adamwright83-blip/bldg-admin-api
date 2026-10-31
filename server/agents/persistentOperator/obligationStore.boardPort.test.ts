import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db", () => ({
  getDb: vi.fn(),
}));

import { drizzle } from "drizzle-orm/mysql2";
import { getDb } from "../../db";
import { listPersistentOperatorObligationPayloads } from "./obligationStore";

/** A real drizzle query builder over a client that records the SQL it is sent. */
function recordingDb(rows: unknown[][] = []) {
  const sent: string[] = [];
  const client = {
    query: async (query: { sql: string }) => {
      sent.push(query.sql);
      return [rows, []];
    },
  };
  return { db: drizzle({ client: client as never }), sent };
}

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
          where: () => ({ orderBy: () => Promise.reject(queryError) }),
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
          where: () => ({ orderBy: () => Promise.reject(missingTableError) }),
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
          where: () => ({ orderBy: () => Promise.resolve([{ payloadJson: fixture }]) }),
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

  it("reads the board earliest due first, then by id, so the next follow-up is the same on every read", async () => {
    const { db, sent } = recordingDb();
    vi.mocked(getDb).mockResolvedValueOnce(db as never);

    await listPersistentOperatorObligationPayloads({ tenantId: "tenant-1", operatorUserId: "operator-1" });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatch(
      /order by `claire_proactive_obligations`\.`dueDate` asc, `claire_proactive_obligations`\.`id` asc$/
    );
  });
});
