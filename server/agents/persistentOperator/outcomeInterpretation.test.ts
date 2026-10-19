import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { interpretGoalCycleOutcome, interpretStoredOutcome } from "./outcomeInterpretation";

/**
 * Stage 1 Phase 3 (a): the shared outcome reading. Contradiction wins over every
 * positive signal; "supported" needs verified revenue or a verified conversion.
 */
const base = { outcomeKind: "visit_completed", impactClass: "operational_result", epistemicStatus: "verified", monetaryValueCents: null } as const;

describe("interpretGoalCycleOutcome", () => {
  it("reads contradiction before any positive signal", () => {
    expect(interpretGoalCycleOutcome({ ...base, outcomeKind: "hypothesis_contradicted" }).result).toBe("contradicted");
    expect(interpretGoalCycleOutcome({ ...base, outcomeKind: "send_blocked" }).result).toBe("contradicted");
    expect(interpretGoalCycleOutcome({ ...base, outcomeKind: "visit_failed" }).result).toBe("contradicted");
    expect(
      interpretGoalCycleOutcome({ ...base, outcomeKind: "verified_payment", impactClass: "commercial_revenue", monetaryValueCents: 9000, epistemicStatus: "rejected" })
    ).toEqual({ result: "contradicted", basis: "authoritative_rejection" });
  });

  it("supports only verified revenue or a verified conversion", () => {
    expect(interpretGoalCycleOutcome({ ...base, outcomeKind: "verified_payment", impactClass: "commercial_revenue", monetaryValueCents: 4500 }))
      .toEqual({ result: "supported", basis: "verified_revenue" });
    expect(interpretGoalCycleOutcome({ ...base, outcomeKind: "account_won", impactClass: "customer_lifecycle" }))
      .toEqual({ result: "supported", basis: "verified_conversion" });
    expect(interpretGoalCycleOutcome({ ...base, outcomeKind: "verified_payment", impactClass: "commercial_revenue", monetaryValueCents: 0 }).result).toBe("inconclusive");
    expect(interpretGoalCycleOutcome(base)).toEqual({ result: "inconclusive", basis: "no_result_signal" });
    expect(interpretGoalCycleOutcome({ ...base, impactClass: "action_verification" })).toEqual({ result: "inconclusive", basis: "execution_only" });
  });

  it("nothing unsettled is read as a result, and unknown stored statuses are unsettled", () => {
    expect(interpretGoalCycleOutcome({ ...base, outcomeKind: "account_won", epistemicStatus: "unverified" }).result).toBe("unresolved");
    expect(interpretGoalCycleOutcome({ ...base, outcomeKind: "hypothesis_contradicted", epistemicStatus: "disputed" }).result).toBe("unresolved");
    expect(interpretStoredOutcome({ ...base, outcomeKind: "account_won", epistemicStatus: "maybe" }).result).toBe("unresolved");
  });

  it("learning, the scoreboard and the diagnosis reader all use it, and keep no private reading", () => {
    const read = (path: string) => readFileSync(join(import.meta.dirname, path), "utf8");
    for (const path of ["learningStore.ts", "proofReadModels.ts", "../../strategy/strategicEvidenceReaders.ts"]) {
      const source = read(path);
      expect(source, path).toMatch(/interpret(?:GoalCycle|Stored)Outcome\(/);
      expect(source, path).not.toMatch(/outcomeKind\.includes\("failed"\)|hypothesis_contradicted\/\.test/);
    }
  });
});
