/**
 * Deterministic time-based segmentation for long-form video ingestion.
 * Generic — never references Shelby or any specific creator/video. A
 * source's duration is supplied per-run; the segmentation logic itself
 * makes no assumption about which video it's splitting.
 */

export type VideoSegment = {
  /** 0-based, stable across runs for the same (durationSeconds, chunkSeconds) pair. */
  index: number;
  startSeconds: number;
  endSeconds: number;
};

/**
 * Splits a video into fixed-length chunks with no overlap. The final chunk
 * is whatever remains (never zero-length, never longer than chunkSeconds).
 *
 * No overlap for v1: sales teaching crossing a chunk boundary is a real
 * risk, but deduplicating overlapping transcript/framework evidence adds
 * real complexity (which candidate is authoritative when two overlapping
 * segments both extract "the same" objection framework?) for a benefit
 * that's speculative until we've seen real segment boundaries land badly.
 * Exact boundaries are simpler, and Gemini's own 1-second timestamp
 * granularity plus the "preserve what's actually said" prompt design
 * (never invent transitions) makes a clean cut the safer default. If real
 * ingestion runs show teaching genuinely lost at boundaries, revisit with
 * a small overlap and an explicit de-dup step — not before.
 */
export function computeVideoSegments(
  durationSeconds: number,
  chunkSeconds: number
): VideoSegment[] {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("durationSeconds must be a positive finite number");
  }
  if (!Number.isFinite(chunkSeconds) || chunkSeconds <= 0) {
    throw new Error("chunkSeconds must be a positive finite number");
  }

  const segments: VideoSegment[] = [];
  let start = 0;
  let index = 0;
  while (start < durationSeconds) {
    const end = Math.min(start + chunkSeconds, durationSeconds);
    segments.push({ index, startSeconds: start, endSeconds: end });
    start = end;
    index += 1;
  }
  return segments;
}

/** Gemini's `videoMetadata.start_offset`/`end_offset` format: an integer-second string like "900s". */
export function toGeminiOffset(seconds: number): string {
  return `${Math.round(seconds)}s`;
}
