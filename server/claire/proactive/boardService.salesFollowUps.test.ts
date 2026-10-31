import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProactiveObligation } from "../../../shared/claireProactive";

/**
 * The proactive board's copy of a commercial follow-up: named for its account,
 * one copy per follow-up however often it is rescheduled, and closed when the
 * pipeline completes or cancels it.
 */

type StoredRecord = {
  id: string;
  kind: string;
  subjectKey: string;
  status: string;
  dueDate: string;
  payload: ProactiveObligation;
  commercialFollowUpRef: string | null;
};
type FollowUp = {
  id: string;
  missionId: number;
  status: "open" | "completed" | "cancelled";
  dueAt: Date;
  note: string;
  accountName: string | null;
};

const world = vi.hoisted(() => ({
  records: new Map<string, StoredRecord>(),
  followUps: [] as FollowUp[],
  statesUnreadable: false,
}));

// The store, as the board sees it: earliest due first, then by id.
const ordered = () =>
  [...world.records.values()].sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id));

const obligationMocks = vi.hoisted(() => ({
  listPersistentOperatorObligationPayloads: vi.fn(async () => ordered().map(record => record.payload)),
  listPersistentOperatorObligationRecords: vi.fn(async () => ordered()),
  upsertPersistentOperatorObligation: vi.fn(
    async (input: { obligation: ProactiveObligation; commercialFollowUpRef?: string | null }) => {
      world.records.set(input.obligation.id, {
        id: input.obligation.id,
        kind: input.obligation.kind,
        subjectKey: input.obligation.subjectKey,
        status: input.obligation.status,
        dueDate: input.obligation.dueDate,
        payload: input.obligation,
        commercialFollowUpRef: input.commercialFollowUpRef ?? null,
      });
    }
  ),
  backfillPersistentOperatorCommercialFollowUpRef: vi.fn(
    async (input: { obligationId: string; commercialFollowUpRef: string }) => {
      const record = world.records.get(input.obligationId);
      if (record) record.commercialFollowUpRef = input.commercialFollowUpRef;
    }
  ),
}));

vi.mock("../../agents/persistentOperator/obligationStore", () => ({
  claireProactiveObligations: {},
  ...obligationMocks,
}));
vi.mock("../../domains/commercial/commercialFollowUpReadService", () => ({
  listOpenCommercialFollowUps: vi.fn(async () =>
    world.followUps
      .filter(follow => follow.status === "open")
      .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime() || a.id.localeCompare(b.id))
      .map(({ id, missionId, dueAt, note, accountName }) => ({ id, missionId, dueAt, note, accountName }))
  ),
  listCommercialFollowUpStates: vi.fn(async (_tenantId: string, ids: readonly string[]) =>
    world.statesUnreadable
      ? null
      : world.followUps
          .filter(follow => ids.includes(follow.id))
          .map(({ id, missionId, status, dueAt }) => ({ id, missionId, status, dueAt }))
  ),
}));
vi.mock("../../agents/persistentOperator/salesHoldInstruction", async importOriginal => ({
  ...(await importOriginal<typeof import("../../agents/persistentOperator/salesHoldInstruction")>()),
  loadOperatorSalesHoldFor: vi.fn(async () => null),
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

const DAY = 86_400_000;
const dueIn = (days: number) => new Date(Date.now() + days * DAY);
const ymd = (date: Date) => date.toISOString().slice(0, 10);

function sweep() {
  return ensureOperatorBoard({
    tenantId: "tenant-sales-identity",
    operatorUserId: "op-sales-identity",
    actorId: "1",
    timeZone: "America/Los_Angeles",
    recoveryDraftIdentity: { storeName: "Laundry Butler", senderName: "Adam", serviceLabel: "laundry" },
    force: true,
  });
}

function followUp(overrides: Partial<FollowUp> & Pick<FollowUp, "id" | "missionId">): FollowUp {
  return {
    status: "open",
    dueAt: dueIn(1),
    note: "Email the revised quote to the property manager.",
    accountName: "Larkspur Hotel",
    ...overrides,
  };
}

const salesCopies = () => ordered().filter(record => record.kind === "sales_follow_up");
const scheduledSales = () => salesCopies().filter(record => record.status === "scheduled");

describe("the proactive board's sales follow-ups", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    world.records = new Map();
    world.followUps = [];
    world.statesUnreadable = false;
  });

  it("names a follow-up for its account, and falls back to the mission only when the account is unknown", async () => {
    world.followUps = [
      followUp({ id: "follow-1", missionId: 42, accountName: "Larkspur Hotel" }),
      followUp({ id: "follow-2", missionId: 43, accountName: null, dueAt: dueIn(2) }),
    ];

    const result = await sweep();

    expect(result.created).toBe(2);
    const [larkspur, unnamed] = scheduledSales();
    expect(larkspur!.payload).toMatchObject({
      subjectKey: "42",
      subjectName: "Larkspur Hotel",
      title: "Follow up: Larkspur Hotel",
    });
    expect(unnamed!.payload).toMatchObject({ subjectKey: "43", title: "Follow up: Mission 43" });
    expect(result.brief).toContain(
      "Sales that must survive the operations day: Follow up: Larkspur Hotel. Email the revised quote to the property manager."
    );
    expect(result.conciseBrief).toContain("Next sales follow-up: Follow up: Larkspur Hotel.");
  });

  it("a rescheduled follow-up keeps one copy on the board, on its new day", async () => {
    const first = dueIn(1);
    const moved = dueIn(3);
    world.followUps = [followUp({ id: "follow-1", missionId: 42, dueAt: first })];
    await sweep();
    expect(scheduledSales().map(record => record.id)).toEqual([`sales:42:${ymd(first)}`]);

    world.followUps[0]!.dueAt = moved;
    await sweep();

    expect(scheduledSales().map(record => record.id)).toEqual([`sales:42:${ymd(moved)}`]);
    const old = world.records.get(`sales:42:${ymd(first)}`)!;
    expect(old.status).toBe("superseded");
    expect(old.commercialFollowUpRef).toBe("follow-1");
    expect(old.payload.why).toBe("Email the revised quote to the property manager.");
    expect(world.records.get(`sales:42:${ymd(moved)}`)!.commercialFollowUpRef).toBe("follow-1");

    // Moved back to its first day: that copy is scheduled again, and only that one.
    world.followUps[0]!.dueAt = first;
    await sweep();
    expect(scheduledSales().map(record => record.id)).toEqual([`sales:42:${ymd(first)}`]);
    expect(world.records.get(`sales:42:${ymd(moved)}`)!.status).toBe("superseded");
  });

  it("a follow-up the pipeline completed or cancelled closes its copy the same way", async () => {
    world.followUps = [
      followUp({ id: "follow-1", missionId: 42 }),
      followUp({ id: "follow-2", missionId: 43, accountName: "Juniper Spa", dueAt: dueIn(2) }),
    ];
    await sweep();
    expect(scheduledSales()).toHaveLength(2);

    world.followUps[0]!.status = "completed";
    world.followUps[1]!.status = "cancelled";
    const result = await sweep();

    expect(scheduledSales()).toEqual([]);
    expect(world.records.get(`sales:42:${ymd(world.followUps[0]!.dueAt)}`)!.status).toBe("completed");
    expect(world.records.get(`sales:43:${ymd(world.followUps[1]!.dueAt)}`)!.status).toBe("cancelled");
    expect(result.brief).not.toContain("Sales that must survive the operations day");
    expect(result.conciseBrief).not.toContain("Next sales follow-up");
  });

  it("a new follow-up on the same account and day is scheduled even though an earlier one there was completed", async () => {
    const day = dueIn(1);
    world.followUps = [followUp({ id: "follow-1", missionId: 42, dueAt: day })];
    await sweep();
    world.followUps[0]!.status = "completed";
    world.followUps.push(followUp({ id: "follow-2", missionId: 42, dueAt: day, note: "Send the signed contract." }));

    await sweep();

    const copy = world.records.get(`sales:42:${ymd(day)}`)!;
    expect(copy).toMatchObject({ status: "scheduled", commercialFollowUpRef: "follow-2" });
    expect(copy.payload.why).toBe("Send the signed contract.");
  });

  it("leaves alone what it cannot judge: no follow-up id, work in flight, an unknown or unreadable follow-up", async () => {
    const conquest: ProactiveObligation = {
      id: `sales:conquest:77:${ymd(dueIn(0))}`,
      kind: "sales_follow_up",
      subjectKey: "77",
      subjectName: "Cedar Court",
      status: "scheduled",
      dueDate: ymd(dueIn(0)),
      title: "Conquest pitch: Cedar Court",
      why: "Corridor neighbor to recently won Larkspur Hotel (0.2 mi away)",
      draft: null,
      historyIntact: true,
      moveCount: 0,
    };
    const inFlight: ProactiveObligation = { ...conquest, id: "sales:50:2026-10-01", subjectKey: "50", status: "awaiting_result", dueDate: "2026-10-01" };
    const unknown: ProactiveObligation = { ...conquest, id: "sales:51:2026-10-02", subjectKey: "51", dueDate: "2026-10-02" };
    for (const [obligation, ref] of [
      [conquest, null],
      [inFlight, "follow-50"],
      [unknown, "follow-51"],
    ] as const) {
      world.records.set(obligation.id, {
        id: obligation.id,
        kind: obligation.kind,
        subjectKey: obligation.subjectKey,
        status: obligation.status,
        dueDate: obligation.dueDate,
        payload: obligation,
        commercialFollowUpRef: ref,
      });
    }
    // follow-50 was completed in the pipeline; follow-51 is not on file.
    world.followUps = [followUp({ id: "follow-50", missionId: 50, status: "completed" })];

    await sweep();
    world.statesUnreadable = true;
    await sweep();

    expect(obligationMocks.upsertPersistentOperatorObligation).not.toHaveBeenCalled();
    expect(world.records.get(conquest.id)!.status).toBe("scheduled");
    expect(world.records.get(inFlight.id)!.status).toBe("awaiting_result");
    expect(world.records.get(unknown.id)!.status).toBe("scheduled");
  });
});
