import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { macroGoalRuns, operatorMacroGoals } from "../../../drizzle/schema";

// Stage 1 1D: the supervisor sweep only ensures runs and one live tick per run.
// Preparation and call scheduling happen in the leased goal-cycle step, and one
// goal's failure does not stop the sweep for the others.

const mocks = vi.hoisted(() => ({
  prepareStrategicProposal: vi.fn(),
  scheduleAuthorizedStrategicCall: vi.fn(),
  ensureSundayPlanningAppointment: vi.fn(),
  resolveCanonicalOperatorIdentity: vi.fn(),
}));

vi.mock("../../db", () => ({
  getDb: async () => ({
    select: () => ({
      from: (table: unknown) => {
        const rows =
          table === operatorMacroGoals
            ? [
                { id: "goal-a", tenantId: "tenant-a", operatorUserId: "op-a", metricKey: "active_customers", status: "active" },
                { id: "goal-b", tenantId: "tenant-b", operatorUserId: "op-b", metricKey: "active_customers", status: "active" },
              ]
            : table === macroGoalRuns
              ? [{ id: "run-b" }]
              : [];
        const chain = {
          where: () => chain,
          limit: async () => rows,
          then: (resolve: (value: unknown) => unknown) => resolve(rows),
        };
        return chain;
      },
    }),
  }),
}));
vi.mock("./identity", () => ({
  resolveCanonicalOperatorIdentity: mocks.resolveCanonicalOperatorIdentity,
}));
vi.mock("../../strategy/strategicPreparation", () => ({
  prepareStrategicProposal: mocks.prepareStrategicProposal,
}));
vi.mock("./strategicCallAuthorization", () => ({
  scheduleAuthorizedStrategicCall: mocks.scheduleAuthorizedStrategicCall,
}));
vi.mock("./operatorAppointmentPolicy", () => ({
  ensureSundayPlanningAppointment: mocks.ensureSundayPlanningAppointment,
  resolveOperatorTimeZone: vi.fn(async () => "America/Los_Angeles"),
}));

import { ensureAutonomousGoalBootstrap } from "./autonomousWorkerService";

describe("autonomous goal bootstrap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveCanonicalOperatorIdentity.mockImplementation(async (input: { tenantId: string }) => {
      if (input.tenantId === "tenant-a") throw new Error("identity store timed out");
      return { ok: true, identity: { tenantId: input.tenantId, canonicalOperatorId: `tenant:${input.tenantId}:operator:op` } };
    });
  });

  it("never prepares or schedules calls, and one goal's failure does not stop the sweep", async () => {
    const store = {
      ensureLiveScheduledTick: vi.fn(async () => ({ id: "tick-b", created: true, reason: "created" as const })),
    };
    const result = await ensureAutonomousGoalBootstrap({ store });

    expect(mocks.prepareStrategicProposal).not.toHaveBeenCalled();
    expect(mocks.scheduleAuthorizedStrategicCall).not.toHaveBeenCalled();
    expect(mocks.ensureSundayPlanningAppointment).not.toHaveBeenCalled();
    expect(result.errors).toEqual([
      { tenantId: "tenant-a", goalId: "goal-a", error: "identity store timed out" },
    ]);
    expect(store.ensureLiveScheduledTick).toHaveBeenCalledTimes(1);
    expect(store.ensureLiveScheduledTick).toHaveBeenCalledWith({
      tenantId: "tenant-b",
      goalRunId: "run-b",
      triggerSourceReference: "autonomous_supervisor:heartbeat",
    });
    expect(result).toMatchObject({ goals: 2, createdTickIds: ["tick-b"] });
  });

  it("the sweep's source has no path to preparation or call scheduling", () => {
    const source = readFileSync("server/agents/persistentOperator/autonomousWorkerService.ts", "utf8");
    const start = source.indexOf("export async function ensureAutonomousGoalBootstrap");
    const end = source.indexOf("export async function ensureOperatorAppointmentSchedule");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const sweep = source.slice(start, end);
    expect(sweep).not.toMatch(/prepareStrategicProposal|scheduleAuthorizedStrategicCall|ensureSundayPlanningAppointment|\.enqueue\(/);
    expect(sweep).toMatch(/ensureLiveScheduledTick/);
  });
});
