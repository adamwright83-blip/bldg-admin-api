import { describe, expect, it } from "vitest";
import { parseOperatorVoiceCommand } from "./agentRuntime";

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
