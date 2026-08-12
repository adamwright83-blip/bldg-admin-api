import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./SalesIntelAdmin.tsx", import.meta.url),
  "utf8"
);
const normalized = source.replace(/\s+/g, " ");

describe("review UX", () => {
  it("is human gated and provenance explicit", () => {
    expect(normalized).not.toContain(
      "High-confidence extractions are accepted automatically"
    );
    for (const phrase of [
      "EXACT SOURCE",
      "PARAPHRASE",
      "WHEN TO USE:",
      "WHEN NOT TO USE:",
      "Model extraction confidence",
      "does not create personal outcome evidence",
      "mappings remain independently reviewed",
    ]) {
      expect(normalized).toContain(phrase);
    }
  });
});
