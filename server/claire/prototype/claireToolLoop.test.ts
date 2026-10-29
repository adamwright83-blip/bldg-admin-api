import { describe, expect, it } from "vitest";
import { assembleSpeech } from "./claireToolLoop";

describe("assembleSpeech", () => {
  it("speaks the final round and drops planning narration before a tool call", () => {
    expect(assembleSpeech([["This is dictation, so I'll write all three now."], ["All three are on. Tomorrow the Devon interview, Saturday the Nakamura call, Monday the invoices."]])).toBe(
      "All three are on. Tomorrow the Devon interview, Saturday the Nakamura call, Monday the invoices."
    );
  });

  it("keeps an answer given beside end_call when the final round is only a sign-off (run 8)", () => {
    expect(assembleSpeech([["I can read and change your Day Line and pull your numbers. I can't send texts or make calls."], ["Goodnight, Adam."]])).toBe(
      "I can read and change your Day Line and pull your numbers. I can't send texts or make calls. Goodnight, Adam."
    );
  });

  it("keeps earlier text when the final round is empty", () => {
    expect(assembleSpeech([["Done. The Opus pickup is on tomorrow."], []])).toBe("Done. The Opus pickup is on tomorrow.");
    expect(assembleSpeech([[]])).toBe("");
    expect(assembleSpeech([])).toBe("");
  });

  it("a plain final answer with no tools is spoken as is", () => {
    expect(assembleSpeech([["Tomorrow has two things: the pack walk and the husky meet-and-greet."]])).toBe("Tomorrow has two things: the pack walk and the husky meet-and-greet.");
  });
});
