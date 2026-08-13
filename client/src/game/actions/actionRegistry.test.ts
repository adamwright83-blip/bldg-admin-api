import { describe, expect, it } from "vitest";
import type { PlayableMission } from "../state/GameState";
import {
  GOLDLINE_ACTION_REGISTRY,
  resolveGoldlineAction,
} from "./actionRegistry";

const mission: PlayableMission = {
  key: "mission:7",
  missionId: 7,
  moveId: null,
  name: "Fixture",
  address: null,
  navigationUrl: null,
  phoneUrl: "tel:15555550100",
  destinationPath: "/driver/sales-mission/7",
  state: "active",
  timeBurdenMinutes: null,
  travelBurdenMinutes: null,
  estimatedValueLowCents: null,
  estimatedValueHighCents: null,
  confidence: "high",
  expiresAt: null,
  contestedUntil: null,
  verifiedAnnualValueCents: null,
  realizedRevenueCents: 0,
  unlockedPath: null,
  lossReason: null,
};

const context = (overrides: Partial<PlayableMission> = {}) => ({
  mission: { ...mission, ...overrides },
  now: new Date("2026-08-13T12:00:00Z"),
  followUp: null,
  scoutCapability: null,
  scoutReport: null,
});

describe("Goldline action adapter registry", () => {
  it("resolves CALL only from an authoritative callable affordance", () => {
    expect(resolveGoldlineAction(context())?.kind).toBe("CALL");
    expect(
      GOLDLINE_ACTION_REGISTRY.CALL.resolve(context({ phoneUrl: null }))
    ).toBeNull();
  });

  it("never lets VISIT route through CALL and requires navigation data", () => {
    const visit = context({
      phoneUrl: null,
      address: "100 Real St",
      navigationUrl: "https://maps.example/real",
    });
    expect(resolveGoldlineAction(visit)?.kind).toBe("VISIT");
    expect(GOLDLINE_ACTION_REGISTRY.CALL.resolve(visit)).toBeNull();
    expect(
      GOLDLINE_ACTION_REGISTRY.VISIT.resolve(
        context({ phoneUrl: null, address: "100 Real St" })
      )
    ).toBeNull();
  });

  it("requires a real open follow-up for FOLLOW_UP", () => {
    const due = context({
      state: "contested",
      contestedUntil: "2026-08-12T12:00:00Z",
    });
    expect(GOLDLINE_ACTION_REGISTRY.FOLLOW_UP.resolve(due)).toBeNull();
    expect(
      GOLDLINE_ACTION_REGISTRY.FOLLOW_UP.resolve({
        ...due,
        followUp: {
          pipelineId: 3,
          followUpId: "follow-1",
          dueAt: "2026-08-12T12:00:00Z",
          note: null,
          channel: "phone",
        },
      })?.kind
    ).toBe("FOLLOW_UP");
  });

  it("reserves RECOVER for server-projected recovery", () => {
    expect(
      GOLDLINE_ACTION_REGISTRY.RECOVER.resolve(context({ state: "active" }))
    ).toBeNull();
    expect(
      GOLDLINE_ACTION_REGISTRY.RECOVER.resolve(
        context({ state: "recovery_available", phoneUrl: null })
      )?.kind
    ).toBe("RECOVER");
  });

  it("keeps REVIEW and WAIT read-only", () => {
    expect(GOLDLINE_ACTION_REGISTRY.REVIEW.resolve(context())?.mode).toBe(
      "read"
    );
    expect(
      GOLDLINE_ACTION_REGISTRY.WAIT.resolve(
        context({ state: "watching", phoneUrl: null })
      )?.mode
    ).toBe("read");
  });

  it("requires server capability before a SCOUT move can run", () => {
    const scout = context({
      missionId: null,
      moveId: "server-move-1",
      phoneUrl: null,
    });
    expect(GOLDLINE_ACTION_REGISTRY.SCOUT.resolve(scout)).toBeNull();
    expect(
      GOLDLINE_ACTION_REGISTRY.SCOUT.resolve({
        ...scout,
        scoutCapability: { unlocked: true } as never,
      })?.kind
    ).toBe("SCOUT");
  });
});
