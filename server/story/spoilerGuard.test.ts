import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script without types
import { findProtected, hashWord, PROTECTED_WORD_HASHES, SALT, wordsOf } from "../../scripts/story/spoiler-guard.mjs";

describe("story spoiler guard", () => {
  const TEST_SALT = "test-salt:";
  const planted = new Set([hashWord("zzplantedword", TEST_SALT)]);

  it("finds a protected word in any case and any surrounding", () => {
    for (const text of ["zzplantedword", 'const a = "ZZPlantedWord";', "<p>hello zzplantedword.</p>", "x_zzplantedword_y"]) {
      expect(findProtected(text, planted, TEST_SALT)).toHaveLength(1);
    }
  });

  it("does not flag words that merely contain a protected word", () => {
    expect(findProtected("zzplantedwords prezzplantedword", planted, TEST_SALT)).toEqual([]);
  });

  it("reports hash prefixes, never the word", () => {
    const [hit] = findProtected("zzplantedword", planted, TEST_SALT);
    expect(hit).toMatch(/^[0-9a-f]{12}$/);
    expect(hit).not.toContain("planted");
  });

  it("holds only hashes", () => {
    expect(SALT).toBe("joystick-story-guard/v1:");
    expect(PROTECTED_WORD_HASHES.size).toBeGreaterThan(0);
    for (const h of PROTECTED_WORD_HASHES) expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(wordsOf("A b-c")).toEqual(new Set(["a", "b", "c"]));
  });
});
