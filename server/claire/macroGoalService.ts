import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { operatorMacroGoals, type OperatorMacroGoal } from "../../drizzle/schema";
import { getDb } from "../db";

export type MacroGoal = Omit<OperatorMacroGoal, "targetValue"> & { targetValue: number };
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
  source: MacroGoalSource;
  sourceNote: string;
};

export type MacroGoalPersistence = {
  getActive(input: { tenantId: string; operatorUserId: string; metricKey?: string }): Promise<OperatorMacroGoal | null>;
  replaceActive(input: SetActiveMacroGoalInput & { id: string }): Promise<OperatorMacroGoal>;
};

function normalize(row: OperatorMacroGoal | null): MacroGoal | null {
  return row ? { ...row, targetValue: Number(row.targetValue) } : null;
}

const databasePersistence: MacroGoalPersistence = {
  async getActive(input) {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    const conditions = [
      eq(operatorMacroGoals.tenantId, input.tenantId),
      eq(operatorMacroGoals.operatorUserId, input.operatorUserId),
      eq(operatorMacroGoals.status, "active"),
    ];
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
    if (!db) throw new Error("Database not available");
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
