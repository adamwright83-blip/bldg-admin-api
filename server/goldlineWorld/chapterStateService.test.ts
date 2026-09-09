import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("../db", () => ({ getDb: mocks.getDb }));

import {
  ChapterStateRevisionConflictError,
  getChapterState,
  saveChapterState,
} from "./chapterStateService";
import type { GoldlineChapterFictionState } from "../../shared/goldlineChapterState";

type Row = Record<string, unknown>;

function predicateParameters(predicate: unknown): unknown[] {
  if (!predicate || typeof predicate !== "object") return [];
  const node = predicate as {
    constructor?: { name?: string };
    queryChunks?: unknown[];
    value?: unknown;
  };
  if (node.constructor?.name === "Param") return [node.value];
  return (node.queryChunks ?? []).flatMap(predicateParameters);
}

function memoryDb() {
  const rows: Row[] = [];
  // predicate param order for our service: tenantId, operatorId, chapterId, [revision]
  const filterRows = (predicate: unknown) => {
    const params = predicateParameters(predicate);
    return rows.filter(
      row =>
        row.tenantId === params[0] &&
        row.operatorId === params[1] &&
        row.chapterId === params[2] &&
        (params.length < 4 || row.revision === params[3])
    );
  };
  const db: any = {
    select: vi.fn(() => ({
      from: () => ({
        where: (predicate: unknown) => {
          const result = filterRows(predicate);
          const promise = Promise.resolve(result) as Promise<Row[]> & {
            limit: (count: number) => Promise<Row[]>;
          };
          promise.limit = async count => result.slice(0, count);
          return promise;
        },
      }),
    })),
    insert: vi.fn(() => ({
      values: async (value: Row) => {
        rows.push({ ...value, createdAt: new Date(), updatedAt: new Date() });
      },
    })),
    update: vi.fn(() => ({
      set: (patch: Row) => ({
        where: async (predicate: unknown) => {
          const matched = filterRows(predicate);
          for (const row of matched) Object.assign(row, patch);
          return [{ affectedRows: matched.length }];
        },
      }),
    })),
  };
  return { db, rows };
}

function sampleState(): GoldlineChapterFictionState {
  return {
    chapterId: "the-last-valet",
    version: 1,
    room: "arrival",
    checkpoint: { room: "arrival", x: 150, y: 470 },
    mechanism: { heading: null, gardenOpen: false, latchOpen: false },
    cleared: [],
    completed: false,
    choice: null,
    restored: false,
    secretSeen: false,
  };
}

const identity = { tenantId: "t1", operatorId: "op1", chapterId: "the-last-valet" };

describe("goldline chapter state service", () => {
  it("returns null when no database is available", async () => {
    mocks.getDb.mockResolvedValue(null);
    expect(await getChapterState(identity)).toBeNull();
  });

  it("creates a new row at revision 1 when none exists", async () => {
    const { db, rows } = memoryDb();
    mocks.getDb.mockResolvedValue(db);
    const result = await saveChapterState({
      ...identity,
      expectedRevision: 0,
      state: sampleState(),
      requestId: "req-1",
    });
    expect(result.revision).toBe(1);
    expect(rows).toHaveLength(1);
  });

  it("round-trips state through get after a save", async () => {
    const { db } = memoryDb();
    mocks.getDb.mockResolvedValue(db);
    await saveChapterState({ ...identity, expectedRevision: 0, state: sampleState(), requestId: "req-1" });
    const fetched = await getChapterState(identity);
    expect(fetched?.revision).toBe(1);
    expect(fetched?.state.room).toBe("arrival");
  });

  it("bumps the revision on a matching compare-and-set write", async () => {
    const { db } = memoryDb();
    mocks.getDb.mockResolvedValue(db);
    await saveChapterState({ ...identity, expectedRevision: 0, state: sampleState(), requestId: "req-1" });
    const next = { ...sampleState(), room: "garden" };
    const result = await saveChapterState({ ...identity, expectedRevision: 1, state: next, requestId: "req-2" });
    expect(result.revision).toBe(2);
    expect(result.state.room).toBe("garden");
  });

  it("rejects a stale write with the current authoritative row", async () => {
    const { db } = memoryDb();
    mocks.getDb.mockResolvedValue(db);
    await saveChapterState({ ...identity, expectedRevision: 0, state: sampleState(), requestId: "req-1" });
    await saveChapterState({ ...identity, expectedRevision: 1, state: { ...sampleState(), room: "garden" }, requestId: "req-2" });
    await expect(
      saveChapterState({ ...identity, expectedRevision: 1, state: { ...sampleState(), room: "gallery" }, requestId: "req-3" })
    ).rejects.toBeInstanceOf(ChapterStateRevisionConflictError);
  });

  it("is idempotent: retrying the same requestId does not double-bump the revision", async () => {
    const { db } = memoryDb();
    mocks.getDb.mockResolvedValue(db);
    await saveChapterState({ ...identity, expectedRevision: 0, state: sampleState(), requestId: "req-1" });
    await saveChapterState({ ...identity, expectedRevision: 1, state: { ...sampleState(), room: "garden" }, requestId: "req-2" });
    const retried = await saveChapterState({
      ...identity, expectedRevision: 1, state: { ...sampleState(), room: "gallery" }, requestId: "req-2",
    });
    expect(retried.revision).toBe(2);
    expect(retried.state.room).toBe("garden");
  });

  it("keeps tenants isolated — a different tenant sees no row", async () => {
    const { db } = memoryDb();
    mocks.getDb.mockResolvedValue(db);
    await saveChapterState({ ...identity, expectedRevision: 0, state: sampleState(), requestId: "req-1" });
    expect(await getChapterState({ ...identity, tenantId: "other-tenant" })).toBeNull();
  });
});
