import { describe, expect, it, vi } from "vitest";

vi.mock("../../db", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "../../db";
import { loadObligations } from "./boardService";

describe("loadObligations persistence error safety", () => {
  it("propagates transient database query errors so callers do not assume zero obligations", async () => {
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

    await expect(loadObligations("tenant-1", "operator-1")).rejects.toThrow(
      "Connection lost during query"
    );
  });

  it("returns empty array when the optional table has not been migrated yet", async () => {
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

    const rows = await loadObligations("tenant-1", "operator-1");
    expect(rows).toEqual([]);
  });

  it("returns mapped proactive obligations on successful read", async () => {
    const fixtureObligation = {
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
          where: () => Promise.resolve([{ payloadJson: fixtureObligation }]),
        }),
      }),
    } as never);

    const rows = await loadObligations("tenant-1", "operator-1");
    expect(rows).toEqual([fixtureObligation]);
  });
});
