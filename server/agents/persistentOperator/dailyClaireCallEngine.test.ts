import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const started: Array<Record<string, unknown>> = [];

vi.mock("../../claire/claireModelHealth", () => ({
  checkClaireModelHealth: async () => ({ ok: true }),
  claireModelDownText: () => "",
}));
vi.mock("./actionExecution", () => ({
  executePersistentOperatorAction: async (input: { execute: () => Promise<unknown> }) => ({ executed: true, result: await input.execute() }),
}));
vi.mock("../agentEvents", () => ({ logAgentEvent: async () => undefined }));
vi.mock("../../claire/claireTwilio", () => ({
  startClairePreDriveCall: async (input: Record<string, unknown>) => {
    started.push(input);
    return { callSid: "CA1", brief: "", communicationReceiptId: "r1" };
  },
}));
vi.mock("../../claire/showrunner/showrunnerBriefing", () => ({
  buildShowrunnerBriefing: async () => ({}),
  composeShowrunnerOpening: () => ({ text: "Scripted showrunner opening.", askedCarried: false }),
  preparedItemSpoken: () => null,
}));
vi.mock("../daphne/decisionPointSeam", () => ({ prepareDaphneCallDecision: async () => null }));

import { executeDailyClaireCall } from "./operatorAppointmentExecution";

const step = {
  id: "appt-1",
  tenantId: "default",
  canonicalOperatorId: "tenant:default:operator:adam-admin",
  operatorUserId: "adam-admin",
  appointmentKind: "evening_debrief",
  timeZone: "America/Los_Angeles",
} as never;

const context = {
  jobId: "appt-1",
  scope: { kind: "tenant", tenantId: "default" },
  actor: { kind: "user_delegation", operatorUserId: "adam-admin", canonicalOperatorId: "tenant:default:operator:adam-admin", standingAuthorizationId: "auth-1" },
  source: { kind: "operator_appointment", appointmentKind: "evening_debrief", sourceReference: "daily" },
  idempotencyKey: "idem-1",
} as never;

const identity = {
  tenantId: "default",
  canonicalOperatorId: "tenant:default:operator:adam-admin",
  canonicalOpenId: "adam-admin",
  communicationOperatorUserId: "adam-admin",
  dayDirectorActorId: "7",
  dayDirectorActorIds: ["7"],
} as never;

const store = { beginDailyCallDispatch: async () => true } as never;

describe("scheduled daily Claire calls pick the engine before dialing", () => {
  const env = { ...process.env };
  beforeEach(() => {
    started.length = 0;
  });
  afterEach(() => {
    process.env = { ...env };
  });

  it("an operator on the native-tool switch gets the native engine: no scripted opening, the purpose travels with the call", async () => {
    process.env.CLAIRE_NATIVE_TOOL_OPERATOR_IDS = "default:adam-admin";
    delete process.env.CLAIRE_NATIVE_TOOL_KILL_SWITCH;
    const result = await executeDailyClaireCall({ step, now: new Date("2026-10-30T00:30:00Z"), store, context, identity, purpose: "evening_debrief" });
    expect(result).toMatchObject({ callSid: "CA1" });
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({ nativeToolPurpose: "evening_debrief", sessionKindOverride: "evening_debrief", actorId: "adam-admin", dayDirectorActorId: "7" });
    expect(started[0]!.openingOverride).toBeUndefined();
    expect(started[0]!.showrunner).toBeUndefined();
  });

  it("everyone else, and everyone when the kill switch is on, stays on Brain V2 with the showrunner opening", async () => {
    process.env.CLAIRE_NATIVE_TOOL_OPERATOR_IDS = "default:someone-else";
    await executeDailyClaireCall({ step, now: new Date("2026-10-30T00:30:00Z"), store, context, identity, purpose: "morning_readiness" });
    process.env.CLAIRE_NATIVE_TOOL_OPERATOR_IDS = "default:adam-admin";
    process.env.CLAIRE_NATIVE_TOOL_KILL_SWITCH = "1";
    await executeDailyClaireCall({ step, now: new Date("2026-10-30T00:30:00Z"), store, context, identity, purpose: "evening_debrief" });
    expect(started).toHaveLength(2);
    for (const call of started) {
      expect(call.nativeToolPurpose).toBeUndefined();
      expect(call.openingOverride).toBe("Scripted showrunner opening.");
      expect(call.showrunner).toBeTruthy();
    }
  });
});
