import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { tuneChallenge } from "./challengeDirector";

describe("tuneChallenge", () => {
  it("returns a valid tuning for baseline depth", () => {
    const tuning = tuneChallenge({ depth: "baseline" });
    expect(tuning.timerSeconds).toBeGreaterThan(0);
    expect(tuning.presentationComplexity).toBe("standard");
  });

  it("deepened play skill changes presentation, never the count of real work", () => {
    const tuning = tuneChallenge({ depth: "deepened" });
    expect(tuning.presentationComplexity).toBe("elevated");
  });

  describe("structural boundary: the Challenge Director cannot create business work", () => {
    it("its input/output types have nowhere to put a business action", () => {
      const source = readFileSync(resolve(__dirname, "./challengeDirector.ts"), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
      const typeBlock = source.slice(
        source.indexOf("export type ChallengeDirectorInput"),
        source.indexOf("export function tuneChallenge")
      );
      for (const forbidden of [
        "count",
        "location",
        "businessActionId",
        "grammar",
        "customer",
        "visit",
        "call",
      ]) {
        expect(typeBlock.toLowerCase()).not.toContain(forbidden.toLowerCase());
      }
    });

    it("its depth input is demonstrated-skill-derived, not a client-invented score field", () => {
      const source = readFileSync(resolve(__dirname, "./challengeDirector.ts"), "utf8");
      expect(source).toMatch(/depth: ChallengeDepth/);
      expect(source).not.toMatch(/score: number/);
    });
  });
});
