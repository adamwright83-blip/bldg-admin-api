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

export function formatGoalVoiceReadback(input: {
  metricKey: string;
  targetValue: number;
  targetDate: string;
}): string {
  const metricLabel = input.metricKey.replace(/_/g, " ");
  return `You confirmed a target of ${input.targetValue} ${metricLabel} by ${input.targetDate}. Did I get that right?`;
}

export function validateVoiceReadbackConfirmation(transcript: string): boolean {
  const normalized = transcript.trim().toLowerCase();
  return (
    /\b(?:yes|correct|that's right|right|confirmed|yep|yeah|sure)\b/i.test(normalized) &&
    !/\b(?:no|not right|incorrect|wrong|wait)\b/i.test(normalized)
  );
}

// In-memory store for unit tests or when DB is not available
const inMemoryGoals = new Map<string, OperatorMacroGoal[]>();

export function resetInMemoryGoalsForTesting(): void {
  inMemoryGoals.clear();
}

export type MacroGoalPersistence = {
  getActive(input: { tenantId: string; operatorUserId: string; metricKey?: string }): Promise<OperatorMacroGoal | null>;
  replaceActive(input: SetActiveMacroGoalInput & { id: string }): Promise<OperatorMacroGoal>;
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

const databasePersistence: MacroGoalPersistence = {
  async getActive(input) {
    const db = await getDb();
    if (!db) {
      const list = inMemoryGoals.get(input.tenantId) ?? [];
      const match = list.find(candidate =>
        candidate.tenantId === input.tenantId &&
        (candidate.operatorUserId === input.operatorUserId || !input.operatorUserId || input.operatorUserId === "owner") &&
        candidate.status === "active" &&
        (!input.metricKey || candidate.metricKey === input.metricKey)
      ) ?? list.find(candidate => candidate.tenantId === input.tenantId && candidate.status === "active");
      return match ?? null;
    }
    const conditions = [
      eq(operatorMacroGoals.tenantId, input.tenantId),
      eq(operatorMacroGoals.status, "active"),
    ];
    if (input.operatorUserId && input.operatorUserId !== "owner") {
      conditions.push(eq(operatorMacroGoals.operatorUserId, input.operatorUserId));
    }
    if (input.metricKey) conditions.push(eq(operatorMacroGoals.metricKey, input.metricKey));
    const [row] = await db
      .select()
      .from(operatorMacroGoals)
      .where(and(...conditions))
      .orderBy(desc(operatorMacroGoals.updatedAt))
      .limit(1);
    return row ?? null;
  },

  async replaceActive(input) {
    const db = await getDb();
    if (!db) {
      const list = inMemoryGoals.get(input.tenantId) ?? [];
      for (const candidate of list) {
        if (
          candidate.tenantId === input.tenantId &&
          candidate.metricKey === input.metricKey &&
          candidate.status === "active"
        ) {
          candidate.status = "superseded";
          candidate.supersededById = input.id;
        }
      }
      const saved: OperatorMacroGoal = {
        id: input.id,
        tenantId: input.tenantId,
        operatorUserId: input.operatorUserId,
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
      inMemoryGoals.set(input.tenantId, list);
      return saved;
    }
    return db.transaction(
      async tx => {
        const scope = and(
          eq(operatorMacroGoals.tenantId, input.tenantId),
          eq(operatorMacroGoals.operatorUserId, input.operatorUserId),
          eq(operatorMacroGoals.metricKey, input.metricKey),
          eq(operatorMacroGoals.status, "active")
        );
        const existing = await tx.select({ id: operatorMacroGoals.id }).from(operatorMacroGoals).where(scope).for("update");
        if (existing.length > 1) {
          throw new Error("Macro goal invariant violated: multiple active scoped goals");
        }
        await tx.insert(operatorMacroGoals).values({
          id: input.id,
          tenantId: input.tenantId,
          operatorUserId: input.operatorUserId,
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
        const [saved] = await tx.select().from(operatorMacroGoals).where(eq(operatorMacroGoals.id, input.id)).limit(1);
        if (!saved) throw new Error("Macro goal insert was not readable in its transaction");
        return saved;
      },
      { isolationLevel: "serializable" }
    );
  },
};

export async function getActiveMacroGoal(
  input: { tenantId: string; operatorUserId: string; metricKey?: string },
  persistence: MacroGoalPersistence = databasePersistence
): Promise<MacroGoal | null> {
  return normalize(await persistence.getActive(input));
}

/**
 * Structured write contract for an admin today and Prompt B's later explicit
 * proposal/confirmation path. It accepts no transcript or model-generated blob.
 */
export async function setActiveMacroGoal(
  input: SetActiveMacroGoalInput,
  persistence: MacroGoalPersistence = databasePersistence
): Promise<MacroGoal> {
  if (!Number.isFinite(input.targetValue)) throw new Error("targetValue must be finite");
  return normalize(await persistence.replaceActive({ ...input, id: randomUUID() }))!;
}
