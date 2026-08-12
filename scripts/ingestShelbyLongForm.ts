/**
 * Step 17: the real long-form ingestion run for Shelby Sapp's approved
 * video, through the actual application path (registry/artifact
 * lookup-or-create by the same content-hash identity every other Sales
 * Intel entry point uses, then `processLongFormVideoSegments`). Frameworks
 * land in `review_required` — nothing here auto-accepts anything.
 *
 * Run in the same environment the real provider runs in, against the real
 * production database:
 *   railway run --service bldg-admin-api npx tsx scripts/ingestShelbyLongForm.ts
 *
 * Safe to re-run: segment/source identity is idempotent (see
 * longFormVideoProcessing.integration.test.ts) — a second invocation
 * resumes rather than reprocessing completed segments or forking the
 * source artifact.
 */
import { classifySalesIntelInput } from "../shared/salesIntel";
import { processLongFormVideoSegments, type SegmentResult } from "../server/salesIntel/longFormVideoProcessing";
import { salesIntelContentHash } from "../server/salesIntel/salesIntelIdentity";
import {
  findSourceArtifactByHash,
  upsertSourceArtifact,
} from "../server/salesIntel/salesIntelStore";

const SHELBY_VIDEO_URL = "https://www.youtube.com/watch?v=U2w7SQ7NEUQ";
const SHELBY_VIDEO_DURATION_SECONDS = 118 * 60 + 0; // ~1h58m, per the approved video's real length

async function main(): Promise<void> {
  const identity = classifySalesIntelInput(SHELBY_VIDEO_URL);
  if (!identity) {
    console.error("Could not classify the Shelby video URL — refusing to proceed.");
    process.exitCode = 1;
    return;
  }

  const contentHash = salesIntelContentHash({
    sourceType: identity.sourceType,
    canonicalUrl: identity.canonicalUrl,
    externalContentId: identity.externalContentId,
    transcriptText: null,
  });

  // Reuse the EXISTING artifact from prior 404/timeout/400 attempts if one
  // exists (it should — never fork a second logical Shelby source).
  let artifact = await findSourceArtifactByHash(contentHash);
  if (!artifact) {
    const result = await upsertSourceArtifact({
      contentHash,
      sourceType: identity.sourceType,
      sourceUrl: SHELBY_VIDEO_URL,
      canonicalUrl: identity.canonicalUrl,
      externalContentId: identity.externalContentId,
      creatorName: "Shelby Sapp",
      creatorHandle: null,
      publishedAt: null,
      title: null,
      metadata: {},
      ingestedBy: "long-form-ingestion-script",
      status: "awaiting_content",
    });
    artifact = result.artifact;
    console.log(`No existing artifact found — created ${artifact.id} (this should be rare; prior attempts should have left one).`);
  } else {
    console.log(`Reusing existing artifact ${artifact.id} (status: ${artifact.status}).`);
  }

  console.log(`\nProcessing ${SHELBY_VIDEO_DURATION_SECONDS}s (${(SHELBY_VIDEO_DURATION_SECONDS / 60).toFixed(0)} min) in 15-minute chunks...\n`);

  const result = await processLongFormVideoSegments({
    sourceArtifactId: artifact.id,
    durationSeconds: SHELBY_VIDEO_DURATION_SECONDS,
    actorId: "long-form-ingestion-script",
    onSegmentComplete: (segment: SegmentResult) => {
      console.log(
        `SEGMENT ${segment.index} [${segment.startSeconds}s-${segment.endSeconds}s] ` +
          `STATUS=${segment.status} ELAPSED_MS=${segment.elapsedMs ?? "n/a"} ` +
          `PROVIDER=${segment.provider ?? "n/a"} MODEL=${segment.model ?? "n/a"}` +
          (segment.failureMessage ? ` FAILURE=${segment.failureMessage}` : "")
      );
    },
  });

  console.log("\n=== FINAL REPORT ===");
  console.log(`TOTAL SEGMENTS: ${result.segments.length}`);
  console.log(`COMPLETED: ${result.segments.filter(s => s.status === "completed").length}`);
  console.log(`FAILED: ${result.segments.filter(s => s.status === "failed").length}`);
  console.log(`SOURCE ARTIFACT ID: ${result.artifact.id}`);
  console.log(`SOURCE ARTIFACT STATUS: ${result.artifact.status}`);
  console.log(`EXTRACTION COUNT (this run): ${result.frameworks.length}`);
  console.log(`OUTCOME: ${result.outcome}`);
  console.log(`MESSAGE: ${result.message}`);

  if (result.outcome === "partial_failure") {
    console.log(
      "\nStopped at the first failed segment, as designed — re-run this exact script to resume; " +
        "completed segments will not be reprocessed."
    );
  }
}

void main();
