import { describe, expect, it } from "vitest";
import {
  checkTerritoryPresence,
  deriveRunCadence,
  deriveRunProgress,
  PRESENCE_VALIDITY_MINUTES,
  type CampaignTarget,
  type CampaignTargetEvent,
  type RunTargetSlot,
} from "./campaignRun";

const RUN = "run-1";

function target(targetId: string, lat = 34.07, lng = -118.4): CampaignTarget {
  return {
    targetId,
    targetSetId: "set-1",
    label: targetId,
    address: `${targetId} Example St`,
    lat,
    lng,
    placementPoint: "front_door_knob",
    sourceNote: "operator walked the block and confirmed access",
    provenance: "operator_observed",
  };
}

function slots(...targetIds: string[]): RunTargetSlot[] {
  return targetIds.map((targetId, index) => ({
    campaignRunId: RUN,
    slotId: `slot-${index + 1}`,
    originalTargetId: targetId,
  }));
}

function presence(
  eventId: string,
  occurredAt: string,
  operatorUserId = "op-1"
): CampaignTargetEvent {
  return {
    eventId,
    campaignRunId: RUN,
    targetId: null,
    kind: "territory_presence",
    occurredAt,
    operatorUserId,
    provenance: "device_location",
    epistemicState: "confirmed",
    supportingPresenceEventId: null,
    replacementTargetId: null,
    lat: 34.07,
    lng: -118.4,
    accuracyMeters: 12,
    note: null,
  };
}

function placement(
  eventId: string,
  targetId: string,
  occurredAt: string,
  supportingPresenceEventId: string | null,
  operatorUserId = "op-1"
): CampaignTargetEvent {
  return {
    eventId,
    campaignRunId: RUN,
    targetId,
    kind: "placement_reported",
    occurredAt,
    operatorUserId,
    provenance: "operator_reported",
    epistemicState: "confirmed",
    supportingPresenceEventId,
    replacementTargetId: null,
    lat: null,
    lng: null,
    accuracyMeters: null,
    note: null,
  };
}

function replacement(
  eventId: string,
  targetId: string,
  replacementTargetId: string,
  occurredAt: string
): CampaignTargetEvent {
  return {
    eventId,
    campaignRunId: RUN,
    targetId,
    kind: "target_replaced",
    occurredAt,
    operatorUserId: "op-1",
    provenance: "operator_observed",
    epistemicState: "confirmed",
    supportingPresenceEventId: null,
    replacementTargetId,
    lat: null,
    lng: null,
    accuracyMeters: null,
    note: "gated, no accessible placement point",
  };
}

describe("deriveRunProgress — the completion contract", () => {
  it("counts nothing from presence alone", () => {
    const progress = deriveRunProgress({
      campaignRunId: RUN,
      slots: slots("a", "b"),
      events: [presence("p1", "2026-09-16T17:00:00.000Z")],
    });
    expect(progress.qualified).toBe(0);
  });

  it("qualifies a placement backed by same-operator presence just before it", () => {
    const progress = deriveRunProgress({
      campaignRunId: RUN,
      slots: slots("a", "b"),
      events: [
        presence("p1", "2026-09-16T17:00:00.000Z"),
        placement("e1", "a", "2026-09-16T17:05:00.000Z", "p1"),
      ],
    });
    expect(progress.qualified).toBe(1);
    expect(progress.total).toBe(2);
    expect(progress.complete).toBe(false);
  });

  it("rejects a placement with no supporting presence, and says why", () => {
    const progress = deriveRunProgress({
      campaignRunId: RUN,
      slots: slots("a"),
      events: [placement("e1", "a", "2026-09-16T17:05:00.000Z", null)],
    });
    expect(progress.qualified).toBe(0);
    expect(progress.unqualifiedPlacements).toEqual([
      { targetId: "a", reason: "no_supporting_presence" },
    ]);
  });

  it("rejects a presence event borrowed from another run", () => {
    const foreign = { ...presence("p-other", "2026-09-16T17:00:00.000Z"), campaignRunId: "run-2" };
    const progress = deriveRunProgress({
      campaignRunId: RUN,
      slots: slots("a"),
      events: [foreign, placement("e1", "a", "2026-09-16T17:05:00.000Z", "p-other")],
    });
    expect(progress.unqualifiedPlacements[0].reason).toBe("presence_not_in_run");
  });

  it("rejects presence recorded by a different operator", () => {
    const progress = deriveRunProgress({
      campaignRunId: RUN,
      slots: slots("a"),
      events: [
        presence("p1", "2026-09-16T17:00:00.000Z", "op-2"),
        placement("e1", "a", "2026-09-16T17:05:00.000Z", "p1", "op-1"),
      ],
    });
    expect(progress.unqualifiedPlacements[0].reason).toBe(
      "presence_different_operator"
    );
  });

  it("rejects presence recorded after the placement it claims to back", () => {
    const progress = deriveRunProgress({
      campaignRunId: RUN,
      slots: slots("a"),
      events: [
        presence("p1", "2026-09-16T18:00:00.000Z"),
        placement("e1", "a", "2026-09-16T17:05:00.000Z", "p1"),
      ],
    });
    expect(progress.unqualifiedPlacements[0].reason).toBe(
      "presence_after_placement"
    );
  });

  it("does not let one GPS ping authorize placements days later", () => {
    const progress = deriveRunProgress({
      campaignRunId: RUN,
      slots: slots("a", "b"),
      events: [
        presence("p1", "2026-09-16T17:00:00.000Z"),
        placement("e1", "a", "2026-09-16T17:05:00.000Z", "p1"),
        placement("e2", "b", "2026-09-27T17:05:00.000Z", "p1"),
      ],
    });
    expect(progress.qualified).toBe(1);
    expect(progress.unqualifiedPlacements).toEqual([
      { targetId: "b", reason: "presence_expired" },
    ]);
  });

  it("accepts a placement at the edge of the validity window and not past it", () => {
    const base = Date.parse("2026-09-16T17:00:00.000Z");
    const inside = new Date(base + (PRESENCE_VALIDITY_MINUTES - 1) * 60_000).toISOString();
    const outside = new Date(base + (PRESENCE_VALIDITY_MINUTES + 1) * 60_000).toISOString();
    const ok = deriveRunProgress({
      campaignRunId: RUN,
      slots: slots("a"),
      events: [presence("p1", "2026-09-16T17:00:00.000Z"), placement("e1", "a", inside, "p1")],
    });
    const late = deriveRunProgress({
      campaignRunId: RUN,
      slots: slots("a"),
      events: [presence("p1", "2026-09-16T17:00:00.000Z"), placement("e1", "a", outside, "p1")],
    });
    expect(ok.qualified).toBe(1);
    expect(late.qualified).toBe(0);
  });

  it("ignores a placement against an address the run is not carrying", () => {
    const progress = deriveRunProgress({
      campaignRunId: RUN,
      slots: slots("a"),
      events: [
        presence("p1", "2026-09-16T17:00:00.000Z"),
        placement("e1", "zzz", "2026-09-16T17:05:00.000Z", "p1"),
      ],
    });
    expect(progress.qualified).toBe(0);
    expect(progress.unqualifiedPlacements).toContainEqual({
      targetId: "zzz",
      reason: "target_not_in_run",
    });
  });
});

describe("the frozen denominator", () => {
  it("keeps the denominator when a target is replaced, and reopens the slot", () => {
    const events = [
      presence("p1", "2026-09-16T17:00:00.000Z"),
      placement("e1", "a", "2026-09-16T17:05:00.000Z", "p1"),
      replacement("r1", "b", "c", "2026-09-16T18:00:00.000Z"),
    ];
    const progress = deriveRunProgress({
      campaignRunId: RUN,
      slots: slots("a", "b"),
      events,
    });
    expect(progress.total).toBe(2);
    expect(progress.qualified).toBe(1);
    expect(progress.complete).toBe(false);
    const replaced = progress.slots.find(slot => slot.originalTargetId === "b");
    expect(replaced?.currentTargetId).toBe("c");
    expect(replaced?.history).toEqual(["b", "c"]);
  });

  it("completes only once the replacement itself is placed", () => {
    const progress = deriveRunProgress({
      campaignRunId: RUN,
      slots: slots("a", "b"),
      events: [
        presence("p1", "2026-09-16T17:00:00.000Z"),
        placement("e1", "a", "2026-09-16T17:05:00.000Z", "p1"),
        replacement("r1", "b", "c", "2026-09-16T17:10:00.000Z"),
        placement("e2", "c", "2026-09-16T17:20:00.000Z", "p1"),
      ],
    });
    expect(progress.total).toBe(2);
    expect(progress.complete).toBe(true);
  });

  it("carries a placement credit forward only for the current occupant", () => {
    const progress = deriveRunProgress({
      campaignRunId: RUN,
      slots: slots("a"),
      events: [
        presence("p1", "2026-09-16T17:00:00.000Z"),
        placement("e1", "a", "2026-09-16T17:05:00.000Z", "p1"),
        replacement("r1", "a", "b", "2026-09-16T17:30:00.000Z"),
      ],
    });
    expect(progress.total).toBe(1);
    expect(progress.qualified).toBe(0);
  });

  it("holds progress across days without decaying", () => {
    const progress = deriveRunProgress({
      campaignRunId: RUN,
      slots: slots("a", "b"),
      events: [
        presence("p1", "2026-09-16T17:00:00.000Z"),
        placement("e1", "a", "2026-09-16T17:05:00.000Z", "p1"),
        presence("p2", "2026-10-20T17:00:00.000Z"),
        placement("e2", "b", "2026-10-20T17:30:00.000Z", "p2"),
      ],
    });
    expect(progress.qualified).toBe(2);
    expect(progress.complete).toBe(true);
  });
});

describe("checkTerritoryPresence", () => {
  it("accepts an observation beside a target", () => {
    const check = checkTerritoryPresence({
      observation: { lat: 34.0701, lng: -118.4001, accuracyMeters: 10 },
      targets: [target("a")],
    });
    expect(check.inTerritory).toBe(true);
  });

  it("refuses an observation far outside the territory", () => {
    const check = checkTerritoryPresence({
      observation: { lat: 34.2, lng: -118.9, accuracyMeters: 5 },
      targets: [target("a")],
    });
    expect(check.inTerritory).toBe(false);
    if (!check.inTerritory) expect(check.reason).toBe("outside_territory");
  });

  it("refuses rather than guessing when no target carries coordinates", () => {
    const check = checkTerritoryPresence({
      observation: { lat: 34.07, lng: -118.4, accuracyMeters: 5 },
      targets: [target("a", null as unknown as number, null as unknown as number)],
    });
    expect(check.inTerritory).toBe(false);
    if (!check.inTerritory) expect(check.reason).toBe("no_target_coordinates");
  });

  it("caps how far a bad accuracy reading can widen the territory", () => {
    const wild = checkTerritoryPresence({
      observation: { lat: 34.09, lng: -118.4, accuracyMeters: 50_000 },
      targets: [target("a")],
    });
    expect(wild.inTerritory).toBe(false);
  });
});

describe("deriveRunCadence", () => {
  it("counts sessions by the operator's own business date, not UTC", () => {
    const progress = deriveRunProgress({
      campaignRunId: RUN,
      slots: slots("a", "b"),
      events: [
        presence("p1", "2026-09-17T02:00:00.000Z"),
        placement("e1", "a", "2026-09-17T02:30:00.000Z", "p1"),
        presence("p2", "2026-09-17T03:00:00.000Z"),
        placement("e2", "b", "2026-09-17T03:30:00.000Z", "p2"),
      ],
    });
    // Both are the evening of Sept 16 in Los Angeles: one session, not two days.
    expect(deriveRunCadence(progress).sessionCount).toBe(1);
  });

  it("reports the largest gap between sessions", () => {
    const progress = deriveRunProgress({
      campaignRunId: RUN,
      slots: slots("a", "b"),
      events: [
        presence("p1", "2026-09-16T17:00:00.000Z"),
        placement("e1", "a", "2026-09-16T17:05:00.000Z", "p1"),
        presence("p2", "2026-09-26T17:00:00.000Z"),
        placement("e2", "b", "2026-09-26T17:05:00.000Z", "p2"),
      ],
    });
    const cadence = deriveRunCadence(progress);
    expect(cadence.sessionCount).toBe(2);
    expect(cadence.largestGapDays).toBe(10);
  });

  it("reports nothing rather than guessing when no placement qualifies", () => {
    const cadence = deriveRunCadence(
      deriveRunProgress({ campaignRunId: RUN, slots: slots("a"), events: [] })
    );
    expect(cadence.sessionCount).toBe(0);
  });
});
