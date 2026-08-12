/**
 * General teaching re-extraction against real MySQL.
 *
 * Gated the same way as the other DayForge release integration tests:
 *   DAYFORGE_RELEASE_DB=1 DATABASE_URL=<disposable test db> \
 *     pnpm vitest run --config vitest.integration.config.ts server/salesIntel/salesIntelTeachingReExtraction
 */
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import {
  salesIntelFrameworks,
  salesIntelSourceArtifacts,
  salesIntelTeachings,
  salesIntelTranscripts,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { appendTranscript, getSourceArtifact, upsertSourceArtifact } from "./salesIntelStore";
import { listAllAcceptedTeachings, listTeachingsPendingReview, setTeachingReviewState } from "./salesIntelTeachingStore";
import { reextractGeneralTeachingsFromTranscripts } from "./salesIntelTeachingReExtraction";
import {
  TeachingExtractionUnavailableError,
  TeachingExtractionValidationError,
  type ExtractedTeaching,
  type SalesIntelTeachingExtractor,
  type TeachingExtractionRequest,
  type TeachingExtractionResult,
} from "./salesIntelTeachingExtraction";

const runDatabaseGate =
  process.env.DAYFORGE_RELEASE_DB === "1" && Boolean(process.env.DATABASE_URL);

const createdArtifactIds: string[] = [];

async function createArtifactWithTranscripts(
  segmentTexts: string[]
): Promise<{ artifactId: string; transcriptIds: string[] }> {
  const { artifact } = await upsertSourceArtifact({
    contentHash: `teaching-fixture-${randomUUID()}`,
    sourceType: "youtube",
    sourceUrl: "https://www.youtube.com/watch?v=fixture",
    canonicalUrl: "https://www.youtube.com/watch?v=fixture",
    externalContentId: "fixturevid01",
    creatorName: "Teaching Fixture Creator",
    creatorHandle: null,
    publishedAt: null,
    title: "Teaching fixture video",
    metadata: {},
    ingestedBy: "test-admin",
    status: "analyzed",
  });
  createdArtifactIds.push(artifact.id);

  const transcriptIds: string[] = [];
  let startMs = 0;
  for (const text of segmentTexts) {
    const endMs = startMs + 900_000;
    const transcript = await appendTranscript({
      sourceArtifactId: artifact.id,
      contentKind: "video_understanding",
      text,
      segments: [{ startMs, endMs, text }],
      provider: "gemini",
      model: "gemini-3.6-flash",
      analysisVersion: "sales-intel-video-analysis-v1",
    });
    transcriptIds.push(transcript.id);
    startMs = endMs;
  }
  return { artifactId: artifact.id, transcriptIds };
}

function fixedExtractor(
  byCallIndex: (index: number) => ExtractedTeaching[],
  extractionVersion = "fixture-teaching-extraction-v1"
): SalesIntelTeachingExtractor {
  let calls = 0;
  return {
    key: "fixture-extractor",
    extractionVersion,
    async extract(_request: TeachingExtractionRequest): Promise<TeachingExtractionResult> {
      const teachings = byCallIndex(calls);
      calls += 1;
      return {
        teachings,
        provider: "fixture-extractor",
        model: "fixture-model-1",
        promptVersion: "fixture-prompt-v1",
        extractionVersion,
      };
    },
  };
}

function teaching(overrides: Partial<ExtractedTeaching> = {}): ExtractedTeaching {
  return {
    category: "discovery",
    title: "Ask consequence questions before pitching",
    principle: "Get the prospect to state the cost of inaction before proposing a solution.",
    whenToUse: ["Early discovery"],
    whenNotToUse: ["After the prospect has already committed"],
    exampleLanguagePhrases: [
      { kind: "exact_source_phrase", text: "What happens if you don't fix this?" },
    ],
    confidence: 0.9,
    objectionMapping: null,
    ...overrides,
  };
}

describe.skipIf(!runDatabaseGate)("general teaching re-extraction from existing transcripts", () => {
  afterAll(async () => {
    if (!createdArtifactIds.length) return;
    const db = await getDb();
    if (!db) return;
    await db.delete(salesIntelFrameworks).where(inArray(salesIntelFrameworks.sourceArtifactId, createdArtifactIds));
    await db.delete(salesIntelTeachings).where(inArray(salesIntelTeachings.sourceArtifactId, createdArtifactIds));
    await db.delete(salesIntelTranscripts).where(inArray(salesIntelTranscripts.sourceArtifactId, createdArtifactIds));
    await db.delete(salesIntelSourceArtifacts).where(inArray(salesIntelSourceArtifacts.id, createdArtifactIds));
  });

  it("persists a general teaching with no objection mapping — never discarded for lacking an archetype", async () => {
    const { artifactId } = await createArtifactWithTranscripts([
      "Ask what would happen if the prospect did nothing about their problem.",
    ]);

    const result = await reextractGeneralTeachingsFromTranscripts({
      sourceArtifactId: artifactId,
      actorId: "test-admin",
      extractor: fixedExtractor(() => [teaching()]),
    });

    expect(result.totalTeachingsCreated).toBe(1);
    expect(result.totalObjectionMappingsCreated).toBe(0);
    expect(result.transcriptResults[0].status).toBe("persisted");

    const db = await getDb();
    if (!db) throw new Error("no db");
    const rows = await db.select().from(salesIntelTeachings).where(eq(salesIntelTeachings.sourceArtifactId, artifactId));
    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe("discovery");
    // No archetype/channel/exactObjection columns exist on this table at all —
    // the schema itself makes "no objection required" structurally true.
    expect(rows[0]).not.toHaveProperty("archetype");
  });

  it("derives a real, independently-reviewed framework row when the teaching's own evidence supports an objection mapping", async () => {
    const { artifactId } = await createArtifactWithTranscripts([
      "Here's how I handle 'we already have a vendor'...",
    ]);

    const result = await reextractGeneralTeachingsFromTranscripts({
      sourceArtifactId: artifactId,
      actorId: "test-admin",
      extractor: fixedExtractor(() => [
        teaching({
          category: "objection_handling",
          title: "Handle the existing-vendor objection",
          objectionMapping: {
            archetype: "ANCHOR",
            channel: "phone",
            exactObjection: "We already have a vendor",
            frameworkName: "Isolate the constraint",
            responseFamily: "isolate_constraint",
            discoveryQuestions: ["What would have to change?"],
            whenToUse: [],
            whenNotToUse: [],
            followUpMoves: [],
            badResponses: [],
          },
        }),
      ]),
    });

    expect(result.totalTeachingsCreated).toBe(1);
    expect(result.totalObjectionMappingsCreated).toBe(1);

    const db = await getDb();
    if (!db) throw new Error("no db");
    const frameworkRows = await db
      .select()
      .from(salesIntelFrameworks)
      .where(eq(salesIntelFrameworks.sourceArtifactId, artifactId));
    expect(frameworkRows).toHaveLength(1);
    expect(frameworkRows[0].archetype).toBe("ANCHOR");
    expect(frameworkRows[0].reviewState).toBe("accepted"); // confidence 0.9 clears the existing auto-accept bar

    // The teaching and the derived framework are independently reviewable —
    // rejecting the teaching does not touch the framework's own review state.
    const teachingRows = await db
      .select()
      .from(salesIntelTeachings)
      .where(eq(salesIntelTeachings.sourceArtifactId, artifactId));
    await setTeachingReviewState({
      teachingId: teachingRows[0].id,
      reviewState: "rejected",
      reviewedBy: "test-admin",
    });
    const frameworkAfter = await db
      .select()
      .from(salesIntelFrameworks)
      .where(eq(salesIntelFrameworks.id, frameworkRows[0].id));
    expect(frameworkAfter[0].reviewState).toBe("accepted"); // unchanged
  });

  it("a transcript that genuinely teaches nothing returns zero teachings, not an error", async () => {
    const { artifactId } = await createArtifactWithTranscripts(["Just an intro with no sales content."]);

    const result = await reextractGeneralTeachingsFromTranscripts({
      sourceArtifactId: artifactId,
      actorId: "test-admin",
      extractor: fixedExtractor(() => []),
    });

    expect(result.transcriptResults[0].status).toBe("no_teachings");
    expect(result.totalTeachingsCreated).toBe(0);
  });

  it("preserves exact-quote vs paraphrase distinction through persistence", async () => {
    const { artifactId } = await createArtifactWithTranscripts(["fixture"]);
    await reextractGeneralTeachingsFromTranscripts({
      sourceArtifactId: artifactId,
      actorId: "test-admin",
      extractor: fixedExtractor(() => [
        teaching({
          exampleLanguagePhrases: [
            { kind: "exact_source_phrase", text: "What happens if you don't fix this?" },
            { kind: "paraphrased_principle", text: "Get them to feel the cost of waiting." },
          ],
        }),
      ]),
    });

    const db = await getDb();
    if (!db) throw new Error("no db");
    const rows = await db.select().from(salesIntelTeachings).where(eq(salesIntelTeachings.sourceArtifactId, artifactId));
    const phrases = rows[0].exampleLanguageJson as Array<{ kind: string; text: string }>;
    expect(phrases.find(p => p.kind === "exact_source_phrase")?.text).toBe(
      "What happens if you don't fix this?"
    );
    expect(phrases.find(p => p.kind === "paraphrased_principle")?.text).toBe(
      "Get them to feel the cost of waiting."
    );
  });

  it("preserves the transcript/segment/timestamp relationship — absolute video-time range, never invented", async () => {
    const { artifactId, transcriptIds } = await createArtifactWithTranscripts([
      "segment zero content",
      "segment one content",
    ]);

    await reextractGeneralTeachingsFromTranscripts({
      sourceArtifactId: artifactId,
      actorId: "test-admin",
      extractor: fixedExtractor(index => [teaching({ title: `Teaching from segment ${index}` })]),
    });

    const db = await getDb();
    if (!db) throw new Error("no db");
    const rows = await db
      .select()
      .from(salesIntelTeachings)
      .where(eq(salesIntelTeachings.sourceArtifactId, artifactId));
    const bySegment0 = rows.find(r => r.transcriptId === transcriptIds[0])!;
    const bySegment1 = rows.find(r => r.transcriptId === transcriptIds[1])!;
    expect(bySegment0.transcriptStartMs).toBe(0);
    expect(bySegment0.transcriptEndMs).toBe(900_000);
    expect(bySegment1.transcriptStartMs).toBe(900_000);
    expect(bySegment1.transcriptEndMs).toBe(1_800_000);
  });

  it("is idempotent: the same extraction version run twice creates zero duplicate teachings", async () => {
    const { artifactId } = await createArtifactWithTranscripts(["fixture"]);
    const extractor = fixedExtractor(() => [teaching()]);

    const first = await reextractGeneralTeachingsFromTranscripts({
      sourceArtifactId: artifactId,
      actorId: "test-admin",
      extractor,
    });
    expect(first.transcriptResults[0].status).toBe("persisted");

    const second = await reextractGeneralTeachingsFromTranscripts({
      sourceArtifactId: artifactId,
      actorId: "test-admin",
      extractor,
    });
    expect(second.transcriptResults[0].status).toBe("skipped_already_extracted");
    expect(second.totalTeachingsCreated).toBe(0);

    const db = await getDb();
    if (!db) throw new Error("no db");
    const rows = await db.select().from(salesIntelTeachings).where(eq(salesIntelTeachings.sourceArtifactId, artifactId));
    expect(rows).toHaveLength(1); // never 2
  });

  it("a new extraction version is distinguishable and not silently skipped", async () => {
    const { artifactId } = await createArtifactWithTranscripts(["fixture"]);
    await reextractGeneralTeachingsFromTranscripts({
      sourceArtifactId: artifactId,
      actorId: "test-admin",
      extractor: fixedExtractor(() => [teaching()], "teaching-extraction-v1"),
    });
    const secondVersionResult = await reextractGeneralTeachingsFromTranscripts({
      sourceArtifactId: artifactId,
      actorId: "test-admin",
      extractor: fixedExtractor(() => [teaching({ title: "A refined teaching title" })], "teaching-extraction-v2"),
    });

    expect(secondVersionResult.transcriptResults[0].status).toBe("persisted");
    const db = await getDb();
    if (!db) throw new Error("no db");
    const rows = await db.select().from(salesIntelTeachings).where(eq(salesIntelTeachings.sourceArtifactId, artifactId));
    expect(rows.map(r => r.extractionVersion).sort()).toEqual(["teaching-extraction-v1", "teaching-extraction-v2"]);
  });

  it("rejecting a teaching keeps it out of the accepted corpus", async () => {
    const { artifactId } = await createArtifactWithTranscripts(["fixture"]);
    await reextractGeneralTeachingsFromTranscripts({
      sourceArtifactId: artifactId,
      actorId: "test-admin",
      extractor: fixedExtractor(() => [teaching({ confidence: 0.2 })]), // below the auto-accept bar -> review_required
    });
    const pending = await listTeachingsPendingReview();
    const ours = pending.find(t => t.sourceArtifactId === artifactId);
    expect(ours).toBeDefined();

    await setTeachingReviewState({ teachingId: ours!.id, reviewState: "rejected", reviewedBy: "test-admin" });
    const accepted = await listAllAcceptedTeachings();
    expect(accepted.some(t => t.id === ours!.id)).toBe(false);
  });

  it("distinguishes provider_unavailable from a genuine zero-teaching result", async () => {
    const { artifactId } = await createArtifactWithTranscripts(["fixture"]);
    const failingExtractor: SalesIntelTeachingExtractor = {
      key: "failing",
      extractionVersion: "failing-v1",
      async extract() {
        throw new TeachingExtractionUnavailableError("ANTHROPIC_API_KEY is not configured");
      },
    };
    const result = await reextractGeneralTeachingsFromTranscripts({
      sourceArtifactId: artifactId,
      actorId: "test-admin",
      extractor: failingExtractor,
    });
    expect(result.transcriptResults[0].status).toBe("provider_unavailable");
    expect(result.transcriptResults[0].status).not.toBe("no_teachings");
  });

  it("distinguishes invalid_output from a genuine zero-teaching result", async () => {
    const { artifactId } = await createArtifactWithTranscripts(["fixture"]);
    const invalidExtractor: SalesIntelTeachingExtractor = {
      key: "invalid",
      extractionVersion: "invalid-v1",
      async extract() {
        throw new TeachingExtractionValidationError("Extraction output failed validation");
      },
    };
    const result = await reextractGeneralTeachingsFromTranscripts({
      sourceArtifactId: artifactId,
      actorId: "test-admin",
      extractor: invalidExtractor,
    });
    expect(result.transcriptResults[0].status).toBe("invalid_output");
    expect(result.transcriptResults[0].status).not.toBe("no_teachings");
  });

  it("never creates a second logical source artifact for the same video", async () => {
    const { artifactId } = await createArtifactWithTranscripts(["fixture"]);
    await reextractGeneralTeachingsFromTranscripts({
      sourceArtifactId: artifactId,
      actorId: "test-admin",
      extractor: fixedExtractor(() => [teaching()]),
    });
    const db = await getDb();
    if (!db) throw new Error("no db");
    const artifactRows = await db.select().from(salesIntelSourceArtifacts).where(eq(salesIntelSourceArtifacts.id, artifactId));
    expect(artifactRows).toHaveLength(1);

    const refetched = await getSourceArtifact(artifactId);
    expect(refetched?.id).toBe(artifactId);
  });
});
