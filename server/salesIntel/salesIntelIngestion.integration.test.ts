/**
 * Sales Intel ingestion journey against real MySQL.
 *
 * Gated the same way as the other DayForge release integration tests:
 *   DAYFORGE_RELEASE_DB=1 DATABASE_URL=<disposable test db> \
 *     pnpm vitest run --config vitest.integration.config.ts server/salesIntel
 *
 * Every provider is injected, so nothing here depends on a live credential and
 * nothing here can fabricate trainer material.
 */
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import {
  salesIntelFrameworks,
  salesIntelSourceArtifacts,
  salesIntelTranscripts,
} from "../../drizzle/schema";
import { getDb } from "../db";
import {
  attachSalesIntelContent,
  ingestSalesIntelSource,
  reextractSalesIntelSource,
} from "./salesIntelService";
import {
  getSourceArtifact,
  listFrameworkVersions,
  listTranscripts,
  queryDriverVisibleFrameworks,
  setFrameworkReviewState,
} from "./salesIntelStore";
import type {
  ExtractionRequest,
  ExtractionResult,
  SalesIntelExtractor,
} from "./salesIntelExtraction";
import { ExtractionValidationError } from "./salesIntelExtraction";
import {
  createSalesIntelAdapterRegistry,
  InstagramSourceAdapter,
  ManualUrlSourceAdapter,
  SuppliedTranscriptAdapter,
  YouTubeSourceAdapter,
} from "./sourceAdapters";
import {
  UnconfiguredVideoUnderstandingProvider,
  VideoUnderstandingFailedError,
  type VideoUnderstandingProvider,
} from "./videoUnderstanding";

const runDatabaseGate =
  process.env.DAYFORGE_RELEASE_DB === "1" && Boolean(process.env.DATABASE_URL);

const createdArtifactIds: string[] = [];

/** Deterministic extractor. Confidence drives the acceptance policy. */
function stubExtractor(options: {
  confidence?: number;
  objection?: string;
  frameworkName?: string;
  archetype?: "ANCHOR" | "GATEKEEPER" | "GHOST" | "STALLER";
  channel?: "phone" | "in_person" | "follow_up" | "proposal";
  empty?: boolean;
} = {}): SalesIntelExtractor {
  return {
    key: "stub-extractor",
    async extract(request: ExtractionRequest): Promise<ExtractionResult> {
      return {
        provider: "stub-extractor",
        model: "stub-model-1",
        promptVersion: "stub-prompt-v1",
        extractionVersion: "stub-extraction-v1",
        frameworks: options.empty
          ? []
          : [
              {
                archetype: options.archetype ?? "ANCHOR",
                channel: options.channel ?? "phone",
                exactObjection:
                  options.objection ?? "We already have a company",
                diagnosis: null,
                frameworkName: options.frameworkName ?? "Constraint isolation",
                principle: `Derived from: ${request.transcriptText.slice(0, 40)}`,
                responseFamily: "isolate_constraint",
                discoveryQuestions: ["What would have to change?"],
                exampleLanguage: [],
                exampleLanguagePhrases: [
                  {
                    kind: "paraphrased_principle",
                    text: "Ask what would have to change.",
                  },
                ],
                whenToUse: [],
                whenNotToUse: [],
                followUpMoves: [],
                badResponses: [],
                confidence: options.confidence ?? 0.9,
                transcriptStartMs: null,
                transcriptEndMs: null,
              },
            ],
      };
    },
  };
}

function videoProvider(text: string): VideoUnderstandingProvider {
  return {
    key: "stub-video",
    configured: true,
    async analyze() {
      return {
        text,
        segments: [{ startMs: 0, endMs: 5_000, text }],
        provider: "stub-video",
        model: "stub-video-model",
        analysisVersion: "stub-video-v1",
      };
    },
  };
}

const noMetadata = async () => null;

function registryWith(video: VideoUnderstandingProvider) {
  return createSalesIntelAdapterRegistry([
    new YouTubeSourceAdapter(video, noMetadata),
    new InstagramSourceAdapter(),
    new SuppliedTranscriptAdapter(),
    new ManualUrlSourceAdapter(),
  ]);
}

async function track(artifactId: string) {
  if (!createdArtifactIds.includes(artifactId)) {
    createdArtifactIds.push(artifactId);
  }
}

/** Unique transcript text keeps each test's content hash distinct. */
function uniqueTranscript(label: string) {
  return `${label} ${randomUUID()} — when they say they already have someone, isolate the constraint first.`;
}

describe.skipIf(!runDatabaseGate)("Sales Intel ingestion journey", () => {
  afterAll(async () => {
    if (!createdArtifactIds.length) return;
    const db = await getDb();
    if (!db) return;
    await db
      .delete(salesIntelFrameworks)
      .where(inArray(salesIntelFrameworks.sourceArtifactId, createdArtifactIds));
    await db
      .delete(salesIntelTranscripts)
      .where(
        inArray(salesIntelTranscripts.sourceArtifactId, createdArtifactIds)
      );
    await db
      .delete(salesIntelSourceArtifacts)
      .where(inArray(salesIntelSourceArtifacts.id, createdArtifactIds));
  });

  it("takes pasted transcript text all the way to a driver-visible weapon", async () => {
    const objection = `We already have a company ${randomUUID()}`;
    const result = await ingestSalesIntelSource(
      {
        input: uniqueTranscript("transcript-only"),
        creatorName: "Supplied Trainer",
        actorId: "admin-openid",
      },
      { extractor: stubExtractor({ objection, confidence: 0.9 }) }
    );
    await track(result.artifact.id);

    expect(result.outcome).toBe("extracted");
    expect(result.artifact.status).toBe("extracted");
    expect(result.frameworks).toHaveLength(1);
    expect(result.frameworks[0]!.reviewState).toBe("accepted");
    expect(result.frameworks[0]!.creatorName).toBe("Supplied Trainer");

    const visible = await queryDriverVisibleFrameworks({
      archetype: "ANCHOR",
      channel: "phone",
      limit: 200,
    });
    expect(visible.map(item => item.exactObjection)).toContain(objection);
  });

  it("turns a YouTube URL into intelligence and keeps analysis provenance", async () => {
    const objection = `Under contract ${randomUUID()}`;
    const result = await ingestSalesIntelSource(
      {
        input: "https://www.youtube.com/watch?v=aaaaaaaaaaa",
        actorId: "admin-openid",
      },
      {
        adapters: registryWith(
          videoProvider(uniqueTranscript("youtube-analysis"))
        ),
        extractor: stubExtractor({ objection, confidence: 0.88 }),
      }
    );
    await track(result.artifact.id);

    expect(result.outcome).toBe("extracted");
    expect(result.artifact.externalContentId).toBe("aaaaaaaaaaa");
    expect(result.artifact.canonicalUrl).toBe(
      "https://www.youtube.com/watch?v=aaaaaaaaaaa"
    );

    const transcripts = await listTranscripts(result.artifact.id);
    expect(transcripts[0]!.contentKind).toBe("video_understanding");
    expect(transcripts[0]!.provider).toBe("stub-video");
    expect(transcripts[0]!.model).toBe("stub-video-model");
    expect(transcripts[0]!.analysisVersion).toBe("stub-video-v1");

    expect(result.frameworks[0]!.extractionProvider).toBe("stub-extractor");
    expect(result.frameworks[0]!.extractionModel).toBe("stub-model-1");
    expect(result.frameworks[0]!.promptVersion).toBe("stub-prompt-v1");

    const visible = await queryDriverVisibleFrameworks({
      archetype: "ANCHOR",
      channel: "phone",
      limit: 200,
    });
    expect(visible.map(item => item.exactObjection)).toContain(objection);
  });

  it("never fabricates a transcript when no video provider is configured", async () => {
    const result = await ingestSalesIntelSource(
      {
        input: "https://youtu.be/bbbbbbbbbbb",
        actorId: "admin-openid",
      },
      {
        adapters: registryWith(new UnconfiguredVideoUnderstandingProvider()),
        extractor: stubExtractor(),
      }
    );
    await track(result.artifact.id);

    expect(result.outcome).toBe("awaiting_content");
    expect(result.artifact.status).toBe("awaiting_content");
    expect(result.artifact.failureCode).toBe("provider_unavailable");
    expect(result.frameworks).toHaveLength(0);
    expect(await listTranscripts(result.artifact.id)).toHaveLength(0);
  });

  it("preserves the source artifact when video analysis fails", async () => {
    const failing: VideoUnderstandingProvider = {
      key: "failing",
      configured: true,
      async analyze() {
        throw new VideoUnderstandingFailedError(
          "provider returned 503",
          "provider_http_503",
          true
        );
      },
    };
    const result = await ingestSalesIntelSource(
      { input: "https://youtu.be/ccccccccccc", actorId: "admin-openid" },
      { adapters: registryWith(failing), extractor: stubExtractor() }
    );
    await track(result.artifact.id);

    const persisted = await getSourceArtifact(result.artifact.id);
    expect(persisted).not.toBeNull();
    expect(persisted!.status).toBe("awaiting_content");
    expect(persisted!.failureCode).toBe("provider_http_503");
    expect(persisted!.canonicalUrl).toBe(
      "https://www.youtube.com/watch?v=ccccccccccc"
    );
  });

  it("collapses YouTube URL variants onto one source artifact", async () => {
    const analysis = uniqueTranscript("dedupe");
    const first = await ingestSalesIntelSource(
      {
        input: "https://www.youtube.com/watch?v=ddddddddddd",
        actorId: "admin-openid",
      },
      {
        adapters: registryWith(videoProvider(analysis)),
        extractor: stubExtractor({ objection: `Dedupe ${randomUUID()}` }),
      }
    );
    await track(first.artifact.id);

    const second = await ingestSalesIntelSource(
      { input: "https://youtu.be/ddddddddddd", actorId: "admin-openid" },
      {
        adapters: registryWith(videoProvider(analysis)),
        extractor: stubExtractor(),
      }
    );
    await track(second.artifact.id);

    expect(second.artifact.id).toBe(first.artifact.id);
    expect(second.outcome).toBe("duplicate_source");
  });

  it("stores an Instagram Reel without content, then extracts once a transcript arrives", async () => {
    const shortcode = "Ig" + randomUUID().replace(/-/g, "").slice(0, 8);
    const saved = await ingestSalesIntelSource(
      {
        input: `https://www.instagram.com/somecreator/reel/${shortcode}/`,
        actorId: "admin-openid",
      },
      { extractor: stubExtractor() }
    );
    await track(saved.artifact.id);

    expect(saved.outcome).toBe("awaiting_content");
    expect(saved.artifact.status).toBe("awaiting_content");
    expect(saved.artifact.externalContentId).toBe(shortcode);
    expect(saved.artifact.creatorHandle).toBe("@somecreator");

    // Awaiting content must not be driver-visible.
    const objection = `Instagram objection ${randomUUID()}`;
    const beforeContent = await queryDriverVisibleFrameworks({
      archetype: "GHOST",
      channel: "follow_up",
      limit: 200,
    });
    expect(beforeContent.map(item => item.exactObjection)).not.toContain(
      objection
    );

    const extracted = await attachSalesIntelContent(
      {
        sourceArtifactId: saved.artifact.id,
        transcriptText: uniqueTranscript("instagram-supplied"),
        actorId: "admin-openid",
        creatorName: "Supplied Trainer",
      },
      {
        extractor: stubExtractor({
          objection,
          archetype: "GHOST",
          channel: "follow_up",
          confidence: 0.91,
        }),
      }
    );

    expect(extracted.outcome).toBe("extracted");
    expect(extracted.artifact.status).toBe("extracted");

    const afterContent = await queryDriverVisibleFrameworks({
      archetype: "GHOST",
      channel: "follow_up",
      limit: 200,
    });
    expect(afterContent.map(item => item.exactObjection)).toContain(objection);
  });

  it("supersedes rather than destroys prior extraction versions", async () => {
    const objection = `Re-extract ${randomUUID()}`;
    const first = await ingestSalesIntelSource(
      {
        input: uniqueTranscript("reextract"),
        creatorName: "Supplied Trainer",
        actorId: "admin-openid",
      },
      { extractor: stubExtractor({ objection, confidence: 0.7 }) }
    );
    await track(first.artifact.id);

    const again = await reextractSalesIntelSource(
      { sourceArtifactId: first.artifact.id, actorId: "admin-openid" },
      { extractor: stubExtractor({ objection, confidence: 0.95 }) }
    );

    expect(again.outcome).toBe("extracted");
    const versions = await listFrameworkVersions(
      // Same identity inputs produce the same framework key.
      (await listFrameworkVersionsKeyFor(first.artifact.id))!
    );
    expect(versions).toHaveLength(2);
    expect(versions[0]!.version).toBe(1);
    expect(versions[0]!.active).toBe(false);
    expect(versions[0]!.supersededAt).not.toBeNull();
    expect(versions[1]!.version).toBe(2);
    expect(versions[1]!.active).toBe(true);
    // Original provenance survives.
    expect(versions[0]!.confidence).toBeCloseTo(0.7, 3);
    expect(versions[1]!.confidence).toBeCloseTo(0.95, 3);
  });

  it("holds low-confidence extraction out of the driver's reach", async () => {
    const objection = `Low confidence ${randomUUID()}`;
    const result = await ingestSalesIntelSource(
      {
        input: uniqueTranscript("low-confidence"),
        creatorName: "Supplied Trainer",
        actorId: "admin-openid",
      },
      {
        extractor: stubExtractor({
          objection,
          confidence: 0.2,
          archetype: "STALLER",
          channel: "in_person",
        }),
      }
    );
    await track(result.artifact.id);

    expect(result.frameworks[0]!.reviewState).toBe("review_required");
    const visible = await queryDriverVisibleFrameworks({
      archetype: "STALLER",
      channel: "in_person",
      limit: 200,
    });
    expect(visible.map(item => item.exactObjection)).not.toContain(objection);
  });

  it("keeps a rejected framework out of the driver's reach", async () => {
    const objection = `Rejected ${randomUUID()}`;
    const result = await ingestSalesIntelSource(
      {
        input: uniqueTranscript("rejected"),
        creatorName: "Supplied Trainer",
        actorId: "admin-openid",
      },
      {
        extractor: stubExtractor({
          objection,
          confidence: 0.95,
          archetype: "GATEKEEPER",
          channel: "phone",
        }),
      }
    );
    await track(result.artifact.id);
    expect(result.frameworks[0]!.reviewState).toBe("accepted");

    await setFrameworkReviewState({
      frameworkId: result.frameworks[0]!.id,
      reviewState: "rejected",
      reviewedBy: "admin-openid",
    });

    const visible = await queryDriverVisibleFrameworks({
      archetype: "GATEKEEPER",
      channel: "phone",
      limit: 200,
    });
    expect(visible.map(item => item.exactObjection)).not.toContain(objection);
  });

  it("records a failed extraction without discarding the source", async () => {
    const failingExtractor: SalesIntelExtractor = {
      key: "invalid",
      async extract() {
        throw new ExtractionValidationError("frameworks[0].archetype required");
      },
    };
    const result = await ingestSalesIntelSource(
      {
        input: uniqueTranscript("invalid-extraction"),
        creatorName: "Supplied Trainer",
        actorId: "admin-openid",
      },
      { extractor: failingExtractor }
    );
    await track(result.artifact.id);

    expect(result.outcome).toBe("failed");
    const persisted = await getSourceArtifact(result.artifact.id);
    expect(persisted!.status).toBe("failed");
    expect(persisted!.failureCode).toBe("extraction_invalid");
    expect(persisted!.failureRetryable).toBe(false);
    // The transcript is still there for a later re-extraction.
    expect(await listTranscripts(result.artifact.id)).toHaveLength(1);
  });

  it("does not claim intelligence when a transcript teaches nothing", async () => {
    const result = await ingestSalesIntelSource(
      {
        input: uniqueTranscript("no-frameworks"),
        creatorName: "Supplied Trainer",
        actorId: "admin-openid",
      },
      { extractor: stubExtractor({ empty: true }) }
    );
    await track(result.artifact.id);

    expect(result.outcome).toBe("no_frameworks_found");
    expect(result.artifact.status).toBe("analyzed");
    expect(result.frameworks).toHaveLength(0);
  });
});

/** Reads back the framework key for a source's first framework. */
async function listFrameworkVersionsKeyFor(
  sourceArtifactId: string
): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select({ frameworkKey: salesIntelFrameworks.frameworkKey })
    .from(salesIntelFrameworks)
    .where(inArray(salesIntelFrameworks.sourceArtifactId, [sourceArtifactId]))
    .limit(1);
  return rows[0]?.frameworkKey ?? null;
}
