import { describe, expect, it } from "vitest";
import {
  COLD_CALL_CALLER_ID_UNVERIFIED_MESSAGE,
  coldCallAmmo,
  coldCallEligibility,
  coldCallRollingStatusCopy,
  comboAfterChain,
  isColdCallRollingTerminal,
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

  it("reads rolling-call copy from sales attempt status and the server company", () => {
    expect(
      coldCallRollingStatusCopy({
        status: "dialing_rep",
        companyName: "Kith Treats",
      })
    ).toBe("Calling your phone…");
    expect(
      coldCallRollingStatusCopy({
        status: "rep_connected",
        companyName: "Kith Treats",
      })
    ).toBe("You're connected.");
    expect(
      coldCallRollingStatusCopy({
        status: "dialing_customer",
        companyName: "Kith Treats",
      })
    ).toBe("Calling Kith Treats…");
    expect(
      coldCallRollingStatusCopy({
        status: "customer_connected",
        companyName: "Kith Treats",
      })
    ).toBe("Connected to Kith Treats.");
    expect(isColdCallRollingTerminal("customer_connected")).toBe(false);
    expect(isColdCallRollingTerminal("completed_success")).toBe(true);
    expect(isColdCallRollingTerminal("completed_no_connect")).toBe(true);
    expect(isColdCallRollingTerminal("failed")).toBe(true);
    expect(COLD_CALL_CALLER_ID_UNVERIFIED_MESSAGE).toBe(
      "Your cell must be verified as an outgoing caller ID in Twilio before Goldline can roll this call."
    );
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
