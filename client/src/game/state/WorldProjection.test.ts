import { describe, expect, it } from "vitest";
import {
  coolingLabel,
  gameWorldControlPercent,
  visualStateForBusinessStatus,
} from "../../../../shared/driverGameWorld";
import { equipAnchorAbilities } from "./EncounterProjection";
import {
  projectMissionTruth,
  projectPersistentHistory,
  projectPlayableMissions,
} from "./WorldProjection";

describe("driver game truth projection", () => {
  it("maps authoritative outcomes without letting arcade state create a win", () => {
    expect(visualStateForBusinessStatus({ missionStatus: "won" })).toBe(
      "captured"
    );
    expect(visualStateForBusinessStatus({ missionStatus: "lost" })).toBe(
      "closed"
    );
    expect(visualStateForBusinessStatus({ missionStatus: "follow_up" })).toBe(
      "contested"
    );
    expect(visualStateForBusinessStatus({ missionStatus: "phone_ready" })).toBe(
      "active"
    );
  });

  it("preserves only server-supported recovery projections", () => {
    expect(
      visualStateForBusinessStatus({
        missionStatus: "follow_up",
        savedVisualState: "recovery_available",
      })
    ).toBe("recovery_available");
    expect(
      visualStateForBusinessStatus({
        missionStatus: "follow_up",
        savedVisualState: "recovery_active",
      })
    ).toBe("recovery_active");
    expect(
      visualStateForBusinessStatus({
        missionStatus: "lost",
        savedVisualState: "recovery_active",
      })
    ).toBe("closed");
  });

  it("never fabricates a cooling timer without a durable timestamp", () => {
    expect(coolingLabel(null, new Date("2026-08-10T10:00:00Z"))).toBe(
      "CONTESTED · AWAITING ACTION"
    );
    expect(
      coolingLabel(
        "2026-08-12T10:00:00.000Z",
        new Date("2026-08-10T10:00:00.000Z")
      )
    ).toBe("COOLING 48H");
  });

  it("preserves Armory provenance and makes strategy affect execution", () => {
    const [ability] = equipAnchorAbilities([
      {
        id: "foundation:no-risk-trial",
        title: "NO-RISK TRIAL",
        cue: "Switching feels risky",
        response: "Try us on one run. If we don't outperform, don't switch.",
        outcome: "guidance",
        provenance: "foundation",
        sourceReference: "armory:foundation:anchor:no-risk-trial",
      },
    ]);
    expect(ability).toMatchObject({
      fit: "high",
      provenance: "foundation",
      sourceReference: "armory:foundation:anchor:no-risk-trial",
    });
  });
});

describe("mission source dedup", () => {
  it("retains resolved truth after it leaves the playable mission list", () => {
    const mission = {
      id: 7801,
      status: "won",
      account: {
        name: "Resolved fixture",
        address: "7801 Goldline Way",
        decisionMaker: { phone: "+13235550100" },
      },
      opportunity: {
        estimatedAnnualValueCents: 240_000,
        estimateConfidence: "high",
      },
      expiresAt: null,
    } as never;
    const input = { missions: [mission] };
    expect(projectPlayableMissions(input)).toEqual([]);
    expect(projectMissionTruth(input)).toMatchObject([
      { missionId: 7801, state: "captured" },
    ]);
  });

  it("does not produce two world nodes for one real entity discovered by two sources", () => {
    const mission = {
      id: 501,
      status: "active",
      account: {
        name: "The Maybourne Beverly Hills",
        address: "225 N Canon Dr, Beverly Hills, CA 90210",
        decisionMaker: { phone: null },
      },
      opportunity: {
        estimatedAnnualValueCents: 2_160_000,
        estimateConfidence: "medium",
      },
      expiresAt: null,
    } as never;
    // A FIELD move that already references the same real mission row —
    // the same shape a Scout-originated candidate takes once it has
    // materialized into a commercialMissions row and FIELD also surfaces it.
    const move = {
      id: "move-1",
      missionId: 501,
      target: { name: "The Maybourne Beverly Hills" },
      destinationPath: "/driver/sales-mission/501",
      expectedDurationMinutes: 20,
      travelMinutes: 10,
      expectedValue: { value: { lowCents: 1_800_000, highCents: 2_400_000 } },
      confidence: "medium",
      expiresAt: null,
    } as never;
    const projected = projectPlayableMissions({
      missions: [mission],
      moves: { recommendedMoves: [move] } as never,
    });
    const entriesForMission = projected.filter(m => m.missionId === 501);
    expect(entriesForMission).toHaveLength(1);
    expect(entriesForMission[0].key).toBe("mission:501");
  });

  it("keeps a move without a materialized mission when it is a distinct entity", () => {
    const move = {
      id: "move-2",
      missionId: null,
      target: { name: "A different, not-yet-mission business" },
      destinationPath: "/driver/sales-mission/move-2",
      expectedDurationMinutes: 15,
      travelMinutes: 5,
      expectedValue: { value: null },
      confidence: "low",
      expiresAt: null,
    } as never;
    const projected = projectPlayableMissions({
      missions: [],
      moves: { recommendedMoves: [move] } as never,
    });
    expect(projected).toHaveLength(1);
    expect(projected[0].key).toBe("move:move-2");
  });
});

describe("persistent world history", () => {
  it("keeps resolved history separate and labels game progression as world control", () => {
    const nodes = [
      {
        missionId: 10,
        accountName: "Verified historical account",
        visualState: "captured",
        isHistorical: true,
        resolvedAt: "2026-07-01T10:00:00.000Z",
        verifiedAnnualValueCents: 2_160_000,
        realizedRevenueCents: 0,
        contestedUntil: null,
        unlockedPath: null,
        lossReason: null,
      },
    ] as never;
    expect(projectPersistentHistory(nodes)).toHaveLength(1);
    expect(gameWorldControlPercent(nodes)).toBe(100);
  });
});
