import { describe, expect, it } from "vitest";
import {
  LEVER_MIN_SCORE,
  explainEmpty,
  isDealable,
  rankCandidates,
  selectLeverCandidate,
  type LeverCandidate,
} from "./hustlerLeverSelection";

const candidate = (over: Partial<LeverCandidate> & { id: string }): LeverCandidate => ({
  score: 80,
  activeOrderCount: 0,
  historyOrderCount: 6,
  daysSinceLastOrder: 90,
  estimatedMonthlyImpactCents: 50_000,
  ...over,
});

describe("lever eligibility mirrors what the recovery service will accept", () => {
  it("refuses a customer below the intervention score floor", () => {
    expect(isDealable(candidate({ id: "a", score: LEVER_MIN_SCORE - 1 }))).toBe(false);
    expect(isDealable(candidate({ id: "a", score: LEVER_MIN_SCORE }))).toBe(true);
  });

  it("refuses a customer who is currently ordering", () => {
    // Win-back outreach to someone mid-order is not a dormant customer.
    expect(isDealable(candidate({ id: "a", activeOrderCount: 1 }))).toBe(false);
  });

  it("refuses a customer with too little history to have a cadence", () => {
    expect(isDealable(candidate({ id: "a", historyOrderCount: 1 }))).toBe(false);
  });
});

describe("the lever is deterministic — no rerolls", () => {
  const pool = [
    candidate({ id: "b", historyOrderCount: 10, estimatedMonthlyImpactCents: 20_000 }),
    candidate({ id: "a", historyOrderCount: 4, estimatedMonthlyImpactCents: 90_000 }),
    candidate({ id: "c", historyOrderCount: 10, estimatedMonthlyImpactCents: 20_000 }),
  ];

  it("deals the same customer for the same pull, every time", () => {
    const first = selectLeverCandidate(pool, "warm");
    for (let i = 0; i < 25; i += 1) {
      expect(selectLeverCandidate(pool, "warm")?.id).toBe(first?.id);
    }
  });

  it("is stable when two customers rank identically", () => {
    // b and c are indistinguishable on every signal; without a final id
    // tiebreak they could swap between pulls and "no rerolls" would break.
    const ranked = rankCandidates(pool, "warm").map(c => c.id);
    expect(ranked).toEqual(rankCandidates(pool, "warm").map(c => c.id));
    expect(ranked[0]).toBe("b");
  });

  it("does not depend on the order candidates arrive in", () => {
    const shuffled = [pool[2], pool[0], pool[1]];
    expect(selectLeverCandidate(shuffled, "warm")?.id).toBe(
      selectLeverCandidate(pool, "warm")?.id
    );
  });
});

describe("the two lever directions are one pool, sorted differently", () => {
  const pool = [
    candidate({ id: "deep", historyOrderCount: 12, estimatedMonthlyImpactCents: 10_000 }),
    candidate({ id: "rich", historyOrderCount: 3, estimatedMonthlyImpactCents: 99_000 }),
  ];

  it("warm favours the established relationship", () => {
    expect(selectLeverCandidate(pool, "warm")?.id).toBe("deep");
  });

  it("big swing favours the money", () => {
    expect(selectLeverCandidate(pool, "big_swing")?.id).toBe("rich");
  });

  it("never hides a customer from one direction entirely", () => {
    // Splitting into separate pools would make someone permanently invisible
    // to one side of the machine.
    const warm = rankCandidates(pool, "warm").map(c => c.id).sort();
    const big = rankCandidates(pool, "big_swing").map(c => c.id).sort();
    expect(warm).toEqual(big);
  });
});

describe("a customer already on the table is not dealt again", () => {
  it("skips a customer with an open mission", () => {
    const pool = [candidate({ id: "open" }), candidate({ id: "free", score: 70 })];
    expect(selectLeverCandidate(pool, "warm", ["open"])?.id).toBe("free");
  });

  it("returns nothing rather than repeating the mission you already have", () => {
    const pool = [candidate({ id: "open" })];
    expect(selectLeverCandidate(pool, "warm", ["open"])).toBeNull();
  });
});

describe("an empty machine explains itself", () => {
  it("distinguishes never-scanned from nothing-eligible", () => {
    expect(explainEmpty([])).toBe("no_scan");
  });

  it("says so when every candidate is still actively ordering", () => {
    expect(explainEmpty([candidate({ id: "a", activeOrderCount: 2 })])).toBe("all_active");
  });

  it("says so when nobody is overdue enough yet", () => {
    expect(explainEmpty([candidate({ id: "a", score: 10 })])).toBe("all_engaged");
  });

  it("says so when the eligible customers are already missions in progress", () => {
    expect(explainEmpty([candidate({ id: "a" })], ["a"])).toBe("all_in_progress");
  });
});
