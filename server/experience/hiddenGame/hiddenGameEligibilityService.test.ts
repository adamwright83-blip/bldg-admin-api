import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  OBJECTIVES_PER_CHAPTER,
  dedupeUnits,
  isPreviewOperator,
  resolveChapters,
  type CompletedUnit,
  type FirstVerifiedSale,
  type UnlockRecord,
} from "../../../shared/hiddenGameEligibility";
import {
  readHiddenGameEligibility,
  type HiddenGameEligibilityDeps,
  type HiddenGameScope,
} from "./hiddenGameEligibilityService";

const scope: HiddenGameScope = {
  tenantId: "tenant-a",
  canonicalOperatorId: "op-1",
  operatorId: "7",
  operatorUserIds: ["open-1"],
};

const SALE: FirstVerifiedSale = { territoryId: "hollywood", occurredAt: "2026-10-01T18:00:00.000Z" };
const unit = (key: string, completedAt: string): CompletedUnit => ({ key, completedAt });
const at = (day: number, hour = 12) =>
  `2026-10-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00.000Z`;

/** In-memory harness with the same uniqueness the real table enforces. */
function harness(init: { sale?: FirstVerifiedSale | null; units?: CompletedUnit[]; ledger?: UnlockRecord[] } = {}) {
  const state = {
    sale: init.sale === undefined ? null : init.sale,
    units: init.units ?? [],
    ledger: [...(init.ledger ?? [])],
  };
  const deps: HiddenGameEligibilityDeps = {
    readFirstSale: vi.fn(async () => state.sale),
    readCompletedUnits: vi.fn(async () => state.units),
    listUnlocks: vi.fn(async () => state.ledger.map(row => ({ ...row }))),
    recordUnlock: vi.fn(async (_s, row) => {
      if (state.ledger.some(r => r.chapter === row.chapter)) return;
      state.ledger.push({ chapter: row.chapter, openedAt: row.openedAt, unlockedOnLocalDate: row.unlockedOnLocalDate });
    }),
    env: {},
  };
  return { state, deps };
}

describe("Chapter 1: the first verified sale", () => {
  it("no sale: locked, next step is a sale, nothing recorded", async () => {
    const h = harness({ units: [unit("a", at(2)), unit("b", at(3)), unit("c", at(4))] });
    const out = await readHiddenGameEligibility(scope, h.deps);
    expect(out).toMatchObject({
      unlockedChapters: 0,
      nextChapter: 1,
      nextUnlockRequirement: "first_verified_sale",
      objectivesRemaining: null,
      preview: false,
    });
    expect(h.deps.recordUnlock).not.toHaveBeenCalled();
  });

  it("objectives alone never open Chapter 1", () => {
    const resolved = resolveChapters({
      firstSale: null,
      units: Array.from({ length: 20 }, (_, i) => unit(`u${i}`, at(2, i))),
      persisted: [],
    });
    expect(resolved).toEqual([]);
  });

  it("a verified sale opens Chapter 1 the same read, with no Objectives required", async () => {
    const h = harness({ sale: SALE });
    const out = await readHiddenGameEligibility(scope, h.deps);
    expect(out.unlockedChapters).toBe(1);
    expect(out.firstSaleTerritoryId).toBe("hollywood");
    expect(out.nextChapter).toBe(2);
    expect(out.objectivesRemaining).toBe(OBJECTIVES_PER_CHAPTER);
    expect(h.state.ledger).toHaveLength(1);
    expect(h.state.ledger[0]).toMatchObject({ chapter: 1, openedAt: SALE.occurredAt });
  });
});

describe("Chapters 2 and 3: completed Objectives", () => {
  it("counts only Objectives completed AFTER the previous chapter opened", async () => {
    const h = harness({
      sale: SALE,
      units: [unit("old1", at(1, 9)), unit("old2", "2026-09-30T00:00:00.000Z"), unit("n1", at(2))],
    });
    const out = await readHiddenGameEligibility(scope, h.deps);
    expect(out.unlockedChapters).toBe(1);
    expect(out.objectivesRemaining).toBe(2);
  });

  it("2 of 3 keeps Chapter 2 shut; the 3rd opens it", async () => {
    const h = harness({ sale: SALE, units: [unit("a", at(2)), unit("b", at(3))] });
    expect((await readHiddenGameEligibility(scope, h.deps)).unlockedChapters).toBe(1);
    h.state.units.push(unit("c", at(4)));
    const out = await readHiddenGameEligibility(scope, h.deps);
    expect(out.unlockedChapters).toBe(2);
    expect(h.state.ledger.find(r => r.chapter === 2)?.openedAt).toBe(at(4));
  });

  it("Chapter 3 counts from the moment Chapter 2 opened, not from the sale", async () => {
    const h = harness({
      sale: SALE,
      units: [unit("a", at(2)), unit("b", at(3)), unit("c", at(4)), unit("d", at(5)), unit("e", at(6))],
    });
    const out = await readHiddenGameEligibility(scope, h.deps);
    expect(out.unlockedChapters).toBe(2);
    expect(out.objectivesRemaining).toBe(1);
    h.state.units.push(unit("f", at(7)));
    const full = await readHiddenGameEligibility(scope, h.deps);
    expect(full.unlockedChapters).toBe(3);
    expect(full.nextUnlockRequirement).toBe("all_unlocked");
    expect(full.nextChapter).toBeNull();
  });

  it("a backlog opens each chapter in order on one read, never past Chapter 3", async () => {
    const units = Array.from({ length: 30 }, (_, i) => unit(`u${i}`, at(2 + (i % 20), i % 24)));
    const h = harness({ sale: SALE, units });
    const out = await readHiddenGameEligibility(scope, h.deps);
    expect(out.unlockedChapters).toBe(3);
    expect(h.state.ledger.map(r => r.chapter).sort()).toEqual([1, 2, 3]);
  });

  it("the same underlying work counted by two ledgers is one Objective", () => {
    const deduped = dedupeUnits([
      unit("commitment:x", at(3, 10)),
      unit("commitment:x", at(3, 11)),
      unit("campaign_run:y", at(4)),
    ]);
    expect(deduped).toHaveLength(2);
    expect(deduped[0]).toMatchObject({ key: "commitment:x", completedAt: at(3, 10) });
  });

  it("does not depend on when the game is opened", async () => {
    const h = harness({ sale: SALE, units: [unit("a", at(2)), unit("b", at(3)), unit("c", at(4))] });
    // First read happens much later; the answer is the same and anchored to the ledger.
    const out = await readHiddenGameEligibility(scope, h.deps);
    expect(out.unlockedChapters).toBe(2);
    expect(h.state.ledger.find(r => r.chapter === 2)?.openedAt).toBe(at(4));
  });

  it("an optional floor ignores Objectives completed before it", async () => {
    const h = harness({ sale: SALE, units: [unit("a", at(2)), unit("b", at(3)), unit("c", at(4))] });
    h.deps.env = { countFrom: at(3, 13) };
    const out = await readHiddenGameEligibility(scope, h.deps);
    expect(out.unlockedChapters).toBe(1);
    expect(out.objectivesRemaining).toBe(2);
  });
});

describe("permanence and idempotency", () => {
  it("re-reading never records twice", async () => {
    const h = harness({ sale: SALE, units: [unit("a", at(2)), unit("b", at(3)), unit("c", at(4))] });
    await readHiddenGameEligibility(scope, h.deps);
    await readHiddenGameEligibility(scope, h.deps);
    await readHiddenGameEligibility(scope, h.deps);
    expect(h.state.ledger).toHaveLength(2);
    expect(h.deps.recordUnlock).toHaveBeenCalledTimes(2);
  });

  it("a chapter never re-locks when the ledgers stop supporting it", async () => {
    const h = harness({ sale: SALE, units: [unit("a", at(2)), unit("b", at(3)), unit("c", at(4))] });
    await readHiddenGameEligibility(scope, h.deps);
    h.state.units = [];
    h.state.sale = null;
    const out = await readHiddenGameEligibility(scope, h.deps);
    expect(out.unlockedChapters).toBe(2);
  });

  it("a permanent Chapter 2 anchors the count for Chapter 3 even if its Objectives vanish", async () => {
    const h = harness({
      sale: null,
      ledger: [
        { chapter: 1, openedAt: SALE.occurredAt, unlockedOnLocalDate: "2026-10-01" },
        { chapter: 2, openedAt: at(4), unlockedOnLocalDate: "2026-10-04" },
      ],
      units: [unit("x", at(5)), unit("y", at(6)), unit("z", at(7))],
    });
    const out = await readHiddenGameEligibility(scope, h.deps);
    expect(out.unlockedChapters).toBe(3);
  });

  it("a failing ledger read surfaces as an error and records nothing", async () => {
    const h = harness({ sale: SALE });
    (h.deps.readCompletedUnits as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("db down"));
    await expect(readHiddenGameEligibility(scope, h.deps)).rejects.toThrow("db down");
    expect(h.deps.recordUnlock).not.toHaveBeenCalled();
    expect(h.state.ledger).toHaveLength(0);
  });

  it("Chapter 4 never opens", async () => {
    const units = Array.from({ length: 200 }, (_, i) => unit(`u${i}`, at(2 + (i % 25), i % 24)));
    const h = harness({ sale: SALE, units });
    const out = await readHiddenGameEligibility(scope, h.deps);
    expect(out.unlockedChapters).toBe(3);
    expect(h.state.ledger.some(r => r.chapter > 3)).toBe(false);
  });
});

describe("developer preview", () => {
  const ownerEnv = { openIds: "open-1, open-9", tenantId: "tenant-a" };

  it("owner sees all chapters and nothing is read or written", async () => {
    const h = harness();
    h.deps.env = ownerEnv;
    const out = await readHiddenGameEligibility(scope, h.deps);
    expect(out).toMatchObject({ unlockedChapters: 3, preview: true, nextUnlockRequirement: "all_unlocked" });
    expect(h.deps.readFirstSale).not.toHaveBeenCalled();
    expect(h.deps.readCompletedUnits).not.toHaveBeenCalled();
    expect(h.deps.listUnlocks).not.toHaveBeenCalled();
    expect(h.deps.recordUnlock).not.toHaveBeenCalled();
  });

  it("is off unless BOTH env values are set", () => {
    const base = { tenantId: "tenant-a", canonicalOpenIds: ["open-1"] };
    expect(isPreviewOperator({ ...base, envOpenIds: "open-1", envTenantId: undefined })).toBe(false);
    expect(isPreviewOperator({ ...base, envOpenIds: undefined, envTenantId: "tenant-a" })).toBe(false);
    expect(isPreviewOperator({ ...base, envOpenIds: "", envTenantId: "tenant-a" })).toBe(false);
    expect(isPreviewOperator({ ...base, envOpenIds: "open-1", envTenantId: "tenant-a" })).toBe(true);
  });

  it("another user in the same tenant gets the normal rules", async () => {
    const h = harness();
    h.deps.env = ownerEnv;
    const out = await readHiddenGameEligibility({ ...scope, operatorUserIds: ["someone-else"] }, h.deps);
    expect(out.preview).toBe(false);
    expect(out.unlockedChapters).toBe(0);
  });

  it("the owner in a different tenant gets the normal rules", async () => {
    const h = harness();
    h.deps.env = ownerEnv;
    const out = await readHiddenGameEligibility({ ...scope, tenantId: "tenant-b" }, h.deps);
    expect(out.preview).toBe(false);
  });
});

describe("scope and structure", () => {
  it("missing tenant or operator throws instead of defaulting", async () => {
    const h = harness();
    await expect(readHiddenGameEligibility({ ...scope, tenantId: "  " }, h.deps)).rejects.toThrow(/tenantId/);
    await expect(readHiddenGameEligibility({ ...scope, canonicalOperatorId: "" }, h.deps)).rejects.toThrow(
      /canonicalOperatorId/
    );
    expect(h.deps.readFirstSale).not.toHaveBeenCalled();
  });

  it("passes the caller's tenant to every reader", async () => {
    const h = harness({ sale: SALE });
    await readHiddenGameEligibility({ ...scope, tenantId: "tenant-z" }, h.deps);
    for (const fn of [h.deps.readFirstSale, h.deps.readCompletedUnits, h.deps.listUnlocks]) {
      expect(fn).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "tenant-z" }));
    }
  });

  it("the service and router never import a business-write path", () => {
    for (const file of ["hiddenGameEligibilityService.ts", "hiddenGameEligibilityRouter.ts"]) {
      const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
      expect(source).not.toMatch(/completeDayDirectorCommitment|bridgeDriverAction|transitionObjectiveStatus/);
      expect(source).not.toMatch(/COALESCE\(/i);
      expect(source).not.toMatch(/\.update\(|\.delete\(/);
    }
  });

  it("the router exposes a query and no mutation", () => {
    const source = readFileSync(new URL("./hiddenGameEligibilityRouter.ts", import.meta.url), "utf8");
    expect(source).toMatch(/\.query\(/);
    expect(source).not.toMatch(/\.mutation\(/);
  });

  it("the unlock table keeps one row per chapter and no per-day limit", () => {
    const sql = readFileSync(new URL("../../../drizzle/0128_hidden_game_chapter_unlocks.sql", import.meta.url), "utf8");
    expect(sql).toMatch(/uq_hidden_game_unlock_chapter/);
    expect(sql).not.toMatch(/uq_hidden_game_unlock_date/);
  });
});
