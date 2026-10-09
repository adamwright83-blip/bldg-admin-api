import { beforeEach, describe, expect, it, vi } from "vitest";

const obligationMocks = vi.hoisted(() => ({
  listPersistentOperatorObligationPayloads: vi.fn(),
  upsertPersistentOperatorObligation: vi.fn(),
  backfillPersistentOperatorCommercialFollowUpRef: vi.fn(),
}));

vi.mock("../../agents/persistentOperator/obligationStore", () => ({
  claireProactiveObligations: {},
  ...obligationMocks,
}));

import { conciseOperatorBoardSpeech, loadObligations } from "./boardService";

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

describe("Daphne V2 concise morning board presentation", () => {
  const recoveries = Array.from({ length: 16 }, (_, i) => ({
    kind: "dormant_recovery", subjectName: `Customer ${i + 1}`, status: "scheduled",
  })) as never;

  it("preserves the import warning and next sales task without speaking sixteen names", () => {
    const speech = conciseOperatorBoardSpeech({
      warnings: ["GUMBALL failed today. Last successful import was October 5."],
      recoveries,
      sales: [{ kind: "sales_follow_up", status: "scheduled", title: "Email Mission 15" }] as never,
      skipSales: false,
      overload: { kind: "ok", speak: "" },
    });
    expect(speech).toContain("GUMBALL import failed today");
    expect(speech).toContain("Recovery candidates need verification");
    expect(speech).toContain("Next sales follow-up: Email Mission 15");
    expect(speech).not.toContain("Customer 1");
    expect(speech.length).toBeLessThan(240);
  });

  it("preserves critical overload warnings and respects paused sales", () => {
    const speech = conciseOperatorBoardSpeech({
      warnings: [],
      recoveries: [] as never,
      sales: [{ kind: "sales_follow_up", status: "scheduled", title: "Email Mission 15" }] as never,
      skipSales: true,
      overload: { kind: "impossible", speak: "Two customer commitments overlap." },
    });
    expect(speech).toContain("Two customer commitments overlap.");
    expect(speech).not.toContain("Email Mission 15");
  });
});
