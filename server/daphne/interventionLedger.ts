import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { daphneInterventions } from "../../drizzle/schema";
import { getDb } from "../db";
import { recordDaphneMetricEvent } from "./metrics";

export type DaphneSelectionMode =
  | "deterministic"
  | "randomized"
  | "propensity"
  | "manual"
  | "abstain";

export type DaphneInterventionRecord = {
  id: string;
  tenantId: string;
  canonicalOperatorId: string;
  agentId: string;
  decisionPointId: string;
  contextKey: string;
  acceptableActions: string[];
  chosenAction: string;
  selectionMode: DaphneSelectionMode;
  selectionProbability: number | null;
  propensity: Record<string, number> | null;
  policyVersion: string;
  policyReceipt: Record<string, unknown> | null;
  interventionDefinitionVersion: number | null;
  proximalOutcomeWindowMinutes: number | null;
  sourceObservationIds: string[];
  idempotencyKey: string;
  createdAt: string;
};

export type RecordDaphneInterventionInput = {
  tenantId: string;
  canonicalOperatorId: string;
  agentId: string;
  decisionPointId: string;
  contextKey: string;
  acceptableActions: string[];
  chosenAction: string;
  selectionMode: DaphneSelectionMode;
  selectionProbability?: number | null;
  propensity?: Record<string, number> | null;
  policyVersion: string;
  policyReceipt?: Record<string, unknown> | null;
  interventionDefinitionVersion?: number | null;
  proximalOutcomeWindowMinutes?: number | null;
  sourceObservationIds: string[];
  idempotencyKey: string;
};

function required(value: string, label: string, max = 191): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`Daphne intervention requires ${label}`);
  if (normalized.length > max) throw new Error(`${label} exceeds ${max} characters`);
  return normalized;
}

function uniq(values: string[]): string[] {
  return Array.from(new Set(values.map(v => v.trim()).filter(Boolean)));
}

export function validateDaphneIntervention(input: RecordDaphneInterventionInput): void {
  const acceptable = uniq(input.acceptableActions);
  const chosen = required(input.chosenAction, "chosenAction", 128);
  if (!acceptable.includes(chosen)) {
    throw new Error("Daphne chosen action must be in the acceptable action set");
  }
  if (!input.sourceObservationIds.length) {
    throw new Error("Daphne intervention requires source observations");
  }
  const probability = input.selectionProbability;
  if (["randomized", "propensity"].includes(input.selectionMode)) {
    if (typeof probability !== "number" || !Number.isFinite(probability) || probability <= 0 || probability > 1) {
      throw new Error("Daphne randomized/propensity intervention requires selectionProbability in (0,1]");
    }
  }
  if (input.propensity) {
    let sum = 0;
    for (const [action, value] of Object.entries(input.propensity)) {
      if (!acceptable.includes(action) || !Number.isFinite(value) || value < 0 || value > 1) {
        throw new Error("Daphne propensity map must cover only acceptable actions with probabilities in [0,1]");
      }
      sum += value;
    }
    if (Math.abs(sum - 1) > 0.0001) {
      throw new Error("Daphne propensity probabilities must sum to 1");
    }
    if (probability != null && Math.abs((input.propensity[chosen] ?? -1) - probability) > 0.0001) {
      throw new Error("Daphne chosen-action propensity must equal selectionProbability");
    }
  }
  if (input.proximalOutcomeWindowMinutes != null && input.proximalOutcomeWindowMinutes <= 0) {
    throw new Error("Daphne proximal outcome window must be positive");
  }
}

function stableId(input: RecordDaphneInterventionInput): string {
  return `dint_${createHash("sha256")
    .update([input.tenantId.trim(), input.canonicalOperatorId.trim(), input.idempotencyKey.trim()].join("\u0000"))
    .digest("hex").slice(0,46)}`;
}

function toRecord(row: typeof daphneInterventions.$inferSelect): DaphneInterventionRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    canonicalOperatorId: row.canonicalOperatorId,
    agentId: row.agentId,
    decisionPointId: row.decisionPointId,
    contextKey: row.contextKey,
    acceptableActions: Array.isArray(row.acceptableActionsJson) ? row.acceptableActionsJson.filter((v): v is string => typeof v === "string") : [],
    chosenAction: row.chosenAction,
    selectionMode: row.selectionMode,
    selectionProbability: row.selectionProbability == null ? null : Number(row.selectionProbability),
    propensity: (row.propensityJson as Record<string, number> | null) ?? null,
    policyVersion: row.policyVersion,
    policyReceipt: (row.policyReceiptJson as Record<string, unknown> | null) ?? null,
    interventionDefinitionVersion: row.interventionDefinitionVersion,
    proximalOutcomeWindowMinutes: row.proximalOutcomeWindowMinutes,
    sourceObservationIds: Array.isArray(row.sourceObservationIdsJson) ? row.sourceObservationIdsJson.filter((v): v is string => typeof v === "string") : [],
    idempotencyKey: row.idempotencyKey,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function recordDaphneIntervention(input: RecordDaphneInterventionInput): Promise<DaphneInterventionRecord> {
  validateDaphneIntervention(input);
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const rowId = stableId(input);
  await db.insert(daphneInterventions).values({
    id: rowId,
    tenantId: required(input.tenantId, "tenantId", 64),
    canonicalOperatorId: required(input.canonicalOperatorId, "canonicalOperatorId", 191),
    agentId: required(input.agentId, "agentId", 128),
    decisionPointId: required(input.decisionPointId, "decisionPointId", 128),
    contextKey: required(input.contextKey, "contextKey", 191),
    acceptableActionsJson: uniq(input.acceptableActions),
    chosenAction: input.chosenAction.trim(),
    selectionMode: input.selectionMode,
    selectionProbability: input.selectionProbability == null ? null : String(input.selectionProbability),
    propensityJson: input.propensity ?? null,
    policyVersion: required(input.policyVersion, "policyVersion", 64),
    policyReceiptJson: input.policyReceipt ?? null,
    interventionDefinitionVersion: input.interventionDefinitionVersion ?? null,
    proximalOutcomeWindowMinutes: input.proximalOutcomeWindowMinutes ?? null,
    sourceObservationIdsJson: uniq(input.sourceObservationIds),
    idempotencyKey: required(input.idempotencyKey, "idempotencyKey", 191),
  }).onDuplicateKeyUpdate({ set: { id: rowId } });

  const [row] = await db.select().from(daphneInterventions).where(eq(daphneInterventions.id, rowId)).limit(1);
  if (!row) throw new Error("Daphne intervention did not persist");
  await recordDaphneMetricEvent({
    tenantId: row.tenantId,
    canonicalOperatorId: row.canonicalOperatorId,
    agentId: row.agentId,
    eventName: row.selectionMode === "randomized" ? "experiment_assignment" : "intervention_selected",
    properties: { chosenAction: row.chosenAction, selectionMode: row.selectionMode, contextKey: row.contextKey },
    sourceReference: row.id,
    idempotencyKey: `intervention:${row.id}`,
  }).catch(() => undefined);
  return toRecord(row);
}

export async function listDaphneInterventions(input: {
  tenantId: string;
  canonicalOperatorId: string;
  limit?: number;
}): Promise<DaphneInterventionRecord[]> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const rows = await db.select().from(daphneInterventions).where(and(
    eq(daphneInterventions.tenantId, required(input.tenantId, "tenantId", 64)),
    eq(daphneInterventions.canonicalOperatorId, required(input.canonicalOperatorId, "canonicalOperatorId", 191))
  )).orderBy(desc(daphneInterventions.createdAt)).limit(Math.max(1, Math.min(input.limit ?? 100, 500)));
  return rows.map(toRecord);
}
