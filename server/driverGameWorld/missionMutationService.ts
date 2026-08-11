/**
 * Mission Mutation evaluation and persistence.
 *
 * Reads the same authoritative evidence `driverGameWorldService` already
 * joins (mission status, pipeline stage, follow-up due date, decision-maker
 * contact) and maps it to a durable world interpretation via
 * `shared/missionMutation.ts`. Persistence is idempotent on
 * (tenantId, actorId, missionId, triggerReference): evaluating identical
 * evidence twice never creates a second row.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { missionMutations } from "../../drizzle/schema";
import {
  deriveMutation,
  type MutationDecision,
  type MutationEvidence,
} from "../../shared/missionMutation";
import { getDb } from "../db";
import type { DriverGameWorldNode } from "../../shared/driverGameWorld";

/**
 * Builds evidence from the same `DriverGameWorldNode` the world read path
 * already computes from authoritative joins — no second query, no
 * duplicated business logic. `hasDecisionMakerContact` is supplied by the
 * caller because it is already known client-side (the same signal
 * `archetypeForMission` uses) and re-deriving it here would be a second
 * source of truth for the same fact.
 */
export function evidenceFromWorldNode(
  node: DriverGameWorldNode,
  hasDecisionMakerContact: boolean
): MutationEvidence {
  return {
    missionStatus: node.missionStatus,
    pipelineStage: null,
    lossReason: node.lossReason,
    followUpDueAt: node.contestedUntil,
    hasDecisionMakerContact,
    verifiedWin: node.verifiedAnnualValueCents !== null,
  };
}

export type PersistedMutation = {
  id: string;
  missionId: number;
  sourceState: string;
  mutationType: MutationDecision["mutationType"];
  triggerType: MutationDecision["triggerType"];
  triggerReference: string;
  worldEffect: MutationDecision["worldEffect"];
  businessReferences: string[];
  createdAt: string;
};

/**
 * Evaluates evidence and persists the resulting mutation if one applies.
 * Returns the existing row unchanged when this exact evidence was already
 * evaluated — the insert is a no-op via `onDuplicateKeyUpdate` that only
 * rewrites `createdAt`-independent fields to themselves.
 */
export async function evaluateAndPersistMutation(input: {
  tenantId: string;
  actorId: string;
  missionId: number;
  evidence: MutationEvidence;
  businessReferences?: string[];
}): Promise<PersistedMutation | null> {
  const decision = deriveMutation(input.evidence);
  if (!decision) return null;

  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const id = randomUUID();
  await db
    .insert(missionMutations)
    .values({
      id,
      tenantId: input.tenantId,
      actorId: input.actorId,
      missionId: input.missionId,
      sourceState: input.evidence.missionStatus,
      mutationType: decision.mutationType,
      triggerType: decision.triggerType,
      triggerReference: decision.triggerReference,
      worldEffectJson: decision.worldEffect,
      businessReferencesJson: input.businessReferences ?? [],
      metadataJson: {},
    })
    // Idempotent: a repeat of the same trigger touches no meaningful column.
    .onDuplicateKeyUpdate({
      set: { sourceState: input.evidence.missionStatus },
    });

  const [row] = await db
    .select()
    .from(missionMutations)
    .where(
      and(
        eq(missionMutations.tenantId, input.tenantId),
        eq(missionMutations.actorId, input.actorId),
        eq(missionMutations.missionId, input.missionId),
        eq(missionMutations.triggerReference, decision.triggerReference)
      )
    )
    .limit(1);
  if (!row) throw new Error("Mission mutation failed to persist");

  return {
    id: row.id,
    missionId: row.missionId,
    sourceState: row.sourceState,
    mutationType: row.mutationType,
    triggerType: row.triggerType,
    triggerReference: row.triggerReference,
    worldEffect: row.worldEffectJson as MutationDecision["worldEffect"],
    businessReferences: (row.businessReferencesJson ?? []) as string[],
    createdAt: row.createdAt.toISOString(),
  };
}

/** Most recent mutation for a mission, for reload-safe world rendering. */
export async function getLatestMutation(input: {
  tenantId: string;
  actorId: string;
  missionId: number;
}): Promise<PersistedMutation | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db
    .select()
    .from(missionMutations)
    .where(
      and(
        eq(missionMutations.tenantId, input.tenantId),
        eq(missionMutations.actorId, input.actorId),
        eq(missionMutations.missionId, input.missionId)
      )
    )
    .orderBy(desc(missionMutations.createdAt))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    missionId: row.missionId,
    sourceState: row.sourceState,
    mutationType: row.mutationType,
    triggerType: row.triggerType,
    triggerReference: row.triggerReference,
    worldEffect: row.worldEffectJson as MutationDecision["worldEffect"],
    businessReferences: (row.businessReferencesJson ?? []) as string[],
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listMissionMutations(input: {
  tenantId: string;
  actorId: string;
  missionId: number;
}): Promise<PersistedMutation[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db
    .select()
    .from(missionMutations)
    .where(
      and(
        eq(missionMutations.tenantId, input.tenantId),
        eq(missionMutations.actorId, input.actorId),
        eq(missionMutations.missionId, input.missionId)
      )
    )
    .orderBy(desc(missionMutations.createdAt));
  return rows.map(row => ({
    id: row.id,
    missionId: row.missionId,
    sourceState: row.sourceState,
    mutationType: row.mutationType,
    triggerType: row.triggerType,
    triggerReference: row.triggerReference,
    worldEffect: row.worldEffectJson as MutationDecision["worldEffect"],
    businessReferences: (row.businessReferencesJson ?? []) as string[],
    createdAt: row.createdAt.toISOString(),
  }));
}
