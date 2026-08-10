import { describe, expect, it } from "vitest";
import {
  coolingLabel,
  gameWorldControlPercent,
  visualStateForBusinessStatus,
} from "../../../../shared/driverGameWorld";
import { equipAnchorAbilities } from "./EncounterProjection";
import { projectPersistentHistory } from "./WorldProjection";

describe("driver game truth projection", () => {
  it("maps authoritative outcomes without letting arcade state create a win", () => {
    expect(
      visualStateForBusinessStatus({ missionStatus: "won" })
    ).toBe("captured");
    expect(
      visualStateForBusinessStatus({ missionStatus: "lost" })
    ).toBe("closed");
    expect(
      visualStateForBusinessStatus({ missionStatus: "follow_up" })
    ).toBe("contested");
  });

  it("persists only the valid contested to recovery-active projection", () => {
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
