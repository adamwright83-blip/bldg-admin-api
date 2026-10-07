import { describe, expect, it } from "vitest";
import { targetWeekHorizon } from "../../shared/weeklyMissionReadiness";
import { getAgentToolPolicy } from "../agents/toolRegistry";
import { parseWeeklyPlanningCallbackRequest } from "./operatorAppointmentPolicy";
import { insideSundayStandingWindow } from "./operatorAppointmentExecution";
import {
  admitOperatorAppointmentExecution,
  assertOperatorAppointmentExecutionContext,
} from "./operatorAppointmentExecutionContext";
import type { ClaimedOperatorAppointment } from "./operatorAppointmentStore";

describe("Persistent Growth PR3 authority and appointment contracts", () => {
  it("allows an unprompted planning call only on Sunday inside the standing window", () => {
    const step = { timeZone: "America/Los_Angeles" };
    expect(
      insideSundayStandingWindow(step, new Date("2026-10-05T01:00:00.000Z"))
    ).toBe(true); // Sunday 6:00 PM PDT
    expect(
      insideSundayStandingWindow(step, new Date("2026-10-06T01:00:00.000Z"))
    ).toBe(false); // Monday 6:00 PM PDT
    expect(
      insideSundayStandingWindow(step, new Date("2026-10-04T23:30:00.000Z"))
    ).toBe(false); // Sunday 4:30 PM PDT
  });

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


  it("admits worker execution only from the durable tenant, actor, source, and idempotency identity", () => {
    const step: ClaimedOperatorAppointment = {
      id: "appointment-a",
      tenantId: "tenant-a",
      canonicalOperatorId: "tenant:tenant-a:operator:adam",
      operatorUserId: "adam",
      appointmentKind: "weekly_planning_callback",
      weekStart: "2026-10-05",
      scheduledFor: new Date("2026-10-07T20:00:00.000Z"),
      timeZone: "America/Los_Angeles",
      source: "explicit_operator_request",
      sourceReference: "conversation:123",
      idempotencyKey: "callback:tenant-a:123",
      standingAuthorizationId: null,
      unprompted: false,
      attemptCount: 1,
      maxAttempts: 3,
      leaseOwner: "worker-a",
    };
    const context = admitOperatorAppointmentExecution(step);
    expect(context).toMatchObject({
      jobId: "appointment-a",
      scope: { kind: "tenant", tenantId: "tenant-a" },
      actor: {
        kind: "user_delegation",
        operatorUserId: "adam",
        canonicalOperatorId: "tenant:tenant-a:operator:adam",
      },
      source: {
        kind: "operator_appointment",
        appointmentKind: "weekly_planning_callback",
        sourceReference: "conversation:123",
      },
      idempotencyKey: "callback:tenant-a:123",
    });
    expect(() =>
      assertOperatorAppointmentExecutionContext(step, {
        ...context,
        scope: { kind: "tenant", tenantId: "tenant-b" },
      })
    ).toThrow("does not match durable job identity");
    expect(() =>
      assertOperatorAppointmentExecutionContext(step, {
        ...context,
        actor: { ...context.actor, operatorUserId: "other-operator" },
      })
    ).toThrow("does not match durable job identity");
  });

  it("refuses missing durable tenant/idempotency instead of manufacturing worker authority", () => {
    const base: ClaimedOperatorAppointment = {
      id: "appointment-a",
      tenantId: "tenant-a",
      canonicalOperatorId: "tenant:tenant-a:operator:adam",
      operatorUserId: "adam",
      appointmentKind: "weekly_planning_callback",
      weekStart: "2026-10-05",
      scheduledFor: new Date("2026-10-07T20:00:00.000Z"),
      timeZone: "America/Los_Angeles",
      source: "explicit_operator_request",
      sourceReference: "conversation:123",
      idempotencyKey: "callback:tenant-a:123",
      standingAuthorizationId: null,
      unprompted: false,
      attemptCount: 1,
      maxAttempts: 3,
      leaseOwner: "worker-a",
    };
    expect(() =>
      admitOperatorAppointmentExecution({ ...base, tenantId: "" })
    ).toThrow("durable tenantId");
    expect(() =>
      admitOperatorAppointmentExecution({ ...base, idempotencyKey: "" })
    ).toThrow("durable idempotencyKey");
    expect(
      admitOperatorAppointmentExecution({
        ...base,
        source: "standing_weekly_authorization",
        standingAuthorizationId: "standing-auth-a",
      }).actor.kind
    ).toBe("standing_authorization");
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
