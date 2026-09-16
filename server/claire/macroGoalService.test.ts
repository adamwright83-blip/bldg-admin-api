import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { OperatorMacroGoal } from "../../drizzle/schema";
import {
  getActiveMacroGoal,
  setActiveMacroGoal,
  type MacroGoalPersistence,
} from "./macroGoalService";

function row(overrides: Partial<OperatorMacroGoal> = {}): OperatorMacroGoal {
  return {
    id: "goal-1",
    tenantId: "tenant-1",
    operatorUserId: "operator-1",
    objective: "Get to 50 active customers",
    metricKey: "active_customers",
    targetValue: "50.00",
    unit: "customers",
    urgencyText: "ASAP",
    targetDate: null,
    source: "operator_attested",
    sourceNote: "Operator attested",
    status: "active",
    supersededById: null,
    createdAt: new Date("2026-09-14T00:00:00.000Z"),
    updatedAt: new Date("2026-09-14T00:00:00.000Z"),
    ...overrides,
  };
}

function memoryPersistence(initial: OperatorMacroGoal[]): MacroGoalPersistence {
  const rows = [...initial];
  return {
    async getActive(input) {
      return rows.find(candidate =>
        candidate.tenantId === input.tenantId &&
        candidate.operatorUserId === input.operatorUserId &&
        candidate.status === "active" &&
        (!input.metricKey || candidate.metricKey === input.metricKey)
      ) ?? null;
    },
    async replaceActive(input) {
      for (const candidate of rows) {
        if (candidate.tenantId === input.tenantId && candidate.operatorUserId === input.operatorUserId && candidate.metricKey === input.metricKey && candidate.status === "active") {
          candidate.status = "superseded";
          candidate.supersededById = input.id;
        }
      }
      const saved = row({ ...input, targetValue: input.targetValue.toFixed(2), status: "active" });
      rows.push(saved);
      return saved;
    },
  };
}

describe("operator macro goals", () => {
  it("reports an unknown goal as absent", async () => {
    expect(await getActiveMacroGoal({ tenantId: "tenant-1", operatorUserId: "operator-1" }, memoryPersistence([]))).toBeNull();
  });

  it("retrieves the active goal with a numeric target", async () => {
    expect(await getActiveMacroGoal({ tenantId: "tenant-1", operatorUserId: "operator-1" }, memoryPersistence([row()]))).toMatchObject({
      objective: "Get to 50 active customers",
      targetValue: 50,
    });
  });

  it.each(["superseded", "closed"] as const)("does not return a %s goal", async status => {
    expect(await getActiveMacroGoal({ tenantId: "tenant-1", operatorUserId: "operator-1" }, memoryPersistence([row({ status })]))).toBeNull();
  });

  it("isolates tenants and operators", async () => {
    const persistence = memoryPersistence([row()]);
    expect(await getActiveMacroGoal({ tenantId: "tenant-2", operatorUserId: "operator-1" }, persistence)).toBeNull();
    expect(await getActiveMacroGoal({ tenantId: "tenant-1", operatorUserId: "operator-2" }, persistence)).toBeNull();
  });

  it("atomically supersedes the scoped active goal", async () => {
    const persistence = memoryPersistence([row()]);
    const saved = await setActiveMacroGoal({
      tenantId: "tenant-1",
      operatorUserId: "operator-1",
      objective: "Get to 60 active customers",
      metricKey: "active_customers",
      targetValue: 60,
      unit: "customers",
      source: "admin",
      sourceNote: "Explicit admin update",
    }, persistence);
    expect(saved.targetValue).toBe(60);
    expect(await getActiveMacroGoal({ tenantId: "tenant-1", operatorUserId: "operator-1" }, persistence)).toMatchObject({ id: saved.id, objective: "Get to 60 active customers" });
  });

  it("persists and restores secondaryTargets structured metadata", async () => {
    const saved = await setActiveMacroGoal({
      tenantId: "tenant-secondary-1",
      operatorUserId: "operator-1",
      objective: "Expand route revenue",
      metricKey: "paid_orders_per_period",
      targetValue: 100,
      unit: "orders",
      secondaryTargets: [
        { metricType: "active_customers", targetValue: 35, unit: "accounts" },
        { metricType: "net_sales_per_period", targetValue: 5000, unit: "USD" },
      ],
      source: "admin",
      sourceNote: "Secondary metric stretch targets",
    });

    expect(saved.targetValue).toBe(100);
    expect(saved.secondaryTargets).toEqual([
      { metricType: "active_customers", targetValue: 35, unit: "accounts" },
      { metricType: "net_sales_per_period", targetValue: 5000, unit: "USD" },
    ]);

    const retrieved = await getActiveMacroGoal({
      tenantId: "tenant-secondary-1",
      operatorUserId: "operator-1",
      metricKey: "paid_orders_per_period",
    });

    expect(retrieved).not.toBeNull();
    expect(retrieved?.secondaryTargets).toEqual([
      { metricType: "active_customers", targetValue: 35, unit: "accounts" },
      { metricType: "net_sales_per_period", targetValue: 5000, unit: "USD" },
    ]);
  });

  it("exposes goal writes only through the structured admin mutation, not the voice loop", () => {
    const router = readFileSync(new URL("./claireRouter.ts", import.meta.url), "utf8");
    const voiceLoop = readFileSync(new URL("./voiceCommitmentLoop.ts", import.meta.url), "utf8");
    expect(router).toMatch(/setMacroGoal:\s*adminProcedure/);
    expect(voiceLoop).not.toContain("setActiveMacroGoal");
  });
});

