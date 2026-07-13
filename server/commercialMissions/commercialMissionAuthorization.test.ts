import { describe, expect, it } from "vitest";
import { TEST_COMMERCIAL_MISSION } from "@shared/commercialMission.test";
import {
  assertDriverCanReadMission,
  assertDriverTransitionAllowed,
} from "./commercialMissionAuthorization";

describe("commercial mission authorization", () => {
  it("rejects a mission assigned to another field user", () => {
    expect(() => assertDriverCanReadMission({
      mission: TEST_COMMERCIAL_MISSION,
      userId: "operator-2",
      isAdmin: false,
    })).toThrow(/not assigned/);
  });

  it("allows the assignee and an administrator", () => {
    expect(() => assertDriverCanReadMission({
      mission: TEST_COMMERCIAL_MISSION,
      userId: "operator-1",
      isAdmin: false,
    })).not.toThrow();
    expect(() => assertDriverCanReadMission({
      mission: TEST_COMMERCIAL_MISSION,
      userId: "any-admin",
      isAdmin: true,
    })).not.toThrow();
  });

  it("does not let a field client impersonate the game", () => {
    expect(() => assertDriverTransitionAllowed("arrived")).not.toThrow();
    expect(() => assertDriverTransitionAllowed("game_completed")).toThrow(/cannot transition/);
  });
});
