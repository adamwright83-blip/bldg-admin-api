import { describe, expect, it } from "vitest";
import { CLAIRE_CANON } from "../character/characterDefinition";
import { lintFailureDayLanguage } from "./toneLint";
import { AUTHORED_DIALOGUE, type DialogueCategory } from "./authoredDialogue";
import { selectDialogueLine } from "./dialogueRegistry";

const lines = (category: DialogueCategory) => AUTHORED_DIALOGUE.filter(l => l.category === category);

describe("no progression state falls back to unfinished copy", () => {
  it("every rapport band has at least three decline lines authored for it (register warms; answer never changes)", () => {
    for (const band of [0, 1, 2, 3] as const) {
      const specific = lines("decline").filter(l => l.minRapport <= band && band <= l.maxRapport && l.maxRapport - l.minRapport < 3);
      expect(specific.length, `decline band ${band}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("every band has at least three thread closers, three pivots, and three exits, so repetition is avoidable", () => {
    for (const category of ["thread_closer", "business_pivot", "call_exit"] as const) {
      for (const band of [0, 1, 2, 3] as const) {
        const eligible = lines(category).filter(l => l.minRapport <= band && band <= l.maxRapport);
        expect(eligible.length, `${category} band ${band}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("selection returns an authored line for every category and band, never null for the categories in use", () => {
    for (const category of ["decline", "thread_closer", "business_pivot", "call_exit"] as const) {
      for (const band of [0, 1, 2, 3] as const) {
        expect(selectDialogueLine({ category, rapportBand: band, fallbackToDeclineFloor: false, random: () => 0 })).not.toBeNull();
      }
    }
  });

  it("a lost reveal is indistinguishable from a refusal: recovery has no dedicated lines and falls to ordinary declines", () => {
    expect(lines("recovery_after_failed_generation")).toHaveLength(0);
    for (const band of [0, 1, 2, 3] as const) {
      const line = selectDialogueLine({ category: "recovery_after_failed_generation", rapportBand: band, random: () => 0 })!;
      expect(line.category).toBe("decline");
    }
  });
});

describe("locked Claire voice and product laws", () => {
  const all = AUTHORED_DIALOGUE.map(l => l.text);
  it("concise, no exclamation marks, no numbers, no placeholders", () => {
    for (const text of all) {
      expect(text.length).toBeLessThanOrEqual(80);
      expect(text).not.toMatch(/[!]|\d/);
      expect(text).not.toMatch(/todo|tbd|placeholder|lorem|xxx|filler/i);
    }
  });
  it("no therapy language, gushing, flirtation, punishment, shame, or motivation", () => {
    for (const text of all) {
      expect(text).not.toMatch(/\b(feel|feelings|safe space|process|heal|trauma|boundar(?:y|ies)|share with me|vulnerab|proud of you|amazing|wonderful|lovely|darling|dear|handsome|love you|disappoint|let me down|prove yourself|not good enough)\b/i);
      expect(lintFailureDayLanguage(text).passes).toBe(true);
    }
  });
  it("never announces progress, unlocks, levels, budgets, counters, or why she is answering", () => {
    for (const text of all) {
      expect(text).not.toMatch(/\b(unlock|level|earned|reward|progress|trust|rapport|question(?:s)? (?:left|remaining)|limit|count|meter|later|another time|next time|when you)\b/i);
    }
  });
  it("invents no biography: no canon vocabulary, no people, places, or history", () => {
    const ordinary = new Set(["something", "anything", "everything", "because", "through", "another", "between", "remains", "quality", "qualities"]);
    const canonWords = new Set<string>();
    for (const f of CLAIRE_CANON) for (const w of (f.fact ?? "").toLowerCase().match(/[a-z]{6,}/g) ?? []) if (!ordinary.has(w)) canonWords.add(w);
    for (const text of all) {
      for (const w of text.toLowerCase().match(/[a-z]{6,}/g) ?? []) expect(canonWords.has(w), `${text} -> ${w}`).toBe(false);
      expect(text).not.toMatch(/\b(father|mother|family|childhood|london|british|born|grew|school|ex\b|married)\b/i);
    }
  });
  it("British register: no American-only idiom", () => {
    for (const text of all) expect(text).not.toMatch(/\b(gonna|wanna|y'all|awesome|buddy|dude|guys)\b/i);
  });
});
