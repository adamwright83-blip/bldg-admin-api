import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const captureRouterSource = readFileSync(
  resolve(import.meta.dirname, "salesIntelCaptureRouter.ts"),
  "utf8"
);
const systemRouterSource = readFileSync(
  resolve(import.meta.dirname, "..", "_core", "systemRouter.ts"),
  "utf8"
);

describe("driver Sales Intel capture boundary", () => {
  it("exposes only the narrow capture/status/retry surface to admin or driver", () => {
    for (const procedure of ["captureInstagram", "status", "retry"]) {
      expect(captureRouterSource).toMatch(
        new RegExp(`${procedure}:\\s*adminOrDriverProcedure`)
      );
    }
  });

  it("contains no corpus administration operations", () => {
    for (const forbidden of [
      "setFrameworkReviewState",
      "setTeachingReviewState",
      "importSalesIntelCorpus",
      "listSourceArtifacts",
      "listTeachingsPendingReview",
      "listFrameworksForSource",
      "reextractSalesIntelSource",
    ]) {
      expect(captureRouterSource).not.toContain(forbidden);
    }
    expect(captureRouterSource).not.toMatch(/:\s*publicProcedure/);
  });

  it("is mounted separately from the existing admin-only Sales Intel router", () => {
    expect(systemRouterSource).toContain(
      "salesIntelCapture: salesIntelCaptureRouter"
    );
    expect(systemRouterSource).toContain("salesIntel: salesIntelRouter");
  });
});
