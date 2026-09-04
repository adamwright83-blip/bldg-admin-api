import type { ExtractedExternalJob } from "../../../../shared/externalOperationalOrder";

function normalized(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Adjacent screenshot bands overlap on purpose so a CleanCloud row cannot be
 * split at a crop seam. The same real row can therefore be extracted twice.
 *
 * Prefer the external order id when CleanCloud shows one. Otherwise use the
 * operational identity visible to the operator. This is deliberately
 * conservative: materially different time windows or addresses remain separate
 * review rows rather than being silently merged.
 */
export function dedupeExtractedJobs(
  jobs: ExtractedExternalJob[]
): ExtractedExternalJob[] {
  const seen = new Set<string>();
  const result: ExtractedExternalJob[] = [];

  for (const job of jobs) {
    const externalId = normalized(job.externalOrderId);
    const key = externalId
      ? `id|${externalId}|${job.jobKind}`
      : [
          "row",
          job.jobKind,
          normalized(job.customerName),
          normalized(job.address),
          normalized(job.scheduledDate),
          normalized(job.windowStart),
          normalized(job.windowEnd),
        ].join("|");

    if (seen.has(key)) continue;
    seen.add(key);
    result.push(job);
  }

  return result;
}
