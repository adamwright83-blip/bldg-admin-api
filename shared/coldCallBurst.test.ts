import { describe, expect, it } from "vitest";
import {
  COLD_CALL_CALLER_ID_UNVERIFIED_MESSAGE,
  coldCallAmmo,
  coldCallEligibility,
  coldCallRollingStatusCopy,
  comboAfterChain,
  isColdCallRollingTerminal,
  prospectLegConnected,
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

describe("prospect-leg connection", () => {
  const base = {
    tenantId: "tenant-1",
    attemptStatus: "dialing_customer",
    repLegCallSid: "CA_rep",
    customerLegCallSid: "CA_prospect",
    receipts: [] as Array<{
      tenantId?: string | null;
      eventType: string;
      callSid: string | null;
      parentCallSid: string | null;
    }>,
  };

  it("accepts a live prospect connection and a prospect CALL_CONNECTED receipt", () => {
    expect(prospectLegConnected({ ...base, attemptStatus: "customer_connected" })).toBe(true);
    expect(prospectLegConnected({ ...base, attemptStatus: "completed_success" })).toBe(false);
    expect(
      prospectLegConnected({
        ...base,
        attemptStatus: "completed_success",
        receipts: [
          {
            tenantId: "tenant-1",
            eventType: "CALL_CONNECTED",
            callSid: "CA_prospect",
            parentCallSid: "CA_rep",
          },
        ],
      })
    ).toBe(true);
    expect(
      prospectLegConnected({
        ...base,
        receipts: [
          {
            tenantId: "tenant-1",
            eventType: "CALL_CONNECTED",
            callSid: "CA_prospect",
            parentCallSid: "CA_rep",
          },
        ],
      })
    ).toBe(true);
  });

  it("rejects the bridge, the rep leg, ringing, duration stand-ins, and non-connect receipts", () => {
    expect(prospectLegConnected({ ...base, attemptStatus: "dialing_rep" })).toBe(false);
    expect(prospectLegConnected({ ...base, attemptStatus: "rep_connected" })).toBe(false);
    expect(prospectLegConnected({ ...base, attemptStatus: "completed_no_connect" })).toBe(false);
    expect(prospectLegConnected({ ...base, attemptStatus: "failed" })).toBe(false);
    for (const eventType of [
      "CALL_RINGING",
      "CALL_COMPLETED",
      "CALL_NO_ANSWER",
      "CALL_BUSY",
      "CALL_FAILED",
      "VOICEMAIL_DETECTED",
    ]) {
      expect(
        prospectLegConnected({
          ...base,
          receipts: [
            {
              tenantId: "tenant-1",
              eventType,
              callSid: "CA_prospect",
              parentCallSid: "CA_rep",
            },
          ],
        })
      ).toBe(false);
    }
    expect(
      prospectLegConnected({
        ...base,
        receipts: [
          {
            tenantId: "tenant-1",
            eventType: "CALL_CONNECTED",
            callSid: "CA_rep",
            parentCallSid: null,
          },
        ],
      })
    ).toBe(false);
    expect(
      prospectLegConnected({
        ...base,
        receipts: [
          {
            tenantId: "other-tenant",
            eventType: "CALL_CONNECTED",
            callSid: "CA_prospect",
            parentCallSid: "CA_rep",
          },
        ],
      })
    ).toBe(false);
    expect(
      prospectLegConnected({
        ...base,
        receipts: [
          {
            eventType: "CALL_CONNECTED",
            callSid: "CA_prospect",
            parentCallSid: "CA_rep",
          },
        ],
      })
    ).toBe(false);
    expect(
      prospectLegConnected({
        ...base,
        receipts: [
          {
            tenantId: "tenant-1",
            eventType: "CALL_CONNECTED",
            callSid: "CA_other_child",
            parentCallSid: "CA_rep",
          },
        ],
      })
    ).toBe(false);
    expect(
      prospectLegConnected({
        ...base,
        customerLegCallSid: null,
        receipts: [
          {
            tenantId: "tenant-1",
            eventType: "CALL_CONNECTED",
            callSid: "CA_prospect",
            parentCallSid: "CA_rep",
          },
        ],
      })
    ).toBe(true);
  });
});
