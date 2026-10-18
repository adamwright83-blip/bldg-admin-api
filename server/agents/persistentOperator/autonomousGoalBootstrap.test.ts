import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

/**
 * Stage 1 · 1D: the bootstrap sweep only ensures runs and live cycles. It never
 * prepares, and one failing goal cannot abort the sweep for the others.
 */
const goals = vi.hoisted(() => [
  { id: "goal-a", tenantId: "tenant-a", operatorUserId: "op-a", status: "active", metricKey: "m" },
  { id: "goal-b", tenantId: "tenant-b", operatorUserId: "op-b", status: "active", metricKey: "m" },
]);
vi.mock("../../db", () => ({
  getDb: vi.fn(async () => ({
    select: () => ({
      from: () => ({
        where: (/* active goals or active run */) => {
          const rows = Promise.resolve(goals) as Promise<unknown[]> & { limit: (n: number) => Promise<unknown[]> };
          rows.limit = async () => [{ id: "run-existing" }];
          return rows;
        },
      }),
    }),
  })),
}));
vi.mock("./identity", () => ({
  resolveCanonicalOperatorIdentity: vi.fn(async ({ tenantId }: { tenantId: string }) => {
    if (tenantId === "tenant-a") throw new Error("identity store timeout");
    return { ok: true, identity: { tenantId } };
  }),
}));
vi.mock("./operatorAppointmentPolicy", () => ({
  ensureSundayPlanningAppointment: vi.fn(async () => null),
}));

const { ensureAutonomousGoalBootstrap } = await import("./autonomousWorkerService");

describe("autonomous goal bootstrap", () => {
  it("isolates each goal: a failure for one tenant still ensures the next tenant's cycle", async () => {
    const ensureLiveScheduledTick = vi.fn(async () => ({ id: "tick-b", queued: true }));
    const outcome = await ensureAutonomousGoalBootstrap({
      store: { ensureLiveScheduledTick },
      appointmentStore: {} as never,
    });
    expect(outcome.failed).toEqual([{ tenantId: "tenant-a", goalId: "goal-a", error: "identity store timeout" }]);
    expect(ensureLiveScheduledTick).toHaveBeenCalledTimes(1);
    expect(ensureLiveScheduledTick).toHaveBeenCalledWith({ tenantId: "tenant-b", goalRunId: "run-existing", now: undefined });
    expect(outcome).toMatchObject({ checked: 2, queued: 1 });
  });

  it("never prepares or schedules strategy calls, and never mints hourly auto ticks", () => {
    const source = readFileSync(join(import.meta.dirname, "autonomousWorkerService.ts"), "utf8");
    const start = source.indexOf("export async function ensureAutonomousGoalBootstrap(");
    const end = source.indexOf("export async function", start + 1);
    const bootstrap = source.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(bootstrap).not.toMatch(/prepareStrategicProposal|scheduleAuthorizedStrategicCall|decideGoalCycle|planForDate|auto_tick|\.enqueue\(/);
    expect(bootstrap).toMatch(/ensureLiveScheduledTick\(/);
    expect(source).not.toMatch(/from "\.\.\/\.\.\/strategy\/strategicPreparation"/);
  });
});
