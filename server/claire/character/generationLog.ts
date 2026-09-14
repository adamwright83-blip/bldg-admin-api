import { claireGenerationLogs } from "../../../drizzle/schema";
import { getDb } from "../../db";
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
    relationshipDimensionsJson: { disclosureTier: input.compiled.disclosureTier },
    sharedHistoryEventIdsJson: input.compiled.sharedHistorySummaries,
    canonFragmentIdsJson: input.compiled.eligibleCanonFacts,
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
