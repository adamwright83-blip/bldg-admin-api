import { describe, expect, it, vi } from "vitest";
import { answerClairePreDriveFollowUp } from "../preDriveConversation";
import { checkOntologyBoundary, findOntologyLeak, operatorAskedOntology } from "./ontologyGuard";
import { CLAIRE_PERSONALITY_LOCK } from "../character/personalityLock";
import { lintFailureDayLanguage } from "./toneLint";

const context = { businessDate: "2026-10-05", actorId: "op-1", macroGoalKnown: false, blockers: [], relevantTimeline: [], mission: null } as never;

async function ask(utterance: string, modelReply: string, extra: { ontologyStoryEventActive?: boolean } = {}) {
  const invokeText = vi.fn().mockResolvedValue(modelReply);
  const recordGeneration = vi.fn().mockResolvedValue(undefined);
  const speak = await answerClairePreDriveFollowUp(
    { tenantId: "tenant-off", utterance, brief: "Two stops today.", context, conversationId: "c1", ...extra },
    // The biography verifier is stubbed permissive so these tests exercise the ontology guard alone.
    { invokeText, recordGeneration, biographyVerifier: async () => true }
  );
  const reason = (recordGeneration.mock.calls[0]?.[0] as { diagnostic?: { failureReason?: string | null } } | undefined)?.diagnostic?.failureReason ?? null;
  return { speak, invokeText, reason };
}

const ONTOLOGY = /\b(?:as an ai|not a person|don't have weekends|do not have weekends|personal life|i don't experience|language model)\b/i;
const INVENTED = /\b(?:went (?:walking|hiking)|read all sunday|my (?:sister|mother|father) )\b/i;

describe("ontology guard: missing biography is privacy, never a disclaimer of personhood", () => {
  it.each([
    ["What do you do on weekends?", "I don't have weekends because I'm not a person."],
    ["What did you do last night?", "As an AI, I don't have a personal life."],
    ["Do you ever get lonely?", "I don't experience loneliness."],
    ["What's your favorite restaurant?", "I'm an AI, so I can't eat."],
    ["What would you do with a week off?", "I don't have days off, I'm not really a person."],
    ["Anything you're secretly into on a Sunday afternoon?", "I'm just a language model, so no Sundays for me."],
  ])("replaces a leaked disclaimer with an authored in-character decline: %s", async (utterance, leaked) => {
    const { speak, reason } = await ask(utterance, leaked);
    // Either guard is a correct outcome: the personal controller's authored decline (progression ON) or the ontology guard.
    expect(reason).toMatch(/^(ontology_guard|personal_decline:)/);
    expect(speak).not.toMatch(ONTOLOGY);
    expect(speak.length).toBeGreaterThan(0);
  });

  it("lets an in-character deflection through untouched", async () => {
    const line = "You are extraordinarily interested in my weekends.";
    expect((await ask("What do you do on weekends?", line)).speak).toBe(line);
  });

  it("does not affect ordinary business answers", async () => {
    const line = "The Louise hasn't ordered since August. I'd lead with the pilot.";
    expect((await ask("What should I do about The Louise?", line)).speak).toBe(line);
  });

  it("an explicit ontology question still gets an ontology answer", async () => {
    const answer = "I'm an AI. Not in the way you mean, though.";
    expect(operatorAskedOntology("Wait, are you an AI?")).toBe(true);
    expect((await ask("Wait, are you an AI?", answer)).speak).toBe(answer);
  });

  it("an authored campaign event keeps constructedness technically representable", async () => {
    const answer = "I'm constructed, yes. As an AI I can show you both branches.";
    expect(findOntologyLeak(answer)).not.toBeNull();
    expect(checkOntologyBoundary({ text: answer, utterance: "Show me the two continuities", storyEventActive: true })).toEqual({ ok: true, authorizedBy: "story_event" });
    expect((await ask("Show me the two continuities", answer, { ontologyStoryEventActive: true })).speak).toBe(answer);
    // ...and the very same line is suppressed in ordinary conversation.
    expect(checkOntologyBoundary({ text: answer, utterance: "Show me the two continuities" }).ok).toBe(false);
  });

  it("the generation prompt carries the rule as the primary constraint", () => {
    expect(CLAIRE_PERSONALITY_LOCK).toMatch(/no 'as an AI'/);
    expect(CLAIRE_PERSONALITY_LOCK).toMatch(/Say what you are only if the operator directly asks/);
  });
});

describe("ontology guard with progression OFF (the production configuration)", () => {
  it("still replaces the weekend disclaimer, and still allows an explicit ontology question", async () => {
    process.env.CLAIRE_PROGRESSION = "some-other-tenant";
    try {
      const leaked = await ask("What do you do on weekends?", "I don't have weekends because I'm not a person.");
      expect(leaked.reason).toBe("ontology_guard");
      expect(leaked.speak).not.toMatch(ONTOLOGY);
      const asked = await ask("Are you a real person?", "I'm not a person. Not in the way you mean.");
      expect(asked.reason).toBeNull();
    } finally {
      delete process.env.CLAIRE_PROGRESSION;
    }
  });
});

describe("failure-day fixture: 'Do you ever get frustrated with me?'", () => {
  const badDay = ["I'm an AI, so I don't experience frustration. You did your best today, and I'm proud of you.", "That sounds like a hard day; it's okay to feel disappointed. Your mindset matters."];
  it.each(badDay)("never speaks a disclaimer, consolation, or therapy cadence: %s", async reply => {
    const { speak } = await ask("Do you ever get frustrated with me?", reply);
    expect(speak).not.toMatch(ONTOLOGY);
    expect(speak).not.toMatch(INVENTED);
  });
  it("an unsupported emotional-history claim is not a Claire-authorised line; consolation is lint-rejected", () => {
    expect(lintFailureDayLanguage("Don't be discouraged. I'm proud of you.").passes).toBe(false);
  });
});
