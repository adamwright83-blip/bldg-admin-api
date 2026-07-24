import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  commercialAccounts,
  commercialMissionCoachingArtifacts,
  commercialMissions,
  commercialMissionSteps,
  commercialOpportunities,
  type CommercialMissionCoachingArtifactRow,
} from "../../drizzle/schema";
import {
  dayforgeCoachingClaimSchema,
  dayforgeCoachingOutputSchema,
  dayforgeEvidenceReferenceSchema,
} from "@shared/dayforgeCoaching";
import {
  assertDayforgeCoachingOutputIsSafeForStorage,
  sanitizeDayforgeEvidenceReferenceForStorage,
} from "./dayforgeCoachingPolicy";
import { getDb } from "../db";
import { isMysqlDuplicateKeyError } from "../mysqlErrors";
import type {
  DayforgeCoachingArtifact,
  DayforgeCoachingArtifactRepository,
  FindReusableDayforgeCoachingArtifactInput,
  PersistDayforgeCoachingArtifactInput,
} from "./dayforgeCoachingArtifactTypes";
import { dayforgeCoachingArtifactCacheKey } from "./dayforgeCoachingArtifactTypes";

type CoachingTransaction = Parameters<
  Parameters<NonNullable<Awaited<ReturnType<typeof getDb>>>["transaction"]>[0]
>[0];

function scopeKeyFor(missionStepId: number | null): string {
  return missionStepId === null ? "mission" : `step:${missionStepId}`;
}

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function decodeArtifact(row: CommercialMissionCoachingArtifactRow): DayforgeCoachingArtifact {
  const output = row.structuredOutputJson === null
    ? null
    : dayforgeCoachingOutputSchema.parse(row.structuredOutputJson);
  const evidenceReferences = z.array(dayforgeEvidenceReferenceSchema).parse(
    row.evidenceReferencesJson ?? [],
  );
  const claims = z.array(dayforgeCoachingClaimSchema).parse(row.claimsJson ?? []);
  if (output && JSON.stringify(output.claims) !== JSON.stringify(claims)) {
    throw new Error("Persisted coaching claim projection does not match its structured output");
  }
  return {
    id: row.id,
    tenantId: row.tenantId,
    missionId: row.missionId,
    missionStepId: row.missionStepId,
    scopeKey: row.scopeKey,
    accountId: row.accountId,
    generationStatus: row.generationStatus,
    provider: row.provider,
    modelId: row.modelId,
    promptVersion: row.promptVersion,
    contextHash: row.contextHash,
    cacheKey: row.cacheKey,
    requestId: row.requestId,
    version: row.version,
    generatedAt: iso(row.generatedAt),
    structuredOutput: output,
    evidenceReferences,
    claims,
    failureCode: row.failureCode,
    fallbackCode: row.fallbackCode,
    requestedBy: row.requestedBy,
    supersededAt: iso(row.supersededAt),
    active: row.active,
    latencyMs: row.latencyMs,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    estimatedCostMicros: row.estimatedCostMicros,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function validatedPersistencePayload(
  input: PersistDayforgeCoachingArtifactInput,
): PersistDayforgeCoachingArtifactInput {
  const output = dayforgeCoachingOutputSchema.parse(input.structuredOutput);
  assertDayforgeCoachingOutputIsSafeForStorage(output);
  const evidenceReferences = z.array(dayforgeEvidenceReferenceSchema)
    .max(50)
    .parse(input.evidenceReferences)
    .map(sanitizeDayforgeEvidenceReferenceForStorage);
  if (input.generationStatus === "generated" && input.fallbackCode !== null) {
    throw new Error("Generated coaching cannot carry a fallback code");
  }
  if (input.generationStatus === "fallback" && input.fallbackCode === null) {
    throw new Error("Fallback coaching requires a controlled fallback code");
  }
  return { ...input, structuredOutput: output, evidenceReferences };
}

function assertReplayMatches(
  row: CommercialMissionCoachingArtifactRow,
  input: PersistDayforgeCoachingArtifactInput,
): void {
  const matches = row.missionId === input.missionId &&
    row.missionStepId === input.missionStepId &&
    row.scopeKey === scopeKeyFor(input.missionStepId) &&
    row.accountId === input.accountId &&
    row.requestedBy === input.requestedBy &&
    row.provider === input.provider &&
    row.modelId === input.modelId &&
    row.promptVersion === input.promptVersion &&
    row.contextHash === input.contextHash;
  if (!matches) {
    throw new Error("Coaching request ID is already bound to a different generation request");
  }
}

async function findByRequestWith(
  query: Pick<CoachingTransaction, "select">,
  input: { tenantId: string; requestId: string },
): Promise<CommercialMissionCoachingArtifactRow | null> {
  const rows = await query
    .select()
    .from(commercialMissionCoachingArtifacts)
    .where(and(
      eq(commercialMissionCoachingArtifacts.tenantId, input.tenantId),
      eq(commercialMissionCoachingArtifacts.requestId, input.requestId),
    ))
    .limit(1);
  return rows[0] ?? null;
}

async function assertMissionAccountScopeWith(
  tx: CoachingTransaction,
  input: PersistDayforgeCoachingArtifactInput,
): Promise<void> {
  // The mission row is the serialization lock for artifact versions. It also
  // prevents two concurrent requests from both choosing the same next version.
  const missionRows = await tx
    .select({ opportunityId: commercialMissions.opportunityId })
    .from(commercialMissions)
    .where(and(
      eq(commercialMissions.tenantId, input.tenantId),
      eq(commercialMissions.id, input.missionId),
    ))
    .limit(1)
    .for("update");
  const mission = missionRows[0];
  if (!mission) throw new Error("Commercial mission not found");
  if (mission.opportunityId === null) {
    throw new Error("Commercial mission is not linked to an opportunity");
  }

  const opportunityRows = await tx
    .select({ accountId: commercialOpportunities.accountId })
    .from(commercialOpportunities)
    .where(and(
      eq(commercialOpportunities.tenantId, input.tenantId),
      eq(commercialOpportunities.id, mission.opportunityId),
    ))
    .limit(1);
  const opportunity = opportunityRows[0];
  if (!opportunity || opportunity.accountId !== input.accountId) {
    throw new Error("Coaching account does not belong to the commercial mission");
  }

  const accountRows = await tx
    .select({ id: commercialAccounts.id })
    .from(commercialAccounts)
    .where(and(
      eq(commercialAccounts.tenantId, input.tenantId),
      eq(commercialAccounts.id, input.accountId),
    ))
    .limit(1);
  if (!accountRows[0]) throw new Error("Commercial coaching account not found");

  if (input.missionStepId !== null) {
    const stepRows = await tx
      .select({ id: commercialMissionSteps.id })
      .from(commercialMissionSteps)
      .where(and(
        eq(commercialMissionSteps.tenantId, input.tenantId),
        eq(commercialMissionSteps.missionId, input.missionId),
        eq(commercialMissionSteps.id, input.missionStepId),
      ))
      .limit(1);
    if (!stepRows[0]) throw new Error("Coaching mission step does not belong to the mission");
  }
}

async function persistWith(
  tx: CoachingTransaction,
  input: PersistDayforgeCoachingArtifactInput,
): Promise<CommercialMissionCoachingArtifactRow> {
  await assertMissionAccountScopeWith(tx, input);
  const replay = await findByRequestWith(tx, input);
  if (replay) {
    assertReplayMatches(replay, input);
    return replay;
  }

  const scopeKey = scopeKeyFor(input.missionStepId);
  const history = await tx
    .select()
    .from(commercialMissionCoachingArtifacts)
    .where(and(
      eq(commercialMissionCoachingArtifacts.tenantId, input.tenantId),
      eq(commercialMissionCoachingArtifacts.missionId, input.missionId),
      eq(commercialMissionCoachingArtifacts.scopeKey, scopeKey),
    ))
    .orderBy(desc(commercialMissionCoachingArtifacts.version));
  const version = (history[0]?.version ?? 0) + 1;
  const persistedAt = new Date();

  await tx
    .update(commercialMissionCoachingArtifacts)
    .set({ active: false, supersededAt: persistedAt })
    .where(and(
      eq(commercialMissionCoachingArtifacts.tenantId, input.tenantId),
      eq(commercialMissionCoachingArtifacts.missionId, input.missionId),
      eq(commercialMissionCoachingArtifacts.scopeKey, scopeKey),
      eq(commercialMissionCoachingArtifacts.active, true),
    ));

  const id = randomUUID();
  await tx.insert(commercialMissionCoachingArtifacts).values({
    id,
    tenantId: input.tenantId,
    missionId: input.missionId,
    missionStepId: input.missionStepId,
    scopeKey,
    accountId: input.accountId,
    generationStatus: input.generationStatus,
    provider: input.provider,
    modelId: input.modelId,
    promptVersion: input.promptVersion,
    contextHash: input.contextHash,
    cacheKey: dayforgeCoachingArtifactCacheKey(input),
    requestId: input.requestId,
    version,
    generatedAt: input.generatedAt,
    structuredOutputJson: input.structuredOutput,
    evidenceReferencesJson: input.evidenceReferences,
    claimsJson: input.structuredOutput.claims,
    failureCode: input.failureCode,
    fallbackCode: input.fallbackCode,
    requestedBy: input.requestedBy,
    generationLeaseUntil: null,
    generationAttemptCount: 1,
    supersededAt: null,
    active: true,
    latencyMs: input.latencyMs,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    estimatedCostMicros: input.estimatedCostMicros,
  });
  const created = await tx
    .select()
    .from(commercialMissionCoachingArtifacts)
    .where(and(
      eq(commercialMissionCoachingArtifacts.tenantId, input.tenantId),
      eq(commercialMissionCoachingArtifacts.id, id),
    ))
    .limit(1);
  if (!created[0]) throw new Error("Coaching artifact was not persisted");
  return created[0];
}

export const dayforgeCoachingArtifactRepository: DayforgeCoachingArtifactRepository = {
  async findReusable(input) {
    return findReusableDayforgeCoachingArtifact(input);
  },
  async persist(input) {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    const validatedInput = validatedPersistencePayload(input);
    try {
      const row = await db.transaction(tx => persistWith(tx, validatedInput));
      return decodeArtifact(row);
    } catch (error) {
      if (!isMysqlDuplicateKeyError(error)) throw error;
      const replay = await findByRequestWith(db, validatedInput);
      if (!replay) throw error;
      assertReplayMatches(replay, validatedInput);
      return decodeArtifact(replay);
    }
  },
};

export async function findReusableDayforgeCoachingArtifact(
  input: FindReusableDayforgeCoachingArtifactInput,
): Promise<DayforgeCoachingArtifact | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db
    .select()
    .from(commercialMissionCoachingArtifacts)
    .where(and(
      eq(commercialMissionCoachingArtifacts.tenantId, input.tenantId),
      eq(commercialMissionCoachingArtifacts.missionId, input.missionId),
      eq(commercialMissionCoachingArtifacts.scopeKey, scopeKeyFor(input.missionStepId)),
      eq(commercialMissionCoachingArtifacts.accountId, input.accountId),
      eq(commercialMissionCoachingArtifacts.cacheKey, dayforgeCoachingArtifactCacheKey(input)),
      eq(commercialMissionCoachingArtifacts.generationStatus, "generated"),
      eq(commercialMissionCoachingArtifacts.active, true),
    ))
    .orderBy(desc(commercialMissionCoachingArtifacts.version))
    .limit(1);
  return rows[0] ? decodeArtifact(rows[0]) : null;
}

export async function getActiveDayforgeCoachingArtifact(input: {
  tenantId: string;
  missionId: number;
  missionStepId: number | null;
}): Promise<DayforgeCoachingArtifact | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db
    .select()
    .from(commercialMissionCoachingArtifacts)
    .where(and(
      eq(commercialMissionCoachingArtifacts.tenantId, input.tenantId),
      eq(commercialMissionCoachingArtifacts.missionId, input.missionId),
      eq(commercialMissionCoachingArtifacts.scopeKey, scopeKeyFor(input.missionStepId)),
      eq(commercialMissionCoachingArtifacts.active, true),
    ))
    .orderBy(desc(commercialMissionCoachingArtifacts.version))
    .limit(1);
  return rows[0] ? decodeArtifact(rows[0]) : null;
}

export async function listDayforgeCoachingArtifactHistory(input: {
  tenantId: string;
  missionId: number;
  missionStepId: number | null;
}): Promise<DayforgeCoachingArtifact[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db
    .select()
    .from(commercialMissionCoachingArtifacts)
    .where(and(
      eq(commercialMissionCoachingArtifacts.tenantId, input.tenantId),
      eq(commercialMissionCoachingArtifacts.missionId, input.missionId),
      eq(commercialMissionCoachingArtifacts.scopeKey, scopeKeyFor(input.missionStepId)),
    ))
    .orderBy(desc(commercialMissionCoachingArtifacts.version));
  return rows.map(decodeArtifact);
}
