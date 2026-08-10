/**
 * Bulk import of a human-curated sourced corpus.
 *
 * This is the path the researcher dataset arrives on. Researchers never touch
 * the database: they hand over the documented JSON contract, it is validated
 * at the boundary, and this module persists it with full provenance.
 *
 * Human-curated frameworks are accepted on import — a person already did the
 * extraction — except for synthetic fixtures, which always stay behind review
 * so they can never pose as real trainer material.
 */
import {
  isSyntheticSourceType,
  normalizeImportedPhrase,
  type SalesIntelFramework,
  type SalesIntelImport,
  type SalesIntelSourceArtifact,
} from "../../shared/salesIntel";
import {
  salesIntelContentHash,
  salesIntelFrameworkKey,
} from "./salesIntelIdentity";
import {
  appendTranscript,
  getSourceArtifact,
  persistFrameworkVersion,
  setSourceStatus,
  upsertSourceArtifact,
} from "./salesIntelStore";

export const SALES_INTEL_IMPORT_VERSION = "sales-intel-import-v1";

export type SalesIntelImportResult = {
  artifact: SalesIntelSourceArtifact;
  frameworks: SalesIntelFramework[];
  transcriptId: string | null;
  outcome: "imported" | "awaiting_content";
  message: string;
};

export async function importSalesIntelCorpus(input: {
  payload: SalesIntelImport;
  actorId: string;
}): Promise<SalesIntelImportResult> {
  const { payload } = input;

  const contentHash = salesIntelContentHash({
    sourceType: payload.source.type,
    canonicalUrl: payload.source.url ?? null,
    externalContentId: payload.source.externalId ?? null,
    transcriptText: payload.transcript?.text ?? null,
  });

  const { artifact } = await upsertSourceArtifact({
    contentHash,
    sourceType: payload.source.type,
    sourceUrl: payload.source.url ?? null,
    canonicalUrl: payload.source.url ?? null,
    externalContentId: payload.source.externalId ?? null,
    creatorName: payload.creator.name,
    creatorHandle: payload.creator.handle ?? null,
    publishedAt: payload.source.publishedAt ?? null,
    title: payload.source.title ?? null,
    metadata: { importedVia: SALES_INTEL_IMPORT_VERSION },
    ingestedBy: input.actorId,
    status: payload.transcript ? "analyzed" : "awaiting_content",
  });

  let transcriptId: string | null = null;
  if (payload.transcript) {
    const transcript = await appendTranscript({
      sourceArtifactId: artifact.id,
      contentKind: payload.transcript.contentKind,
      text: payload.transcript.text,
      segments: payload.transcript.segments,
      provider: payload.transcript.provider ?? null,
      model: payload.transcript.model ?? null,
      analysisVersion: null,
    });
    transcriptId = transcript.id;
  }

  if (payload.frameworks.length === 0) {
    await setSourceStatus({
      id: artifact.id,
      status: payload.transcript ? "analyzed" : "awaiting_content",
      failureCode: payload.transcript ? null : "content_required",
      failureMessage: payload.transcript
        ? null
        : "Imported source has no transcript yet.",
      failureRetryable: true,
    });
    const refreshed = (await getSourceArtifact(artifact.id)) ?? artifact;
    return {
      artifact: refreshed,
      frameworks: [],
      transcriptId,
      outcome: payload.transcript ? "imported" : "awaiting_content",
      message: "Source imported without frameworks.",
    };
  }

  const synthetic = isSyntheticSourceType(payload.source.type);
  const frameworks: SalesIntelFramework[] = [];

  for (const framework of payload.frameworks) {
    const frameworkKey = salesIntelFrameworkKey({
      sourceArtifactId: artifact.id,
      archetype: framework.archetype,
      channel: framework.channel,
      frameworkName: framework.frameworkName,
      exactObjection: framework.exactObjection,
    });
    frameworks.push(
      await persistFrameworkVersion({
        frameworkKey,
        sourceArtifactId: artifact.id,
        transcriptId,
        creatorName: payload.creator.name,
        creatorHandle: payload.creator.handle ?? null,
        archetype: framework.archetype,
        channel: framework.channel,
        exactObjection: framework.exactObjection,
        diagnosis: framework.diagnosis ?? null,
        frameworkName: framework.frameworkName,
        principle: framework.principle,
        responseFamily: framework.responseFamily,
        discoveryQuestions: framework.discoveryQuestions,
        exampleLanguage: framework.exampleLanguage.map(normalizeImportedPhrase),
        whenToUse: framework.whenToUse,
        whenNotToUse: framework.whenNotToUse,
        followUpMoves: framework.followUpMoves,
        badResponses: framework.badResponses,
        confidence: framework.confidence ?? null,
        extractionVersion: SALES_INTEL_IMPORT_VERSION,
        extractionProvider: "researcher_import",
        extractionModel: null,
        promptVersion: null,
        transcriptStartMs: framework.transcriptStartMs ?? null,
        transcriptEndMs: framework.transcriptEndMs ?? null,
        // A human curated these, so they are accepted — unless synthetic.
        reviewState: synthetic ? "review_required" : "accepted",
      })
    );
  }

  await setSourceStatus({ id: artifact.id, status: "extracted" });
  const refreshed = (await getSourceArtifact(artifact.id)) ?? artifact;

  return {
    artifact: refreshed,
    frameworks,
    transcriptId,
    outcome: "imported",
    message: synthetic
      ? `${frameworks.length} fixture framework(s) imported and held for review.`
      : `${frameworks.length} framework(s) imported and available to the Armory.`,
  };
}
