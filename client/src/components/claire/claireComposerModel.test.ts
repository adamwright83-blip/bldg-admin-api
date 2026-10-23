import { describe, expect, it } from "vitest";
import {
  CLAIRE_COMPOSER_TTL_MS,
  claireComposerErrorCopy,
  freshConversation,
  parseStoredConversation,
  serializeConversation,
} from "./claireComposerModel";

describe("claire composer conversation storage", () => {
  const now = 1_800_000_000_000;

  it("round-trips a live conversation", () => {
    const c = { ...freshConversation(now), lines: [{ who: "you" as const, text: "hi", at: now }] };
    expect(parseStoredConversation(serializeConversation(c), now + 1000)).toEqual(c);
  });

  it("drops a conversation once the server's 12h state has expired", () => {
    const c = { ...freshConversation(now), lines: [{ who: "you" as const, text: "hi", at: now }] };
    expect(parseStoredConversation(serializeConversation(c), now + CLAIRE_COMPOSER_TTL_MS)).toBeNull();
  });

  it("rejects malformed storage and ids the server would refuse", () => {
    expect(parseStoredConversation("not json", now)).toBeNull();
    expect(parseStoredConversation(JSON.stringify({ conversationId: "short", startedAt: now, lines: [] }), now)).toBeNull();
    expect(parseStoredConversation(JSON.stringify({ conversationId: "x".repeat(65), startedAt: now, lines: [] }), now)).toBeNull();
  });

  it("filters out corrupt lines", () => {
    const raw = JSON.stringify({
      conversationId: "abcdefgh-1234",
      startedAt: now,
      lines: [{ who: "claire", text: "ok", at: now }, { who: "system", text: "x", at: now }, null],
    });
    expect(parseStoredConversation(raw, now)?.lines).toEqual([{ who: "claire", text: "ok", at: now }]);
  });

  it("issues conversation ids the server accepts", () => {
    const id = freshConversation(now).conversationId;
    expect(id.length).toBeGreaterThanOrEqual(8);
    expect(id.length).toBeLessThanOrEqual(64);
  });
});

describe("claire composer error copy", () => {
  it("names the membership requirement on FORBIDDEN", () => {
    expect(claireComposerErrorCopy({ code: "FORBIDDEN" })).toMatch(/JOYSTICK account/);
  });

  it("never claims nothing was saved after a failed turn", () => {
    const copy = claireComposerErrorCopy({ code: "INTERNAL_SERVER_ERROR", message: "boom" });
    expect(copy).toMatch(/may already be saved/);
    expect(copy).not.toMatch(/nothing (was|has been) saved/i);
  });
});
