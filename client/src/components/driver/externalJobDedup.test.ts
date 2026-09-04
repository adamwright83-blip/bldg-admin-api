import { describe, expect, it } from "vitest";
import type { ExtractedExternalJob } from "../../../../shared/externalOperationalOrder";
import { dedupeExtractedJobs } from "./externalJobDedup";

function job(overrides: Partial<ExtractedExternalJob> = {}): ExtractedExternalJob {
  return {
    jobKind: "pickup",
    customerName: "Miso",
    address: "Opus LA",
    scheduledDate: "2026-09-02",
    windowStart: "09:00",
    windowEnd: "11:00",
    notes: null,
    externalOrderId: "CC-4471",
    ...overrides,
  };
}

describe("CleanCloud overlap dedupe", () => {
  it("collapses the same CleanCloud row extracted from adjacent bands", () => {
    expect(dedupeExtractedJobs([job(), job()])).toHaveLength(1);
  });

  it("normalizes harmless OCR whitespace/case around a stable order id", () => {
    expect(
      dedupeExtractedJobs([
        job({ externalOrderId: "CC-4471" }),
        job({ externalOrderId: " cc-4471 " }),
      ])
    ).toHaveLength(1);
  });

  it("keeps genuinely separate jobs for the same customer", () => {
    expect(
      dedupeExtractedJobs([
        job({ externalOrderId: null, windowStart: "09:00", windowEnd: "11:00" }),
        job({ externalOrderId: null, windowStart: "14:00", windowEnd: "16:00" }),
      ])
    ).toHaveLength(2);
  });

  it("keeps pickup and dropoff separate even when CleanCloud repeats an id", () => {
    expect(
      dedupeExtractedJobs([
        job({ jobKind: "pickup" }),
        job({ jobKind: "dropoff" }),
      ])
    ).toHaveLength(2);
  });
});
