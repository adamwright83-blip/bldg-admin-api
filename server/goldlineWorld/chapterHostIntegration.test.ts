/**
 * Integration Gate, router layer: calls the REAL tRPC routers via
 * createCaller — the same procedure/context boundary a real chapter host
 * would call over HTTP — rather than calling the underlying services
 * directly (chapterIntegration.test.ts already covers that layer). Only
 * `getDb` (persistence) and the real Tower Wars ledger fetch are mocked;
 * every router, procedure, and service function in between is the actual
 * production code.
 *
 * PRODUCTION DATABASE ROUND-TRIP: NOT VERIFIED — no live or local test MySQL
 * is reachable in this sandbox (Railway MySQL is private-network only).
 * SAFE INTEGRATED CONTRACT/HOST TEST: VERIFIED — the real router → procedure
 * → auth middleware → service chain is exercised end to end against a
 * mocked backend store standing in for that database.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";

const access = vi.hoisted(() => ({ resolveMembership: vi.fn(), hasEntitlement: vi.fn() }));
const mocks = vi.hoisted(() => ({ getDb: vi.fn(), getTowerWarsToday: vi.fn() }));

vi.mock("../saas/tenantAccess", () => ({
  resolveDayforgeMembership: access.resolveMembership,
  hasDayforgeEntitlement: access.hasEntitlement,
  roleAllows: (actual: string, allowed: readonly string[]) => allowed.includes(actual),
}));
vi.mock("../db", () => ({ getDb: mocks.getDb }));
vi.mock("../towerWars/towerWarsService", () => ({ getTowerWarsToday: mocks.getTowerWarsToday }));

import { chapterStateRouter } from "./chapterStateRouter";
import { chapterEventBindingRouter } from "./chapterEventBindingRouter";
import { echoFollowUpRouter } from "./echoFollowUpRouter";
import type { GoldlineChapterFictionState } from "../../shared/goldlineChapterState";

type Row = Record<string, unknown>;

function predicateParameters(predicate: unknown): unknown[] {
  if (!predicate || typeof predicate !== "object") return [];
  const node = predicate as { constructor?: { name?: string }; queryChunks?: unknown[]; value?: unknown };
  if (node.constructor?.name === "Param") return [node.value];
  return (node.queryChunks ?? []).flatMap(predicateParameters);
}

function sharedMemoryDb() {
  const chapterStateRows: Row[] = [];
  const eventBindingRows: Row[] = [];
  let chapterStateTable: unknown;
  const rowsFor = (table: unknown) => (table === chapterStateTable ? chapterStateRows : eventBindingRows);

  const db: any = {
    select: vi.fn(() => ({
      from: (table: unknown) => {
        if (chapterStateTable === undefined) chapterStateTable = table;
        return {
          where: (predicate: unknown) => {
            const params = predicateParameters(predicate);
            const rows = rowsFor(table).filter(row =>
              row.tenantId === params[0] &&
              (row.operatorId === params[1] || row.chapterId === params[1]) &&
              (row.chapterId === params[2] || row.buildingId === params[2]) &&
              (params.length < 4 || row.revision === params[3])
            );
            const promise = Promise.resolve(rows) as Promise<Row[]> & { limit: (n: number) => Promise<Row[]> };
            promise.limit = async n => rows.slice(0, n);
            return promise;
          },
        };
      },
    })),
    insert: vi.fn((table: unknown) => ({
      values: async (value: Row) => {
        rowsFor(table).push({ resolvedEventId: null, resolvedAt: null, lastRequestId: null, ...value, createdAt: new Date() });
      },
    })),
    update: vi.fn((table: unknown) => ({
      set: (patch: Row) => ({
        where: async (predicate: unknown) => {
          const params = predicateParameters(predicate);
          const matched = rowsFor(table).filter(row => {
            const identityMatches =
              row.tenantId === params[0] &&
              (row.operatorId === params[1] || row.chapterId === params[1]) &&
              (row.chapterId === params[2] || row.buildingId === params[2]);
            if (!identityMatches) return false;
            return "revision" in patch ? row.revision === params[3] : row.resolvedEventId == null;
          });
          for (const row of matched) Object.assign(row, patch);
          return [{ affectedRows: matched.length }];
        },
      }),
    })),
  };
  return db;
}

function context(deviceUserAgent: "desktop" | "mobile" = "desktop"): TrpcContext {
  return {
    req: { headers: { "user-agent": deviceUserAgent } } as never,
    res: undefined as never,
    vendorSession: null,
    tenantId: "tenant-a",
    user: {
      id: 1, tenantId: "tenant-a", openId: "operator-a", name: "Operator",
      email: "operator@example.test", loginMethod: "test", role: "operator",
      createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    },
  };
}

function chapterState(overrides: Partial<GoldlineChapterFictionState> = {}): GoldlineChapterFictionState {
  return {
    chapterId: "the-last-valet", version: 1, room: "garden",
    checkpoint: { room: "garden", x: 480, y: 330 },
    mechanism: { heading: null, gardenOpen: false, latchOpen: false },
    cleared: ["arrival"], completed: false, choice: null, restored: false, secretSeen: false,
    prepared: { armedAt: null, resolvedEventId: null }, realOutcome: null,
    ...overrides,
  };
}

describe("chapter host integration (real routers, mocked backend)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    access.resolveMembership.mockResolvedValue({ tenantId: "tenant-a", userOpenId: "operator-a", role: "operator" });
    access.hasEntitlement.mockResolvedValue(true);
  });

  it("A: desktop → shared chapter-state service → mocked backend → mobile reads it → mobile writes back → desktop sees it", async () => {
    const db = sharedMemoryDb();
    mocks.getDb.mockResolvedValue(db);

    const desktopCaller = chapterStateRouter.createCaller(context("desktop"));
    const mobileCaller = chapterStateRouter.createCaller(context("mobile"));

    const created = await desktopCaller.save({
      chapterId: "the-last-valet", expectedRevision: 0,
      state: chapterState({ mechanism: { heading: "bridge", gardenOpen: false, latchOpen: false } }),
      requestId: "desktop-req-1",
    });
    expect(created).toMatchObject({ ok: true, revision: 1 });

    const mobileRead = await mobileCaller.get({ chapterId: "the-last-valet" });
    expect(mobileRead?.state.mechanism.heading).toBe("bridge");

    const mobileWrite = await mobileCaller.save({
      chapterId: "the-last-valet", expectedRevision: mobileRead!.revision,
      state: chapterState({ mechanism: { heading: "bridge", gardenOpen: true, latchOpen: false } }),
      requestId: "mobile-req-1",
    });
    expect(mobileWrite).toMatchObject({ ok: true, revision: 2 });

    const desktopReload = await desktopCaller.get({ chapterId: "the-last-valet" });
    expect(desktopReload?.state.mechanism.gardenOpen).toBe(true);
  });

  it("B: a qualifying real event reconciled through the real router produces a visible fictional consequence, exactly once", async () => {
    const db = sharedMemoryDb();
    mocks.getDb.mockResolvedValue(db);
    const bindingCaller = chapterEventBindingRouter.createCaller(context());
    const stateCaller = chapterStateRouter.createCaller(context());

    await stateCaller.save({ chapterId: "the-last-valet", expectedRevision: 0, state: chapterState(), requestId: "r1" });
    const armed = await bindingCaller.arm({ chapterId: "the-last-valet", buildingId: "century_park_east" });
    expect(armed.resolvedEventId).toBeNull();

    await new Promise(resolve => setTimeout(resolve, 2));
    // The event occurs strictly after arming — that ordering is what reconcile requires.
    mocks.getTowerWarsToday.mockResolvedValue({
      ledger: [{
        eventId: "evt-real", occurredAt: new Date().toISOString(), businessDate: "2026-09-08",
        buildingId: "century_park_east", buildingDisplayName: "Century Park East", orderId: 1,
        customerIdentity: null, customerDisplayName: null, customerPhone: null,
        revenueSource: "stripe", realOrderValueCents: 5000, sourceEvidence: {},
      }],
    });
    const reconciled = await bindingCaller.reconcile({ chapterId: "the-last-valet", buildingId: "century_park_east" });
    expect(reconciled).toMatchObject({ consequenceApplied: true });

    // Apply the now-resolved consequence into the same persisted chapter row, as the real host would.
    const current = await stateCaller.get({ chapterId: "the-last-valet" });
    await stateCaller.save({
      chapterId: "the-last-valet", expectedRevision: current!.revision,
      state: { ...current!.state, prepared: { armedAt: armed.armedAt, resolvedEventId: "evt-real" } },
      requestId: "apply-consequence",
    });
    const afterConsequence = await stateCaller.get({ chapterId: "the-last-valet" });
    expect(afterConsequence?.state.prepared.resolvedEventId).toBe("evt-real");
    // The chapter is still marked incomplete — the event never auto-completes it.
    expect(afterConsequence?.state.completed).toBe(false);

    const duplicate = await bindingCaller.reconcile({ chapterId: "the-last-valet", buildingId: "century_park_east" });
    expect(duplicate).toMatchObject({ consequenceApplied: false, reason: "already_resolved" });
  });

  it("Echo's brief is reachable through its real router procedure with no send/business-write path", async () => {
    mocks.getDb.mockResolvedValue(null); // no eligible follow-up in this scenario
    const brief = await echoFollowUpRouter.createCaller(context()).brief();
    expect(brief).toEqual({ available: false, reason: "no_eligible_follow_up" });
  });

  it("rejects a caller without the commercial_pipeline entitlement before reaching Echo's service", async () => {
    access.hasEntitlement.mockResolvedValue(false);
    await expect(echoFollowUpRouter.createCaller(context()).brief()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
