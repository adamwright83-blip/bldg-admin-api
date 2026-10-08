import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  ActionExecutionGateError,
  assertActionExecutionAdmission,
  executeAdmittedAction,
} from "./actionExecutionGate";

const liveConversation = () => ({
  actionName: "commit_day_line",
  authorityBasis: "current_turn_explicit_request",
  source: { kind: "conversation" as const },
  expiresAtMs: 10_000,
  constraints: { mutationAllowed: true, shadowOnly: false },
});

describe("neutral action execution gate", () => {
  it("executes admitted conversational work through the same final fence", async () => {
    const execute = vi.fn(async () => "done");
    await expect(
      executeAdmittedAction(liveConversation(), {
        execute,
        nowMs: 1_000,
      })
    ).resolves.toEqual({ executed: true, result: "done" });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("keeps shadow authority inert", async () => {
    const execute = vi.fn(async () => "must-not-run");
    await expect(
      executeAdmittedAction(
        {
          ...liveConversation(),
          constraints: { mutationAllowed: false, shadowOnly: true },
        },
        { execute, nowMs: 1_000 }
      )
    ).resolves.toEqual({ executed: false, reason: "shadow_only" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects expired authority before execution", () => {
    expect(() =>
      assertActionExecutionAdmission(
        { ...liveConversation(), expiresAtMs: 999 },
        1_000
      )
    ).toThrow(ActionExecutionGateError);
  });

  it("rejects background tenant or canonical-operator drift", () => {
    expect(() =>
      assertActionExecutionAdmission(
        {
          actionName: "place_weekly_planning_call",
          tenantId: "tenant-a",
          canonicalOperatorId: "canonical-a",
          authorityBasis: "scheduled_operator_appointment",
          source: {
            kind: "background_grant",
            tenantId: "tenant-b",
            canonicalOperatorId: "canonical-a",
          },
          expiresAtMs: 10_000,
          constraints: { mutationAllowed: true, shadowOnly: false },
        },
        1_000
      )
    ).toThrow(/does not match execution tenant/);
  });

  it("requires durable source and idempotency lineage for background jobs", () => {
    expect(() =>
      assertActionExecutionAdmission(
        {
          actionName: "place_weekly_planning_call",
          tenantId: "tenant-a",
          canonicalOperatorId: "canonical-a",
          authorityBasis: "scheduled_operator_appointment",
          source: {
            kind: "durable_background",
            tenantId: "tenant-a",
            canonicalOperatorId: "canonical-a",
            sourceReference: "",
            idempotencyKey: "job-key",
          },
          expiresAtMs: 10_000,
          constraints: { mutationAllowed: true, shadowOnly: false },
        },
        1_000
      )
    ).toThrow(/durable sourceReference/);

    expect(() =>
      assertActionExecutionAdmission(
        {
          actionName: "place_weekly_planning_call",
          tenantId: "tenant-a",
          canonicalOperatorId: "canonical-a",
          authorityBasis: "scheduled_operator_appointment",
          source: {
            kind: "durable_background",
            tenantId: "tenant-a",
            canonicalOperatorId: "canonical-a",
            sourceReference: "appointment:1",
            idempotencyKey: "",
          },
          expiresAtMs: 10_000,
          constraints: { mutationAllowed: true, shadowOnly: false },
        },
        1_000
      )
    ).toThrow(/durable idempotencyKey/);
  });

  it("keeps background admission out of Claire Brain", () => {
    const appointment = readFileSync(
      path.join(
        process.cwd(),
        "server/persistentOperator/operatorAppointmentExecution.ts"
      ),
      "utf8"
    );
    const persistentGate = readFileSync(
      path.join(
        process.cwd(),
        "server/persistentOperator/actionExecution.ts"
      ),
      "utf8"
    );
    const claireGateway = readFileSync(
      path.join(
        process.cwd(),
        "server/claire/brain/actions/gateway.ts"
      ),
      "utf8"
    );

    expect(appointment).toMatch(/from "\.\/actionExecution"/);
    expect(appointment).not.toMatch(/executeClairePersistentOperatorAction/);
    expect(persistentGate).not.toMatch(/claire\/brain|claireTwilio/);
    expect(persistentGate).toMatch(/authority\/actionExecutionGate/);
    expect(claireGateway).toMatch(/authority\/actionExecutionGate/);
  });
});
