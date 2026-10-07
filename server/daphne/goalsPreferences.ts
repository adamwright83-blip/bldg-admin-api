import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { daphneGoals, daphneMetaPreferences } from "../../drizzle/schema";
import { getDb } from "../db";
import { recordDaphneMetricEvent } from "./metrics";

export const DAPHNE_META_PREFERENCE_KEYS = [
  "adaptation_enabled",
  "proactive_initiative",
  "personality_inference",
  "memory_recall",
  "safe_experimentation",
  "cross_agent_sharing",
  "cross_user_learning",
  "response_directness",
  "response_detail",
  "challenge_level",
] as const;

export type DaphneMetaPreferenceKey =
  (typeof DAPHNE_META_PREFERENCE_KEYS)[number];

export type DaphneGoalRecord = {
  id: string;
  tenantId: string;
  canonicalOperatorId: string;
  goalKey: string;
  horizon: "current" | "near" | "long";
  statement: string;
  priority: number;
  constraints: Record<string, unknown> | null;
  status: "active" | "completed" | "abandoned" | "superseded";
  sourceObservationId: string;
  supersedesGoalId: string | null;
  createdAt: string;
  closedAt: string | null;
};

export type DaphneMetaPreferenceRecord = {
  id: string;
  tenantId: string;
  canonicalOperatorId: string;
  preferenceKey: DaphneMetaPreferenceKey;
  value: unknown;
  version: number;
  sourceObservationId: string;
  status: "active" | "revoked";
  createdAt: string;
};

function required(value: string, label: string, max: number): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`Daphne goals/preferences require ${label}`);
  if (normalized.length > max) throw new Error(`${label} exceeds ${max} characters`);
  return normalized;
}

function id(prefix: string, ...parts: string[]): string {
  return `${prefix}_${createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 46)}`;
}

function goalRecord(row: typeof daphneGoals.$inferSelect): DaphneGoalRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    canonicalOperatorId: row.canonicalOperatorId,
    goalKey: row.goalKey,
    horizon: row.horizon,
    statement: row.statement,
    priority: row.priority,
    constraints: (row.constraintsJson as Record<string, unknown> | null) ?? null,
    status: row.status,
    sourceObservationId: row.sourceObservationId,
    supersedesGoalId: row.supersedesGoalId,
    createdAt: row.createdAt.toISOString(),
    closedAt: row.closedAt?.toISOString() ?? null,
  };
}

function prefRecord(row: typeof daphneMetaPreferences.$inferSelect): DaphneMetaPreferenceRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    canonicalOperatorId: row.canonicalOperatorId,
    preferenceKey: row.preferenceKey as DaphneMetaPreferenceKey,
    value: row.valueJson,
    version: row.version,
    sourceObservationId: row.sourceObservationId,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function createDaphneGoal(input: {
  tenantId: string;
  canonicalOperatorId: string;
  goalKey: string;
  horizon: DaphneGoalRecord["horizon"];
  statement: string;
  priority?: number;
  constraints?: Record<string, unknown> | null;
  sourceObservationId: string;
  supersedesGoalId?: string | null;
}): Promise<DaphneGoalRecord> {
  const tenantId = required(input.tenantId, "tenantId", 64);
  const canonicalOperatorId = required(input.canonicalOperatorId, "canonicalOperatorId", 191);
  const goalKey = required(input.goalKey, "goalKey", 191);
  const statement = required(input.statement, "statement", 4000);
  const sourceObservationId = required(input.sourceObservationId, "sourceObservationId", 64);
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const rowId = id("dgoal", tenantId, canonicalOperatorId, goalKey, sourceObservationId);
  await db.insert(daphneGoals).values({
    id: rowId,
    tenantId,
    canonicalOperatorId,
    goalKey,
    horizon: input.horizon,
    statement,
    priority: Math.max(-100, Math.min(input.priority ?? 0, 100)),
    constraintsJson: input.constraints ?? null,
    sourceObservationId,
    supersedesGoalId: input.supersedesGoalId?.trim() || null,
  }).onDuplicateKeyUpdate({ set: { id: rowId } });
  const [row] = await db.select().from(daphneGoals).where(eq(daphneGoals.id, rowId)).limit(1);
  if (!row) throw new Error("Daphne goal did not persist");
  return goalRecord(row);
}

export async function listActiveDaphneGoals(input: {
  tenantId: string;
  canonicalOperatorId: string;
}): Promise<DaphneGoalRecord[]> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const rows = await db.select().from(daphneGoals).where(and(
    eq(daphneGoals.tenantId, required(input.tenantId, "tenantId", 64)),
    eq(daphneGoals.canonicalOperatorId, required(input.canonicalOperatorId, "canonicalOperatorId", 191)),
    eq(daphneGoals.status, "active")
  )).orderBy(desc(daphneGoals.priority), desc(daphneGoals.createdAt));
  return rows.map(goalRecord);
}

export function validateDaphneMetaPreferenceValue(
  key: DaphneMetaPreferenceKey,
  value: unknown
): void {
  if (
    ["adaptation_enabled", "personality_inference", "memory_recall", "safe_experimentation", "cross_agent_sharing", "cross_user_learning"].includes(key)
    && typeof value !== "boolean"
  ) {
    throw new Error(`Daphne preference ${key} requires a boolean`);
  }
  if (key === "proactive_initiative" && !["low", "normal", "high"].includes(String(value))) {
    throw new Error("Daphne proactive_initiative must be low, normal, or high");
  }
  if (["response_directness", "response_detail", "challenge_level"].includes(key)) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`Daphne preference ${key} must be normalized to [0,1]`);
    }
  }
}

export async function setDaphneMetaPreference(input: {
  tenantId: string;
  canonicalOperatorId: string;
  preferenceKey: DaphneMetaPreferenceKey;
  value: unknown;
  sourceObservationId: string;
  status?: "active" | "revoked";
}): Promise<DaphneMetaPreferenceRecord> {
  validateDaphneMetaPreferenceValue(input.preferenceKey, input.value);
  const tenantId = required(input.tenantId, "tenantId", 64);
  const canonicalOperatorId = required(input.canonicalOperatorId, "canonicalOperatorId", 191);
  const sourceObservationId = required(input.sourceObservationId, "sourceObservationId", 64);
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [latest] = await db.select().from(daphneMetaPreferences).where(and(
    eq(daphneMetaPreferences.tenantId, tenantId),
    eq(daphneMetaPreferences.canonicalOperatorId, canonicalOperatorId),
    eq(daphneMetaPreferences.preferenceKey, input.preferenceKey)
  )).orderBy(desc(daphneMetaPreferences.version)).limit(1);
  const version = (latest?.version ?? 0) + 1;
  const rowId = id("dpref", tenantId, canonicalOperatorId, input.preferenceKey, String(version));
  await db.insert(daphneMetaPreferences).values({
    id: rowId,
    tenantId,
    canonicalOperatorId,
    preferenceKey: input.preferenceKey,
    valueJson: input.value,
    version,
    sourceObservationId,
    status: input.status ?? "active",
  });
  const [row] = await db.select().from(daphneMetaPreferences).where(eq(daphneMetaPreferences.id, rowId)).limit(1);
  if (!row) throw new Error("Daphne meta-preference did not persist");
  await recordDaphneMetricEvent({
    tenantId,
    canonicalOperatorId,
    eventName: "control_changed",
    properties: { preferenceKey: input.preferenceKey, version, status: row.status },
    sourceReference: row.id,
    idempotencyKey: `control:${row.id}`,
  }).catch(() => undefined);
  return prefRecord(row);
}

export async function loadDaphneMetaPreferences(input: {
  tenantId: string;
  canonicalOperatorId: string;
}): Promise<Partial<Record<DaphneMetaPreferenceKey, DaphneMetaPreferenceRecord>>> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const rows = await db.select().from(daphneMetaPreferences).where(and(
    eq(daphneMetaPreferences.tenantId, required(input.tenantId, "tenantId", 64)),
    eq(daphneMetaPreferences.canonicalOperatorId, required(input.canonicalOperatorId, "canonicalOperatorId", 191))
  )).orderBy(desc(daphneMetaPreferences.version), desc(daphneMetaPreferences.createdAt));
  const latest: Partial<Record<DaphneMetaPreferenceKey, DaphneMetaPreferenceRecord>> = {};
  for (const row of rows) {
    const key = row.preferenceKey as DaphneMetaPreferenceKey;
    if (!(key in latest)) latest[key] = prefRecord(row);
  }
  return latest;
}

export function daphneAdaptationAllowed(
  preferences: Partial<Record<DaphneMetaPreferenceKey, DaphneMetaPreferenceRecord>>
): boolean {
  const latest = preferences.adaptation_enabled;
  return latest?.status !== "revoked" && latest?.value !== false;
}
