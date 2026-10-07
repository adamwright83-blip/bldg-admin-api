import { describe, expect, it } from "vitest";
import { requireClaireCallExecutionProof } from "./operatorAppointmentExecution";
import {
  admitOperatorAppointmentExecution,
  assertOperatorAppointmentExecutionContext,
} from "./operatorAppointmentExecutionContext";
import {
  OperatorAppointmentStore,
  type ClaimedOperatorAppointment,
} from "./operatorAppointmentStore";

describe("operator appointment execution proof", () => {
  it("requires both provider acceptance identity and durable communication receipt", () => {
    expect(
      requireClaireCallExecutionProof({
        callSid: "CA123",
        communicationReceiptId: "receipt-123",
      })
    ).toEqual({
      callSid: "CA123",
      communicationReceiptId: "receipt-123",
    });

    expect(() =>
      requireClaireCallExecutionProof({
        callSid: "CA123",
      })
    ).toThrow("no durable communication receipt");

    expect(() =>
      requireClaireCallExecutionProof({
        communicationReceiptId: "receipt-123",
      })
    ).toThrow("no call SID");

    expect(() => requireClaireCallExecutionProof(null)).toThrow("no call SID");
  });
});


const durableAppointment = (
  overrides: Partial<ClaimedOperatorAppointment> = {}
): ClaimedOperatorAppointment => ({
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
  ...overrides,
});

describe("operator appointment worker admission context", () => {
  it("carries only durable job, tenant, actor, source, and idempotency identity", () => {
    expect(admitOperatorAppointmentExecution(durableAppointment())).toEqual({
      jobId: "appointment-a",
      scope: {
        kind: "tenant",
        tenantId: "tenant-a",
      },
      actor: {
        kind: "user_delegation",
        operatorUserId: "adam",
        canonicalOperatorId: "tenant:tenant-a:operator:adam",
        standingAuthorizationId: null,
      },
      source: {
        kind: "operator_appointment",
        appointmentKind: "weekly_planning_callback",
        sourceReference: "conversation:123",
      },
      idempotencyKey: "callback:tenant-a:123",
    });
  });

  it("does not manufacture a default tenant or execute without durable idempotency", () => {
    expect(() =>
      admitOperatorAppointmentExecution(
        durableAppointment({ tenantId: "" })
      )
    ).toThrow("durable tenantId");
    expect(() =>
      admitOperatorAppointmentExecution(
        durableAppointment({ idempotencyKey: "" })
      )
    ).toThrow("durable idempotencyKey");
  });

  it("keeps explicit user delegation distinct from standing authorization", () => {
    const standing = admitOperatorAppointmentExecution(
      durableAppointment({
        source: "standing_weekly_authorization",
        sourceReference: "operator_rule:2026-09-28:sunday_weekly_planning",
        standingAuthorizationId: "standing-auth-a",
        idempotencyKey: "sunday:tenant-a:2026-10-05",
      })
    );
    expect(standing.actor).toMatchObject({
      kind: "standing_authorization",
      standingAuthorizationId: "standing-auth-a",
    });
  });

  it("rejects a context whose tenant scope no longer matches the durable job", () => {
    const step = durableAppointment();
    const context = admitOperatorAppointmentExecution(step);
    expect(() =>
      assertOperatorAppointmentExecutionContext(step, {
        ...context,
        scope: { kind: "tenant", tenantId: "tenant-b" },
      })
    ).toThrow("does not match durable job identity");
  });

  it("rejects actor provenance that does not match the durable job", () => {
    const step = durableAppointment();
    const context = admitOperatorAppointmentExecution(step);
    expect(() =>
      assertOperatorAppointmentExecutionContext(step, {
        ...context,
        actor: {
          ...context.actor,
          operatorUserId: "other-operator",
        },
      })
    ).toThrow("does not match durable job identity");
  });

  it("rejects invalid tenant scope before persistence can create a worker job", async () => {
    const store = new OperatorAppointmentStore({} as never);
    await expect(
      store.enqueue({
        tenantId: "",
        canonicalOperatorId: "tenant:tenant-a:operator:adam",
        operatorUserId: "adam",
        appointmentKind: "weekly_planning_callback",
        weekStart: "2026-10-05",
        scheduledFor: new Date("2026-10-07T20:00:00.000Z"),
        timeZone: "America/Los_Angeles",
        source: "explicit_operator_request",
        sourceReference: "conversation:123",
        standingAuthorizationId: null,
        unprompted: false,
        idempotencyKey: "callback:tenant-a:123",
      })
    ).rejects.toThrow("tenantId is required");
  });
});
