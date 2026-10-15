import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  LOST_PROPERTY_OBJECTIVES_PER_CHAPTER,
  type CompletedUnit,
  type FirstVerifiedSale,
} from "../../../shared/lostPropertyUnlock";
import {
  admittedOrdersFromLedger,
  indexPaidEventIdentity,
  readLostPropertyUnlock,
  type LostPropertyScope,
  type LostPropertyUnlockDeps,
} from "./lostPropertyUnlockRead";

const scope: LostPropertyScope = {
  tenantId: "tenant-a",
  canonicalOperatorId: "op-1",
  actorIds: ["actor-7"],
  operatorOpenIds: ["open-1"],
};

const sale: FirstVerifiedSale = {
  territoryId: "koreatown",
  occurredAt: "2026-10-01T18:00:00.000Z",
  eventKey: "order:1",
};

const unit = (key: string, day: number): CompletedUnit => ({
  key,
  completedAt: `2026-10-${String(day).padStart(2, "0")}T12:00:00.000Z`,
});

function deps(init?: {
  sale?: FirstVerifiedSale | null;
  units?: CompletedUnit[];
  env?: LostPropertyUnlockDeps["env"];
}): LostPropertyUnlockDeps & {
  readFirstSale: ReturnType<typeof vi.fn>;
  readCompletedUnits: ReturnType<typeof vi.fn>;
} {
  return {
    readFirstSale: vi.fn(async () => (init?.sale === undefined ? null : init.sale)),
    readCompletedUnits: vi.fn(async () => init?.units ?? []),
    env: init?.env ?? {},
  };
}

describe("readLostPropertyUnlock", () => {
  it("requires a tenant and an operator and does not substitute either", async () => {
    const harness = deps();
    await expect(readLostPropertyUnlock({ ...scope, tenantId: "  " }, harness)).rejects.toThrow(/tenantId/);
    await expect(readLostPropertyUnlock({ ...scope, canonicalOperatorId: "" }, harness)).rejects.toThrow(
      /canonicalOperatorId/
    );
    expect(harness.readFirstSale).not.toHaveBeenCalled();
    expect(harness.readCompletedUnits).not.toHaveBeenCalled();
  });

  it("passes only the requested tenant into the sale read", async () => {
    const harness = deps();
    const read = await readLostPropertyUnlock(scope, harness);
    expect(harness.readFirstSale).toHaveBeenCalledWith("tenant-a");
    expect(harness.readCompletedUnits).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "tenant-a" }));
    expect(read.unlockedChapters).toBe(0);
    expect(read.preview).toBe(false);
  });

  it("a verified sale unlocks Chapter 1, three Objectives unlock Chapter 2, and three more unlock Chapter 3", async () => {
    const harness = deps({ sale, units: [unit("a", 2), unit("b", 3)] });
    expect((await readLostPropertyUnlock(scope, harness)).unlockedChapters).toBe(1);
    harness.readCompletedUnits.mockResolvedValue([unit("a", 2), unit("b", 3), unit("c", 4)]);
    const chapter2 = await readLostPropertyUnlock(scope, harness);
    expect(chapter2.unlockedChapters).toBe(2);
    expect(chapter2.chapters[1]).toEqual({ chapter: 2, openedAt: "2026-10-04T12:00:00.000Z" });
    expect(chapter2.objectivesRemaining).toBe(LOST_PROPERTY_OBJECTIVES_PER_CHAPTER);
    harness.readCompletedUnits.mockResolvedValue([
      unit("a", 2),
      unit("b", 3),
      unit("c", 4),
      unit("d", 5),
      unit("e", 6),
      unit("f", 7),
    ]);
    const chapter3 = await readLostPropertyUnlock(scope, harness);
    expect(chapter3.unlockedChapters).toBe(3);
    expect(chapter3.chapters.map(chapter => chapter.chapter)).toEqual([1, 2, 3]);
    expect(chapter3.nextChapter).toBeNull();
  });

  it("replayed units do not advance a chapter twice", async () => {
    const once = [unit("a", 2), unit("b", 3), unit("c", 4)];
    const harness = deps({ sale, units: [...once, ...once, unit("a", 9)] });
    const read = await readLostPropertyUnlock(scope, harness);
    expect(read.unlockedChapters).toBe(2);
    expect(read.chapters[1]?.openedAt).toBe("2026-10-04T12:00:00.000Z");
  });

  it("preview answers before any ledger read and writes nothing", async () => {
    const harness = deps({
      env: { openIds: "open-1, open-2", tenantId: "tenant-a" },
    });
    harness.readFirstSale.mockRejectedValue(new Error("must not read"));
    harness.readCompletedUnits.mockRejectedValue(new Error("must not read"));
    const read = await readLostPropertyUnlock(scope, harness);
    expect(read.preview).toBe(true);
    expect(read.unlockedChapters).toBe(3);
    expect(read.chapters).toEqual([]);
    expect(read.firstSaleOccurredAt).toBeNull();
    expect(harness.readFirstSale).not.toHaveBeenCalled();
    expect(harness.readCompletedUnits).not.toHaveBeenCalled();
  });

  it("preview stays off unless both env values match this operator's tenant", async () => {
    const missingOpenIds = deps({ env: { tenantId: "tenant-a" }, sale });
    expect((await readLostPropertyUnlock(scope, missingOpenIds)).preview).toBe(false);
    expect(missingOpenIds.readFirstSale).toHaveBeenCalled();

    const otherTenant = deps({ env: { openIds: "open-1", tenantId: "tenant-b" }, sale: null });
    const read = await readLostPropertyUnlock(scope, otherTenant);
    expect(read.preview).toBe(false);
    expect(read.unlockedChapters).toBe(0);
    expect(otherTenant.readFirstSale).toHaveBeenCalledWith("tenant-a");
  });

  it("a failing ledger read rejects and has no unlock writer", async () => {
    const harness = deps();
    harness.readFirstSale.mockRejectedValue(new Error("sale ledger down"));
    await expect(readLostPropertyUnlock(scope, harness)).rejects.toThrow("sale ledger down");
    expect(readLostPropertyUnlock).not.toHaveProperty("recordUnlock");
  });
});

describe("paid-order identity join", () => {
  it("maps native and CleanCloud orders once and drops an ambiguous identity", () => {
    const indexed = indexPaidEventIdentity(
      new Map([
        ["hash-a", [{ source: "laundry_butler", sourceOrderId: "9" }]],
        ["hash-b", [{ source: "cleancloud", sourceOrderId: "77" }]],
        ["hash-c", [{ source: "laundry_butler", sourceOrderId: "9" }]],
      ])
    );
    expect(indexed.get("order:9")).toBe("ambiguous");
    expect(indexed.get("cleancloud:77")).toBe("hash-b");
    const orders = admittedOrdersFromLedger({
      tenantId: "tenant-a",
      identityByEventKey: indexed,
      events: [
        {
          eventKey: "order:9",
          occurredAt: new Date("2026-10-02T18:00:00.000Z"),
          ingestedAt: new Date("2026-10-15T00:00:00.000Z"),
          cents: 1800,
        },
        {
          eventKey: "cleancloud:77",
          occurredAt: new Date("2026-10-01T18:00:00.000Z"),
          ingestedAt: new Date("2026-10-20T00:00:00.000Z"),
          cents: 2500,
        },
      ],
    });
    expect(orders.find(row => row.eventKey === "order:9")?.customerIdentityKey).toBeNull();
    expect(orders.find(row => row.eventKey === "cleancloud:77")).toMatchObject({
      occurredAt: "2026-10-01T18:00:00.000Z",
      ingestedAt: "2026-10-20T00:00:00.000Z",
      customerIdentityKey: "hash-b",
    });
  });
});

describe("unlock reader source", () => {
  const source = readFileSync(new URL("./lostPropertyUnlockRead.ts", import.meta.url), "utf8");

  it("does not write business rows, unlock rows, or campaign-run counts", () => {
    expect(source).not.toMatch(/\.insert\(/);
    expect(source).not.toMatch(/\.update\(/);
    expect(source).not.toMatch(/\.delete\(/);
    expect(source).not.toContain("goldlineCampaignRuns");
    expect(source).not.toContain("hiddenGameChapterUnlocks");
    expect(source).not.toContain("cozyVillager");
    expect(source).toContain("loadPaidOrderLedger");
    expect(source).toContain("ledger.events");
    expect(source).not.toContain("unverifiedNative");
  });
});
