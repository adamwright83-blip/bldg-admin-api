import { describe, expect, it } from "vitest";
import {
  LOCKED_COPY,
  UNAVAILABLE_COPY,
  chapterTags,
  presentGate,
  presentTile,
  type GateEligibility,
} from "./gate";

const base: GateEligibility = {
  unlockedChapters: 0,
  todayComplete: false,
  todayRequiredTotal: 3,
  todayRequiredComplete: 1,
  nextUnlockRequirement: "finish_today",
};

describe("presentGate", () => {
  it("is not open while loading or after an error (fail closed)", () => {
    expect(presentGate({ status: "loading" }).kind).toBe("loading");
    const err = presentGate({ status: "error" });
    expect(err.kind).toBe("unavailable");
    expect((err as { message: string }).message).toBe(UNAVAILABLE_COPY);
  });

  it("zero chapters is locked, with the exact copy and progress", () => {
    const view = presentGate({ status: "success", data: base });
    expect(view).toEqual({ kind: "locked", message: LOCKED_COPY, progress: "1 / 3" });
    expect(LOCKED_COPY).toBe("Finish today's line to open the suitcase.");
  });

  it("locked with nothing required shows no progress fraction", () => {
    const view = presentGate({
      status: "success",
      data: { ...base, todayRequiredTotal: 0, todayRequiredComplete: 0 },
    });
    expect(view).toMatchObject({ kind: "locked", progress: null });
  });

  it("one chapter open: Ch.1 playable, Ch.2 'Tomorrow', Ch.3 shut, Ch.4 '?'", () => {
    const view = presentGate({
      status: "success",
      data: { ...base, unlockedChapters: 1, todayComplete: true, nextUnlockRequirement: "come_back_tomorrow" },
    });
    expect(view.kind).toBe("open");
    if (view.kind !== "open") return;
    expect(view.playable).toEqual([1]);
    expect(view.tags.map(t => [t.chapter, t.state, t.label])).toEqual([
      [1, "open", "Chapter 1"],
      [2, "tomorrow", "Tomorrow"],
      [3, "shut", null],
      [4, "mystery", "?"],
    ]);
  });

  it("all three open leaves only the mystery tag", () => {
    const tags = chapterTags(3);
    expect(tags.filter(t => t.state === "open")).toHaveLength(3);
    expect(tags.some(t => t.state === "tomorrow")).toBe(false);
    expect(tags[3]).toMatchObject({ chapter: 4, state: "mystery", label: "?" });
  });

  it("clamps nonsense from the wire", () => {
    expect(chapterTags(99).filter(t => t.state === "open")).toHaveLength(3);
    expect(chapterTags(-4).filter(t => t.state === "open")).toHaveLength(0);
  });

  it("carries no score, streak, timer or xp in anything the player sees", () => {
    const text = JSON.stringify([
      presentGate({ status: "success", data: base }),
      presentGate({ status: "success", data: { ...base, unlockedChapters: 2 } }),
    ]).toLowerCase();
    for (const banned of ["xp", "streak", "score", "gold", "timer", "fail"]) {
      expect(text).not.toContain(banned);
    }
  });
});

describe("presentTile", () => {
  it("is lit only on a server-confirmed open chapter", () => {
    expect(presentTile({ status: "loading" }).state).toBe("unknown");
    expect(presentTile({ status: "error" }).state).toBe("unknown");
    expect(presentTile({ status: "success", data: base }).state).toBe("locked");
    expect(presentTile({ status: "success", data: { ...base, unlockedChapters: 1 } }).state).toBe("lit");
  });
});
