import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { projectCurrentDayLine, type CurrentDayLine } from "../../../shared/currentDayLine";
import {
  chapterToUnlock,
  evaluateDayCompletion,
  type ItemCompletion,
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
};

function line(date: string, ids: string[], rankingStatus: CurrentDayLine["rankingStatus"] = "ranked") {
  return projectCurrentDayLine({
    businessDate: date,
    rankingStatus,
    rankedWorks: ids.map(id => ({ id, title: id, executionType: "mission" as const })),
    designated: null,
  });
}

/** In-memory ledger with the same uniqueness the real table enforces. */
function harness(initial: UnlockRecord[] = []) {
  const ledger = [...initial];
  let currentLine = line("2026-10-10", ["a", "b", "c"]);
  let completion: Record<string, ItemCompletion> = {};
  const deps: HiddenGameEligibilityDeps = {
    readDayLine: vi.fn(async () => currentLine),
    readCompletion: vi.fn(async () => new Map(Object.entries(completion))),
    listUnlocks: vi.fn(async () => ledger.map(row => ({ ...row }))),
    recordUnlock: vi.fn(async (_s, row) => {
      const clash = ledger.some(
        r => r.chapter === row.chapter || r.unlockedOnLocalDate === row.unlockedOnLocalDate
      );
      if (!clash) ledger.push({ chapter: row.chapter, unlockedOnLocalDate: row.unlockedOnLocalDate });
    }),
  };
  return {
    deps,
    ledger,
    setLine(next: CurrentDayLine) {
      currentLine = next;
    },
    setCompletion(next: Record<string, ItemCompletion>) {
      completion = next;
    },
  };
}

const allDone = { a: "complete", b: "complete", c: "complete" } as const;

describe("readHiddenGameEligibility", () => {
  it("0 of 3 required complete: locked, nothing recorded", async () => {
    const h = harness();
    const out = await readHiddenGameEligibility(scope, h.deps);
    expect(out).toEqual({
      unlockedChapters: 0,
      todayComplete: false,
      todayRequiredTotal: 3,
      todayRequiredComplete: 0,
      nextUnlockRequirement: "finish_today",
    });
    expect(h.deps.recordUnlock).not.toHaveBeenCalled();
  });

  it("2 of 3 is still locked", async () => {
    const h = harness();
    h.setCompletion({ a: "complete", b: "complete", c: "incomplete" });
    const out = await readHiddenGameEligibility(scope, h.deps);
    expect(out.unlockedChapters).toBe(0);
    expect(out.todayRequiredComplete).toBe(2);
  });

  it("3 of 3 unlocks chapter 1 and says come back tomorrow", async () => {
    const h = harness();
    h.setCompletion({ ...allDone });
    const out = await readHiddenGameEligibility(scope, h.deps);
    expect(out.unlockedChapters).toBe(1);
    expect(out.todayComplete).toBe(true);
    expect(out.nextUnlockRequirement).toBe("come_back_tomorrow");
    expect(h.ledger).toEqual([{ chapter: 1, unlockedOnLocalDate: "2026-10-10" }]);
  });

  it("a second finished day unlocks chapter 2", async () => {
    const h = harness([{ chapter: 1, unlockedOnLocalDate: "2026-10-10" }]);
    h.setLine(line("2026-10-11", ["a", "b", "c"]));
    h.setCompletion({ ...allDone });
    const out = await readHiddenGameEligibility(scope, h.deps);
    expect(out.unlockedChapters).toBe(2);
  });

  it("reading the same day twice does not unlock a third chapter", async () => {
    const h = harness([{ chapter: 1, unlockedOnLocalDate: "2026-10-10" }]);
    h.setLine(line("2026-10-11", ["a", "b", "c"]));
    h.setCompletion({ ...allDone });
    await readHiddenGameEligibility(scope, h.deps);
    const again = await readHiddenGameEligibility(scope, h.deps);
    expect(again.unlockedChapters).toBe(2);
    expect(h.ledger).toHaveLength(2);
    expect(h.deps.recordUnlock).toHaveBeenCalledTimes(1);
  });

  it("un-completion after an unlock never re-locks", async () => {
    const h = harness();
    h.setCompletion({ ...allDone });
    await readHiddenGameEligibility(scope, h.deps);
    h.setCompletion({ a: "incomplete", b: "incomplete", c: "incomplete" });
    const out = await readHiddenGameEligibility(scope, h.deps);
    expect(out.unlockedChapters).toBe(1);
    expect(out.todayComplete).toBe(false);
  });

  it("stops at chapter 3 and reports all_unlocked", async () => {
    const h = harness([
      { chapter: 1, unlockedOnLocalDate: "2026-10-08" },
      { chapter: 2, unlockedOnLocalDate: "2026-10-09" },
    ]);
    h.setCompletion({ ...allDone });
    const third = await readHiddenGameEligibility(scope, h.deps);
    expect(third.unlockedChapters).toBe(3);
    expect(third.nextUnlockRequirement).toBe("all_unlocked");
    h.setLine(line("2026-10-11", ["a", "b", "c"]));
    const fourth = await readHiddenGameEligibility(scope, h.deps);
    expect(fourth.unlockedChapters).toBe(3);
    expect(h.ledger).toHaveLength(3);
  });

  it("unknown completion counts as not complete", async () => {
    const h = harness();
    h.setCompletion({ a: "complete", b: "complete", c: "unknown" });
    const out = await readHiddenGameEligibility(scope, h.deps);
    expect(out.todayComplete).toBe(false);
    expect(out.unlockedChapters).toBe(0);
  });

  it("a completion reader that throws leaves the day unfinished", async () => {
    const h = harness();
    (h.deps.readCompletion as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("boom"));
    const out = await readHiddenGameEligibility(scope, h.deps);
    expect(out.todayComplete).toBe(false);
    expect(out.unlockedChapters).toBe(0);
  });

  it("an empty or unavailable Day Line is not a finished day", async () => {
    for (const rankingStatus of ["no_plan", "unavailable"] as const) {
      const h = harness();
      h.setLine(line("2026-10-10", [], rankingStatus));
      const out = await readHiddenGameEligibility(scope, h.deps);
      expect(out.todayComplete).toBe(false);
      expect(out.todayRequiredTotal).toBe(0);
      expect(out.unlockedChapters).toBe(0);
    }
  });

  it("an unranked line ignores stale items but keeps the designated one", () => {
    const l = projectCurrentDayLine({
      businessDate: "2026-10-10",
      rankingStatus: "unavailable",
      rankedWorks: [{ id: "ghost", title: "ghost" }],
      designated: { id: "d", title: "designated" },
    });
    const c = evaluateDayCompletion(l, new Map([["d", "complete"], ["ghost", "complete"]]));
    expect(c.requiredIds).toEqual(["d"]);
    expect(c.todayComplete).toBe(true);
  });

  it("missing tenant or operator throws instead of defaulting", async () => {
    const h = harness();
    await expect(
      readHiddenGameEligibility({ ...scope, tenantId: "  " }, h.deps)
    ).rejects.toThrow(/tenantId/);
    await expect(
      readHiddenGameEligibility({ ...scope, canonicalOperatorId: "" }, h.deps)
    ).rejects.toThrow(/canonicalOperatorId/);
    expect(h.deps.readDayLine).not.toHaveBeenCalled();
  });

  it("passes the caller's scope to every reader", async () => {
    const h = harness();
    await readHiddenGameEligibility(scope, h.deps);
    for (const fn of [h.deps.readDayLine, h.deps.listUnlocks]) {
      expect(fn).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "tenant-a" }));
    }
  });
});

describe("chapterToUnlock", () => {
  it("never opens twice for one day or past the last chapter", () => {
    expect(chapterToUnlock({ existing: [], localDate: "d1", todayComplete: true })).toBe(1);
    expect(
      chapterToUnlock({
        existing: [{ chapter: 1, unlockedOnLocalDate: "d1" }],
        localDate: "d1",
        todayComplete: true,
      })
    ).toBeNull();
    expect(
      chapterToUnlock({
        existing: [
          { chapter: 1, unlockedOnLocalDate: "d1" },
          { chapter: 2, unlockedOnLocalDate: "d2" },
          { chapter: 3, unlockedOnLocalDate: "d3" },
        ],
        localDate: "d4",
        todayComplete: true,
      })
    ).toBeNull();
  });
});

describe("structure", () => {
  it("the service and router never import a mutation path", () => {
    for (const file of [
      "hiddenGameEligibilityService.ts",
      "hiddenGameEligibilityRouter.ts",
    ]) {
      const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
      expect(source).not.toMatch(/completeDayDirectorCommitment|bridgeDriverAction|transitionObjectiveStatus/);
      expect(source).not.toMatch(/COALESCE\(/i);
    }
  });

  it("the router exposes a query and no mutation", () => {
    const source = readFileSync(
      new URL("./hiddenGameEligibilityRouter.ts", import.meta.url),
      "utf8"
    );
    expect(source).toMatch(/\.query\(/);
    expect(source).not.toMatch(/\.mutation\(/);
  });
});
