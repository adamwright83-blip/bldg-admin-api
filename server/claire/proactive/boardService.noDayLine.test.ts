import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Stage 1 authority rule: Claire prepares; only the operator's approval commits to the Day Line.

const obligationMocks = vi.hoisted(() => ({
  listPersistentOperatorObligationPayloads: vi.fn(async () => [] as unknown[]),
  upsertPersistentOperatorObligation: vi.fn(async () => undefined),
  backfillPersistentOperatorCommercialFollowUpRef: vi.fn(async () => undefined),
}));
const dayDirectorMocks = vi.hoisted(() => ({
  acceptProposalWithReceipt: vi.fn(),
  moveDayDirectorCommitment: vi.fn(),
}));

vi.mock("../../agents/persistentOperator/obligationStore", () => ({
  claireProactiveObligations: {},
  ...obligationMocks,
}));
vi.mock("../../planning/dayDirector/dayDirectorService", async importOriginal => ({
  ...(await importOriginal<typeof import("../../planning/dayDirector/dayDirectorService")>()),
  ...dayDirectorMocks,
}));
vi.mock("../../domains/commercial/commercialFollowUpReadService", () => ({
  listOpenCommercialFollowUps: vi.fn(async () => [
    {
      id: "follow-1",
      missionId: 42,
      dueAt: new Date(Date.now() + 86_400_000),
      note: "Email the revised quote to the property manager.",
    },
  ]),
}));
vi.mock("../../analytics/paidOrderLedger", () => ({
  loadPaidOrderLedger: vi.fn(async () => {
    throw new Error("ledger not needed for this test");
  }),
}));
vi.mock("../../analytics/dataFreshness", () => ({
  loadDataFreshness: vi.fn(async () => {
    throw new Error("freshness not needed for this test");
  }),
}));
vi.mock("./salesInsights", () => ({ loadSalesInsight: vi.fn(async () => null) }));

import { ensureOperatorBoard } from "./boardService";

describe("proactive board never commits to the Day Line on its own", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("a sweep prepares the follow-up obligation and writes no Day Line commitment", async () => {
    const result = await ensureOperatorBoard({
      tenantId: "tenant-board-1a",
      operatorUserId: "op-board-1a",
      actorId: "1",
      timeZone: "America/Los_Angeles",
      recoveryDraftIdentity: { storeName: "Laundry Butler", senderName: "Adam", serviceLabel: "laundry" },
      force: true,
    });

    expect(result.created).toBe(1);
    expect(obligationMocks.upsertPersistentOperatorObligation).toHaveBeenCalledTimes(1);
    const [saved] = obligationMocks.upsertPersistentOperatorObligation.mock.calls[0] as unknown as [
      { obligation: { id: string; status: string; kind: string } },
    ];
    expect(saved.obligation).toMatchObject({ id: expect.stringMatching(/^sales:42:/), kind: "sales_follow_up", status: "scheduled" });
    expect(dayDirectorMocks.acceptProposalWithReceipt).not.toHaveBeenCalled();
  });

  it("the board has no path to a Day Line commitment writer", () => {
    const source = readFileSync("server/claire/proactive/boardService.ts", "utf8");
    expect(source).not.toMatch(/acceptProposalWithReceipt|placeOnDayLine|dayDirectorCommitments|planning\/dayDirector/);
  });
});
