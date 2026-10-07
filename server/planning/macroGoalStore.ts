import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { operatorMacroGoals, type OperatorMacroGoal } from "../../drizzle/schema";
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
        ) ??
        list.find(
          candidate =>
            candidate.tenantId === tenantId && candidate.status === "active"
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
      for (const candidate of list) {
        if (
          candidate.tenantId === tenantId &&
          candidate.metricKey === input.metricKey &&
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

export async function setActiveMacroGoal(
  input: SetActiveMacroGoalInput,
  persistence: MacroGoalPersistence = databaseMacroGoalPersistence
): Promise<MacroGoal> {
  if (!Number.isFinite(input.targetValue)) {
    throw new Error("targetValue must be finite");
  }
  return normalize(
    await persistence.replaceActive({ ...input, id: randomUUID() })
  )!;
}
