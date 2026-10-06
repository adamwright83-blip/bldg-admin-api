import { describe, expect, it } from "vitest";
import {
  evaluatePrepCompletionEvidence,
  type PrepCompletionEvidence,
} from "./prepReadiness";

function evidence(
  overrides: Partial<PrepCompletionEvidence> = {}
): PrepCompletionEvidence {
  return {
    completedAt: new Date("2026-10-03T12:00:00.000Z"),
    completedBy: "operator-1",
    completionEventId: 44,
    completionActorId: "operator-1",
    ...overrides,
  };
}

describe("Mission Director prep completion evidence", () => {
  const deadline = "2026-10-03";

  it("does not treat status=completed as ready without a completion time", () => {
    expect(
      evaluatePrepCompletionEvidence(
        evidence({ completedAt: null }),
        deadline
      )
    ).toEqual({
      ready: false,
      reason: "ops_tasks.completedAt missing",
    });
  });

  it("requires the completing actor on the task", () => {
    expect(
      evaluatePrepCompletionEvidence(
        evidence({ completedBy: null }),
        deadline
      )
    ).toEqual({
      ready: false,
      reason: "ops_tasks.completedBy missing",
    });
  });

  it("requires the authoritative completed event", () => {
    expect(
      evaluatePrepCompletionEvidence(
        evidence({ completionEventId: null }),
        deadline
      )
    ).toEqual({
      ready: false,
      reason: "ops_task_events.completed evidence missing",
    });
  });

  it("requires the actor on the completed event", () => {
    expect(
      evaluatePrepCompletionEvidence(
        evidence({ completionActorId: null }),
        deadline
      )
    ).toEqual({
      ready: false,
      reason: "ops_task_events.completed.actorId missing",
    });
  });

  it("rejects mismatched completion actors", () => {
    expect(
      evaluatePrepCompletionEvidence(
        evidence({ completionActorId: "someone-else" }),
        deadline
      )
    ).toEqual({
      ready: false,
      reason: "ops task completion actor does not match completion event actor",
    });
  });

  it("uses completedAt rather than createdAt for the prep deadline", () => {
    expect(
      evaluatePrepCompletionEvidence(
        evidence({ completedAt: new Date("2026-10-04T00:00:00.000Z") }),
        deadline
      )
    ).toEqual({
      ready: false,
      reason: "ops_tasks.completedAt is after the prep lead-time deadline",
    });
  });

  it("admits prep completed by the deadline with matching durable evidence", () => {
    expect(evaluatePrepCompletionEvidence(evidence(), deadline)).toEqual({
      ready: true,
      reason: null,
    });
  });
});
