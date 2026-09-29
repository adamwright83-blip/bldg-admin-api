import { describe, expect, it } from "vitest";
import {
  parseOperatorVoiceCommand,
  validatedPersistentPolicyEventContext,
} from "./agentRuntime";
import { parseEmergencyTaskIntake, publicEmergencyTaskErrorMessage } from "../operatorTaskIntake";

describe("validatedPersistentPolicyEventContext", () => {
  const base = {
    tenantId: "tenant-a",
    agentType: "goal_cycle_agent" as const,
    actorType: "system" as const,
    actorId: "adam",
    approvedByUserId: "adam",
    standingAuthorizationId: "stale-auth",
    standingAuthorizationVersion: 99,
  };

  it("uses the standing authorization record actually validated by policy", () => {
    expect(
      validatedPersistentPolicyEventContext(base, {
        allowed: true,
        authority: "standing_authorization",
        standingAuthorizationId: "validated-auth",
        standingAuthorizationVersion: 4,
      })
    ).toMatchObject({
      authorityBasis: "standing_authorization",
      approvalBasis: "standing_authorization",
      approvedByUserId: null,
      standingAuthorizationId: "validated-auth",
      standingAuthorizationVersion: 4,
    });
  });

  it("clears caller-supplied standing authorization lineage for explicit approval", () => {
    expect(
      validatedPersistentPolicyEventContext(base, {
        allowed: true,
        authority: "explicit_approval",
        standingAuthorizationId: null,
        standingAuthorizationVersion: null,
      })
    ).toMatchObject({
      authorityBasis: "explicit_approval",
      approvalBasis: "explicit_approval",
      approvedByUserId: "adam",
      standingAuthorizationId: null,
      standingAuthorizationVersion: null,
    });
  });

  it("clears both approval and standing authorization lineage for automatic actions", () => {
    expect(
      validatedPersistentPolicyEventContext(base, {
        allowed: true,
        authority: "automatic",
        standingAuthorizationId: null,
        standingAuthorizationVersion: null,
      })
    ).toMatchObject({
      authorityBasis: "automatic",
      approvalBasis: "automatic",
      approvedByUserId: null,
      standingAuthorizationId: null,
      standingAuthorizationVersion: null,
    });
  });
});

describe("parseOperatorVoiceCommand", () => {
  it("turns bank deposit voice notes into schedule and availability actions", () => {
    const plan = parseOperatorVoiceCommand(
      "Russell needs me to make bank deposits today. I’m leaving Huntington Park at 2:45 and driving back to LA."
    );

    expect(plan.actions.map((action) => action.toolName)).toEqual([
      "createScheduleExceptionTool",
      "updateOperatorAvailabilityTool",
    ]);
    expect(plan.actions[0].input).toMatchObject({
      reason: "bank_deposits",
      locationFrom: "Huntington Park",
      locationTo: "Los Angeles",
    });
    expect(plan.actions[1].input).toMatchObject({
      unavailableReason: "bank_deposits",
      inferredAvailability: expect.stringContaining("4pm"),
    });
  });

  it("turns dry-cleaning pickup notes into intake-pending order and driver stop actions", () => {
    const plan = parseOperatorVoiceCommand(
      "I’m picking up Bailey dry cleaning Century Park East in an hour. No clue what garments yet. Remind me after."
    );

    expect(plan.actions.map((action) => action.toolName)).toEqual([
      "createPendingDryCleaningOrderTool",
      "createDriverStopTool",
    ]);
    expect(plan.actions[0].input).toMatchObject({
      firstName: "Bailey",
      buildingName: "Century Park East",
    });
    expect(plan.actions[1].input).toMatchObject({
      stopType: "pickup",
      buildingName: "Century Park East",
    });
  });
});

describe("parseEmergencyTaskIntake", () => {
  it("turns one messy emergency note into levelized operator tasks", () => {
    const tasks = parseEmergencyTaskIntake(
      "Charge Daniel, call Karin, fix vendor signup, test laundry order flow, create Laundry Farm flyer."
    );

    expect(tasks.map((task) => [task.level, task.title])).toEqual([
      ["level_3", "Charge Daniel"],
      ["level_2", "Call Karin"],
      ["level_4", "Fix vendor signup"],
      ["level_1", "Test laundry order flow"],
      ["level_4", "Create Laundry Farm flyer"],
    ]);
  });

  it("classifies money and flyer tasks from sentence dumps", () => {
    const tasks = parseEmergencyTaskIntake(
      "Collect past due money from OPUS LA customer Ben. Order Laundry Farm flyer via Staples purchase. Create laundry farm flyer."
    );

    expect(tasks.map((task) => [task.level, task.title])).toEqual([
      ["level_3", "Collect past due money from OPUS LA customer Ben"],
      ["level_4", "Order Laundry Farm flyer via Staples purchase"],
      ["level_4", "Create laundry farm flyer"],
    ]);
    expect(tasks.every((task) => task.classificationReason.length > 0)).toBe(true);
  });

  it("recognizes Level 4 boss work separately from product fixes", () => {
    const tasks = parseEmergencyTaskIntake(
      "Text Christopher for the Building 3 intro and fix admin.bldg.chat intake composer"
    );

    expect(tasks[0]).toMatchObject({ level: "level_4" });
    expect(tasks[1]).toMatchObject({ level: "level_1" });
  });

  it("does not expose raw SQL errors to the emergency composer UI", () => {
    const raw = "Failed query: insert into `agent_events` values (...)";
    expect(publicEmergencyTaskErrorMessage(new Error(raw))).toBe("Task could not be saved. Please try again.");
  });
});
