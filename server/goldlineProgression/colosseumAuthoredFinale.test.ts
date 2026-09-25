/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { readFileSync } from "node:fs";
import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { COLOSSEUM_AUTHORED_FINALE_CONSEQUENCE } from "../../shared/colosseumAuthoredFinale";
import type { TrpcContext } from "../_core/context";
import { colosseumLeadHuntDefinition } from "./colosseumKingdomBinding";

const access = vi.hoisted(() => ({ resolveMembership: vi.fn() }));
const mocks = vi.hoisted(() => ({
  readMission: vi.fn(),
  isCompanionEarned: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("../saas/tenantAccess", () => ({
  resolveLegacyDayforgeMembership: access.resolveMembership,
  hasLegacyDayforgeEntitlement: vi.fn(),
  roleAllows: (actual: string, allowed: readonly string[]) => allowed.includes(actual),
}));
vi.mock("../openChannel/day1TenDoorsService", () => ({
  getDay1TenDoorsMissionReadOnly: mocks.readMission,
}));
vi.mock("../companions/companionService", () => ({
  isCompanionEarned: mocks.isCompanionEarned,
}));
vi.mock("../db", () => ({ getDb: mocks.getDb }));

import { progressionRouter } from "./progressionRouter";
import { acknowledgeColosseumAuthoredFinale } from "./progressionService";
import {
  beginCoastalMarketRookHunt,
  recordAuthoredCoastalMarketRookCatch,
} from "./progressionStore";

const TARGETS = [...(colosseumLeadHuntDefinition()?.targetIds ?? [])];
const five = () => Object.fromEntries(TARGETS.map(id => [id, "pitched"]));
const finale = { authoredConsequence: COLOSSEUM_AUTHORED_FINALE_CONSEQUENCE } as const;

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
  const match = (predicate: unknown) => rows.filter(row => rowMatches(row, predicate));
  const db = {
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
          for (const row of match(predicate)) Object.assign(row, patch);
        },
      }),
    }),
    transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(db),
  };
  return db;
}

function context(tenantId: string, userId: number): TrpcContext {
  return {
    req: { headers: {} } as never,
    res: undefined as never,
    vendorSession: null,
    tenantId,
    user: {
      id: userId,
      tenantId,
      openId: `open-${userId}`,
      name: "Operator",
      email: "operator@example.test",
      loginMethod: "test",
      role: "operator",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
  };
}

describe("authored Clockhead finale acknowledgement", () => {
  let db: ReturnType<typeof memoryDb>;

  beforeEach(() => {
    vi.clearAllMocks();
    db = memoryDb();
    mocks.getDb.mockResolvedValue(db);
    mocks.isCompanionEarned.mockResolvedValue(false);
    mocks.readMission.mockImplementation(async ({ tenantId, driverId }: { tenantId: string; driverId: string }) => {
      if (tenantId === "tenant-a" && driverId === "open-7") return { outcomes: five() };
      return { outcomes: {} };
    });
    access.resolveMembership.mockImplementation(async ({ tenantId, userOpenId }: { tenantId: string; userOpenId: string }) => ({
      tenantId,
      userOpenId,
      role: "operator",
    }));
  });

  it("refuses the finale when the binding is unsatisfied and writes nothing", async () => {
    mocks.readMission.mockResolvedValue({
      outcomes: Object.fromEntries(TARGETS.slice(0, 4).map(id => [id, "pitched"])),
    });
    const caller = progressionRouter.createCaller(context("tenant-a", 7));
    await expect(caller.acknowledgeColosseumFinale(finale)).rejects.toThrow(/not satisfied/);
    expect(db.rows).toHaveLength(0);
    const read = await caller.get({});
    expect(read.kingdomBinding.status).toBe("unsatisfied");
    expect(read.levelColosseumResolved).toEqual({ status: "unearned", value: false });
    expect(read.companionRookOwned).toEqual({ status: "unearned", value: false });
    expect(read.kingdomBrassRepublicCompleted.value).toBe(false);
    expect(read.capabilityRookContact.granted).toBe(false);
  });

  it("refuses state-setting flags and any consequence other than the authored finale", async () => {
    const caller = progressionRouter.createCaller(context("tenant-a", 7));
    await expect(caller.acknowledgeColosseumFinale({} as never)).rejects.toThrow();
    await expect(
      caller.acknowledgeColosseumFinale({ authoredConsequence: "rookOwned" } as never)
    ).rejects.toThrow();
    for (const forged of [
      { rookOwned: true },
      { resolved: true },
      { kingdomComplete: true },
      { levelColosseumResolved: true },
      { companionRookOwned: true },
    ]) {
      await expect(caller.acknowledgeColosseumFinale(forged as never)).rejects.toThrow();
      await expect(
        acknowledgeColosseumAuthoredFinale({
          tenantId: "tenant-a",
          operatorId: "open-7",
          authoredConsequence: COLOSSEUM_AUTHORED_FINALE_CONSEQUENCE,
          ...forged,
        })
      ).rejects.toThrow();
    }
    expect(db.rows).toHaveLength(0);
    const read = await caller.get({});
    expect(read.kingdomBinding.status).toBe("satisfied");
    expect(read.levelColosseumResolved.value).toBe(false);
    expect(read.companionRookOwned.value).toBe(false);
    expect(read.kingdomBrassRepublicCompleted.value).toBe(false);
  });

  it("persists the level but does not own Rook, and a repeat keeps that boundary", async () => {
    const caller = progressionRouter.createCaller(context("tenant-a", 7));
    const owned = await caller.acknowledgeColosseumFinale(finale);
    const levelStamp = db.rows[0]?.levelColosseumResolvedAt;
    const again = await caller.acknowledgeColosseumFinale(finale);
    expect(owned.operatorId).toBe("open-7");
    expect(owned.tenantId).toBe("tenant-a");
    expect(owned.companionRookOwned).toEqual({ status: "unearned", value: false });
    expect(owned.levelColosseumResolved.value).toBe(true);
    expect(owned.kingdomBrassRepublicCompleted.value).toBe(false);
    expect(owned.kingdomBrassRepublicCompleted.impliedByLevelColosseum).toBe(false);
    expect(owned.capabilityRookContact.granted).toBe(false);
    expect(owned.capabilityRookContact.grantsCompanionOwnership).toBe(false);
    expect(again.companionRookOwned.value).toBe(false);
    expect(again.levelColosseumResolved.value).toBe(true);
    expect(levelStamp).toBeInstanceOf(Date);
    expect(db.rows[0]?.levelColosseumResolvedAt).toBe(levelStamp);
    expect(db.rows[0]?.companionRookOwnedAt).toBeNull();
    expect(db.rows[0]?.kingdomBrassRepublicCompletedAt).toBeNull();
    expect(db.rows).toHaveLength(1);

    const clearedLocalStorage = await caller.get({});
    expect(clearedLocalStorage.localStorage).toBe("cache_and_present_only");
    expect(clearedLocalStorage.companionRookOwned.value).toBe(false);
    expect(clearedLocalStorage.kingdomBrassRepublicCompleted.value).toBe(false);
    expect(clearedLocalStorage.capabilityRookContact.granted).toBe(false);
  });

  it("owns Rook only after the server-started Coastal Market catch beat", async () => {
    const caller = progressionRouter.createCaller(context("tenant-a", 7));
    const revealed = await caller.acknowledgeColosseumFinale(finale);
    expect(revealed.levelColosseumResolved.value).toBe(true);
    expect(revealed.companionRookOwned.value).toBe(false);

    const runId = "33333333-3333-4333-8333-333333333333";
    await beginCoastalMarketRookHunt({
      tenantId: "tenant-a",
      operatorId: "open-7",
      runId,
      startedAt: new Date("2026-09-25T10:00:00.000Z"),
    });
    await expect(
      recordAuthoredCoastalMarketRookCatch({
        tenantId: "tenant-a",
        operatorId: "open-7",
        runId: "44444444-4444-4444-8444-444444444444",
        at: new Date("2026-09-25T10:00:06.000Z"),
      })
    ).rejects.toThrow(/server-started hunt run/);

    await recordAuthoredCoastalMarketRookCatch({
      tenantId: "tenant-a",
      operatorId: "open-7",
      runId,
      at: new Date("2026-09-25T10:00:06.000Z"),
    });
    const owned = await caller.get({});
    expect(owned.companionRookOwned).toEqual({ status: "earned", value: true });
    expect(db.rows.filter(row => row.companionRookOwnedAt)).toHaveLength(1);

    await recordAuthoredCoastalMarketRookCatch({
      tenantId: "tenant-a",
      operatorId: "open-7",
      runId,
      at: new Date("2026-09-25T10:00:07.000Z"),
    });
    expect(db.rows.filter(row => row.companionRookOwnedAt)).toHaveLength(1);
  });

  it("does not let another tenant or operator inherit the Colosseum resolution", async () => {
    const owner = progressionRouter.createCaller(context("tenant-a", 7));
    await owner.acknowledgeColosseumFinale(finale);

    const otherTenant = progressionRouter.createCaller(context("tenant-b", 7));
    const otherTenantRead = await otherTenant.get({});
    expect(otherTenantRead.companionRookOwned.value).toBe(false);
    expect(otherTenantRead.levelColosseumResolved.value).toBe(false);
    await expect(otherTenant.acknowledgeColosseumFinale(finale)).rejects.toThrow();

    const otherOperator = progressionRouter.createCaller(context("tenant-a", 8));
    const otherOperatorRead = await otherOperator.get({});
    expect(otherOperatorRead.operatorId).toBe("open-8");
    expect(otherOperatorRead.companionRookOwned.value).toBe(false);
    await expect(otherOperator.acknowledgeColosseumFinale(finale)).rejects.toThrow();

    const stillOwned = await owner.get({});
    expect(stillOwned.companionRookOwned.value).toBe(false);
    expect(stillOwned.levelColosseumResolved.value).toBe(true);
    expect(stillOwned.kingdomBrassRepublicCompleted.value).toBe(false);
    expect(db.rows.filter(row => row.companionRookOwnedAt)).toEqual([]);
    expect(db.rows.filter(row => row.levelColosseumResolvedAt)).toEqual([
      expect.objectContaining({ tenantId: "tenant-a", operatorId: "open-7" }),
    ]);
  });

  it("keeps Day 1 and the Colosseum finale from recording Rook ownership or CONTACT", () => {
    const day1 = readFileSync(new URL("../openChannel/day1TenDoorsService.ts", import.meta.url), "utf8");
    const service = readFileSync(new URL("./progressionService.ts", import.meta.url), "utf8");
    expect(day1).not.toMatch(
      /recordRookFromOutcomes|recordCompanionRookOwned|acknowledgeColosseumAuthoredFinale|recordAuthoredColosseumFinale|recordLevelFromOutcomes|levelColosseumResolvedAt/
    );
    expect(service).not.toMatch(/earnCompanion/);
    expect(service).toMatch(/acknowledgeColosseumAuthoredFinale/);
    expect(service).toMatch(/recordAuthoredColosseumFinale/);
  });
});
