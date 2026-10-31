import { beforeEach, describe, expect, it, vi } from "vitest";

// Stage 1 authority rule, recovery path: a dormant customer gets a prepared,
// unsent recovery obligation, and nothing is committed to the Day Line.

const DAY = 86_400_000;
const phoneKey = "phone:3235550101";
const paid = (daysAgo: number, orderNumber: string) => {
  const at = new Date(Date.now() - daysAgo * DAY);
  return {
    source: "native",
    eventKey: `native:${orderNumber}`,
    occurredAt: at,
    placedAt: at,
    businessDate: at.toISOString().slice(0, 10),
    cents: 4200,
    serviceType: "wash_fold",
    customerName: "Mei Lin",
    identity: { phone: "3235550101" },
    orderNumber,
  };
};
const events = [paid(120, "301"), paid(90, "302")];

const obligationMocks = vi.hoisted(() => ({
  listPersistentOperatorObligationPayloads: vi.fn(async () => [] as unknown[]),
  listPersistentOperatorObligationRecords: vi.fn(async () => [] as unknown[]),
  upsertPersistentOperatorObligation: vi.fn(async () => undefined),
  backfillPersistentOperatorCommercialFollowUpRef: vi.fn(async () => undefined),
}));
const dayDirectorMocks = vi.hoisted(() => ({ acceptProposalWithReceipt: vi.fn(async () => ({ stored: { id: "would-be-commitment" } })) }));

vi.mock("../../agents/persistentOperator/obligationStore", () => ({
  claireProactiveObligations: {},
  ...obligationMocks,
}));
vi.mock("../../planning/dayDirector/dayDirectorService", async importOriginal => ({
  ...(await importOriginal<typeof import("../../planning/dayDirector/dayDirectorService")>()),
  ...dayDirectorMocks,
}));
vi.mock("../../domains/commercial/commercialFollowUpReadService", () => ({
  listOpenCommercialFollowUps: vi.fn(async () => []),
  listCommercialFollowUpStates: vi.fn(async () => []),
}));
vi.mock("../../analytics/paidOrderLedger", () => ({ loadPaidOrderLedger: vi.fn(async () => ({})) }));
vi.mock("../../analytics/canonicalRevenue", async importOriginal => ({
  ...(await importOriginal<typeof import("../../analytics/canonicalRevenue")>()),
  reconcileLedgerSpan: vi.fn(() => ({ includedEvents: events })),
}));
vi.mock("../../analytics/businessMetrics", async importOriginal => ({
  ...(await importOriginal<typeof import("../../analytics/businessMetrics")>()),
  groupCustomers: vi.fn(() => [{ identityId: phoneKey, matched: true, records: events }]),
}));
vi.mock("./recoveryEvidence", () => ({
  loadRecoverySafetyEvidence: vi.fn(async () => ({ coverage: {}, nativeOrders: [], recoveries: [], communications: [] })),
  deriveRecoverySafety: vi.fn(() => ({ openOrderCount: 0, lastOutreachOn: null, attestedOutreachOn: null })),
}));
vi.mock("../../analytics/sourceCoverage", async importOriginal => ({
  ...(await importOriginal<typeof import("../../analytics/sourceCoverage")>()),
  customerTruthDispositionOf: vi.fn(() => "current"),
}));
vi.mock("../../strategy/dormantOutreachGate", async importOriginal => ({
  ...(await importOriginal<typeof import("../../strategy/dormantOutreachGate")>()),
  loadDormantContactFacts: vi.fn(async () => ({
    readable: true,
    permissionByHash: new Map(),
    lastOutreachByPhone: new Map(),
    lastOutreachByHash: new Map(),
  })),
  permissionForKeys: vi.fn(() => ({ state: "opted_in", sourceReference: "fixture:consent", capturedAt: "2026-09-01T00:00:00.000Z" })),
}));
vi.mock("../../analytics/dataFreshness", () => ({
  loadDataFreshness: vi.fn(async () => {
    throw new Error("freshness not needed for this test");
  }),
}));
vi.mock("./salesInsights", () => ({ loadSalesInsight: vi.fn(async () => null) }));

import { ensureOperatorBoard } from "./boardService";

describe("proactive board recovery path never commits to the Day Line", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("a dormant, consented customer gets an unsent draft and no Day Line commitment, sweep after sweep", async () => {
    const sweep = () =>
      ensureOperatorBoard({
        tenantId: "tenant-board-1a-recovery",
        operatorUserId: "op-board-1a-recovery",
        actorId: "1",
        timeZone: "America/Los_Angeles",
        recoveryDraftIdentity: { storeName: "Laundry Butler", senderName: "Adam", serviceLabel: "laundry" },
        force: true,
      });

    const first = await sweep();
    expect(first.created).toBe(1);
    const [saved] = obligationMocks.upsertPersistentOperatorObligation.mock.calls[0] as unknown as [
      { obligation: { kind: string; status: string; subjectKey: string; title: string; draft: { message: string; sent: boolean } | null } },
    ];
    expect(saved.obligation).toMatchObject({ kind: "dormant_recovery", status: "draft_prepared", subjectKey: phoneKey, title: "Text Mei" });
    expect(saved.obligation.draft?.message).toBeTruthy();
    expect(saved.obligation.draft?.sent).toBe(false);

    await sweep();
    await sweep();
    expect(dayDirectorMocks.acceptProposalWithReceipt).not.toHaveBeenCalled();
  });
});
