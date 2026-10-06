import { beforeEach, describe, expect, it, vi } from "vitest";

const obligationMocks = vi.hoisted(() => ({
  listPersistentOperatorObligationPayloads: vi.fn(),
  upsertPersistentOperatorObligation: vi.fn(),
  backfillPersistentOperatorCommercialFollowUpRef: vi.fn(),
}));

vi.mock("../../persistentOperator/obligationStore", () => ({
  claireProactiveObligations: {},
  ...obligationMocks,
}));

import { loadObligations } from "./boardService";

describe("Claire proactive board domain port", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delegates obligation reads to Persistent Operator", async () => {
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

    obligationMocks.listPersistentOperatorObligationPayloads.mockResolvedValueOnce([
      fixtureObligation,
    ]);

    await expect(loadObligations("tenant-1", "operator-1")).resolves.toEqual([
      fixtureObligation,
    ]);
    expect(
      obligationMocks.listPersistentOperatorObligationPayloads
    ).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      operatorUserId: "operator-1",
    });
  });

  it("does not reinterpret a domain-port failure as an empty board", async () => {
    obligationMocks.listPersistentOperatorObligationPayloads.mockRejectedValueOnce(
      new Error("Connection lost during query")
    );

    await expect(loadObligations("tenant-1", "operator-1")).rejects.toThrow(
      "Connection lost during query"
    );
  });
});
