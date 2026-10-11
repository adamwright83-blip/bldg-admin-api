import { describe, expect, it } from "vitest";
import { CONTENT_NOTE, SHUT_COPY, chapterTags, presentGate, presentTile, type GateEligibility } from "./gate";

const base: GateEligibility = {
  unlockedChapters: 0,
  nextChapter: 1,
  objectivesRemaining: null,
  firstSaleTerritoryId: null,
  nextUnlockRequirement: "first_verified_sale",
  preview: false,
};
const ok = (over: Partial<GateEligibility>) => ({ status: "success" as const, data: { ...base, ...over } });

describe("presentGate", () => {
  it("is not open while loading or after an error (fail closed)", () => {
    expect(presentGate({ status: "loading" }).kind).toBe("loading");
    expect(presentGate({ status: "error" })).toEqual({ kind: "unavailable", message: SHUT_COPY });
  });

  it("zero chapters is locked, with no fraction, score or countdown", () => {
    expect(presentGate(ok({}))).toEqual({ kind: "locked", message: SHUT_COPY });
  });

  it("Chapter 1 open: Ch.2 reads '3 to go', Ch.3 blank, Ch.4 '?'", () => {
    const view = presentGate(
      ok({ unlockedChapters: 1, nextChapter: 2, objectivesRemaining: 3, nextUnlockRequirement: "complete_objectives" })
    );
    expect(view.kind).toBe("open");
    if (view.kind !== "open") return;
    expect(view.playable).toEqual([1]);
    expect(view.tags.map(t => [t.chapter, t.state, t.label])).toEqual([
      [1, "open", "Chapter 1"],
      [2, "next", "3 to go"],
      [3, "shut", null],
      [4, "mystery", "?"],
    ]);
  });

  it("the remaining count follows the server", () => {
    const tags = chapterTags({ unlockedChapters: 2, objectivesRemaining: 1 });
    expect(tags[2]).toMatchObject({ chapter: 3, state: "next", label: "1 to go" });
  });

  it("all three open leaves only the mystery tag", () => {
    const tags = chapterTags({ unlockedChapters: 3, objectivesRemaining: null });
    expect(tags.filter(t => t.state === "open")).toHaveLength(3);
    expect(tags.some(t => t.state === "next")).toBe(false);
    expect(tags[3]).toMatchObject({ chapter: 4, state: "mystery", label: "?" });
  });

  it("clamps nonsense from the wire", () => {
    expect(chapterTags({ unlockedChapters: 99, objectivesRemaining: null }).filter(t => t.state === "open")).toHaveLength(3);
    expect(chapterTags({ unlockedChapters: -4, objectivesRemaining: 3 }).filter(t => t.state === "open")).toHaveLength(0);
  });

  it("preview is passed through so the ribbon can show", () => {
    const view = presentGate(ok({ unlockedChapters: 3, preview: true, nextChapter: null }));
    expect(view).toMatchObject({ kind: "open", preview: true });
  });

  it("carries no score, streak, timer or xp in anything the player sees", () => {
    const text = JSON.stringify([
      presentGate(ok({})),
      presentGate(ok({ unlockedChapters: 2, nextChapter: 3, objectivesRemaining: 2 })),
    ]).toLowerCase();
    for (const banned of ["xp", "streak", "score", "gold", "timer", "fail", "coin"]) {
      expect(text).not.toContain(banned);
    }
  });
});

describe("presentTile", () => {
  it("is lit only on a server-confirmed open chapter, and always carries the content note", () => {
    expect(presentTile({ status: "loading" }).state).toBe("unknown");
    expect(presentTile({ status: "error" }).state).toBe("unknown");
    expect(presentTile(ok({})).state).toBe("locked");
    expect(presentTile(ok({ unlockedChapters: 1 })).state).toBe("lit");
    expect(presentTile(ok({ unlockedChapters: 3, preview: true })).label).toBe("Preview");
    for (const q of [{ status: "loading" as const }, ok({}), ok({ unlockedChapters: 1 })]) {
      expect(presentTile(q).note).toBe(CONTENT_NOTE);
    }
    expect(CONTENT_NOTE).toBe("Contains mature themes.");
  });
});
