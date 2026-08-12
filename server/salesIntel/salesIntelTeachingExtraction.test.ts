import { describe, expect, it } from "vitest";
import {
  TeachingExtractionValidationError,
  validateExtractedTeachings,
} from "./salesIntelTeachingExtraction";

const validTeaching = {
  category: "discovery",
  title: "Ask consequence questions before pitching",
  principle: "Get the prospect to state the cost of inaction before proposing a solution.",
  whenToUse: ["Early discovery"],
  whenNotToUse: [],
  exampleLanguage: [{ kind: "exact_source_phrase", text: "What happens if you don't fix this?" }],
  confidence: 0.85,
  objectionMapping: null,
};

describe("validateExtractedTeachings", () => {
  it("accepts a well-formed teaching with no objection mapping", () => {
    const result = validateExtractedTeachings({ teachings: [validTeaching] });
    expect(result).toHaveLength(1);
    expect(result[0].objectionMapping).toBeNull();
  });

  it("accepts a well-formed teaching WITH an objection mapping", () => {
    const withMapping = {
      ...validTeaching,
      category: "objection_handling",
      objectionMapping: {
        archetype: "ANCHOR",
        channel: "phone",
        exactObjection: "We already have a vendor",
        frameworkName: "Isolate the constraint",
        responseFamily: "isolate_constraint",
        discoveryQuestions: [],
        whenToUse: [],
        whenNotToUse: [],
        followUpMoves: [],
        badResponses: [],
      },
    };
    const result = validateExtractedTeachings({ teachings: [withMapping] });
    expect(result[0].objectionMapping?.archetype).toBe("ANCHOR");
  });

  it("accepts an empty teachings array — a genuinely valid, expected outcome", () => {
    expect(validateExtractedTeachings({ teachings: [] })).toEqual([]);
  });

  it("rejects an invalid category rather than silently accepting one Goldline never defined", () => {
    expect(() =>
      validateExtractedTeachings({ teachings: [{ ...validTeaching, category: "not_a_real_category" }] })
    ).toThrow(TeachingExtractionValidationError);
  });

  it("rejects a missing principle", () => {
    const { principle: _principle, ...withoutPrinciple } = validTeaching;
    expect(() => validateExtractedTeachings({ teachings: [withoutPrinciple] })).toThrow(
      TeachingExtractionValidationError
    );
  });

  it("rejects malformed top-level output (no teachings array at all)", () => {
    expect(() => validateExtractedTeachings({ notTeachings: [] })).toThrow(
      TeachingExtractionValidationError
    );
    expect(() => validateExtractedTeachings(null)).toThrow(TeachingExtractionValidationError);
  });

  it("normalizes a bare-string example-language entry to paraphrased_principle, never exact", () => {
    const result = validateExtractedTeachings({
      teachings: [{ ...validTeaching, exampleLanguage: ["Get them to feel the cost of waiting."] }],
    });
    expect(result[0].exampleLanguagePhrases[0]).toEqual({
      kind: "paraphrased_principle",
      text: "Get them to feel the cost of waiting.",
    });
  });

  it("never requires an objection mapping — category alone can be a non-objection category", () => {
    for (const category of ["prospecting", "opening", "closing", "follow_up", "sales_psychology"]) {
      const result = validateExtractedTeachings({
        teachings: [{ ...validTeaching, category }],
      });
      expect(result[0].category).toBe(category);
      expect(result[0].objectionMapping).toBeNull();
    }
  });
});

describe("Shelby re-extraction never calls Gemini (static source check)", () => {
  it("the teaching extractor module never imports or references the Gemini video provider", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("./salesIntelTeachingExtraction.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/GeminiVideoUnderstandingProvider/);
    expect(source).not.toMatch(/generativelanguage\.googleapis\.com/);
    expect(source).not.toMatch(/resolveVideoUnderstandingProvider/);
  });

  it("the re-extraction orchestrator module never imports or references the Gemini video provider", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(
      new URL("./salesIntelTeachingReExtraction.ts", import.meta.url),
      "utf8"
    );
    expect(source).not.toMatch(/GeminiVideoUnderstandingProvider/);
    expect(source).not.toMatch(/generativelanguage\.googleapis\.com/);
    expect(source).not.toMatch(/resolveVideoUnderstandingProvider/);
    expect(source).not.toMatch(/from ["']\.\/videoUnderstanding["']/);
  });

  it("the Shelby re-extraction script never imports videoUnderstanding.ts", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(
      new URL("../../scripts/reextractShelbySalesIntel.ts", import.meta.url),
      "utf8"
    );
    expect(source).not.toMatch(/videoUnderstanding/);
    expect(source).not.toMatch(/GEMINI_API_KEY/);
  });
});
