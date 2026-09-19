import { claireGenerationLogs } from "../../../drizzle/schema";
import { getDb } from "../../db";
import { CLAIRE_CHARACTER_VERSION } from "./characterDefinition";
import { CLAIRE_COMPILER_VERSION } from "./compiler";
import type { ClaireCompiledContext } from "./types";

/**
 * Structured, queryable record for the field-test review tool (Slice 2).
 * Deliberately excludes credentials/secrets/hidden reasoning — only the
 * generated text, compiled character metadata, and provenance summaries.
 */
export async function appendClaireGenerationLog(input: {
  tenantId: string;
  operatorUserId: string | null;
  generationKind: string;
  generationSource: "model" | "fallback";
  fallbackReason: string | null;
  generatedText: string;
  compiled: ClaireCompiledContext;
  businessContextSummary: string | null;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(claireGenerationLogs).values({
    tenantId: input.tenantId,
    operatorUserId: input.operatorUserId,
    characterId: "claire",
    characterVersion: input.compiled.version.characterVersion,
    compilerVersion: input.compiled.version.compilerVersion,
    mode: input.compiled.mode,
    generationKind: input.generationKind,
    generationSource: input.generationSource,
    disclosureTier: input.compiled.disclosureTier,
    generatedText: input.generatedText.slice(0, 1024),
    relationshipDimensionsJson: input.compiled.relationshipDimensions,
    sharedHistoryEventIdsJson: input.compiled.sharedHistoryEventIds,
    canonFragmentIdsJson: input.compiled.eligibleCanonFragmentIds,
    businessContextSummary: input.businessContextSummary?.slice(0, 512) ?? null,
    fallbackReason: input.fallbackReason,
  });
}

export async function listClaireGenerationLogs(input: {
  tenantId: string;
  limit?: number;
}) {
  const db = await getDb();
  if (!db) return [];
  const { and, desc, eq } = await import("drizzle-orm");
  const query = db
    .select()
    .from(claireGenerationLogs)
    .where(and(eq(claireGenerationLogs.tenantId, input.tenantId)))
    .orderBy(desc(claireGenerationLogs.createdAt));
  return input.limit ? query.limit(input.limit) : query;
}

export async function labelClaireGenerationLog(input: {
  tenantId: string;
  id: number;
  reviewLabel: string;
  reviewedByUserId: string;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const { and, eq } = await import("drizzle-orm");
  await db
    .update(claireGenerationLogs)
    .set({ reviewLabel: input.reviewLabel, reviewedByUserId: input.reviewedByUserId })
    .where(
      and(
        eq(claireGenerationLogs.tenantId, input.tenantId),
        eq(claireGenerationLogs.id, input.id)
      )
    );
}

/**
 * Claire Intelligence Repair Part 2, Slice A: persist one turn's answer path.
 *
 * Written for every turn, including the deterministic ones that never reach a
 * model and therefore never wrote a row before. Those rows carry
 * generationKind 'turn_route' and generationSource 'deterministic'; their
 * disclosureTier and relationship columns are placeholders (0 / []), not
 * observations, and the routing-audit reader ignores them.
 *
 * Fail-open by contract: the caller wraps this, and a telemetry failure never
 * changes or delays what Claire says.
 */
export async function appendClaireAnswerPathLog(input: {
  tenantId: string;
  operatorUserId: string | null;
  answerPath: string;
  businessReader: string | null;
  rendererProse: boolean;
  surface: string;
  turnKind: string | null;
  modelRequested: string | null;
  modelServed: string | null;
  promptChars: number | null;
  fallbackReason: string | null;
  spokenText: string;
  detail: unknown;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(claireGenerationLogs).values({
    tenantId: input.tenantId,
    operatorUserId: input.operatorUserId,
    characterId: "claire",
    characterVersion: CLAIRE_CHARACTER_VERSION,
    compilerVersion: CLAIRE_COMPILER_VERSION,
    mode: "turn_route",
    generationKind: "turn_route",
    generationSource: "deterministic",
    disclosureTier: 0,
    generatedText: input.spokenText.slice(0, 1024),
    relationshipDimensionsJson: {},
    sharedHistoryEventIdsJson: [],
    canonFragmentIdsJson: [],
    businessContextSummary: null,
    fallbackReason: input.fallbackReason,
    answerPath: input.answerPath,
    businessReader: input.businessReader,
    rendererProse: input.rendererProse,
    surface: input.surface,
    turnKind: input.turnKind,
    modelRequested: input.modelRequested,
    modelServed: input.modelServed,
    promptChars: input.promptChars,
    answerPathDetailJson: input.detail ?? null,
  });
}

export type ClaireAnswerPathRow = {
  answerPath: string | null;
  businessReader: string | null;
  rendererProse: boolean | null;
  surface: string | null;
  turnKind: string | null;
  turns: number;
};

/**
 * The Slice A distribution: turns by answer path, split by surface and turn
 * kind, over a window. Reads only the routing rows this slice writes.
 */
export async function summarizeClaireAnswerPaths(input: {
  tenantId: string;
  days?: number;
}): Promise<ClaireAnswerPathRow[]> {
  const db = await getDb();
  if (!db) return [];
  const { and, count, eq, gte, isNotNull, sql } = await import("drizzle-orm");
  const since = new Date(Date.now() - (input.days ?? 30) * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      answerPath: claireGenerationLogs.answerPath,
      businessReader: claireGenerationLogs.businessReader,
      rendererProse: claireGenerationLogs.rendererProse,
      surface: claireGenerationLogs.surface,
      turnKind: claireGenerationLogs.turnKind,
      turns: count(),
    })
    .from(claireGenerationLogs)
    .where(
      and(
        eq(claireGenerationLogs.tenantId, input.tenantId),
        isNotNull(claireGenerationLogs.answerPath),
        gte(claireGenerationLogs.createdAt, since)
      )
    )
    .groupBy(
      claireGenerationLogs.answerPath,
      claireGenerationLogs.businessReader,
      claireGenerationLogs.rendererProse,
      claireGenerationLogs.surface,
      claireGenerationLogs.turnKind
    )
    .orderBy(sql`count(*) desc`);
  return rows as ClaireAnswerPathRow[];
}

/** Recent routing rows with their full detail, for the admin telemetry page. */
export async function listClaireAnswerPathDetail(input: {
  tenantId: string;
  limit?: number;
  days?: number;
}) {
  const db = await getDb();
  if (!db) return [];
  const { and, desc, eq, gte, isNotNull } = await import("drizzle-orm");
  const since = new Date(Date.now() - (input.days ?? 30) * 24 * 60 * 60 * 1000);
  return db
    .select({
      id: claireGenerationLogs.id,
      createdAt: claireGenerationLogs.createdAt,
      answerPath: claireGenerationLogs.answerPath,
      businessReader: claireGenerationLogs.businessReader,
      rendererProse: claireGenerationLogs.rendererProse,
      surface: claireGenerationLogs.surface,
      turnKind: claireGenerationLogs.turnKind,
      modelRequested: claireGenerationLogs.modelRequested,
      modelServed: claireGenerationLogs.modelServed,
      promptChars: claireGenerationLogs.promptChars,
      fallbackReason: claireGenerationLogs.fallbackReason,
      generatedText: claireGenerationLogs.generatedText,
      detail: claireGenerationLogs.answerPathDetailJson,
    })
    .from(claireGenerationLogs)
    .where(
      and(
        eq(claireGenerationLogs.tenantId, input.tenantId),
        isNotNull(claireGenerationLogs.answerPath),
        gte(claireGenerationLogs.createdAt, since)
      )
    )
    .orderBy(desc(claireGenerationLogs.createdAt))
    .limit(input.limit ?? 50);
}
