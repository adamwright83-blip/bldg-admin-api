import { describe, expect, it } from "vitest";
import {
  coldCallAmmo,
  coldCallEligibility,
  comboAfterChain,
  type ColdCallBatch,
} from "./coldCallBurst";

const eligible = {
  missionId: 1,
  missionStatus: "phone_ready",
  assignedTo: "driver-1",
  actorId: "driver-1",
  phoneNumber: "+13105550123",
  contactSource: "provider_sourced",
  preferredChannel: "phone",
  withinServiceArea: true,
  alreadyCompleted: false,
};

describe("Cold Call Burst truth contracts", () => {
  it("requires a real permitted call-ready contact", () => {
    expect(coldCallEligibility(eligible).eligible).toBe(true);
    expect(
      coldCallEligibility({ ...eligible, phoneNumber: null }).eligible
    ).toBe(false);
    expect(
      coldCallEligibility({ ...eligible, missionStatus: "lost" }).eligible
    ).toBe(false);
    expect(
      coldCallEligibility({ ...eligible, preferredChannel: "email" }).eligible
    ).toBe(false);
    expect(
      coldCallEligibility({ ...eligible, alreadyCompleted: true }).eligible
    ).toBe(false);
  });

  it("derives ammo exactly from real batch targets without padding", () => {
    const batch = {
      id: "batch",
      targets: [
        { id: "1", status: "completed" },
        { id: "2", status: "pending" },
      ],
      totalTargets: 2,
      completedCount: 1,
    } as ColdCallBatch;
    expect(coldCallAmmo(batch)).toEqual({
      remaining: 1,
      total: 2,
      completed: 1,
    });
  });

  it("breaks only game combo and preserves the next target", () => {
    expect(
      comboAfterChain({
        currentCombo: 3,
        selectedNextTarget: false,
        hasEligibleNextTarget: true,
      })
    ).toEqual({ combo: 0, result: "combo_break" });
  });

  it("ends normally when the backend has no next target", () => {
    expect(
      comboAfterChain({
        currentCombo: 2,
        selectedNextTarget: false,
        hasEligibleNextTarget: false,
      })
    ).toEqual({ combo: 2, result: "sweep_complete" });
  });
});
