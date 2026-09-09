import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("../db", () => ({ getDb: mocks.getDb }));

import {
  armChapterEventBinding,
  getChapterEventBinding,
  reconcileChapterEventBinding,
} from "./chapterEventBindingService";
import type { TowerWarsBusinessEvent } from "../../shared/towerWars";

type Row = Record<string, unknown>;

function predicateParameters(predicate: unknown): unknown[] {
  if (!predicate || typeof predicate !== "object") return [];
  const node = predicate as { constructor?: { name?: string }; queryChunks?: unknown[]; value?: unknown };
  if (node.constructor?.name === "Param") return [node.value];
  return (node.queryChunks ?? []).flatMap(predicateParameters);
}

function memoryDb() {
  const rows: Row[] = [];
  const filterRows = (predicate: unknown) => {
    const params = predicateParameters(predicate);
    return rows.filter(
      row => row.tenantId === params[0] && row.chapterId === params[1] && row.buildingId === params[2]
    );
  };
  const db: any = {
    select: vi.fn(() => ({
      from: () => ({
        where: (predicate: unknown) => {
          const result = filterRows(predicate);
          const promise = Promise.resolve(result) as Promise<Row[]> & { limit: (n: number) => Promise<Row[]> };
          promise.limit = async n => result.slice(0, n);
          return promise;
        },
      }),
    })),
    insert: vi.fn(() => ({
      values: async (value: Row) => {
        rows.push({ resolvedEventId: null, resolvedAt: null, ...value, createdAt: new Date() });
      },
    })),
    update: vi.fn(() => ({
      set: (patch: Row) => ({
        where: async (predicate: unknown) => {
          // Simulate the `resolvedEventId IS NULL` CAS guard from the real predicate.
          const matched = filterRows(predicate).filter(row => row.resolvedEventId == null);
          for (const row of matched) Object.assign(row, patch);
          return [{ affectedRows: matched.length }];
        },
      }),
    })),
  };
  return { db, rows };
}

const identity = { tenantId: "t1", chapterId: "the-last-valet", buildingId: "century_park_east" as const };

function event(overrides: Partial<TowerWarsBusinessEvent> = {}): TowerWarsBusinessEvent {
  return {
    eventId: "evt-1",
    occurredAt: new Date().toISOString(),
    businessDate: "2026-09-08",
    buildingId: "century_park_east",
    buildingDisplayName: "Century Park East",
    orderId: 42,
    customerIdentity: null,
    customerDisplayName: null,
    customerPhone: null,
    revenueSource: "stripe",
    realOrderValueCents: 5000,
    sourceEvidence: {},
    ...overrides,
  };
}

describe("goldline chapter event binding service", () => {
  it("arming is idempotent and does not reset an existing window", async () => {
    const { db } = memoryDb();
    mocks.getDb.mockResolvedValue(db);
    const first = await armChapterEventBinding(identity);
    const second = await armChapterEventBinding(identity);
    expect(second.armedAt).toBe(first.armedAt);
  });

  it("does nothing before the receiver is armed", async () => {
    const { db } = memoryDb();
    mocks.getDb.mockResolvedValue(db);
    const result = await reconcileChapterEventBinding({ ...identity, candidateEvents: [event()] });
    expect(result).toEqual({ consequenceApplied: false, reason: "not_armed" });
  });

  it("applies the consequence exactly once for a correct, post-arm, qualifying event", async () => {
    const { db } = memoryDb();
    mocks.getDb.mockResolvedValue(db);
    await armChapterEventBinding(identity);
    await new Promise(resolve => setTimeout(resolve, 2));
    const qualifying = event({ eventId: "evt-real" });
    const result = await reconcileChapterEventBinding({ ...identity, candidateEvents: [qualifying] });
    expect(result).toEqual({ consequenceApplied: true, event: qualifying });
    const binding = await getChapterEventBinding(identity);
    expect(binding?.resolvedEventId).toBe("evt-real");
  });

  it("ignores an event from the wrong building", async () => {
    const { db } = memoryDb();
    mocks.getDb.mockResolvedValue(db);
    await armChapterEventBinding(identity);
    await new Promise(resolve => setTimeout(resolve, 2));
    const result = await reconcileChapterEventBinding({
      ...identity,
      candidateEvents: [event({ buildingId: "opus_la" })],
    });
    expect(result).toEqual({ consequenceApplied: false, reason: "no_qualifying_event" });
  });

  it("ignores an event that occurred before arming", async () => {
    const { db } = memoryDb();
    mocks.getDb.mockResolvedValue(db);
    const armed = await armChapterEventBinding(identity);
    const before = new Date(new Date(armed.armedAt!).getTime() - 10_000).toISOString();
    const result = await reconcileChapterEventBinding({
      ...identity,
      candidateEvents: [event({ occurredAt: before })],
    });
    expect(result).toEqual({ consequenceApplied: false, reason: "no_qualifying_event" });
  });

  it("does not duplicate the consequence for a repeated (already-resolved) event", async () => {
    const { db } = memoryDb();
    mocks.getDb.mockResolvedValue(db);
    await armChapterEventBinding(identity);
    await new Promise(resolve => setTimeout(resolve, 2));
    const qualifying = event({ eventId: "evt-real" });
    await reconcileChapterEventBinding({ ...identity, candidateEvents: [qualifying] });
    const second = await reconcileChapterEventBinding({ ...identity, candidateEvents: [qualifying] });
    expect(second).toEqual({ consequenceApplied: false, reason: "already_resolved" });
  });

  it("reconciliation works identically whether called immediately or after the player was offline", async () => {
    const { db } = memoryDb();
    mocks.getDb.mockResolvedValue(db);
    const armed = await armChapterEventBinding(identity);
    const laterEvent = event({
      eventId: "evt-offline",
      occurredAt: new Date(new Date(armed.armedAt!).getTime() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const result = await reconcileChapterEventBinding({ ...identity, candidateEvents: [laterEvent] });
    expect(result).toEqual({ consequenceApplied: true, event: laterEvent });
  });

  it("keeps tenants isolated", async () => {
    const { db } = memoryDb();
    mocks.getDb.mockResolvedValue(db);
    await armChapterEventBinding(identity);
    expect(await getChapterEventBinding({ ...identity, tenantId: "other-tenant" })).toBeNull();
  });
});
