import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("../db", () => ({ getDb: mocks.getDb }));

import {
  findDomainProgression,
  insertLevelColosseumResolved,
  setCompanionRookOwnedAt,
  setLevelColosseumResolvedAt,
} from "./progressionStore";

const dialect = new MySqlDialect();

type Row = {
  id: string;
  tenantId: string;
  operatorId: string;
  levelColosseumResolvedAt: Date | null;
  companionRookOwnedAt: Date | null;
  kingdomBrassRepublicCompletedAt: Date | null;
  overworldUnlocksJson: unknown;
};

function compile(predicate: unknown) {
  const query = dialect.sqlToQuery(predicate as SQL);
  return { sql: query.sql, params: [...query.params] };
}

function matches(row: Row, predicate: unknown): boolean {
  const query = compile(predicate);
  const [tenantId, operatorId] = query.params;
  if (row.tenantId !== tenantId || row.operatorId !== operatorId) return false;
  const sql = query.sql;
  if (sql.includes("`levelColosseumResolvedAt` is null") && row.levelColosseumResolvedAt != null) return false;
  if (sql.includes("`levelColosseumResolvedAt` is not null") && row.levelColosseumResolvedAt == null) return false;
  if (sql.includes("`companionRookOwnedAt` is null") && row.companionRookOwnedAt != null) return false;
  if (sql.includes("`companionRookOwnedAt` is not null") && row.companionRookOwnedAt == null) return false;
  return true;
}

function capturingDb(rows: Row[]) {
  const predicates: { kind: string; sql: string; params: unknown[]; set?: Record<string, unknown> }[] = [];
  const db = {
    predicates,
    select: () => ({
      from: () => ({
        where: (predicate: unknown) => {
          const query = compile(predicate);
          predicates.push({ kind: "select", ...query });
          return { limit: async () => rows.filter(row => matches(row, predicate)).slice(0, 1) };
        },
      }),
    }),
    insert: () => ({
      values: async (value: Row) => {
        if (rows.some(row => row.tenantId === value.tenantId && row.operatorId === value.operatorId)) {
          const error = new Error("Duplicate entry") as Error & { code: string; errno: number };
          error.code = "ER_DUP_ENTRY";
          error.errno = 1062;
          throw error;
        }
        rows.push({ ...value });
      },
    }),
    update: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: async (predicate: unknown) => {
          const query = compile(predicate);
          predicates.push({ kind: "update", ...query, set: patch });
          for (const row of rows) {
            if (!matches(row, predicate)) continue;
            Object.assign(row, patch);
          }
        },
      }),
    }),
  };
  return db;
}

describe("goldline_domain_progression writes", () => {
  let rows: Row[];

  beforeEach(() => {
    rows = [];
    mocks.getDb.mockResolvedValue(capturingDb(rows));
  });

  it("selects one tenant and operator and does not treat a missing row as earned", async () => {
    const found = await findDomainProgression({ tenantId: "tenant-a", operatorId: "op-a" });
    expect(found).toEqual({ readable: true, row: null });
    const db = await mocks.getDb();
    expect(db.predicates).toEqual([
      {
        kind: "select",
        sql: "(`goldline_domain_progression`.`tenantId` = ? and `goldline_domain_progression`.`operatorId` = ?)",
        params: ["tenant-a", "op-a"],
      },
    ]);
  });

  it("sets the level timestamp only while that column is null", async () => {
    const first = new Date("2026-09-01T00:00:00Z");
    rows.push({
      id: "row-1",
      tenantId: "tenant-a",
      operatorId: "op-a",
      levelColosseumResolvedAt: first,
      companionRookOwnedAt: null,
      kingdomBrassRepublicCompletedAt: null,
      overworldUnlocksJson: {},
    });
    await setLevelColosseumResolvedAt({
      tenantId: "tenant-a",
      operatorId: "op-a",
      resolvedAt: new Date("2026-09-23T00:00:00Z"),
    });
    expect(rows[0]?.levelColosseumResolvedAt).toBe(first);
    expect(rows[0]?.kingdomBrassRepublicCompletedAt).toBeNull();
    const db = await mocks.getDb();
    expect(db.predicates[0]?.sql).toBe(
      "(`goldline_domain_progression`.`tenantId` = ? and `goldline_domain_progression`.`operatorId` = ? and `goldline_domain_progression`.`levelColosseumResolvedAt` is null)"
    );
    expect(db.predicates[0]?.params).toEqual(["tenant-a", "op-a"]);
    expect(db.predicates[0]?.set).toEqual({ levelColosseumResolvedAt: new Date("2026-09-23T00:00:00Z") });
  });

  it("sets Rook only when the level timestamp exists and Rook is still null", async () => {
    rows.push({
      id: "row-1",
      tenantId: "tenant-a",
      operatorId: "op-a",
      levelColosseumResolvedAt: null,
      companionRookOwnedAt: null,
      kingdomBrassRepublicCompletedAt: null,
      overworldUnlocksJson: {},
    });
    const ownedAt = new Date("2026-09-23T00:00:00Z");
    await setCompanionRookOwnedAt({ tenantId: "tenant-a", operatorId: "op-a", ownedAt });
    expect(rows[0]?.companionRookOwnedAt).toBeNull();

    rows[0]!.levelColosseumResolvedAt = new Date("2026-09-01T00:00:00Z");
    await setCompanionRookOwnedAt({ tenantId: "tenant-a", operatorId: "op-a", ownedAt });
    expect(rows[0]?.companionRookOwnedAt).toBe(ownedAt);
    await setCompanionRookOwnedAt({
      tenantId: "tenant-a",
      operatorId: "op-a",
      ownedAt: new Date("2026-10-01T00:00:00Z"),
    });
    expect(rows[0]?.companionRookOwnedAt).toBe(ownedAt);
    expect(rows[0]?.kingdomBrassRepublicCompletedAt).toBeNull();

    const db = await mocks.getDb();
    expect(db.predicates[0]?.sql).toContain("`levelColosseumResolvedAt` is not null");
    expect(db.predicates[0]?.sql).toContain("`companionRookOwnedAt` is null");
    expect(db.predicates[0]?.sql).not.toContain("kingdomBrassRepublicCompletedAt");
    expect(db.predicates[0]?.set).toEqual({ companionRookOwnedAt: ownedAt });
    expect(db.predicates.every((predicate: { set?: Record<string, unknown> }) => !("kingdomBrassRepublicCompletedAt" in (predicate.set ?? {})))).toBe(true);
  });

  it("inserts an unearned Rook and Kingdom and swallows only a duplicate key", async () => {
    const resolvedAt = new Date("2026-09-23T00:00:00Z");
    await insertLevelColosseumResolved({ tenantId: "tenant-a", operatorId: "op-a", resolvedAt });
    await insertLevelColosseumResolved({ tenantId: "tenant-a", operatorId: "op-a", resolvedAt });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenantId: "tenant-a",
      operatorId: "op-a",
      levelColosseumResolvedAt: resolvedAt,
      companionRookOwnedAt: null,
      kingdomBrassRepublicCompletedAt: null,
      overworldUnlocksJson: {},
    });
  });

  it("names a missing table instead of inserting around it", async () => {
    mocks.getDb.mockResolvedValue({
      insert: () => ({
        values: async () => {
          const error = new Error("Table 'goldline_domain_progression' doesn't exist") as Error & {
            code: string;
            errno: number;
          };
          error.code = "ER_NO_SUCH_TABLE";
          error.errno = 1146;
          throw error;
        },
      }),
    });
    await expect(
      insertLevelColosseumResolved({
        tenantId: "tenant-a",
        operatorId: "op-a",
        resolvedAt: new Date(),
      })
    ).rejects.toMatchObject({ name: "ProgressionSchemaBlockedError" });
  });
});
