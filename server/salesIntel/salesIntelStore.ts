/**
 * Sales Intel persistence.
 *
 * Four record kinds stay separate and are never collapsed into one mutable
 * row: SOURCE ARTIFACT -> TRANSCRIPT/ANALYSIS -> EXTRACTION -> FRAMEWORK.
 * Re-analysis and re-extraction always append a new version; the original
 * provenance is never overwritten or deleted.
 */
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  salesIntelFrameworks,
  salesIntelSourceArtifacts,
  salesIntelTranscripts,
} from "../../drizzle/schema";
import {
  type ObjectionArchetype,
  type SalesIntelChannel,
  type SalesIntelContentKind,
  type SalesIntelFramework,
  type SalesIntelPhrase,
  type SalesIntelReviewState,
  type SalesIntelSourceArtifact,
  type SalesIntelSourceStatus,
  type SalesIntelSourceType,
  type SalesIntelTranscript,
  type SalesIntelTranscriptSegment,
} from "../../shared/salesIntel";
import { getDb } from "../db";

async function db() {
  const database = await getDb();
  if (!database) throw new Error("Database not available");
  return database;
}

function artifactView(
  row: typeof salesIntelSourceArtifacts.$inferSelect
): SalesIntelSourceArtifact {
  return {
    id: row.id,
    sourceType: row.sourceType as SalesIntelSourceType,
    sourceUrl: row.sourceUrl ?? null,
    canonicalUrl: row.canonicalUrl ?? null,
    externalContentId: row.externalContentId ?? null,
    creatorName: row.creatorName ?? null,
    creatorHandle: row.creatorHandle ?? null,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    title: row.title ?? null,
    contentHash: row.contentHash,
    ingestedAt: row.ingestedAt.toISOString(),
    ingestedBy: row.ingestedBy,
    metadata: (row.metadataJson ?? {}) as Record<string, unknown>,
    status: row.status as SalesIntelSourceStatus,
    failureCode: row.failureCode ?? null,
    failureMessage: row.failureMessage ?? null,
    failureRetryable: Boolean(row.failureRetryable),
    attemptCount: row.attemptCount,
    lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null,
  };
}

function transcriptView(
  row: typeof salesIntelTranscripts.$inferSelect
): SalesIntelTranscript {
  return {
    id: row.id,
    sourceArtifactId: row.sourceArtifactId,
    contentKind: row.contentKind as SalesIntelContentKind,
    text: row.text,
    segments: (row.segmentsJson ?? []) as SalesIntelTranscriptSegment[],
    provider: row.provider ?? null,
    model: row.model ?? null,
    analysisVersion: row.analysisVersion ?? null,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
  };
}

function frameworkView(
  row: typeof salesIntelFrameworks.$inferSelect
): SalesIntelFramework {
  return {
    id: row.id,
    sourceArtifactId: row.sourceArtifactId,
    transcriptId: row.transcriptId ?? null,
    creatorName: row.creatorName,
    creatorHandle: row.creatorHandle ?? null,
    archetype: row.archetype as ObjectionArchetype,
    channel: row.channel as SalesIntelChannel,
    exactObjection: row.exactObjection,
    diagnosis: row.diagnosis ?? null,
    frameworkName: row.frameworkName,
    principle: row.principle,
    responseFamily: row.responseFamily,
    discoveryQuestions: (row.discoveryQuestionsJson ?? []) as string[],
    exampleLanguage: (row.exampleLanguageJson ?? []) as SalesIntelPhrase[],
    whenToUse: (row.whenToUseJson ?? []) as string[],
    whenNotToUse: (row.whenNotToUseJson ?? []) as string[],
    followUpMoves: (row.followUpMovesJson ?? []) as string[],
    badResponses: (row.badResponsesJson ?? []) as string[],
    confidence: row.confidence === null ? null : Number(row.confidence),
    extractionVersion: row.extractionVersion,
    extractionProvider: row.extractionProvider ?? null,
    extractionModel: row.extractionModel ?? null,
    promptVersion: row.promptVersion ?? null,
    transcriptStartMs: row.transcriptStartMs ?? null,
    transcriptEndMs: row.transcriptEndMs ?? null,
    reviewState: row.reviewState as SalesIntelReviewState,
    reviewedBy: row.reviewedBy ?? null,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    version: row.version,
    active: Boolean(row.active),
    supersededAt: row.supersededAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export type UpsertSourceArtifactInput = {
  contentHash: string;
  sourceType: SalesIntelSourceType;
  sourceUrl: string | null;
  canonicalUrl: string | null;
  externalContentId: string | null;
  creatorName: string | null;
  creatorHandle: string | null;
  publishedAt: string | null;
  title: string | null;
  metadata: Record<string, unknown>;
  ingestedBy: string;
  status: SalesIntelSourceStatus;
};

/**
 * Idempotent by content hash: re-submitting the same source returns the
 * existing artifact rather than forking the corpus. Identity fields on an
 * existing artifact are never rewritten — only newly-learned metadata that was
 * previously unknown is filled in.
 */
export async function upsertSourceArtifact(
  input: UpsertSourceArtifactInput
): Promise<{ artifact: SalesIntelSourceArtifact; created: boolean }> {
  const database = await db();
  const existing = await findSourceArtifactByHash(input.contentHash);
  if (existing) {
    const enrichment: Record<string, unknown> = {};
    if (!existing.creatorName && input.creatorName) {
      enrichment.creatorName = input.creatorName;
    }
    if (!existing.creatorHandle && input.creatorHandle) {
      enrichment.creatorHandle = input.creatorHandle;
    }
    if (!existing.title && input.title) enrichment.title = input.title;
    if (!existing.publishedAt && input.publishedAt) {
      enrichment.publishedAt = new Date(input.publishedAt);
    }
    if (Object.keys(enrichment).length > 0) {
      await database
        .update(salesIntelSourceArtifacts)
        .set(enrichment)
        .where(eq(salesIntelSourceArtifacts.id, existing.id));
      const refreshed = await getSourceArtifact(existing.id);
      return { artifact: refreshed ?? existing, created: false };
    }
    return { artifact: existing, created: false };
  }

  const id = randomUUID();
  await database.insert(salesIntelSourceArtifacts).values({
    id,
    sourceType: input.sourceType,
    sourceUrl: input.sourceUrl,
    canonicalUrl: input.canonicalUrl,
    externalContentId: input.externalContentId,
    creatorName: input.creatorName,
    creatorHandle: input.creatorHandle,
    publishedAt: input.publishedAt ? new Date(input.publishedAt) : null,
    title: input.title,
    contentHash: input.contentHash,
    status: input.status,
    metadataJson: input.metadata,
    ingestedBy: input.ingestedBy,
  });
  const created = await getSourceArtifact(id);
  if (!created) throw new Error("Sales Intel source artifact failed to persist");
  return { artifact: created, created: true };
}

export async function findSourceArtifactByHash(
  contentHash: string
): Promise<SalesIntelSourceArtifact | null> {
  const database = await db();
  const [row] = await database
    .select()
    .from(salesIntelSourceArtifacts)
    .where(eq(salesIntelSourceArtifacts.contentHash, contentHash))
    .limit(1);
  return row ? artifactView(row) : null;
}

export async function getSourceArtifact(
  id: string
): Promise<SalesIntelSourceArtifact | null> {
  const database = await db();
  const [row] = await database
    .select()
    .from(salesIntelSourceArtifacts)
    .where(eq(salesIntelSourceArtifacts.id, id))
    .limit(1);
  return row ? artifactView(row) : null;
}

/** Status transitions preserve the artifact; failures are recorded, not fatal. */
export async function setSourceStatus(input: {
  id: string;
  status: SalesIntelSourceStatus;
  failureCode?: string | null;
  failureMessage?: string | null;
  failureRetryable?: boolean;
  countAttempt?: boolean;
}): Promise<void> {
  const database = await db();
  await database
    .update(salesIntelSourceArtifacts)
    .set({
      status: input.status,
      failureCode: input.failureCode ?? null,
      // Keep the message short enough for the column and free of stack noise.
      failureMessage: input.failureMessage?.slice(0, 500) ?? null,
      failureRetryable: input.failureRetryable ?? false,
      ...(input.countAttempt
        ? {
            attemptCount: sql`${salesIntelSourceArtifacts.attemptCount} + 1`,
            lastAttemptAt: new Date(),
          }
        : {}),
    })
    .where(eq(salesIntelSourceArtifacts.id, input.id));
}

export async function listSourceArtifacts(
  limit = 50
): Promise<SalesIntelSourceArtifact[]> {
  const database = await db();
  const rows = await database
    .select()
    .from(salesIntelSourceArtifacts)
    .orderBy(desc(salesIntelSourceArtifacts.ingestedAt))
    .limit(limit);
  return rows.map(artifactView);
}

/** Appends transcript version N+1. Version N is never modified. */
export async function appendTranscript(input: {
  sourceArtifactId: string;
  contentKind: SalesIntelContentKind;
  text: string;
  segments: SalesIntelTranscriptSegment[];
  provider: string | null;
  model: string | null;
  analysisVersion: string | null;
}): Promise<SalesIntelTranscript> {
  const database = await db();
  const existing = await listTranscripts(input.sourceArtifactId);
  const version = existing.reduce((max, row) => Math.max(max, row.version), 0) + 1;
  const id = randomUUID();
  await database.insert(salesIntelTranscripts).values({
    id,
    sourceArtifactId: input.sourceArtifactId,
    contentKind: input.contentKind,
    text: input.text,
    segmentsJson: input.segments,
    provider: input.provider,
    model: input.model,
    analysisVersion: input.analysisVersion,
    version,
  });
  const [row] = await database
    .select()
    .from(salesIntelTranscripts)
    .where(eq(salesIntelTranscripts.id, id))
    .limit(1);
  if (!row) throw new Error("Sales Intel transcript failed to persist");
  return transcriptView(row);
}

export async function listTranscripts(
  sourceArtifactId: string
): Promise<SalesIntelTranscript[]> {
  const database = await db();
  const rows = await database
    .select()
    .from(salesIntelTranscripts)
    .where(eq(salesIntelTranscripts.sourceArtifactId, sourceArtifactId))
    .orderBy(asc(salesIntelTranscripts.version));
  return rows.map(transcriptView);
}

export async function getLatestTranscript(
  sourceArtifactId: string
): Promise<SalesIntelTranscript | null> {
  const transcripts = await listTranscripts(sourceArtifactId);
  return transcripts.at(-1) ?? null;
}

export type PersistFrameworkInput = {
  frameworkKey: string;
  sourceArtifactId: string;
  transcriptId: string | null;
  creatorName: string;
  creatorHandle: string | null;
  archetype: ObjectionArchetype;
  channel: SalesIntelChannel;
  exactObjection: string;
  diagnosis: string | null;
  frameworkName: string;
  principle: string;
  responseFamily: string;
  discoveryQuestions: string[];
  exampleLanguage: SalesIntelPhrase[];
  whenToUse: string[];
  whenNotToUse: string[];
  followUpMoves: string[];
  badResponses: string[];
  confidence: number | null;
  extractionVersion: string;
  extractionProvider: string | null;
  extractionModel: string | null;
  promptVersion: string | null;
  transcriptStartMs: number | null;
  transcriptEndMs: number | null;
  reviewState: SalesIntelReviewState;
};

/**
 * Re-extraction supersedes rather than destroys: the prior version is marked
 * inactive with a `supersededAt` stamp and stays queryable as provenance.
 */
export async function persistFrameworkVersion(
  input: PersistFrameworkInput
): Promise<SalesIntelFramework> {
  const database = await db();
  const priorVersions = await database
    .select()
    .from(salesIntelFrameworks)
    .where(eq(salesIntelFrameworks.frameworkKey, input.frameworkKey))
    .orderBy(desc(salesIntelFrameworks.version));
  const nextVersion = (priorVersions[0]?.version ?? 0) + 1;
  const supersededAt = new Date();

  if (priorVersions.length > 0) {
    await database
      .update(salesIntelFrameworks)
      .set({ active: false, supersededAt })
      .where(
        and(
          eq(salesIntelFrameworks.frameworkKey, input.frameworkKey),
          eq(salesIntelFrameworks.active, true)
        )
      );
  }

  const id = randomUUID();
  await database.insert(salesIntelFrameworks).values({
    id,
    sourceArtifactId: input.sourceArtifactId,
    transcriptId: input.transcriptId,
    frameworkKey: input.frameworkKey,
    creatorName: input.creatorName,
    creatorHandle: input.creatorHandle,
    archetype: input.archetype,
    channel: input.channel,
    exactObjection: input.exactObjection,
    diagnosis: input.diagnosis,
    frameworkName: input.frameworkName,
    principle: input.principle,
    responseFamily: input.responseFamily,
    discoveryQuestionsJson: input.discoveryQuestions,
    exampleLanguageJson: input.exampleLanguage,
    whenToUseJson: input.whenToUse,
    whenNotToUseJson: input.whenNotToUse,
    followUpMovesJson: input.followUpMoves,
    badResponsesJson: input.badResponses,
    confidence: input.confidence === null ? null : String(input.confidence),
    extractionVersion: input.extractionVersion,
    extractionProvider: input.extractionProvider,
    extractionModel: input.extractionModel,
    promptVersion: input.promptVersion,
    transcriptStartMs: input.transcriptStartMs,
    transcriptEndMs: input.transcriptEndMs,
    reviewState: input.reviewState,
    version: nextVersion,
    active: true,
  });

  const [row] = await database
    .select()
    .from(salesIntelFrameworks)
    .where(eq(salesIntelFrameworks.id, id))
    .limit(1);
  if (!row) throw new Error("Sales Intel framework failed to persist");
  return frameworkView(row);
}

export async function listFrameworksForSource(
  sourceArtifactId: string,
  options: { activeOnly?: boolean } = {}
): Promise<SalesIntelFramework[]> {
  const database = await db();
  const conditions = [
    eq(salesIntelFrameworks.sourceArtifactId, sourceArtifactId),
  ];
  if (options.activeOnly) conditions.push(eq(salesIntelFrameworks.active, true));
  const rows = await database
    .select()
    .from(salesIntelFrameworks)
    .where(and(...conditions))
    .orderBy(desc(salesIntelFrameworks.createdAt));
  return rows.map(frameworkView);
}

export async function listFrameworkVersions(
  frameworkKey: string
): Promise<SalesIntelFramework[]> {
  const database = await db();
  const rows = await database
    .select()
    .from(salesIntelFrameworks)
    .where(eq(salesIntelFrameworks.frameworkKey, frameworkKey))
    .orderBy(asc(salesIntelFrameworks.version));
  return rows.map(frameworkView);
}

export async function getFramework(
  id: string
): Promise<SalesIntelFramework | null> {
  const database = await db();
  const [row] = await database
    .select()
    .from(salesIntelFrameworks)
    .where(eq(salesIntelFrameworks.id, id))
    .limit(1);
  return row ? frameworkView(row) : null;
}

/**
 * The driver-visible query. Only active, accepted frameworks whose source
 * actually reached `extracted` are eligible — nothing awaiting content,
 * processing, failed, unreviewed, or rejected can reach the game.
 */
export async function queryDriverVisibleFrameworks(input: {
  archetype: ObjectionArchetype;
  channel: SalesIntelChannel;
  limit?: number;
  includeSyntheticFixtures?: boolean;
}): Promise<SalesIntelFramework[]> {
  const database = await db();
  const allowedSourceTypes: SalesIntelSourceType[] = input
    .includeSyntheticFixtures
    ? [
        "manual_url",
        "instagram",
        "youtube",
        "podcast",
        "uploaded_transcript",
        "other",
        "test_fixture",
      ]
    : [
        "manual_url",
        "instagram",
        "youtube",
        "podcast",
        "uploaded_transcript",
        "other",
      ];

  const rows = await database
    .select({ framework: salesIntelFrameworks })
    .from(salesIntelFrameworks)
    .innerJoin(
      salesIntelSourceArtifacts,
      eq(salesIntelSourceArtifacts.id, salesIntelFrameworks.sourceArtifactId)
    )
    .where(
      and(
        eq(salesIntelFrameworks.archetype, input.archetype),
        eq(salesIntelFrameworks.channel, input.channel),
        eq(salesIntelFrameworks.reviewState, "accepted"),
        eq(salesIntelFrameworks.active, true),
        eq(salesIntelSourceArtifacts.status, "extracted"),
        inArray(salesIntelSourceArtifacts.sourceType, allowedSourceTypes)
      )
    )
    .orderBy(desc(salesIntelFrameworks.confidence))
    .limit(input.limit ?? 12);

  return rows.map(row => frameworkView(row.framework));
}

export async function setFrameworkReviewState(input: {
  frameworkId: string;
  reviewState: SalesIntelReviewState;
  reviewedBy: string;
}): Promise<SalesIntelFramework | null> {
  const database = await db();
  await database
    .update(salesIntelFrameworks)
    .set({
      reviewState: input.reviewState,
      reviewedBy: input.reviewedBy,
      reviewedAt: new Date(),
    })
    .where(eq(salesIntelFrameworks.id, input.frameworkId));
  return getFramework(input.frameworkId);
}
