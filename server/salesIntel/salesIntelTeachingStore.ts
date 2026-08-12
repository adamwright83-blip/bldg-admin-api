/**
 * Persistence for general sales teachings — sibling to the framework
 * persistence in salesIntelStore.ts, same versioning conventions
 * (re-extraction appends a new version; the prior one is superseded, never
 * deleted or overwritten).
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { salesIntelTeachings } from "../../drizzle/schema";
import type {
  SalesIntelPhrase,
  SalesIntelReviewState,
} from "../../shared/salesIntel";
import type {
  SalesIntelTeaching,
  SalesIntelTeachingCategory,
} from "../../shared/salesIntelTeaching";
import { getDb } from "../db";

async function db() {
  const database = await getDb();
  if (!database) throw new Error("Database not available");
  return database;
}

function teachingView(
  row: typeof salesIntelTeachings.$inferSelect
): SalesIntelTeaching {
  return {
    id: row.id,
    sourceArtifactId: row.sourceArtifactId,
    transcriptId: row.transcriptId,
    teachingKey: row.teachingKey,
    creatorName: row.creatorName,
    creatorHandle: row.creatorHandle ?? null,
    category: row.category as SalesIntelTeachingCategory,
    title: row.title,
    principle: row.principle,
    whenToUse: (row.whenToUseJson ?? []) as string[],
    whenNotToUse: (row.whenNotToUseJson ?? []) as string[],
    exampleLanguage: (row.exampleLanguageJson ?? []) as SalesIntelPhrase[],
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

export type PersistTeachingInput = {
  teachingKey: string;
  sourceArtifactId: string;
  transcriptId: string;
  creatorName: string;
  creatorHandle: string | null;
  category: SalesIntelTeachingCategory;
  title: string;
  principle: string;
  whenToUse: string[];
  whenNotToUse: string[];
  exampleLanguage: SalesIntelPhrase[];
  confidence: number | null;
  extractionVersion: string;
  extractionProvider: string | null;
  extractionModel: string | null;
  promptVersion: string | null;
  transcriptStartMs: number | null;
  transcriptEndMs: number | null;
  reviewState: SalesIntelReviewState;
};

export async function persistTeachingVersion(
  input: PersistTeachingInput
): Promise<SalesIntelTeaching> {
  const database = await db();
  const priorVersions = await database
    .select()
    .from(salesIntelTeachings)
    .where(eq(salesIntelTeachings.teachingKey, input.teachingKey))
    .orderBy(desc(salesIntelTeachings.version));
  const nextVersion = (priorVersions[0]?.version ?? 0) + 1;
  const supersededAt = new Date();

  if (priorVersions.length > 0) {
    await database
      .update(salesIntelTeachings)
      .set({ active: false, supersededAt })
      .where(
        and(
          eq(salesIntelTeachings.teachingKey, input.teachingKey),
          eq(salesIntelTeachings.active, true)
        )
      );
  }

  const id = randomUUID();
  await database.insert(salesIntelTeachings).values({
    id,
    sourceArtifactId: input.sourceArtifactId,
    transcriptId: input.transcriptId,
    teachingKey: input.teachingKey,
    creatorName: input.creatorName,
    creatorHandle: input.creatorHandle,
    category: input.category,
    title: input.title,
    principle: input.principle,
    whenToUseJson: input.whenToUse,
    whenNotToUseJson: input.whenNotToUse,
    exampleLanguageJson: input.exampleLanguage,
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
    .from(salesIntelTeachings)
    .where(eq(salesIntelTeachings.id, id))
    .limit(1);
  if (!row) throw new Error("Sales Intel teaching failed to persist");
  return teachingView(row);
}

export async function listTeachingsForSource(
  sourceArtifactId: string,
  options: { activeOnly?: boolean } = {}
): Promise<SalesIntelTeaching[]> {
  const database = await db();
  const conditions = [eq(salesIntelTeachings.sourceArtifactId, sourceArtifactId)];
  if (options.activeOnly) conditions.push(eq(salesIntelTeachings.active, true));
  const rows = await database
    .select()
    .from(salesIntelTeachings)
    .where(and(...conditions))
    .orderBy(desc(salesIntelTeachings.createdAt));
  return rows.map(teachingView);
}

export async function listTeachingsForTranscript(
  transcriptId: string
): Promise<SalesIntelTeaching[]> {
  const database = await db();
  const rows = await database
    .select()
    .from(salesIntelTeachings)
    .where(eq(salesIntelTeachings.transcriptId, transcriptId))
    .orderBy(desc(salesIntelTeachings.createdAt));
  return rows.map(teachingView);
}

/**
 * The idempotency gate for re-extraction: has THIS transcript already been
 * run through THIS extraction version? If so, re-extraction skips it
 * entirely rather than calling the extractor again — the simplest correct
 * guarantee against duplicate teaching candidates, since it doesn't depend
 * on an LLM re-producing byte-identical output on a second pass.
 */
export async function transcriptAlreadyExtracted(input: {
  transcriptId: string;
  extractionVersion: string;
}): Promise<boolean> {
  const database = await db();
  const rows = await database
    .select({ id: salesIntelTeachings.id })
    .from(salesIntelTeachings)
    .where(
      and(
        eq(salesIntelTeachings.transcriptId, input.transcriptId),
        eq(salesIntelTeachings.extractionVersion, input.extractionVersion)
      )
    )
    .limit(1);
  return rows.length > 0;
}

/** Every teaching awaiting a human decision — the admin review queue. */
export async function listTeachingsPendingReview(): Promise<SalesIntelTeaching[]> {
  const database = await db();
  const rows = await database
    .select()
    .from(salesIntelTeachings)
    .where(eq(salesIntelTeachings.reviewState, "review_required"))
    .orderBy(desc(salesIntelTeachings.createdAt));
  return rows.map(teachingView);
}

/** Every accepted, active teaching — the general-corpus coverage input. */
export async function listAllAcceptedTeachings(): Promise<SalesIntelTeaching[]> {
  const database = await db();
  const rows = await database
    .select()
    .from(salesIntelTeachings)
    .where(
      and(
        eq(salesIntelTeachings.reviewState, "accepted"),
        eq(salesIntelTeachings.active, true)
      )
    )
    .orderBy(desc(salesIntelTeachings.createdAt));
  return rows.map(teachingView);
}

export async function setTeachingReviewState(input: {
  teachingId: string;
  reviewState: SalesIntelReviewState;
  reviewedBy: string;
}): Promise<SalesIntelTeaching | null> {
  const database = await db();
  await database
    .update(salesIntelTeachings)
    .set({
      reviewState: input.reviewState,
      reviewedBy: input.reviewedBy,
      reviewedAt: new Date(),
    })
    .where(eq(salesIntelTeachings.id, input.teachingId));
  const [row] = await database
    .select()
    .from(salesIntelTeachings)
    .where(eq(salesIntelTeachings.id, input.teachingId))
    .limit(1);
  return row ? teachingView(row) : null;
}
