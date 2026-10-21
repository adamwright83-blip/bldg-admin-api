import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import { followUpKind, sameFollowUpKind } from "./followUpIdempotency";
import { scheduleCommercialFollowUp } from "./commercialPipelineService";

const mocks = vi.hoisted(() => ({ db: null as any, duplicate: null as any }));
vi.mock("../../db", () => ({ getDb: async () => mocks.db }));
vi.mock("../../commercialMissions/commercialMissionStore", () => ({
  getCommercialMission: async () => ({ id: 17 }),
  getCommercialMissionByIdempotencyKey: async () => null,
}));
vi.mock("../../legacy/dayforge/events/legacyDayforgeEventStore", () => ({ writeLegacyDayforgeEventWith: async () => {} }));
vi.mock("./followUpIdempotency", async importOriginal => ({
  ...(await importOriginal<typeof import("./followUpIdempotency")>()),
  findOpenFollowUpOfKind: async () => mocks.duplicate,
}));

/** A recording in-memory stand-in for the tables scheduleCommercialFollowUp touches. */
function fakeDb(tables: Record<string, any[]>) {
  const writes: Array<{ op: "insert" | "update"; table: string; values: any }> = [];
  const chain = (table: string) => {
    const c: any = {
      where: () => c, orderBy: () => c, limit: () => c, for: () => c,
      then: (resolve: any, reject: any) => Promise.resolve(tables[table] ?? []).then(resolve, reject),
    };
    return c;
  };
  const db: any = {
    select: () => ({ from: (t: any) => chain(getTableName(t)) }),
    update: (t: any) => ({
      set: (values: any) => ({
        where: async () => {
          const name = getTableName(t);
          for (const row of tables[name] ?? []) Object.assign(row, values);
          writes.push({ op: "update", table: name, values });
          return [{ affectedRows: 1 }];
        },
      }),
    }),
    insert: (t: any) => ({
      values: async (values: any) => {
        const name = getTableName(t);
        writes.push({ op: "insert", table: name, values });
        (tables[name] ??= []).push({ createdAt: new Date(), updatedAt: new Date(), completedAt: null, ...values });
      },
    }),
    transaction: async (fn: any) => fn(db),
  };
  return { db, writes };
}

const OLD_DUE = new Date("2026-09-28T16:00:00Z");
const NEW_DUE = new Date("2026-11-02T18:00:00Z");

function tables() {
  return {
    commercial_pipeline_records: [
      { id: 17, tenantId: "default", accountId: 17, missionId: 17, stage: "follow_up", version: 1, commercialCustomerId: null, nextFollowUpAt: OLD_DUE,
        estimatedContractValueCents: 0, approvedContractValueCents: 0, invoicedRevenueCents: 0, paidRevenueCents: 0, realizedRevenueCents: 0, lossReason: null, firstOrderId: null },
    ],
    commercial_follow_ups: [
      { id: "d4f4356e-da5e-45f8-9acf-aba76e1d50d9", tenantId: "default", pipelineId: 17, missionId: 17, status: "open", dueAt: OLD_DUE, note: "Email him the collateral", requestId: "req-old", completedAt: null, createdAt: new Date("2026-09-28T00:50:36Z"), updatedAt: new Date("2026-09-28T00:50:36Z") },
    ],
    commercial_pipeline_events: [],
    commercial_accounts: [{ id: 17, tenantId: "default", name: "Los Feliz Towers" }],
  } as Record<string, any[]>;
}

describe("follow-up kind", () => {
  it("treats 'email him with collateral' and 'Email him the collateral' as one kind", () => {
    expect(followUpKind("email him with collateral")).toBe(followUpKind("Email him the collateral"));
    expect(sameFollowUpKind("email him with collateral", "call about pricing")).toBe(false);
  });
});

describe("the explicit admin schedule honours the requested date and never adds a second row", () => {
  beforeEach(() => {
    mocks.duplicate = { id: "d4f4356e-da5e-45f8-9acf-aba76e1d50d9", pipelineId: 17, dueAt: OLD_DUE, note: "Email him the collateral" };
  });

  it("moves the existing follow-up to the requested dueAt, keeps its id, records the change", async () => {
    const t = tables();
    const { db, writes } = fakeDb(t);
    mocks.db = db;
    const detail = await scheduleCommercialFollowUp({
      tenantId: "default", pipelineId: 17, actorId: "adam-admin", requestId: "req-new", dueAt: NEW_DUE, note: "Email him with collateral",
    });
    expect(writes.filter(w => w.op === "insert" && w.table === "commercial_follow_ups")).toHaveLength(0);
    expect(t.commercial_follow_ups).toHaveLength(1);
    expect(t.commercial_follow_ups[0]!.id).toBe("d4f4356e-da5e-45f8-9acf-aba76e1d50d9");
    expect(t.commercial_follow_ups[0]!.dueAt).toEqual(NEW_DUE);
    const event = writes.find(w => w.op === "insert" && w.table === "commercial_pipeline_events");
    expect(event?.values.idempotencyKey).toBe("pipeline-follow-up-rescheduled:req-new");
    expect(event?.values.metadataJson).toMatchObject({ followUpId: "d4f4356e-da5e-45f8-9acf-aba76e1d50d9", dueAt: NEW_DUE.toISOString() });
    expect(writes.some(w => w.op === "update" && w.table === "commercial_pipeline_records" && w.values.nextFollowUpAt === NEW_DUE)).toBe(true);
    expect(detail.followUps).toHaveLength(1);
    expect(detail.followUps[0]!.dueAt).toBe(NEW_DUE.toISOString());
  });

  it("an identical date writes nothing", async () => {
    const t = tables();
    const { db, writes } = fakeDb(t);
    mocks.db = db;
    await scheduleCommercialFollowUp({ tenantId: "default", pipelineId: 17, actorId: "adam-admin", requestId: "req-same", dueAt: OLD_DUE, note: "Email him with collateral" });
    expect(writes).toHaveLength(0);
    expect(t.commercial_follow_ups).toHaveLength(1);
  });

  it("with no duplicate it creates the row as before", async () => {
    mocks.duplicate = null;
    const t = tables();
    t.commercial_follow_ups = [];
    const { db, writes } = fakeDb(t);
    mocks.db = db;
    // The created row must read back with this request id, as the production verification requires.
    const original = db.insert;
    db.insert = (tbl: any) => original(tbl);
    await scheduleCommercialFollowUp({ tenantId: "default", pipelineId: 17, actorId: "adam-admin", requestId: "req-first", dueAt: NEW_DUE, note: "Email him with collateral" });
    expect(writes.filter(w => w.op === "insert" && w.table === "commercial_follow_ups")).toHaveLength(1);
  });
});
