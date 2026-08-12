/**
 * Long-form video segmentation against real MySQL.
 *
 * Gated the same way as the other DayForge release integration tests:
 *   DAYFORGE_RELEASE_DB=1 DATABASE_URL=<disposable test db> \
 *     pnpm vitest run --config vitest.integration.config.ts server/salesIntel/longFormVideoProcessing
 *
 * Every provider/extractor is injected — nothing here depends on a live
 * Gemini credential, and nothing here can fabricate trainer material.
 */
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import {
  salesIntelFrameworks,
  salesIntelSourceArtifacts,
  salesIntelTranscripts,
} from "../../drizzle/schema";
import { getDb } from "../db";
import type { ExtractionRequest, ExtractionResult, SalesIntelExtractor } from "./salesIntelExtraction";
import { processLongFormVideoSegments } from "./longFormVideoProcessing";
import { getSourceArtifact, listTranscripts, upsertSourceArtifact } from "./salesIntelStore";
import {
  VideoUnderstandingFailedError,
  type VideoUnderstandingProvider,
  type VideoUnderstandingRequest,
  type VideoUnderstandingResult,
} from "./videoUnderstanding";

const runDatabaseGate =
  process.env.DAYFORGE_RELEASE_DB === "1" && Boolean(process.env.DATABASE_URL);

const createdArtifactIds: string[] = [];

async function createVideoArtifact(canonicalUrl: string): Promise<string> {
  const { artifact } = await upsertSourceArtifact({
    contentHash: `long-form-fixture-${randomUUID()}`,
    sourceType: "youtube",
    sourceUrl: canonicalUrl,
    canonicalUrl,
    externalContentId: randomUUID().slice(0, 11),
    creatorName: "Long-Form Fixture Creator",
    creatorHandle: null,
    publishedAt: null,
    title: "Long-form fixture video",
    metadata: {},
    ingestedBy: "test-admin",
    status: "awaiting_content",
  });
  createdArtifactIds.push(artifact.id);
  return artifact.id;
}

/** Deterministic — one clip of chunk text per (start,end), teaches one framework per segment except when told not to. */
function fakeProvider(options: {
  failOnCallNumber?: number;
  emptySegments?: Set<number>;
} = {}): VideoUnderstandingProvider {
  let calls = 0;
  return {
    key: "fake-gemini",
    configured: true,
    async analyze(request: VideoUnderstandingRequest): Promise<VideoUnderstandingResult> {
      calls += 1;
      if (options.failOnCallNumber === calls) {
        throw new VideoUnderstandingFailedError(
          `Video analysis timed out after 240000ms`,
          "video_analysis_timeout",
          true
        );
      }
      const start = request.clip?.startOffsetSeconds ?? 0;
      if (options.emptySegments?.has(start)) {
        throw new VideoUnderstandingFailedError(
          "The provider returned no usable sales instruction for this video",
          "empty_analysis",
          false
        );
      }
      return {
        text: `Spoken sales teaching for clip starting at ${start}s.`,
        segments: [],
        provider: "fake-gemini",
        model: "fake-model-1",
        analysisVersion: "fake-analysis-v1",
      };
    },
  };
}

function fakeExtractor(): SalesIntelExtractor {
  return {
    key: "fake-extractor",
    async extract(request: ExtractionRequest): Promise<ExtractionResult> {
      return {
        provider: "fake-extractor",
        model: "fake-model-1",
        promptVersion: "fake-prompt-v1",
        extractionVersion: "fake-extraction-v1",
        frameworks: [
          {
            archetype: "ANCHOR",
            channel: "phone",
            exactObjection: `Objection from: ${request.transcriptText.slice(0, 30)}`,
            diagnosis: null,
            frameworkName: "Fixture framework",
            principle: "Fixture principle",
            responseFamily: "isolate_constraint",
            discoveryQuestions: [],
            exampleLanguage: [],
            exampleLanguagePhrases: [],
            whenToUse: [],
            whenNotToUse: [],
            followUpMoves: [],
            badResponses: [],
            confidence: 0.9,
            transcriptStartMs: null,
            transcriptEndMs: null,
          },
        ],
      };
    },
  };
}

describe.skipIf(!runDatabaseGate)("long-form video segmentation", () => {
  afterAll(async () => {
    if (!createdArtifactIds.length) return;
    const db = await getDb();
    if (!db) return;
    await db
      .delete(salesIntelFrameworks)
      .where(inArray(salesIntelFrameworks.sourceArtifactId, createdArtifactIds));
    await db
      .delete(salesIntelTranscripts)
      .where(inArray(salesIntelTranscripts.sourceArtifactId, createdArtifactIds));
    await db
      .delete(salesIntelSourceArtifacts)
      .where(inArray(salesIntelSourceArtifacts.id, createdArtifactIds));
  });

  it("splits a 118-minute video into 8 ordered segments, persisted as versioned transcripts on ONE source artifact", async () => {
    const artifactId = await createVideoArtifact(
      `https://www.youtube.com/watch?v=${randomUUID().slice(0, 11)}`
    );

    const result = await processLongFormVideoSegments({
      sourceArtifactId: artifactId,
      durationSeconds: 118 * 60,
      actorId: "test-admin",
      provider: fakeProvider(),
      extractor: fakeExtractor(),
    });

    expect(result.outcome).toBe("completed");
    expect(result.segments).toHaveLength(8);
    // Ordered recombination: segments come back in video order.
    result.segments.forEach((segment, i) => expect(segment.index).toBe(i));
    expect(result.segments.every(s => s.status === "completed")).toBe(true);
    expect(result.frameworks).toHaveLength(8); // one per segment from the fake extractor

    // ONE logical source artifact — never eight.
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    const artifactRows = await db
      .select()
      .from(salesIntelSourceArtifacts)
      .where(eq(salesIntelSourceArtifacts.id, artifactId));
    expect(artifactRows).toHaveLength(1);

    // 8 distinct versioned transcript rows, absolute timestamps, all linked to the one artifact.
    const transcripts = await listTranscripts(artifactId);
    expect(transcripts).toHaveLength(8);
    expect(new Set(transcripts.map(t => t.version)).size).toBe(8);
    expect(transcripts[0].segments[0]).toEqual({ startMs: 0, endMs: 900_000, text: expect.any(String) });
    expect(transcripts[7].segments[0]).toEqual({
      startMs: 7 * 900_000,
      endMs: 7080_000,
      text: expect.any(String),
    });

    // Every persisted framework traces back through its transcript to the one Shelby-like artifact.
    const frameworkRows = await db
      .select()
      .from(salesIntelFrameworks)
      .where(eq(salesIntelFrameworks.sourceArtifactId, artifactId));
    expect(frameworkRows).toHaveLength(8);
    for (const row of frameworkRows) {
      expect(row.transcriptId).not.toBeNull();
      expect(transcripts.some(t => t.id === row.transcriptId)).toBe(true);
    }

    const finalArtifact = await getSourceArtifact(artifactId);
    expect(finalArtifact?.status).toBe("extracted");
  });

  it("is idempotent: running the same video twice creates zero duplicate segment transcripts", async () => {
    const artifactId = await createVideoArtifact(
      `https://www.youtube.com/watch?v=${randomUUID().slice(0, 11)}`
    );

    const first = await processLongFormVideoSegments({
      sourceArtifactId: artifactId,
      durationSeconds: 20 * 60, // 2 segments at 15-min chunks
      actorId: "test-admin",
      provider: fakeProvider(),
      extractor: fakeExtractor(),
    });
    expect(first.segments.every(s => !s.wasReused)).toBe(true);

    const second = await processLongFormVideoSegments({
      sourceArtifactId: artifactId,
      durationSeconds: 20 * 60,
      actorId: "test-admin",
      provider: fakeProvider(),
      extractor: fakeExtractor(),
    });
    expect(second.segments.every(s => s.wasReused)).toBe(true);
    expect(second.segments.map(s => s.transcriptId)).toEqual(first.segments.map(s => s.transcriptId));

    const transcripts = await listTranscripts(artifactId);
    expect(transcripts).toHaveLength(2); // never 4
  });

  it("resumes after a failure without rerunning already-completed segments", async () => {
    const artifactId = await createVideoArtifact(
      `https://www.youtube.com/watch?v=${randomUUID().slice(0, 11)}`
    );

    const failingRun = await processLongFormVideoSegments({
      sourceArtifactId: artifactId,
      durationSeconds: 45 * 60, // 3 segments
      actorId: "test-admin",
      provider: fakeProvider({ failOnCallNumber: 2 }),
      extractor: fakeExtractor(),
    });
    expect(failingRun.outcome).toBe("partial_failure");
    expect(failingRun.segments).toHaveLength(2); // segment 0 completed, segment 1 failed, run stopped
    expect(failingRun.segments[0].status).toBe("completed");
    expect(failingRun.segments[1].status).toBe("failed");
    expect(failingRun.segments[1].failureCode).toBe("video_analysis_timeout");

    const afterFailure = await getSourceArtifact(artifactId);
    expect(afterFailure?.status).toBe("failed");
    expect(afterFailure?.failureRetryable).toBe(true);

    let secondCallCount = 0;
    const resumeProvider: VideoUnderstandingProvider = {
      key: "fake-gemini",
      configured: true,
      async analyze(request) {
        secondCallCount += 1;
        return {
          text: `Resumed teaching for clip at ${request.clip?.startOffsetSeconds}s`,
          segments: [],
          provider: "fake-gemini",
          model: "fake-model-1",
          analysisVersion: "fake-analysis-v1",
        };
      },
    };

    const resumed = await processLongFormVideoSegments({
      sourceArtifactId: artifactId,
      durationSeconds: 45 * 60,
      actorId: "test-admin",
      provider: resumeProvider,
      extractor: fakeExtractor(),
    });

    expect(resumed.outcome).toBe("completed");
    expect(resumed.segments).toHaveLength(3);
    // Segment 0 was already done — resumed run reuses it, never calls the provider for it again.
    expect(resumed.segments[0].wasReused).toBe(true);
    expect(resumed.segments[1].wasReused).toBe(false); // the one that failed before
    expect(resumed.segments[2].wasReused).toBe(false); // never attempted before
    expect(secondCallCount).toBe(2); // only segments 1 and 2 hit the provider this time

    const transcripts = await listTranscripts(artifactId);
    expect(transcripts).toHaveLength(3); // never 4 or 5 from double-processing segment 0
  });

  it("treats a clip with no sales instruction as completed, not failed — not every minute of a long video teaches something", async () => {
    const artifactId = await createVideoArtifact(
      `https://www.youtube.com/watch?v=${randomUUID().slice(0, 11)}`
    );

    const result = await processLongFormVideoSegments({
      sourceArtifactId: artifactId,
      durationSeconds: 30 * 60, // 2 segments
      actorId: "test-admin",
      provider: fakeProvider({ emptySegments: new Set([900]) }), // second segment (starts at 900s) teaches nothing
      extractor: fakeExtractor(),
    });

    expect(result.outcome).toBe("completed");
    expect(result.segments[0].status).toBe("completed");
    expect(result.segments[1].status).toBe("completed");
    expect(result.segments[1].transcriptId).toBeNull(); // nothing persisted for the empty clip
    expect(result.frameworks).toHaveLength(1); // only from the segment that actually taught something

    const transcripts = await listTranscripts(artifactId);
    expect(transcripts).toHaveLength(1); // no transcript row for the empty clip
  });
});
