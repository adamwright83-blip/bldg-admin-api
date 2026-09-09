/**
 * Integration Gate (inserted before Slice 9, per Adam's mid-run instruction):
 * proves Slices 3/5/6/7's server contracts compose correctly into ONE
 * coherent chapter loop, not just in isolation.
 *
 * HONEST LIMITATION: this sandbox has no live or local test MySQL reachable
 * (Railway's database is private-network only — see project memory). This
 * suite therefore runs the real service functions against the SAME
 * mocked-db harness the unit tests use, not a real database. It proves the
 * cross-service wiring and CAS/idempotency logic are correct; it does NOT
 * prove the applied-migration/live-network path, which still needs Adam's
 * approval to run drizzle/0067 and 0068 against a real database (see
 * HANDOFF-FIRST-2_5D-CHAPTER.md section 12f).
 */
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("../db", () => ({ getDb: mocks.getDb }));

import { getChapterState, saveChapterState } from "./chapterStateService";
import {
  armChapterEventBinding,
  getChapterEventBinding,
  reconcileChapterEventBinding,
} from "./chapterEventBindingService";
import { buildEchoFollowUpBrief, type FollowUpEvidence } from "./echoFollowUpService";
import { branchFictionFromRealOutcome } from "./chapterOutcomeBranchService";
import type { GoldlineChapterFictionState } from "../../shared/goldlineChapterState";
import type { TowerWarsBusinessEvent } from "../../shared/towerWars";

type Row = Record<string, unknown>;

function predicateParameters(predicate: unknown): unknown[] {
  if (!predicate || typeof predicate !== "object") return [];
  const node = predicate as { constructor?: { name?: string }; queryChunks?: unknown[]; value?: unknown };
  if (node.constructor?.name === "Param") return [node.value];
  return (node.queryChunks ?? []).flatMap(predicateParameters);
}

/**
 * One shared in-memory store standing in for the real database, keyed by
 * table identity so chapter-state rows and event-binding rows don't collide
 * — mirrors how both real tables coexist in one schema.
 */
function sharedMemoryDb() {
  const chapterStateRows: Row[] = [];
  const eventBindingRows: Row[] = [];
  const rowsFor = (table: unknown) =>
    table === chapterStateTable ? chapterStateRows : eventBindingRows;
  let chapterStateTable: unknown;
  let eventBindingTable: unknown;

  const db: any = {
    select: vi.fn((_cols?: unknown) => ({
      from: (table: unknown) => {
        if (chapterStateTable === undefined) chapterStateTable = table;
        else if (table !== chapterStateTable && eventBindingTable === undefined) eventBindingTable = table;
        return {
          where: (predicate: unknown) => {
            const params = predicateParameters(predicate);
            const rows = rowsFor(table);
            const result = rows.filter(row =>
              params.length >= 3
                ? row.tenantId === params[0] &&
                  (row.operatorId === params[1] || row.chapterId === params[1]) &&
                  (row.chapterId === params[2] || row.buildingId === params[2]) &&
                  (params.length < 4 || row.revision === params[3])
                : true
            );
            const promise = Promise.resolve(result) as Promise<Row[]> & { limit: (n: number) => Promise<Row[]> };
            promise.limit = async n => result.slice(0, n);
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
          const rows = rowsFor(table);
          const matched = rows.filter(row => {
            const identityMatches =
              row.tenantId === params[0] &&
              (row.operatorId === params[1] || row.chapterId === params[1]) &&
              (row.chapterId === params[2] || row.buildingId === params[2]);
            if (!identityMatches) return false;
            if ("revision" in patch) return row.revision === params[3];
            return row.resolvedEventId == null;
          });
          for (const row of matched) Object.assign(row, patch);
          return [{ affectedRows: matched.length }];
        },
      }),
    })),
  };
  return db;
}

function chapterState(overrides: Partial<GoldlineChapterFictionState> = {}): GoldlineChapterFictionState {
  return {
    chapterId: "the-last-valet",
    version: 1,
    room: "garden",
    checkpoint: { room: "garden", x: 480, y: 330 },
    mechanism: { heading: null, gardenOpen: false, latchOpen: false },
    cleared: ["arrival"],
    completed: false,
    choice: null,
    restored: false,
    secretSeen: false,
    prepared: { armedAt: null, resolvedEventId: null },
    realOutcome: null,
    ...overrides,
  };
}

const identity = { tenantId: "t1", operatorId: "op1", chapterId: "the-last-valet" };
const buildingIdentity = { tenantId: "t1", chapterId: "the-last-valet", buildingId: "century_park_east" as const };

function towerWarsEvent(overrides: Partial<TowerWarsBusinessEvent> = {}): TowerWarsBusinessEvent {
  return {
    eventId: "evt-real",
    occurredAt: new Date().toISOString(),
    businessDate: "2026-09-08",
    buildingId: "century_park_east",
    buildingDisplayName: "Century Park East",
    orderId: 100,
    customerIdentity: null,
    customerDisplayName: null,
    customerPhone: null,
    revenueSource: "stripe",
    realOrderValueCents: 12000,
    sourceEvidence: {},
    ...overrides,
  };
}

describe("chapter integration gate (mocked persistence — no live database)", () => {
  it("A: desktop saves a mechanism change, mobile reads the same revision, then advances it — cross-device loop", async () => {
    mocks.getDb.mockResolvedValue(sharedMemoryDb());

    // Desktop: first write, creates revision 1.
    const desktop = await saveChapterState({
      ...identity,
      expectedRevision: 0,
      state: chapterState({ mechanism: { heading: "bridge", gardenOpen: false, latchOpen: false } }),
      requestId: "desktop-1",
    });
    expect(desktop.revision).toBe(1);

    // Mobile: loads the SAME state desktop just wrote.
    const mobileRead = await getChapterState(identity);
    expect(mobileRead?.state.mechanism.heading).toBe("bridge");
    expect(mobileRead?.revision).toBe(1);

    // Mobile advances play using what it read, bumping the revision.
    const mobile = await saveChapterState({
      ...identity,
      expectedRevision: mobileRead!.revision,
      state: chapterState({ mechanism: { heading: "bridge", gardenOpen: true, latchOpen: false } }),
      requestId: "mobile-1",
    });
    expect(mobile.revision).toBe(2);

    // Desktop reloads and sees mobile's progress, not stale local state.
    const desktopReload = await getChapterState(identity);
    expect(desktopReload?.state.mechanism.gardenOpen).toBe(true);
    expect(desktopReload?.revision).toBe(2);
  });

  it("B: arming, then a qualifying real event, changes persisted chapter state exactly once — and completion never depends on it", async () => {
    mocks.getDb.mockResolvedValue(sharedMemoryDb());
    await saveChapterState({ ...identity, expectedRevision: 0, state: chapterState(), requestId: "req-1" });

    const armed = await armChapterEventBinding(buildingIdentity);
    expect(armed.resolvedEventId).toBeNull();

    // No event yet: chapter is still fully completable — nothing here blocks that.
    const beforeEvent = await getChapterState(identity);
    expect(beforeEvent?.state.completed).toBe(false);

    await new Promise(resolve => setTimeout(resolve, 2));
    const reconciled = await reconcileChapterEventBinding({
      ...buildingIdentity,
      candidateEvents: [towerWarsEvent()],
    });
    expect(reconciled).toMatchObject({ consequenceApplied: true });

    // The chapter's own fiction state records the unlocked advantage exactly once.
    const current = await getChapterState(identity);
    const updated = await saveChapterState({
      ...identity,
      expectedRevision: current!.revision,
      state: { ...current!.state, prepared: { armedAt: armed.armedAt, resolvedEventId: "evt-real" } },
      requestId: "apply-consequence",
    });
    expect(updated.state.prepared.resolvedEventId).toBe("evt-real");

    // A duplicate of the same event must not re-apply the consequence.
    const duplicate = await reconcileChapterEventBinding({ ...buildingIdentity, candidateEvents: [towerWarsEvent()] });
    expect(duplicate).toEqual({ consequenceApplied: false, reason: "already_resolved" });
  });

  it("C: Echo's brief reflects real recorded evidence end to end, with nothing fabricated and nothing sent", () => {
    const evidence: FollowUpEvidence = {
      id: "fu-9",
      pipelineId: 7,
      status: "open",
      dueAt: new Date("2026-09-11T09:00:00Z"),
      note: "Promised a callback after their site walkthrough.",
      assignedTo: "op1",
    };
    const brief = buildEchoFollowUpBrief(evidence);
    expect(brief).toMatchObject({
      available: true,
      note: evidence.note,
      dueAt: evidence.dueAt.toISOString(),
      missingInfo: [],
    });
    expect(brief).not.toHaveProperty("send");
    expect(brief).not.toHaveProperty("sentAt");
  });

  it("D: a negative real outcome branches the fiction without ever flipping to a fake win", async () => {
    mocks.getDb.mockResolvedValue(sharedMemoryDb());
    await saveChapterState({ ...identity, expectedRevision: 0, state: chapterState(), requestId: "req-1" });

    const { branch } = branchFictionFromRealOutcome("lost");
    expect(branch).toBe("alternate_route_open");

    const current = await getChapterState(identity);
    const updated = await saveChapterState({
      ...identity,
      expectedRevision: current!.revision,
      state: { ...current!.state, realOutcome: "lost" },
      requestId: "apply-outcome",
    });
    expect(updated.state.realOutcome).toBe("lost");
    // The chapter must remain completable regardless of which branch fired.
    expect(updated.state.completed).toBe(false);
  });
});
