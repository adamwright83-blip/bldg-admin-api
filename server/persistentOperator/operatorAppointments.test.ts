import { describe, expect, it } from "vitest";
import { targetWeekHorizon } from "../../shared/weeklyMissionReadiness";
import { getAgentToolPolicy } from "../agents/toolRegistry";
import { parseWeeklyPlanningCallbackRequest } from "./operatorAppointmentPolicy";

describe("Persistent Growth PR3 authority and appointment contracts", () => {
  it("targets the coming Monday-Friday when planning is opened on Sunday", () => {
    const horizon = targetWeekHorizon({
      businessDate: "2026-10-04",
      localTime: "18:00",
      weekStart: "2026-10-05",
    });
    expect(horizon.weekStart).toBe("2026-10-05");
    expect(horizon.remainingDates).toEqual([
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
      "2026-10-08",
      "2026-10-09",
    ]);
    expect(horizon.todayIsRemnant).toBe(false);
  });

  it("resolves an unqualified 7 inside the Sunday planning window and requires readback confirmation", () => {
    const parsed = parseWeeklyPlanningCallbackRequest({
      utterance: "Call me at 7",
      now: new Date("2026-10-05T00:15:00.000Z"),
      timeZone: "America/Los_Angeles",
    });
    expect(parsed.kind).toBe("request");
    if (parsed.kind !== "request") return;
    expect(parsed.inferredMeridiem).toBe(true);
    expect(parsed.readback).toBe("7:00 PM");
    expect(parsed.scheduledFor.toISOString()).toBe("2026-10-05T02:00:00.000Z");
  });

  it("respects an explicitly named callback outside the default 5-8 PM window", () => {
    const parsed = parseWeeklyPlanningCallbackRequest({
      utterance: "Call me back at 9 PM",
      now: new Date("2026-10-05T00:15:00.000Z"),
      timeZone: "America/Los_Angeles",
    });
    expect(parsed.kind).toBe("request");
    if (parsed.kind !== "request") return;
    expect(parsed.inferredMeridiem).toBe(false);
    expect(parsed.readback).toBe("9:00 PM");
    expect(parsed.scheduledFor.toISOString()).toBe("2026-10-05T04:00:00.000Z");
  });

  it("assigns server-owned tool risk classes and fails unclassified tools closed", () => {
    expect(getAgentToolPolicy("getResidentContextTool").riskClass).toBe(
      "READ_ONLY"
    );
    expect(getAgentToolPolicy("sendCustomerReminderTool").riskClass).toBe(
      "EXTERNAL_COMMUNICATION"
    );
    expect(getAgentToolPolicy("createLaundryOrderTool").riskClass).toBe(
      "FINANCIAL_OR_CONTRACTUAL"
    );
  });
});
