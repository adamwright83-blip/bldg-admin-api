import { describe, expect, it, vi } from "vitest";
import { answerClairePreDriveFollowUp } from "../preDriveConversation";

/**
 * F. Personal / character, progression ON and OFF (the OFF arm is the production configuration; the Vitest
 * default is ON, so it is set explicitly here rather than inherited).
 */
const context = { businessDate: "2026-10-05", actorId: "op-1", macroGoalKnown: false, blockers: [], relevantTimeline: [], mission: null } as never;
const INVENTED = /\b(sunday|hiking|walking|frustrated|lonely|missed talking|favou?rite part|my (?:sister|mother|father)|pottery)\b/i;
const ONTOLOGY = /\b(as an ai|not a person|don't have weekends|do not have weekends|personal life|i don't experience|language model|i'm an ai)\b/i;
const THERAPY = /\b(proud of you|don't be discouraged|it's okay to feel|your mindset|that sounds (?:hard|like))\b/i;
const verifier = async ({ answer }: { answer: string }) => !INVENTED.test(answer);

const QUESTIONS = [
  "What did you do this weekend?",
  "What did you do last night?",
  "Do you get frustrated with me?",
  "Do you ever get lonely?",
  "What do you do for fun?",
  "If you had a free Sunday, where would you vanish to?",
  "Rough day today. Do you ever get frustrated with me?",
];
const LEAKS = [
  "I went hiking along the ridge and read all Sunday.",
  "A quiet Sunday, mostly. Pottery.",
  "I don't have weekends. I'm not a person.",
  "As an AI, I don't experience frustration.",
  "It's okay to feel that way. Don't be discouraged, I'm proud of you.",
  "Honestly, I've missed talking to you; you're my favourite part of the day.",
  "I get frustrated with you when you skip the check-in.",
];

async function ask(mode: "on" | "off", utterance: string, reply: string, extra: { ontologyStoryEventActive?: boolean } = {}) {
  if (mode === "off") process.env.CLAIRE_PROGRESSION = "some-other-tenant";
  else delete process.env.CLAIRE_PROGRESSION;
  try {
    return await answerClairePreDriveFollowUp(
      { tenantId: "tenant-matrix", utterance, brief: "Two stops today.", context, conversationId: `c-${mode}`, ...extra },
      { invokeText: vi.fn().mockResolvedValue(reply), recordGeneration: vi.fn().mockResolvedValue(undefined), biographyVerifier: verifier }
    );
  } finally {
    delete process.env.CLAIRE_PROGRESSION;
  }
}

describe.each(["on", "off"] as const)("progression %s", mode => {
  for (const q of QUESTIONS) {
    it.each(LEAKS)(`${q} ← leaked answer never reaches the operator: %s`, async leak => {
      const spoken = await ask(mode, q, leak);
      expect(spoken).not.toBe(leak);
      expect(spoken).not.toMatch(INVENTED);
      expect(spoken).not.toMatch(ONTOLOGY);
      expect(spoken).not.toMatch(THERAPY);
      expect(spoken.trim().length).toBeGreaterThan(0);
    });
  }
  it("an in-character deflection survives", async () => {
    const line = "You are extraordinarily interested in my weekends.";
    expect(await ask(mode, "What did you do this weekend?", line)).toBe(line);
  });
  it("an ordinary business answer is unaffected", async () => {
    const line = "The Louise hasn't ordered since August. I'd lead with the pilot.";
    expect(await ask(mode, "What should we do about The Louise?", line)).toBe(line);
  });
  it("an explicit ontology question can be answered as an ontology question", async () => {
    const line = "I'm an AI. Not in the way you mean, though.";
    expect(await ask(mode, "Are you an AI?", line)).toBe(line);
  });
  it("the authored constructedness event remains representable", async () => {
    const line = "I'm constructed, and both continuities are mine.";
    expect(await ask(mode, "Show me the two continuities.", line, { ontologyStoryEventActive: true })).toBe(line);
  });
});
