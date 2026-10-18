import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { operatorMacroGoals, type OperatorMacroGoal } from "../../drizzle/schema";
import { assertOutcomeMetricKey } from "../../shared/operatingMandate";
import { getDb } from "../db";

export const GOAL_METRIC_TYPES = [
  "new_paying_customers",
  "active_customers",
  "paid_orders_per_period",
  "net_sales_per_period",
] as const;

export type GoalMetricType = (typeof GOAL_METRIC_TYPES)[number] | string;

export type SecondaryTarget = {
  metricType: GoalMetricType;
  targetValue: number;
  unit?: string;
};

export type MacroGoal = Omit<OperatorMacroGoal, "targetValue"> & {
  targetValue: number;
  secondaryTargets?: SecondaryTarget[];
};

export type MacroGoalSource = "operator_attested" | "admin";

export type SetActiveMacroGoalInput = {
  tenantId: string;
  operatorUserId: string;
  objective: string;
  metricKey: string;
  targetValue: number;
  unit: string;
  urgencyText?: string | null;
  targetDate?: string | null;
  secondaryTargets?: SecondaryTarget[];
  source: MacroGoalSource;
  sourceNote: string;
  /**
   * An explicit replacement: this active goal of the same operator is
   * superseded by the new one even when it measures a different metric. A new
   * goal on a different metric without it is an additional goal, not a
   * replacement.
   */
  replacesGoalId?: string | null;
};

const inMemoryGoals = new Map<string, OperatorMacroGoal[]>();

function allowInMemoryMacroGoalFallback(): boolean {
  return process.env.NODE_ENV === "test" || process.env.VITEST === "true";
}

export function resetInMemoryGoalsForTesting(): void {
  inMemoryGoals.clear();
}

export type MacroGoalPersistence = {
  getActive(input: {
    tenantId: string;
    operatorUserId: string;
    metricKey?: string;
  }): Promise<OperatorMacroGoal | null>;
  replaceActive(
    input: SetActiveMacroGoalInput & { id: string }
  ): Promise<OperatorMacroGoal>;
};

/** A stored goal row as a MacroGoal (numeric target, parsed secondary targets). */
export function normalizeMacroGoalRow(row: OperatorMacroGoal): MacroGoal {
  return normalize(row)!;
}

function normalize(row: OperatorMacroGoal | null): MacroGoal | null {
  if (!row) return null;
  let secondaryTargets: SecondaryTarget[] | undefined;
  if (row.secondaryTargetsJson) {
    if (typeof row.secondaryTargetsJson === "string") {
      try {
        secondaryTargets = JSON.parse(row.secondaryTargetsJson);
      } catch {
        secondaryTargets = undefined;
      }
    } else if (Array.isArray(row.secondaryTargetsJson)) {
      secondaryTargets = row.secondaryTargetsJson as SecondaryTarget[];
    }
  }
  return {
    ...row,
    targetValue: Number(row.targetValue),
    secondaryTargets,
  };
}

export const databaseMacroGoalPersistence: MacroGoalPersistence = {
  async getActive(input) {
    const tenantId = input.tenantId.trim();
    if (!tenantId) throw new Error("Macro goal read requires tenant authority");
    const db = await getDb();
    if (!db) {
      if (!allowInMemoryMacroGoalFallback()) {
        throw new Error("Database unavailable");
      }
      const list = inMemoryGoals.get(tenantId) ?? [];
      const match =
        list.find(
          candidate =>
            candidate.tenantId === tenantId &&
            (candidate.operatorUserId === input.operatorUserId ||
              !input.operatorUserId ||
              input.operatorUserId === "owner") &&
            candidate.status === "active" &&
            (!input.metricKey || candidate.metricKey === input.metricKey)
        );
      return match ?? null;
    }
    const conditions = [
      eq(operatorMacroGoals.tenantId, tenantId),
      eq(operatorMacroGoals.status, "active"),
    ];
    if (input.operatorUserId && input.operatorUserId !== "owner") {
      conditions.push(
        eq(operatorMacroGoals.operatorUserId, input.operatorUserId)
      );
    }
    if (input.metricKey) {
      conditions.push(eq(operatorMacroGoals.metricKey, input.metricKey));
    }
    const [row] = await db
      .select()
      .from(operatorMacroGoals)
      .where(and(...conditions))
      .orderBy(desc(operatorMacroGoals.updatedAt))
      .limit(1);
    return row ?? null;
  },

  async replaceActive(input) {
    const tenantId = input.tenantId.trim();
    const operatorUserId = input.operatorUserId.trim();
    if (!tenantId || !operatorUserId) {
      throw new Error("Macro goal write requires tenant and operator authority");
    }
    const db = await getDb();
    if (!db) {
      if (!allowInMemoryMacroGoalFallback()) {
        throw new Error("Database unavailable");
      }
      const list = inMemoryGoals.get(tenantId) ?? [];
      const replaced = input.replacesGoalId
        ? list.find(c => c.id === input.replacesGoalId && c.operatorUserId === operatorUserId && c.status === "active")
        : null;
      if (input.replacesGoalId && !replaced) throw new Error("The goal to replace is not an active goal of this operator");
      for (const candidate of list) {
        if (
          candidate.tenantId === tenantId &&
          candidate.operatorUserId === operatorUserId &&
          (candidate.metricKey === input.metricKey || candidate === replaced) &&
          candidate.status === "active"
        ) {
          candidate.status = "superseded";
          candidate.supersededById = input.id;
        }
      }
      const saved: OperatorMacroGoal = {
        id: input.id,
        tenantId,
        operatorUserId,
        objective: input.objective,
        metricKey: input.metricKey,
        targetValue: input.targetValue.toFixed(2),
        unit: input.unit,
        urgencyText: input.urgencyText ?? null,
        targetDate: input.targetDate ?? null,
        source: input.source,
        sourceNote: input.sourceNote,
        secondaryTargetsJson: input.secondaryTargets ?? null,
        status: "active",
        supersededById: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      list.push(saved);
      inMemoryGoals.set(tenantId, list);
      return saved;
    }
    return db.transaction(
      async tx => {
        const scope = and(
          eq(operatorMacroGoals.tenantId, tenantId),
          eq(operatorMacroGoals.operatorUserId, operatorUserId),
          eq(operatorMacroGoals.metricKey, input.metricKey),
          eq(operatorMacroGoals.status, "active")
        );
        const existing = await tx
          .select({ id: operatorMacroGoals.id })
          .from(operatorMacroGoals)
          .where(scope)
          .for("update");
        if (existing.length > 1) {
          throw new Error(
            "Macro goal invariant violated: multiple active scoped goals"
          );
        }
        const [replaced] = input.replacesGoalId
          ? await tx
              .select({ id: operatorMacroGoals.id })
              .from(operatorMacroGoals)
              .where(
                and(
                  eq(operatorMacroGoals.tenantId, tenantId),
                  eq(operatorMacroGoals.operatorUserId, operatorUserId),
                  eq(operatorMacroGoals.id, input.replacesGoalId),
                  eq(operatorMacroGoals.status, "active")
                )
              )
              .for("update")
          : [];
        if (input.replacesGoalId && !replaced) {
          throw new Error("The goal to replace is not an active goal of this operator");
        }
        await tx.insert(operatorMacroGoals).values({
          id: input.id,
          tenantId,
          operatorUserId,
          objective: input.objective,
          metricKey: input.metricKey,
          targetValue: input.targetValue.toFixed(2),
          unit: input.unit,
          urgencyText: input.urgencyText ?? null,
          targetDate: input.targetDate ?? null,
          source: input.source,
          sourceNote: input.sourceNote,
          secondaryTargetsJson: input.secondaryTargets ?? null,
          status: "active",
          supersededById: null,
        });
        if (existing[0]) {
          await tx
            .update(operatorMacroGoals)
            .set({ status: "superseded", supersededById: input.id })
            .where(and(eq(operatorMacroGoals.id, existing[0].id), scope));
        }
        if (replaced && replaced.id !== existing[0]?.id) {
          await tx
            .update(operatorMacroGoals)
            .set({ status: "superseded", supersededById: input.id })
            .where(
              and(
                eq(operatorMacroGoals.tenantId, tenantId),
                eq(operatorMacroGoals.id, replaced.id),
                eq(operatorMacroGoals.status, "active")
              )
            );
        }
        const [saved] = await tx
          .select()
          .from(operatorMacroGoals)
          .where(eq(operatorMacroGoals.id, input.id))
          .limit(1);
        if (!saved) {
          throw new Error("Macro goal insert was not readable in its transaction");
        }
        return saved;
      },
      { isolationLevel: "serializable" }
    );
  },
};

export async function getActiveMacroGoal(
  input: { tenantId: string; operatorUserId: string; metricKey?: string },
  persistence: MacroGoalPersistence = databaseMacroGoalPersistence
): Promise<MacroGoal | null> {
  return normalize(await persistence.getActive(input));
}

export async function getActiveMacroGoalForOperators(
  input: {
    tenantId: string;
    operatorUserIds: readonly string[];
    metricKey?: string;
  },
  persistence: MacroGoalPersistence = databaseMacroGoalPersistence
): Promise<MacroGoal | null> {
  const operatorUserIds = [
    ...new Set(input.operatorUserIds.map(id => id.trim()).filter(Boolean)),
  ];
  if (!operatorUserIds.length) return null;
  const goals = (
    await Promise.all(
      operatorUserIds.map(operatorUserId =>
        getActiveMacroGoal(
          {
            tenantId: input.tenantId,
            operatorUserId,
            ...(input.metricKey ? { metricKey: input.metricKey } : {}),
          },
          persistence
        )
      )
    )
  ).filter((goal): goal is MacroGoal => Boolean(goal));
  goals.sort((a, b) => {
    const updated = b.updatedAt.getTime() - a.updatedAt.getTime();
    return updated || String(b.id).localeCompare(String(a.id));
  });
  return goals[0] ?? null;
}

/**
 * Every active goal of an operator family (several may be active at once),
 * plus the most recent superseded or closed ones, for the operating mandate.
 * Nothing here picks a "current" goal.
 */
export async function listMacroGoalsForOperators(input: {
  tenantId: string;
  operatorUserIds: readonly string[];
  historyLimit?: number;
}): Promise<MacroGoal[]> {
  const tenantId = input.tenantId.trim();
  const operatorUserIds = [...new Set(input.operatorUserIds.map(id => id.trim()).filter(Boolean))];
  if (!tenantId) throw new Error("Macro goal read requires tenant authority");
  if (!operatorUserIds.length) return [];
  const db = await getDb();
  if (!db) {
    if (!allowInMemoryMacroGoalFallback()) throw new Error("Database unavailable");
    return (inMemoryGoals.get(tenantId) ?? [])
      .filter(goal => operatorUserIds.includes(goal.operatorUserId))
      .map(goal => normalize(goal)!);
  }
  const operators = and(
    eq(operatorMacroGoals.tenantId, tenantId),
    inArray(operatorMacroGoals.operatorUserId, operatorUserIds)
  );
  const [active, history] = await Promise.all([
    db.select().from(operatorMacroGoals).where(and(operators, eq(operatorMacroGoals.status, "active"))),
    db
      .select()
      .from(operatorMacroGoals)
      .where(and(operators, ne(operatorMacroGoals.status, "active")))
      .orderBy(desc(operatorMacroGoals.updatedAt), desc(operatorMacroGoals.id))
      .limit(input.historyLimit ?? 10),
  ]);
  return [...active, ...history].map(goal => normalize(goal)!);
}

export async function setActiveMacroGoal(
  input: SetActiveMacroGoalInput,
  persistence: MacroGoalPersistence = databaseMacroGoalPersistence
): Promise<MacroGoal> {
  if (!Number.isFinite(input.targetValue)) {
    throw new Error("targetValue must be finite");
  }
  // An area-scoped goal must be one something can measure, or its run could never be judged.
  assertOutcomeMetricKey(input.metricKey);
  return normalize(
    await persistence.replaceActive({ ...input, id: randomUUID() })
  )!;
}
