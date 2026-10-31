import { describe, expect, it } from "vitest";
import { chapterGate, type ChapterGateInput } from "./chapterGate";

const kept: ChapterGateInput = { portraitKept: true, chapterOpen: true, onFirstChapter: false, data: undefined, isError: false };
const opportunity = { id: "finding-1" };

describe("what follows a kept portrait", () => {
  it("is nothing until the page is kept", () => {
    expect(chapterGate({ ...kept, portraitKept: false, data: { opportunity } })).toBe("closed");
  });

  it("lets the seal land first", () => {
    expect(chapterGate({ ...kept, chapterOpen: false, data: { opportunity } })).toBe("sealing");
  });

  it("opens the chapter when there's a conversation to pick up", () => {
    expect(chapterGate({ ...kept, data: { opportunity } })).toBe("open");
  });

  it("says so plainly when there's no conversation, instead of staying on the page", () => {
    expect(chapterGate({ ...kept, data: { opportunity: null } })).toBe("no_opportunity");
  });

  it("shows the chapter is on its way while it's read", () => {
    expect(chapterGate(kept)).toBe("loading");
  });

  it("offers to try again when the chapter couldn't be read", () => {
    expect(chapterGate({ ...kept, isError: true })).toBe("error");
  });

  it("keeps a chapter already read when a later read fails", () => {
    expect(chapterGate({ ...kept, isError: true, data: { opportunity } })).toBe("open");
    expect(chapterGate({ ...kept, isError: true, data: { opportunity: null } })).toBe("no_opportunity");
  });

  it("stays out of the way on the person's first-chapter page", () => {
    expect(chapterGate({ ...kept, onFirstChapter: true, data: { opportunity } })).toBe("closed");
    expect(chapterGate({ ...kept, onFirstChapter: true, isError: true })).toBe("closed");
  });

  it("never leaves a kept, opened page with nothing to show", () => {
    for (const data of [undefined, null, { opportunity: null }, { opportunity }]) {
      for (const isError of [false, true]) {
        expect(chapterGate({ ...kept, data, isError })).not.toBe("closed");
      }
    }
  });
});
