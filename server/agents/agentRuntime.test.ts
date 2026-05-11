import { describe, expect, it } from "vitest";
import { parseOperatorVoiceCommand } from "./agentRuntime";
import { parseEmergencyTaskIntake } from "../operatorTaskIntake";

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
      "Need to charge Daniel, call Karin, fix vendor signup, and test laundry order flow."
    );

    expect(tasks.map((task) => [task.level, task.title])).toEqual([
      ["level_1", "Charge Daniel"],
      ["level_2", "Call Karin"],
      ["level_3", "Fix vendor signup"],
      ["level_3", "Test laundry order flow."],
    ]);
  });

  it("recognizes Level 4 boss work separately from product fixes", () => {
    const tasks = parseEmergencyTaskIntake(
      "Text Christopher for the Building 3 intro and fix admin.bldg.chat intake composer"
    );

    expect(tasks[0]).toMatchObject({ level: "level_4" });
    expect(tasks[1]).toMatchObject({ level: "level_3" });
  });
});
