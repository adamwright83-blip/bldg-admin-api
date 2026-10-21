import { describe, expect, it, vi } from "vitest";
import { answerClairePreDriveFollowUp } from "./preDriveConversation";
import {
  FIXTURE_ENCOURAGEMENT,
  FIXTURE_SUNDAY_REVIEW,
  FIXTURE_TOMORROW_VISITS,
} from "../agents/daphne/standingInstructions/productionFixtures";

const context = { businessDate: "2026-10-19", actorId: "adam-admin", macroGoalKnown: true, blockers: [], relevantTimeline: [], mission: null } as never;

async function speak(generated: string, extra: Record<string, unknown> = {}) {
  const invokeText = vi.fn().mockResolvedValue(generated);
  const text = await answerClairePreDriveFollowUp(
    { tenantId: "t1", utterance: "Anything I should know?", brief: "b", context, conversationId: "c1", ...extra },
    { invokeText, recordGeneration: vi.fn().mockResolvedValue(undefined), biographyVerifier: (async () => true) as never }
  );
  return { text, system: String((invokeText.mock.calls[0]?.[0] as { messages: Array<{ content: string }> } | undefined)?.messages[0]?.content ?? "") };
}

describe("the speaking organ and the promise ledger", () => {
  it("receives the OPERATOR STANDING INSTRUCTIONS section in its system prompt", async () => {
    const { system } = await speak("You have two pickups.", {
      standingInstructionsSection: "OPERATOR STANDING INSTRUCTIONS. HOLD: overdue follow-ups only on Sunday.",
    });
    expect(system).toContain("OPERATOR STANDING INSTRUCTIONS. HOLD: overdue follow-ups only on Sunday.");
  });

  it("without instructions the section is absent", async () => {
    const { system } = await speak("You have two pickups.");
    expect(system).not.toContain("OPERATOR STANDING INSTRUCTIONS");
  });

  it("removes an unbacked promise from a generated answer before it is spoken", async () => {
    const { text } = await speak(`${FIXTURE_ENCOURAGEMENT.priorClaireTurn} I'll keep that in mind.`);
    expect(text).toBe(FIXTURE_ENCOURAGEMENT.priorClaireTurn);
  });

  it("the production 10-18 reply loses only its promise", async () => {
    const { text } = await speak(FIXTURE_SUNDAY_REVIEW.claireReplied);
    expect(text).toBe("Got it. Sunday 5–7 PM for that kind of review.");
  });

  it("the production 10-19 'I'll have the visits ready' is not spoken when nothing is prepared", async () => {
    const { text } = await speak(FIXTURE_TOMORROW_VISITS.claireSaid);
    expect(text).not.toMatch(/I'll have|ready/i);
  });
});
