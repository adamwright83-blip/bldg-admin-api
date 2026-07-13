import { describe, expect, it } from "vitest";
import {
  canTransitionCommercialMission,
  eventNameForCommercialMissionTransition,
} from "./commercialMissionLifecycle";

describe("commercial mission lifecycle", () => {
  it("follows the territory to BORESLAY to field path", () => {
    expect(canTransitionCommercialMission("selected", "game_ready")).toBe(true);
    expect(canTransitionCommercialMission("game_completed", "phone_ready")).toBe(true);
    expect(canTransitionCommercialMission("visit_completed", "won")).toBe(true);
  });

  it("rejects skipped production transitions", () => {
    expect(canTransitionCommercialMission("candidate", "won")).toBe(false);
    expect(() => eventNameForCommercialMissionTransition("game_ready", "phone_ready")).toThrow(/Invalid/);
  });

  it("assigns explicit audit event names", () => {
    expect(eventNameForCommercialMissionTransition("game_active", "game_completed")).toBe("game_completed");
  });
});
