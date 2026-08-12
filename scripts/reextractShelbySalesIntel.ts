/**
 * Re-extracts general sales teachings for Shelby Sapp from her EXISTING,
 * already-persisted long-form-video transcripts. Does NOT call Gemini, does
 * NOT touch YouTube, does NOT create a second source artifact — it only
 * reads the 8 segment transcripts already sitting in the database from the
 * prior successful long-form ingestion run and runs the new general
 * teaching extractor (Anthropic) against each.
 *
 * DB-backed. Never prints ANTHROPIC_API_KEY or any secret. Never prints
 * the full transcript text. Never auto-accepts anything — everything lands
 * in review_required (or accepted only per the existing confidence-bar
 * policy, exactly as objection frameworks already work).
 *
 * Idempotent: re-running this script a second time creates zero duplicate
 * teachings (a transcript already run through the current extraction
 * version is skipped).
 *
 * RUN THIS IN YOUR MAC DESKTOP TERMINAL, from inside your local clone:
 *   railway run --service bldg-admin-api npx tsx scripts/reextractShelbySalesIntel.ts
 */
import { getSourceArtifact, listTranscripts } from "../server/salesIntel/salesIntelStore";
import { reextractGeneralTeachingsFromTranscripts } from "../server/salesIntel/salesIntelTeachingReExtraction";

const SHELBY_SOURCE_ARTIFACT_ID = "48a59c97-379e-4d3a-a629-e60bdfd67e0c";

async function main(): Promise<void> {
  const artifact = await getSourceArtifact(SHELBY_SOURCE_ARTIFACT_ID);
  if (!artifact) {
    console.error(`Source artifact ${SHELBY_SOURCE_ARTIFACT_ID} not found. Refusing to proceed.`);
    process.exitCode = 1;
    return;
  }

  console.log(`Source artifact: ${artifact.id}`);
  console.log(`  creator: ${artifact.creatorName ?? "unknown"}`);
  console.log(`  canonical URL: ${artifact.canonicalUrl ?? "n/a"}`);
  console.log(`  status: ${artifact.status}`);

  const transcripts = await listTranscripts(SHELBY_SOURCE_ARTIFACT_ID);
  console.log(`\nTranscript count: ${transcripts.length}`);
  for (const t of transcripts) {
    const seg = t.segments[0];
    const range = seg ? `${seg.startMs / 1000}s-${seg.endMs / 1000}s` : "n/a";
    console.log(`  v${t.version} [${range}] ${t.text.length} chars (contentKind=${t.contentKind})`);
  }

  console.log("\nRunning general teaching extraction (no Gemini, no network video call)...\n");

  const result = await reextractGeneralTeachingsFromTranscripts({
    sourceArtifactId: SHELBY_SOURCE_ARTIFACT_ID,
    actorId: "shelby-reextraction-script",
  });

  for (const r of result.transcriptResults) {
    console.log(
      `TRANSCRIPT v${r.transcriptVersion} [${r.segmentStartMs ?? "?"}ms-${r.segmentEndMs ?? "?"}ms] ` +
        `STATUS=${r.status} TEACHINGS=${r.teachingsCreated} OBJECTION_MAPPINGS=${r.objectionMappingsCreated}` +
        (r.errorMessage ? ` ERROR=${r.errorMessage}` : "")
    );
  }

  console.log("\n=== FINAL REPORT ===");
  console.log(`SOURCE ARTIFACT: ${result.artifact.id}`);
  console.log(`SOURCE ARTIFACT STATUS: ${result.artifact.status}`);
  console.log(`TOTAL TEACHINGS CREATED (this run): ${result.totalTeachingsCreated}`);
  console.log(`TOTAL OBJECTION MAPPINGS CREATED (this run): ${result.totalObjectionMappingsCreated}`);
  console.log(
    `REVIEW_REQUIRED CANDIDATES CREATED THIS RUN: ${result.totalTeachingsCreated + result.totalObjectionMappingsCreated} ` +
      `(actual review-state split depends on the extractor's own calibrated confidence — nothing here was auto-accepted beyond the existing confidence-bar policy already used for objection frameworks)`
  );

  const skipped = result.transcriptResults.filter(r => r.status === "skipped_already_extracted").length;
  if (skipped === result.transcriptResults.length) {
    console.log(
      "\nAll transcripts were already extracted at the current extraction version — this run made no changes. " +
        "Re-run with a new extraction version to force reprocessing."
    );
  }
}

void main();
