import { describe, expect, it } from "vitest";
import {
  deriveRunCadence,
  deriveRunProgress,
  type CampaignTarget,
  type CampaignTargetEvent,
} from "./campaignRun";

const RUN = "run-1";

function target(targetId: string): CampaignTarget {
  return {
    targetId,
    targetSetId: "set-1",
    label: targetId,
    address: `${targetId} Example St`,
    lat: null,
    lng: null,
    placementPoint: "front_door_knob",
    sourceNote: "operator walked the block and confirmed access",
    provenance: "operator_observed",
  };
}

function presence(eventId: string, occurredAt: string): CampaignTargetEvent {
  return {
    eventId,
    campaignRunId: RUN,
    targetId: null,
    kind: "territory_presence",
    occurredAt,
    operatorUserId: "op-1",
    provenance: "device_location",
    epistemicState: "confirmed",
    supportingPresenceEventId: null,
    replacementTargetId: null,
    note: null,
  };
}

function placement(
  eventId: string,
  targetId: string,
  occurredAt: string,
  supportingPresenceEventId: string | null
): CampaignTargetEvent {
  return {
    eventId,
    campaignRunId: RUN,
    targetId,
    kind: "placement_reported",
    occurredAt,
    operatorUserId: "op-1",
    provenance: "operator_reported",
    epistemicState: "confirmed",
    supportingPresenceEventId,
    replacementTargetId: null,
    note: null,
  };
}

describe("deriveRunProgress", () => {
  it("counts nothing from presence alone — presence is never placement", () => {
    const progress = deriveRunProgress({
      campaignRunId: RUN,
      targets: [target("a"), target("b")],
      events: [presence("p1", "2026-09-16T17:00:00.000Z")],
    });
    expect(progress.qualified).toBe(0);
    expect(progress.complete).toBe(false);
  });

  it("does not qualify a placement with no supporting presence, and says so", () => {
    const progress = deriveRunProgress({
      campaignRunId: RUN,
      targets: [target("a")],
      events: [placement("e1", "a", "2026-09-16T17:05:00.000Z", null)],
    });
    expect(progress.qualified).toBe(0);
    expect(progress.unqualifiedPlacementTargetIds).toEqual(["a"]);
  });

  it("does not qualify a placement naming a presence event from another run", () => {
    const foreign = presence("p-other", "2026-09-16T17:00:00.000Z");
    const progress = deriveRunProgress({
      campaignRunId: RUN,
      targets: [target("a")],
      events: [
        { ...foreign, campaignRunId: "run-2" },
        placement("e1", "a", "2026-09-16T17:05:00.000Z", "p-other"),
      ],
    });
    expect(progress.qualified).toBe(0);
    expect(progress.unqualifiedPlacementTargetIds).toEqual(["a"]);
  });

  it("qualifies a placement backed by presence in the same run", () => {
    const progress = deriveRunProgress({
      campaignRunId: RUN,
      targets: [target("a"), target("b")],
      events: [
        presence("p1", "2026-09-16T17:00:00.000Z"),
        placement("e1", "a", "2026-09-16T17:05:00.000Z", "p1"),
      ],
    });
    expect(progress.qualified).toBe(1);
    expect(progress.total).toBe(2);
    expect(progress.fraction).toBe(0.5);
    expect(progress.complete).toBe(false);
  });

  it("completes only when every active target qualifies", () => {
    const progress = deriveRunProgress({
      campaignRunId: RUN,
      targets: [target("a"), target("b")],
      events: [
        presence("p1", "2026-09-16T17:00:00.000Z"),
        placement("e1", "a", "2026-09-16T17:05:00.000Z", "p1"),
        placement("e2", "b", "2026-09-16T17:20:00.000Z", "p1"),
      ],
    });
    expect(progress.complete).toBe(true);
    expect(progress.fraction).toBe(1);
  });

  it("drops a replaced target from the active set", () => {
    const replaced: CampaignTargetEvent = {
      eventId: "r1",
      campaignRunId: RUN,
      targetId: "b",
      kind: "target_replaced",
      occurredAt: "2026-09-16T18:00:00.000Z",
      operatorUserId: "op-1",
      provenance: "operator_observed",
      epistemicState: "confirmed",
      supportingPresenceEventId: null,
      replacementTargetId: "c",
      note: "gated, no accessible placement point",
    };
    const progress = deriveRunProgress({
      campaignRunId: RUN,
      targets: [target("a"), target("b")],
      events: [
        presence("p1", "2026-09-16T17:00:00.000Z"),
        placement("e1", "a", "2026-09-16T17:05:00.000Z", "p1"),
        replaced,
      ],
    });
    expect(progress.total).toBe(1);
    expect(progress.complete).toBe(true);
  });

  it("holds progress across days without decaying", () => {
    const events = [
      presence("p1", "2026-09-16T17:00:00.000Z"),
      placement("e1", "a", "2026-09-16T17:05:00.000Z", "p1"),
      presence("p2", "2026-10-20T17:00:00.000Z"),
      placement("e2", "b", "2026-10-20T17:30:00.000Z", "p2"),
    ];
    const progress = deriveRunProgress({
      campaignRunId: RUN,
      targets: [target("a"), target("b")],
      events,
    });
    expect(progress.qualified).toBe(2);
    expect(progress.complete).toBe(true);
  });
});

describe("deriveRunCadence", () => {
  it("counts distinct days as sessions and reports the largest gap", () => {
    const progress = deriveRunProgress({
      campaignRunId: RUN,
      targets: [target("a"), target("b"), target("c")],
      events: [
        presence("p1", "2026-09-16T17:00:00.000Z"),
        placement("e1", "a", "2026-09-16T17:05:00.000Z", "p1"),
        placement("e2", "b", "2026-09-17T17:05:00.000Z", "p1"),
        placement("e3", "c", "2026-09-27T17:05:00.000Z", "p1"),
      ],
    });
    const cadence = deriveRunCadence(progress);
    expect(cadence.sessionCount).toBe(3);
    expect(cadence.largestGapDays).toBe(10);
    expect(cadence.firstQualifiedAt).toBe("2026-09-16T17:05:00.000Z");
  });

  it("reports nothing rather than guessing when no placement qualifies", () => {
    const cadence = deriveRunCadence(
      deriveRunProgress({ campaignRunId: RUN, targets: [target("a")], events: [] })
    );
    expect(cadence.sessionCount).toBe(0);
    expect(cadence.largestGapDays).toBe(0);
  });
});
