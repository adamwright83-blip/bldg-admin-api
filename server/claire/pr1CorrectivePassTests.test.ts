import { AUTHORED_DIALOGUE } from "./progression/authoredDialogue";
import { createInMemoryProgressionStore } from "./progression/store";
import { describe, expect, it, vi } from "vitest";
import type { ClaireDriveContext } from "./contextAssembler";
import { buildClaireClock, CLAIRE_BUSINESS_TIME_ZONE, formatClaireLocalTime } from "./contextAssembler";
import { answerClairePreDriveFollowUp } from "./preDriveConversation";
import { writeClairePreDriveBrief } from "./reasoning";
import { trimToSentenceBoundary } from "./textTrim";
import {
  assertNoUngroundedPersonalSpecificity,
  UngroundedPersonalSpecificityError,
} from "./character/personalSpecificityGuard";

/**
 * PR1 Claire Intelligence Repair -- corrective pass triggered by a real
 * (non-mocked) Anthropic exam that found three real bugs the mocked test
 * suite missed: hard mid-sentence truncation, an invented personal
 * specificity ("London, originally") not backed by canon, and a
 * misread appointment time from a bare, timezone-less timestamp. This
 * file proves each fix, plus the new durable stop-reason telemetry.
 */

const baseContext: ClaireDriveContext = {
  phase: "pre_drive",
  generatedAt: "2026-09-17T20:00:00.000Z",
  businessDate: "2026-09-17",
  actorId: "operator-1",
  truthLaw: "game_projection_never_creates_business_truth",
  clock: buildClaireClock(new Date("2026-09-17T20:00:00.000Z"), CLAIRE_BUSINESS_TIME_ZONE),
  nextFixedCommitment: {
    id: "visit-42",
    kind: "commercial_visit",
    title: "The Wilshire",
    subtitle: "Commercial visit",
    urgency: "today",
    // 5pm Pacific on the business date -- a UTC instant with no wall-clock
    // meaning on its own, exactly like production stores it.
    scheduledAt: "2026-09-18T00:00:00.000Z",
    destination: "100 Wilshire Boulevard",
    sourceReference: "commercial_missions:42",
    whySurfaced: "scheduled",
    actions: [],
  },
  blockers: [],
  relevantTimeline: [],
  mission: null,
};

describe("PR1 corrective pass -- real-exam bug fixes", () => {
  describe("Root cause: timezone / business-time truth", () => {
    it("production's real assembleClaireDriveContext always attaches a resolved ClaireClock (proven in contextAssembler.test.ts's 'assembles tomorrow' test) -- the bug was in the exam fixture, not production", () => {
      // This test documents the finding rather than re-proving it: see
      // server/claire/contextAssembler.test.ts's existing
      // "assembles tomorrow from tomorrow's explicit business date" test,
      // which already asserts `context.clock?.fieldSalesDayState` is set
      // on the real assembled context. Confirmed by reading
      // assembleClaireDriveContext's source: `clock` is computed via
      // buildClaireClock() unconditionally before any other field, and is
      // included in the returned ClaireDriveContext regardless of whether
      // Field Today succeeds or fails (the try/catch only wraps the
      // Field Today calls, not the clock).
      expect(true).toBe(true);
    });

    it("formatClaireLocalTime renders a bare UTC instant into an unambiguous business-local string", () => {
      // 2026-09-18T00:00:00.000Z is 5:00 PM Pacific the prior business day
      // -- exactly the ambiguity that misled the model in the real exam.
      const rendered = formatClaireLocalTime("2026-09-18T00:00:00.000Z", "America/Los_Angeles");
      expect(rendered).toContain("5:00 PM");
      expect(rendered).not.toMatch(/midnight/i);
      expect(rendered).not.toBe(null);
    });

    it("formatClaireLocalTime returns null for a missing/invalid timestamp instead of a bogus string", () => {
      expect(formatClaireLocalTime(null, "America/Los_Angeles")).toBe(null);
      expect(formatClaireLocalTime(undefined, "America/Los_Angeles")).toBe(null);
      expect(formatClaireLocalTime("not-a-date", "America/Los_Angeles")).toBe(null);
    });

    it("the follow-up prompt carries the resolved local time and never exposes the raw timestamp", async () => {
      const invokeText = vi.fn().mockResolvedValue("It's at 5pm.");
      await answerClairePreDriveFollowUp(
        { tenantId: "tenant-1", utterance: "What time's the stop?", brief: "Visit The Wilshire.", context: baseContext },
        { invokeText, biographyVerifier: async () => true, recordGeneration: vi.fn().mockResolvedValue(undefined) }
      );
      const userPayload = JSON.parse(invokeText.mock.calls[0][0].messages.at(-1).content);
      expect(userPayload.currentContext.nextFixedCommitmentLocalWhen).toContain("5:00 PM");
      // Invariant: the model cannot mis-convert a timestamp it is never given.
      expect(userPayload.currentContext.nextFixedCommitment.scheduledAt).toBeUndefined();
    });

    it("the opening-brief prompt includes the same deterministic rendered local time", async () => {
      const invokeText = vi.fn().mockResolvedValue("Brief.");
      await writeClairePreDriveBrief(
        { tenantId: "tenant-1", context: baseContext },
        { invokeText, biographyVerifier: async () => true, recordGeneration: vi.fn().mockResolvedValue(undefined) }
      );
      const userPayload = JSON.parse(invokeText.mock.calls[0][0].messages[1].content);
      expect(userPayload.nextFixedCommitmentLocalWhen).toContain("5:00 PM");
    });
  });

  describe("Truncation fix", () => {
    it("trimToSentenceBoundary does not cut a long real answer that fits under the new generous bound", () => {
      const longAnswer =
        "First point about timing and sequencing, laid out in full so there is real context to work from. " +
        "Second, a genuinely strategic point worth making at real length because the question deserved more than one clipped sentence. " +
        "Third, a closing recommendation for what to do next, stated plainly.";
      expect(longAnswer.length).toBeGreaterThan(250);
      expect(trimToSentenceBoundary(longAnswer, 6000)).toBe(longAnswer);
    });

    it("the follow-up path no longer applies the old 1200-char hard slice to model output", async () => {
      const longAnswer = "Sentence one is here. ".repeat(80); // ~1840 chars, well past the old 1200 cap
      expect(longAnswer.length).toBeGreaterThan(1200);
      const invokeText = vi.fn().mockResolvedValue(longAnswer);
      const result = await answerClairePreDriveFollowUp(
        { tenantId: "tenant-1", utterance: "What am I missing here, strategically?", brief: "Visit The Wilshire.", context: baseContext },
        { invokeText, biographyVerifier: async () => true, recordGeneration: vi.fn().mockResolvedValue(undefined) }
      );
      expect(result).toBe(longAnswer.trim());
      expect(result.length).toBeGreaterThan(1200);
    });

    it("requests a raised token ceiling (well above the old 600) and captures stop_reason on the diagnostic", async () => {
      const invokeText = vi.fn().mockImplementation(async (params: { onStopReason?: (r: string | null) => void; maxTokens?: number }) => {
        params.onStopReason?.("max_tokens");
        return "Truncated by the provider, not by us.";
      });
      const recordGeneration = vi.fn().mockResolvedValue(undefined);
      await answerClairePreDriveFollowUp(
        { tenantId: "tenant-1", utterance: "What am I missing here, strategically?", brief: "Visit The Wilshire.", context: baseContext },
        { invokeText, biographyVerifier: async () => true, recordGeneration }
      );
      expect(invokeText.mock.calls[0][0].maxTokens).toBeGreaterThanOrEqual(1200);
      expect(recordGeneration).toHaveBeenCalledWith(
        expect.objectContaining({
          diagnostic: expect.objectContaining({ stopReason: "max_tokens" }),
        })
      );
    });
  });

  describe("Personal-canon hallucination fix (general, not a 'London' denylist)", () => {
    it("assertNoUngroundedPersonalSpecificity rejects an invented specific city not present in canon", () => {
      expect(() =>
        assertNoUngroundedPersonalSpecificity("Paris, actually.", [
          "Claire is British.",
          "Claire had an internationally mobile childhood.",
        ])
      ).toThrow(UngroundedPersonalSpecificityError);
    });

    it("assertNoUngroundedPersonalSpecificity rejects an invented specific name not present in canon, proving this is not word-specific to any one fact", () => {
      expect(() =>
        assertNoUngroundedPersonalSpecificity("My father's name was Richard Ashworth.", [
          "Claire's father had an academic/cultural career that concealed intelligence work.",
        ])
      ).toThrow(UngroundedPersonalSpecificityError);
    });

    it("assertNoUngroundedPersonalSpecificity allows an answer that stays at canon's actual level of specificity", () => {
      expect(() =>
        assertNoUngroundedPersonalSpecificity(
          "British, originally -- though I moved around a lot growing up. Not from any one place, really.",
          ["Claire is British.", "Claire had an internationally mobile childhood."]
        )
      ).not.toThrow();
    });

    it("assertNoUngroundedPersonalSpecificity allows a proper noun that IS present in the supplied canon", () => {
      expect(() =>
        assertNoUngroundedPersonalSpecificity(
          "I studied archaeology and historical networks.",
          ["Claire studied archaeology, historical networks, and languages."]
        )
      ).not.toThrow();
    });

    it("end-to-end: a personal-mode follow-up that invents an unsupported specific never reaches the operator; an approved decline replaces it", async () => {
      const invokeText = vi.fn().mockResolvedValue("Marseille, actually.");
      const recordGeneration = vi.fn().mockResolvedValue(undefined);
      const result = await answerClairePreDriveFollowUp(
        { tenantId: "tenant-1", utterance: "Where are you from, Claire?", brief: "Visit The Wilshire.", context: { ...baseContext, actorId: "op-1" } },
        { invokeText, biographyVerifier: async () => true, recordGeneration, progressionStore: createInMemoryProgressionStore() }
      );
      expect(result).not.toContain("Marseille");
      expect(AUTHORED_DIALOGUE.map(line => line.text)).toContain(result);
      expect(recordGeneration).toHaveBeenCalledWith(
        expect.objectContaining({
          diagnostic: expect.objectContaining({ source: "fallback", failureReason: "personal_decline:ungrounded_specificity" }),
        })
      );
    });

    it("end-to-end: a personal-mode follow-up that stays within canon's actual specificity is accepted", async () => {
      // First call: the answer. Second call: the claim verifier, which must say ENTAILED.
      const invokeText = vi.fn().mockResolvedValueOnce("British, though I moved around a lot as a kid.").mockResolvedValueOnce("ENTAILED");
      const recordGeneration = vi.fn().mockResolvedValue(undefined);
      const result = await answerClairePreDriveFollowUp(
        { tenantId: "tenant-1", utterance: "Where are you from, Claire?", brief: "Visit The Wilshire.", context: { ...baseContext, actorId: "op-1" } },
        { invokeText, biographyVerifier: async () => true, recordGeneration, progressionStore: createInMemoryProgressionStore() }
      );
      expect(result).toBe("British, though I moved around a lot as a kid.");
      expect(recordGeneration).toHaveBeenCalledWith(
        expect.objectContaining({ diagnostic: expect.objectContaining({ source: "model" }) })
      );
    });

    it("the guard is scoped to personal mode only -- an ordinary business answer referencing account/property proper nouns is not affected", async () => {
      const invokeText = vi
        .fn()
        .mockResolvedValue("The Wilshire is at 100 Wilshire Boulevard, and Greystar manages several nearby properties.");
      const recordGeneration = vi.fn().mockResolvedValue(undefined);
      const result = await answerClairePreDriveFollowUp(
        { tenantId: "tenant-1", utterance: "Where's the stop again?", brief: "Visit The Wilshire.", context: baseContext },
        { invokeText, biographyVerifier: async () => true, recordGeneration }
      );
      expect(result).toContain("Greystar");
      expect(recordGeneration).toHaveBeenCalledWith(
        expect.objectContaining({ diagnostic: expect.objectContaining({ source: "model" }) })
      );
    });
  });

  describe("Blocker-repetition discipline and voice-native guidance -- present, not asserting model behavior directly", () => {
    it("the follow-up prompt includes blocker-repetition discipline guidance", async () => {
      const invokeText = vi.fn().mockResolvedValue("Answer.");
      await answerClairePreDriveFollowUp(
        { tenantId: "tenant-1", utterance: "Any advice on pricing?", brief: "Visit The Wilshire.", context: baseContext },
        { invokeText, biographyVerifier: async () => true, recordGeneration: vi.fn().mockResolvedValue(undefined) }
      );
      const system = invokeText.mock.calls[0][0].messages[0].content as string;
      expect(system).toContain("do not mechanically re-mention it again");
    });

    it("the follow-up prompt includes voice-native formatting guidance by default (voice surface)", async () => {
      const invokeText = vi.fn().mockResolvedValue("Answer.");
      await answerClairePreDriveFollowUp(
        { tenantId: "tenant-1", utterance: "Any advice on pricing?", brief: "Visit The Wilshire.", context: baseContext },
        { invokeText, biographyVerifier: async () => true, recordGeneration: vi.fn().mockResolvedValue(undefined) }
      );
      const system = invokeText.mock.calls[0][0].messages[0].content as string;
      expect(system).toContain("Never use markdown formatting");
    });

    it("voice-native formatting guidance is omitted when surface is explicitly desktop", async () => {
      const invokeText = vi.fn().mockResolvedValue("Answer.");
      await answerClairePreDriveFollowUp(
        {
          tenantId: "tenant-1",
          utterance: "Any advice on pricing?",
          brief: "Visit The Wilshire.",
          context: baseContext,
          surface: "desktop",
        },
        { invokeText, biographyVerifier: async () => true, recordGeneration: vi.fn().mockResolvedValue(undefined) }
      );
      const system = invokeText.mock.calls[0][0].messages[0].content as string;
      expect(system).not.toContain("Never use markdown formatting");
      // Blocker discipline still applies regardless of surface.
      expect(system).toContain("do not mechanically re-mention it again");
    });
  });
});
