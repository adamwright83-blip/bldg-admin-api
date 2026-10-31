import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NEXT_CHAPTER_TOMORROW_LINE, tomorrowLine } from "./tomorrowLine";

describe("tomorrow's line under a won chapter", () => {
  it("promises the next chapter only while the season has one", () => {
    expect(tomorrowLine(undefined, 1, 3)).toBe(NEXT_CHAPTER_TOMORROW_LINE);
    expect(tomorrowLine(null, 2, 3)).toBe(NEXT_CHAPTER_TOMORROW_LINE);
    expect(tomorrowLine(undefined, 3, 3)).toBeNull();
    expect(tomorrowLine(undefined, 1, 1)).toBeNull();
  });

  it("shows an authored line as written, final chapter or not", () => {
    expect(tomorrowLine("Authored tomorrow.", 1, 3)).toBe("Authored tomorrow.");
    expect(tomorrowLine("Authored ending.", 3, 3)).toBe("Authored ending.");
  });

  it("every surface goes through it: the stock line is written nowhere else in the client", () => {
    const root = path.resolve(import.meta.dirname, "..");
    const offenders = fs
      .readdirSync(root, { recursive: true, encoding: "utf8" })
      .filter(file => /\.(ts|tsx)$/.test(file) && !file.endsWith(".test.ts"))
      .filter(file => path.join(root, file) !== path.join(root, "story", "tomorrowLine.ts"))
      .filter(file => fs.readFileSync(path.join(root, file), "utf8").includes(NEXT_CHAPTER_TOMORROW_LINE));
    expect(offenders).toEqual([]);
  });
});
