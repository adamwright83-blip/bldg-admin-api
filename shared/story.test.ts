import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isStoryProcedurePath, storySeasonSchema } from "./story";

const season0 = JSON.parse(readFileSync(new URL("../server/story/fixtures/season-0.json", import.meta.url), "utf8"));
const clone = () => structuredClone(season0);

describe("story season file format", () => {
  it("accepts the placeholder Season 0", () => {
    const parsed = storySeasonSchema.parse(season0);
    expect(parsed.slug).toBe("season-0");
    expect(parsed.chapters).toHaveLength(3);
  });

  it("Season 0 is placeholder text only", () => {
    for (const chapter of season0.chapters) {
      for (const line of chapter.lines) expect(line.text).toMatch(/^(Placeholder|Left$|Right$)/);
    }
  });

  it("rejects chapters out of order", () => {
    const s = clone();
    s.chapters[1].number = 5;
    expect(storySeasonSchema.safeParse(s).success).toBe(false);
  });

  it("rejects a question without options, or options without a question", () => {
    const a = clone();
    a.chapters[0].lines = a.chapters[0].lines.filter((l: { slot: string }) => l.slot !== "option");
    expect(storySeasonSchema.safeParse(a).success).toBe(false);
    const b = clone();
    delete b.chapters[0].questionKey;
    expect(storySeasonSchema.safeParse(b).success).toBe(false);
  });

  it("rejects duplicate variants, unknown fields and a chapter with no unconditional opening", () => {
    const a = clone();
    a.chapters[2].lines.push({ ...a.chapters[2].lines[0] });
    expect(storySeasonSchema.safeParse(a).success).toBe(false);
    const b = clone();
    b.chapters[0].lines[0].mood = "x";
    expect(storySeasonSchema.safeParse(b).success).toBe(false);
    const c = clone();
    c.chapters[2].lines[0].when = { minDaysAway: 2 };
    expect(storySeasonSchema.safeParse(c).success).toBe(false);
  });

  it("rejects keys that are not plain identifiers", () => {
    const s = clone();
    s.chapters[0].questionKey = "Has Spaces";
    expect(storySeasonSchema.safeParse(s).success).toBe(false);
  });

  it("knows which tRPC paths are story paths", () => {
    expect(isStoryProcedurePath("system.story.tonight")).toBe(true);
    expect(isStoryProcedurePath("system.story.")).toBe(false);
    expect(isStoryProcedurePath("system.story")).toBe(false);
    expect(isStoryProcedurePath("system.storyteller.x")).toBe(false);
    expect(isStoryProcedurePath("system.story..x")).toBe(false);
    expect(isStoryProcedurePath("admin.x")).toBe(false);
  });
});
