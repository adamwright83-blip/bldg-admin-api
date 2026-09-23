import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readMission: vi.fn(),
  isCompanionEarned: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("../openChannel/day1TenDoorsService", () => ({
  getDay1TenDoorsMissionReadOnly: mocks.readMission,
}));
vi.mock("../companions/companionService", () => ({
  isCompanionEarned: mocks.isCompanionEarned,
}));
vi.mock("../db", () => ({ getDb: mocks.getDb }));

import { colosseumLeadHuntDefinition } from "./colosseumKingdomBinding";
import { ProgressionNotPermittedError } from "./progressionContract";
import {
  readGoldlineProgression,
  recordCompanionRookOwned,
  recordKingdomBrassRepublicCompleted,
} from "./progressionService";
import { recordLevelFromOutcomes } from "./progressionWrites";

const TARGETS = [...(colosseumLeadHuntDefinition()?.targetIds ?? [])];
const five = () => Object.fromEntries(TARGETS.map(id => [id, "pitched"]));

type Row = {
  id: string;
  tenantId: string;
  operatorId: string;
  levelColosseumResolvedAt: Date | null;
  companionRookOwnedAt: Date | null;
  kingdomBrassRepublicCompletedAt: Date | null;
  overworldUnlocksJson: unknown;
};

const dialect = new MySqlDialect();

/** Applies the WHERE drizzle actually built. It does not re-check nulls itself. */
function rowMatches(row: Row, predicate: unknown): boolean {
  const query = dialect.sqlToQuery(predicate as SQL);
  const [tenantId, operatorId] = query.params;
  if (row.tenantId !== tenantId || row.operatorId !== operatorId) return false;
  const sql = query.sql;
  if (sql.includes("`levelColosseumResolvedAt` is null") && row.levelColosseumResolvedAt != null) return false;
  if (sql.includes("`levelColosseumResolvedAt` is not null") && row.levelColosseumResolvedAt == null) return false;
  if (sql.includes("`companionRookOwnedAt` is null") && row.companionRookOwnedAt != null) return false;
  if (sql.includes("`companionRookOwnedAt` is not null") && row.companionRookOwnedAt == null) return false;
  return true;
}

function memoryDb() {
  const rows: Row[] = [];
  const patches: Record<string, unknown>[] = [];
  const match = (predicate: unknown) => rows.filter(row => rowMatches(row, predicate));
  const db = {
    patches,
    rows,
    select: () => ({
      from: () => ({
        where: (predicate: unknown) => {
          const found = match(predicate);
          return { limit: async (n: number) => found.slice(0, n) };
        },
      }),
    }),
    insert: () => ({
      values: async (value: Row) => {
        if (rows.some(row => row.tenantId === value.tenantId && row.operatorId === value.operatorId)) {
          const error = new Error("duplicate") as Error & { code: string };
          error.code = "ER_DUP_ENTRY";
          throw error;
        }
        rows.push({ ...value });
      },
    }),
    update: () => ({
      set: (patch: Partial<Row>) => ({
        where: async (predicate: unknown) => {
          patches.push(patch);
          for (const row of match(predicate)) Object.assign(row, patch);
        },
      }),
    }),
  };
  return db;
}

describe("goldline domain progression persistence", () => {
  let db: ReturnType<typeof memoryDb>;

  beforeEach(() => {
    vi.clearAllMocks();
    db = memoryDb();
    mocks.getDb.mockResolvedValue(db);
    mocks.isCompanionEarned.mockResolvedValue(false);
    mocks.readMission.mockResolvedValue({ outcomes: {} });
  });

  it("reads a missing row as unearned and does not insert one", async () => {
    const read = await readGoldlineProgression({
      tenantId: "tenant-a",
      operatorId: "op-a",
      capabilityOperatorId: "cap-a",
    });
    expect(read.levelColosseumResolved).toEqual({ status: "unearned", value: false });
    expect(read.companionRookOwned).toEqual({ status: "unearned", value: false });
    expect(read.kingdomBrassRepublicCompleted.value).toBe(false);
    expect(db.rows).toHaveLength(0);
  });

  it("does not insert a level row when a read sees a satisfied hunt", async () => {
    mocks.readMission.mockResolvedValue({ outcomes: five() });
    const read = await readGoldlineProgression({
      tenantId: "tenant-a",
      operatorId: "op-a",
      capabilityOperatorId: "cap-a",
    });
    expect(read.kingdomBinding.status).toBe("satisfied");
    expect(read.levelColosseumResolved).toEqual({ status: "unearned", value: false });
    expect(read.kingdomBrassRepublicCompleted.value).toBe(false);
    expect(db.rows).toHaveLength(0);
  });

  it("does not resolve another tenant from a caller-supplied outcome map", async () => {
    mocks.readMission.mockImplementation(async ({ tenantId, driverId }: { tenantId: string; driverId: string }) => {
      if (tenantId === "tenant-a" && driverId === "op-a") return { outcomes: five() };
      return { outcomes: {} };
    });
    const forged = await readGoldlineProgression({
      tenantId: "tenant-b",
      operatorId: "op-b",
      capabilityOperatorId: null,
      outcomes: five(),
    } as never);
    expect(forged.kingdomBinding.status).toBe("unsatisfied");
    expect(forged.levelColosseumResolved.value).toBe(false);
    expect(db.rows).toHaveLength(0);
  });

  it("storage primitive records a level timestamp only when invoked, without Rook or Kingdom completion", async () => {
    await expect(
      recordLevelFromOutcomes({
        tenantId: "tenant-b",
        operatorId: "op-b",
        outcomes: {},
        outcomesAvailable: true,
      })
    ).rejects.toBeInstanceOf(ProgressionNotPermittedError);
    expect(db.rows).toHaveLength(0);

    await recordLevelFromOutcomes({
      tenantId: "tenant-a",
      operatorId: "op-a",
      outcomes: five(),
      outcomesAvailable: true,
    });
    const first = await readGoldlineProgression({
      tenantId: "tenant-a",
      operatorId: "op-a",
      capabilityOperatorId: null,
    });
    const stamp = db.rows[0]?.levelColosseumResolvedAt;
    await recordLevelFromOutcomes({
      tenantId: "tenant-a",
      operatorId: "op-a",
      outcomes: five(),
      outcomesAvailable: true,
    });
    expect(first.levelColosseumResolved).toEqual({ status: "earned", value: true });
    expect(first.companionRookOwned.value).toBe(false);
    expect(first.kingdomBrassRepublicCompleted.value).toBe(false);
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]?.levelColosseumResolvedAt).toBe(stamp);
    expect(db.rows[0]?.companionRookOwnedAt).toBeNull();
    expect(db.rows[0]?.kingdomBrassRepublicCompletedAt).toBeNull();
    expect(db.patches.every(patch => !("kingdomBrassRepublicCompletedAt" in patch))).toBe(true);
    const other = await readGoldlineProgression({
      tenantId: "tenant-b",
      operatorId: "op-b",
      capabilityOperatorId: "cap-b",
    });
    expect(other.levelColosseumResolved.value).toBe(false);
  });

  it("records Rook as a separate idempotent write and still does not complete the Kingdom", async () => {
    mocks.readMission.mockResolvedValue({ outcomes: five() });
    await expect(recordCompanionRookOwned({ tenantId: "tenant-a", operatorId: "op-a" })).rejects.toBeInstanceOf(
      ProgressionNotPermittedError
    );
    expect(db.rows).toHaveLength(0);

    await recordLevelFromOutcomes({
      tenantId: "tenant-a",
      operatorId: "op-a",
      outcomes: five(),
      outcomesAvailable: true,
    });
    const owned = await recordCompanionRookOwned({ tenantId: "tenant-a", operatorId: "op-a" });
    const again = await recordCompanionRookOwned({ tenantId: "tenant-a", operatorId: "op-a" });
    expect(owned.levelColosseumResolved.value).toBe(true);
    expect(owned.companionRookOwned).toEqual({ status: "earned", value: true });
    expect(owned.kingdomBrassRepublicCompleted.value).toBe(false);
    expect(owned.overworldUnlocks.flags.postRook).toBe(true);
    expect(again.companionRookOwned.value).toBe(true);
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]?.kingdomBrassRepublicCompletedAt).toBeNull();
    expect(db.rows[0]?.companionRookOwnedAt).toBe(db.rows[0]?.companionRookOwnedAt);
  });

  it("does not let another tenant's Rook row satisfy this operator", async () => {
    mocks.readMission.mockResolvedValue({ outcomes: five() });
    await recordLevelFromOutcomes({
      tenantId: "tenant-a",
      operatorId: "op-a",
      outcomes: five(),
      outcomesAvailable: true,
    });
    await recordCompanionRookOwned({ tenantId: "tenant-a", operatorId: "op-a" });
    const other = await readGoldlineProgression({
      tenantId: "tenant-a",
      operatorId: "op-b",
      capabilityOperatorId: "cap-b",
    });
    expect(other.companionRookOwned.value).toBe(false);
    expect(other.levelColosseumResolved.value).toBe(false);
    expect(other.overworldUnlocks.flags.postRook).toBe(false);
  });

  it("does not promote a capability unlock or a client forge into ownership", async () => {
    mocks.readMission.mockResolvedValue({ outcomes: five() });
    mocks.isCompanionEarned.mockImplementation(
      async ({ operatorId }: { operatorId: string }) => operatorId === "user-7"
    );
    const read = await readGoldlineProgression({
      tenantId: "tenant-a",
      operatorId: "op-a",
      capabilityOperatorId: "user-7",
    });
    expect(mocks.isCompanionEarned).toHaveBeenCalledWith({
      tenantId: "tenant-a",
      operatorId: "user-7",
      companionId: "rook",
    });
    expect(read.capabilityRookContact.granted).toBe(true);
    expect(read.companionRookOwned.value).toBe(false);
    const lookedUpAsOpenId = await readGoldlineProgression({
      tenantId: "tenant-a",
      operatorId: "op-a",
      capabilityOperatorId: "op-a",
    });
    expect(lookedUpAsOpenId.capabilityRookContact.granted).toBe(false);
    await expect(
      recordLevelFromOutcomes({
        tenantId: "tenant-a",
        operatorId: "op-a",
        outcomes: five(),
        outcomesAvailable: true,
        clientPayload: { resolved: true },
      })
    ).rejects.toThrow(/resolved/);
    await expect(
      recordCompanionRookOwned({ tenantId: "tenant-a", operatorId: "op-a", clientPayload: { rookOwned: true } })
    ).rejects.toThrow(/rookOwned/);
    expect(db.rows).toHaveLength(0);
  });

  it("refuses kingdom completion without writing a row", async () => {
    mocks.readMission.mockResolvedValue({ outcomes: five() });
    await expect(
      recordKingdomBrassRepublicCompleted({
        tenantId: "tenant-a",
        operatorId: "op-a",
        outcomes: five(),
        outcomesAvailable: true,
      })
    ).rejects.toBeInstanceOf(ProgressionNotPermittedError);
    expect(db.rows).toHaveLength(0);
  });

  it("keeps a second read earned after the client cache is absent", async () => {
    mocks.readMission.mockResolvedValue({ outcomes: five() });
    await recordLevelFromOutcomes({
      tenantId: "tenant-a",
      operatorId: "op-a",
      outcomes: five(),
      outcomesAvailable: true,
    });
    await recordCompanionRookOwned({ tenantId: "tenant-a", operatorId: "op-a" });
    const fresh = await readGoldlineProgression({
      tenantId: "tenant-a",
      operatorId: "op-a",
      capabilityOperatorId: "cap-a",
    });
    expect(fresh.companionRookOwned.value).toBe(true);
    expect(fresh.levelColosseumResolved.value).toBe(true);
    expect(fresh.localStorage).toBe("cache_and_present_only");
  });
});
