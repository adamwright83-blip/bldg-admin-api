import { describe, expect, it } from "vitest";
import {
  summarizeInitiationFunnelByBusinessWeek,
  summarizeSilentIdle,
} from "./observability";

describe("persistent operator observability", () => {
  it("distinguishes legitimate no-work from identity and source failures", () => {
    const rows = [
      {
        eventKind: "selection_attempt",
        reason: "legitimate_no_work",
        objectiveId: null,
        occurredAt: new Date("2026-09-28T17:00:00Z"),
      },
      {
        eventKind: "selection_attempt",
        reason: "identity_unresolved",
        objectiveId: null,
        occurredAt: new Date("2026-09-28T18:00:00Z"),
      },
      {
        eventKind: "selection_attempt",
        reason: "source_unavailable",
        objectiveId: null,
        occurredAt: new Date("2026-09-28T19:00:00Z"),
      },
      {
        eventKind: "selection_attempt",
        reason: null,
        objectiveId: null,
        occurredAt: new Date("2026-09-28T20:00:00Z"),
      },
    ];
    expect(summarizeSilentIdle(rows)).toEqual({
      attempts: 4,
      silent: 3,
      rate: 0.75,
      byReason: {
        legitimate_no_work: 1,
        identity_unresolved: 1,
        source_unavailable: 1,
      },
    });
  });

  it("groups the objective initiation funnel by business-local Monday week", () => {
    const rows = [
      {
        eventKind: "objective_created",
        reason: null,
        objectiveId: "objective-a",
        occurredAt: new Date("2026-09-28T08:00:00Z"),
      },
      {
        eventKind: "objective_surfaced",
        reason: null,
        objectiveId: "objective-a",
        occurredAt: new Date("2026-09-29T08:00:00Z"),
      },
      {
        eventKind: "objective_started",
        reason: null,
        objectiveId: "objective-a",
        occurredAt: new Date("2026-09-30T08:00:00Z"),
      },
      {
        eventKind: "objective_verified",
        reason: null,
        objectiveId: "objective-a",
        occurredAt: new Date("2026-10-01T08:00:00Z"),
      },
      {
        eventKind: "objective_created",
        reason: null,
        objectiveId: "objective-b",
        occurredAt: new Date("2026-10-05T08:00:00Z"),
      },
    ];
    expect(
      summarizeInitiationFunnelByBusinessWeek(
        rows,
        "America/Los_Angeles"
      )
    ).toEqual([
      {
        weekStart: "2026-09-28",
        objectiveCreated: 1,
        objectiveSurfaced: 1,
        objectiveStarted: 1,
        objectiveVerified: 1,
      },
      {
        weekStart: "2026-10-05",
        objectiveCreated: 1,
        objectiveSurfaced: 0,
        objectiveStarted: 0,
        objectiveVerified: 0,
      },
    ]);
  });

  it("deduplicates repeated transition receipts for the same objective", () => {
    const rows = [
      {
        eventKind: "objective_surfaced",
        reason: null,
        objectiveId: "objective-a",
        occurredAt: new Date("2026-09-28T17:00:00Z"),
      },
      {
        eventKind: "objective_surfaced",
        reason: null,
        objectiveId: "objective-a",
        occurredAt: new Date("2026-09-28T18:00:00Z"),
      },
    ];
    expect(
      summarizeInitiationFunnelByBusinessWeek(
        rows,
        "America/Los_Angeles"
      )[0]?.objectiveSurfaced
    ).toBe(1);
  });
});
