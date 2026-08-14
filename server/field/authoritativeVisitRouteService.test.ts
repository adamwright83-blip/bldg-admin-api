import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  projectAuthoritativeVisitRoute,
  selectEligibleVisitRouteStops,
} from "./authoritativeVisitRouteService";
import type { FieldMoveCandidate } from "./types";

const members = Array.from({ length: 3 }, (_, position) => ({
  occurrenceId: "route-1",
  businessDate: "2026-08-13",
  missionId: position + 1,
  moveId: `mission:${position + 1}:visit`,
  accountName: `Account ${position + 1}`,
  position,
  requiresDriving: true,
  moveType: "nearby_commercial_visit" as const,
}));

function project(
  outcomes: Array<{ id: number; missionId: number; recordedBy: string }>
) {
  return projectAuthoritativeVisitRoute({
    occurrenceId: "route-1",
    businessDate: "2026-08-13",
    startedAt: new Date("2026-08-13T16:00:00.000Z"),
    members,
    outcomes,
    actorId: "driver-a",
  });
}

describe("authoritative commercial visit route projection", () => {
  it("derives 0, 1 and 3 from exact per-stop visit outcomes", () => {
    expect(project([]).coveredCount).toBe(0);
    expect(
      project([{ id: 11, missionId: 1, recordedBy: "driver-a" }]).coveredCount
    ).toBe(1);
    expect(
      project(
        members.map((member, index) => ({
          id: index + 1,
          missionId: member.missionId,
          recordedBy: "driver-a",
        }))
      ).coveredCount
    ).toBe(3);
  });

  it("counts one mission once and ignores foreign evidence", () => {
    expect(
      project([
        { id: 11, missionId: 1, recordedBy: "driver-a" },
        { id: 12, missionId: 1, recordedBy: "driver-a" },
        { id: 13, missionId: 2, recordedBy: "driver-b" },
      ]).coveredCount
    ).toBe(1);
  });

  it("cannot count fabricated outcomes outside frozen membership", () => {
    expect(
      project([{ id: 99, missionId: 999, recordedBy: "driver-a" }]).coveredCount
    ).toBe(0);
  });

  it("preserves the three-stop denominator after the first completion", () => {
    const result = project([{ id: 11, missionId: 1, recordedBy: "driver-a" }]);
    expect(result).toMatchObject({ totalStops: 3, coveredCount: 1 });
    expect(result.stops).toHaveLength(3);
  });

  it("stores membership events and never persists an aggregate counter", () => {
    const source = readFileSync(
      new URL("./authoritativeVisitRouteService.ts", import.meta.url),
      "utf8"
    );
    expect(source).toContain("eventName: MEMBER_EVENT");
    expect(source).toContain("commercialVisitOutcomes.missionId");
    const persistedMetadata = source.slice(
      source.indexOf("const startMetadata"),
      source.indexOf("let lostDailyStartRace")
    );
    expect(persistedMetadata).not.toContain("coveredCount");
    expect(source).not.toContain("routeProgress");
  });
});

function move(missionId: number): FieldMoveCandidate {
  return {
    id: `mission:${missionId}:visit`,
    moveType: "nearby_commercial_visit",
    title: `Visit ${missionId}`,
    target: {
      entityType: "commercial_account",
      entityId: String(missionId),
      name: `Account ${missionId}`,
    },
    expectedDurationMinutes: 25,
    travelMinutes: null,
    expectedValue: {
      value: null,
      provenance: "UNKNOWN",
      sourceReference: null,
      confidence: "unknown",
    },
    confidence: "unknown",
    relevance: "test",
    evidence: [],
    expiresAt: null,
    contactAllowed: true,
    withinServiceRadius: null,
    missionId,
    missionVersion: 1,
    destinationPath: `/driver/sales-mission/${missionId}`,
  };
}

describe("authoritative route-start selection", () => {
  it("accepts only exact current server recommendations", () => {
    expect(
      selectEligibleVisitRouteStops({
        missionIds: [1, 2],
        recommendedMoves: [move(1), move(2)],
      })
    ).toHaveLength(2);
    expect(() =>
      selectEligibleVisitRouteStops({
        missionIds: [1, 999],
        recommendedMoves: [move(1), move(2)],
      })
    ).toThrow(/current eligible/);
  });

  it("rejects duplicate IDs and a client-supplied fourth stop", () => {
    expect(() =>
      selectEligibleVisitRouteStops({
        missionIds: [1, 1],
        recommendedMoves: [move(1)],
      })
    ).toThrow(/distinct/);
    expect(() =>
      selectEligibleVisitRouteStops({
        missionIds: [1, 2, 3, 4],
        recommendedMoves: [move(1), move(2), move(3), move(4)],
      })
    ).toThrow(/two or three/);
  });
});
