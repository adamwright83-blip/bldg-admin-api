import { describe, expect, it } from "vitest";
import { settlementForExecution } from "./commitmentExecutionBridge";
import { observationRetryDelayMs } from "./observationBridgeStore";

const MINUTE = 60_000;

describe("observation bridge retry and settlement", () => {
  it("backs off exponentially and caps: transient failures within hours, unresolved identity within a day", () => {
    expect([1, 2, 3, 4].map(n => observationRetryDelayMs(n, "pending"))).toEqual([MINUTE, 2 * MINUTE, 4 * MINUTE, 8 * MINUTE]);
    expect(observationRetryDelayMs(50, "pending")).toBe(6 * 60 * MINUTE);
    expect(observationRetryDelayMs(1, "unresolved_identity")).toBe(30 * MINUTE);
    expect(observationRetryDelayMs(50, "unresolved_identity")).toBe(24 * 60 * MINUTE);
  });

  it("settles a commitment execution: recorded is bridged, unlinked is unrelated, a lineage conflict needs review", () => {
    const observation = { status: "pending" as const, objectiveId: "o", workThreadId: null, executionOutcomeId: "x", windowStart: "2026-10-19T17:00:00.000Z", windowEnd: null, targets: [], results: [] };
    expect(settlementForExecution({ status: "recorded", objectiveId: "o", outcomeId: "x", evidenceClass: "operator_attested", workThreadId: null, observation }).status).toBe("bridged");
    expect(settlementForExecution({ status: "unlinked", reason: "no_goal_objective", message: "" }).status).toBe("unrelated");
    expect(settlementForExecution({ status: "rejected", reason: "lineage_mismatch", message: "" }).status).toBe("ambiguous_review");
    expect(settlementForExecution({ status: "rejected", reason: "authoritative_external_evidence_missing", message: "" }).status).toBe("rejected");
  });
});
