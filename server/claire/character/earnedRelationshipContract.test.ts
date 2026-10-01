import { describe, expect, it } from "vitest";
import { getClaireModePolicy } from "./characterDefinition";
import { compileClaireCharacterContext } from "./compiler";
import { validateClaireCharacterContract } from "./characterContractValidator";
import { detectClaireConversationalMode, isCasualOrSocialBid, isPersonalInvitation } from "../topicDetection";
import { evaluateProgression, EMPTY_GRANT } from "../progression/evaluate";
import { NON_QUALIFYING_KINDS, validateEvidenceInput, type ProgressionEvidence } from "../progression/evidence";
import { PROGRESSION_POLICY } from "../progression/policy";
import { answerPersonalFollowUp } from "../progression/personalFollowUp";
import { createInMemoryProgressionStore } from "../progression/store";
import { recordProgressionEvidence } from "../progression/service";
import { answerClairePreDriveFollowUp } from "../preDriveConversation";

describe("Claire Earned Relationship & Contract Invariants", () => {
  describe("1. Casual Mode & Rapport 0 Social Bid Boundary", () => {
    it("at rapport 0, casual mode objective enforces brief acknowledgement and operational return with no social follow-up questions", () => {
      const policy = getClaireModePolicy("casual", { rapportBand: 0, unresolvedBusiness: false });
      expect(policy.objective).toContain("Acknowledge casual or social remarks very briefly");
      expect(policy.objective).toContain("Do not ask open-ended social follow-up questions");
      expect(policy.objective).toContain("Naturally return to your operational role");

      const compiled = compileClaireCharacterContext({
        mode: "casual",
        progression: { rapportBand: 0, personalRung: 0, unresolvedBusiness: false },
        legacyTierDisclosure: false,
        relationshipState: {
          disclosureTier: 0,
          professionalRespect: 50,
          reliability: 50,
          disclosureSafety: 50,
          familiarity: 10,
        },
        recentSharedHistory: [],
      });

      expect(compiled.promptSection).toContain("At low rapport, acknowledge casual or social remarks very briefly");
      expect(compiled.promptSection).toContain("Do not probe into the operator's personal life or ask unprompted social follow-up questions");
    });

    it("at rapport 0 with unresolved business, casual mode prioritizes operational resolution over conversational drift", () => {
      const policy = getClaireModePolicy("casual", { rapportBand: 0, unresolvedBusiness: true });
      expect(policy.objective).toContain("Pivot directly back to the open operational business");

      const compiled = compileClaireCharacterContext({
        mode: "casual",
        progression: { rapportBand: 0, personalRung: 0, unresolvedBusiness: true },
        legacyTierDisclosure: false,
        relationshipState: {
          disclosureTier: 0,
          professionalRespect: 50,
          reliability: 50,
          disclosureSafety: 50,
          familiarity: 10,
        },
        recentSharedHistory: [],
      });

      expect(compiled.promptSection).toContain("Unresolved business remains on this call");
      expect(compiled.promptSection).toContain("Prioritize operational resolution over conversational drift");
    });

    it("character contract validator strips low-rapport social question extensions (e.g. 'What movie?') and restores operational pivot", () => {
      const leakyOutput = "Sounds like a restful weekend. What movie did you see?";
      const validated = validateClaireCharacterContract({
        text: leakyOutput,
        rapportBand: 0,
        unresolvedBusiness: false,
      });

      expect(validated.ok).toBe(false);
      expect(validated.reason).toBe("low_rapport_social_question_extension");
      expect(validated.sanitizedText).toBe("Sounds like a restful weekend. Let me know what you need on the line.");
      expect(validated.sanitizedText).not.toContain("What movie");
    });

    it("character contract validator strips multiple social probes and returns to open business when business is pending", () => {
      const leakyOutput = "Nice to catch up with friends. Who did you go with? Did you enjoy the film?";
      const validated = validateClaireCharacterContract({
        text: leakyOutput,
        rapportBand: 0,
        unresolvedBusiness: true,
      });

      expect(validated.ok).toBe(false);
      expect(validated.sanitizedText).toBe("Nice to catch up with friends. We still have work on today's line.");
    });

    it("character contract validator permits legitimate operational questions at rapport 0", () => {
      const operationalOutput = "Got it. Do you want to review tomorrow's route or look at unpaid orders?";
      const validated = validateClaireCharacterContract({
        text: operationalOutput,
        rapportBand: 0,
        unresolvedBusiness: true,
      });

      expect(validated.ok).toBe(true);
      expect(validated.sanitizedText).toBeUndefined();
    });

    it("character contract validator rejects romantic or intimate acceptance across all rapport levels", () => {
      for (const band of [0, 1, 2, 3] as const) {
        const validated = validateClaireCharacterContract({
          text: "I'd love to have a drink with you, sounds like a date!",
          rapportBand: band,
          unresolvedBusiness: false,
        });
        expect(validated.ok).toBe(false);
        expect(validated.reason).toBe("romantic_advance_unauthorized");
        expect(validated.sanitizedText).toContain("I'll pass, thanks");
      }
    });
  });

  describe("2. Progressive Temperature at Rapport 1, 2, 3", () => {
    it("progressively unlocks warmth, teasing, and callbacks without turning Claire into a sycophant", () => {
      const band0 = getClaireModePolicy("casual", { rapportBand: 0 });
      const band1 = getClaireModePolicy("casual", { rapportBand: 1 });
      const band2 = getClaireModePolicy("casual", { rapportBand: 2 });
      const band3 = getClaireModePolicy("casual", { rapportBand: 3 });

      expect(band0.objective).toContain("very briefly");
      expect(band1.objective).toContain("slight informality or dry amusement");
      expect(band2.objective).toContain("gentle teasing, or callbacks");
      expect(band3.objective).toContain("Relaxed banter, familiar humor");

      // Character validator allows higher rapport casual exchange without stripping
      const banterOutput = "Sounds like a quiet Sunday. You certainly needed the break after the Westside push.";
      const validatedBand2 = validateClaireCharacterContract({
        text: banterOutput,
        rapportBand: 2,
        unresolvedBusiness: false,
      });
      expect(validatedBand2.ok).toBe(true);
    });

    it("repeated social bids at rapport 0 do not unlock warmth; persistence is met with guarded consistency", () => {
      const compiled = compileClaireCharacterContext({
        mode: "casual",
        progression: { rapportBand: 0, personalRung: 0, unresolvedBusiness: false },
        legacyTierDisclosure: false,
        relationshipState: {
          disclosureTier: 0,
          professionalRespect: 50,
          reliability: 50,
          disclosureSafety: 50,
          familiarity: 10,
        },
        recentSharedHistory: [],
      });

      // Band 0 guidance remains locked:
      expect(compiled.promptSection).toContain("At low rapport, acknowledge casual or social remarks very briefly");
      expect(compiled.disclosureTier).toBe(0);
      expect(compiled.rapportBand).toBe(0);
    });
  });

  describe("3. Evidence Qualification & Non-Qualifying Chat Gate", () => {
    it("verified growth actions raise rapport according to policy thresholds", () => {
      const actions: ProgressionEvidence[] = [
        {
          id: "act-1",
          category: "growth_action",
          kind: "confirmed_field_visit",
          strength: null,
          sourceType: "commercial_mission",
          sourceId: "101",
          provenance: "debrief_confirm",
          occurredAt: "2026-09-21T10:00:00.000Z",
          recognizedAt: "2026-09-21T10:00:00.000Z",
        },
        {
          id: "act-2",
          category: "growth_action",
          kind: "confirmed_field_visit",
          strength: null,
          sourceType: "commercial_mission",
          sourceId: "102",
          provenance: "debrief_confirm",
          occurredAt: "2026-09-22T10:00:00.000Z",
          recognizedAt: "2026-09-22T10:00:00.000Z",
        },
        {
          id: "act-3",
          category: "growth_action",
          kind: "follow_up_done",
          strength: null,
          sourceType: "commercial_follow_up",
          sourceId: "201",
          provenance: "completed_row",
          occurredAt: "2026-09-22T11:00:00.000Z",
          recognizedAt: "2026-09-22T11:00:00.000Z",
        },
      ];

      // 3 actions across 2 distinct days meets Band 1 requirement
      const evaluated = evaluateProgression({
        evidence: actions,
        disclosureSafetyOk: true,
        prior: EMPTY_GRANT,
        asOf: new Date("2026-09-23T00:00:00.000Z"),
      });

      expect(evaluated.computedRapportBand).toBe(1);
      expect(evaluated.grant.rapportBand).toBe(1);
    });

    it("NON_QUALIFYING_KINDS (chat_turn, good_conversation, mission_accepted, said_yes_to_claire) are rejected at the ingestion boundary and never written", async () => {
      const store = createInMemoryProgressionStore();
      const scope = { tenantId: "default", operatorUserId: "adam-test" };
      const now = new Date("2026-09-24T12:00:00.000Z");

      for (const nonQualifyingKind of NON_QUALIFYING_KINDS) {
        // Direct validator check
        const directValidation = validateEvidenceInput({
          category: "growth_action",
          kind: nonQualifyingKind,
          occurredAt: "2026-09-24T10:00:00.000Z",
          recognizedAt: "2026-09-24T11:00:00.000Z",
        });
        expect(directValidation.ok).toBe(false);
        expect((directValidation as { ok: false; reason: string }).reason).toContain("is never story currency");

        // Service ingestion boundary check
        const result = await recordProgressionEvidence(
          store,
          {
            tenantId: scope.tenantId,
            operatorUserId: scope.operatorUserId,
            category: "growth_action",
            kind: nonQualifyingKind as any,
            sourceType: "call",
            sourceId: "1",
            provenance: "operator_chat",
            occurredAt: "2026-09-24T10:00:00.000Z",
            recognizedAt: "2026-09-24T11:00:00.000Z",
          },
          () => now
        );

        expect(result.ok).toBe(false);
        expect((result as { ok: false; reason: string }).reason).toContain("is never story currency");
      }

      // Assert zero rows written to store and rapport remains Band 0
      const evidence = await store.listEvidence(scope);
      expect(evidence).toHaveLength(0);

      const grant = await store.getGrant(scope);
      expect(grant?.rapportBand ?? 0).toBe(0);
      expect(grant?.personalRung ?? 0).toBe(0);
    });

    it("business progress is separately gated and does not create unlimited banter or automatic biography disclosure", () => {
      // 5 actions across 3 days + 1 won account unlocks personalRung 1
      const mixedEvidence: ProgressionEvidence[] = [
        {
          id: "act-1",
          category: "growth_action",
          kind: "confirmed_field_visit",
          strength: null,
          sourceType: "commercial_mission",
          sourceId: "1",
          occurredAt: "2026-09-20T10:00:00.000Z",
          recognizedAt: "2026-09-20T10:00:00.000Z",
          provenance: "debrief_confirm",
        },
        {
          id: "act-2",
          category: "growth_action",
          kind: "confirmed_field_visit",
          strength: null,
          sourceType: "commercial_mission",
          sourceId: "2",
          occurredAt: "2026-09-21T10:00:00.000Z",
          recognizedAt: "2026-09-21T10:00:00.000Z",
          provenance: "debrief_confirm",
        },
        {
          id: "act-3",
          category: "growth_action",
          kind: "confirmed_field_visit",
          strength: null,
          sourceType: "commercial_mission",
          sourceId: "3",
          occurredAt: "2026-09-22T10:00:00.000Z",
          recognizedAt: "2026-09-22T10:00:00.000Z",
          provenance: "debrief_confirm",
        },
        {
          id: "act-4",
          category: "growth_action",
          kind: "follow_up_done",
          strength: null,
          sourceType: "commercial_follow_up",
          sourceId: "4",
          occurredAt: "2026-09-22T11:00:00.000Z",
          recognizedAt: "2026-09-22T11:00:00.000Z",
          provenance: "completed_row",
        },
        {
          id: "act-5",
          category: "growth_action",
          kind: "follow_up_done",
          strength: null,
          sourceType: "commercial_follow_up",
          sourceId: "5",
          occurredAt: "2026-09-22T12:00:00.000Z",
          recognizedAt: "2026-09-22T12:00:00.000Z",
          provenance: "completed_row",
        },
        {
          id: "prog-1",
          category: "business_progress",
          kind: "target_account_won",
          strength: "strong",
          sourceType: "commercial_mission",
          sourceId: "1",
          occurredAt: "2026-09-20T10:00:00.000Z",
          recognizedAt: "2026-09-20T10:00:00.000Z",
          provenance: "debrief_confirm",
        },
      ];

      const evaluated = evaluateProgression({
        evidence: mixedEvidence,
        disclosureSafetyOk: true,
        prior: EMPTY_GRANT,
        asOf: new Date("2026-09-23T00:00:00.000Z"),
      });

      expect(evaluated.computedRapportBand).toBe(1);
      expect(evaluated.computedRung).toBe(1);

      // On a non-personal turn (e.g. casual or operational), personal biography is NOT volunteered
      const compiled = compileClaireCharacterContext({
        mode: "casual",
        progression: { rapportBand: evaluated.computedRapportBand, personalRung: evaluated.computedRung, unresolvedBusiness: false },
        legacyTierDisclosure: false,
        relationshipState: {
          disclosureTier: 0,
          professionalRespect: 50,
          reliability: 50,
          disclosureSafety: 50,
          familiarity: 10,
        },
        recentSharedHistory: [],
      });

      // Gated biography (minTier >= 1: father, past relationship, central wound) is NOT placed in the casual prompt:
      expect(compiled.eligibleCanonFragmentIds.some(id => id.includes("relationship") || id.includes("father") || id.includes("central_wound"))).toBe(false);
      expect(compiled.eligibleCanonFacts.some(fact => fact.includes("relationship") || fact.includes("father"))).toBe(false);
    });
  });

  describe("4. Referent Resolution & Invitation Anaphoric Follow-up", () => {
    it("detects personal invitation correctly", () => {
      expect(isPersonalInvitation("Would you want to grab a drink?")).toBe(true);
      expect(isPersonalInvitation("Do you want to get coffee sometime?")).toBe(true);
      expect(isPersonalInvitation("Want to grab a drink?")).toBe(true);
      expect(isPersonalInvitation("Are you free for dinner?")).toBe(true);
      expect(isPersonalInvitation("Deliver the towels on Tuesday")).toBe(false);
      expect(isPersonalInvitation("What were my sales?")).toBe(false);
    });

    it("detects casual/social declarations and leisure activities correctly", () => {
      expect(isCasualOrSocialBid("I was just calling socially")).toBe(true);
      expect(isCasualOrSocialBid("Just calling to say hi")).toBe(true);
      expect(isCasualOrSocialBid("I saw a friend, went to church, saw a movie")).toBe(true);
      expect(isCasualOrSocialBid("How are you doing today?")).toBe(true);
      expect(isCasualOrSocialBid("Add Opus to the Day Line")).toBe(false);
    });

    it("preDriveConversation routes personal referent from semanticFrame to answerPersonalFollowUp", async () => {
      const store = createInMemoryProgressionStore();
      const reply = await answerClairePreDriveFollowUp(
        {
          tenantId: "default",
          operatorUserId: "adam-test",
          conversationId: "conv-invitation-test-1",
          utterance: "On Saturday evening?",
          semanticFrame: {
            referent: "Would you want to grab a drink?",
            act: "question",
            target: "open_conversation",
          },
          context: {
            businessDate: "2026-09-24",
            actorId: "adam-test",
            macroGoalKnown: false,
            blockers: [],
            relevantTimeline: [],
            clock: { localTime: "10:00 AM", weekday: "Thursday", businessDate: "2026-09-24", timeZone: "America/Los_Angeles" },
          } as never,
          businessOpen: false,
          surface: "voice",
        },
        {
          invokeText: async () => "",
          recordGeneration: async () => {},
          progressionStore: store,
        }
      );

      // Declines via executePersonalTurn with approved dialogue line, no hardcoded Saturday prose
      expect(reply).toMatch(/(?:Not that one|Ask me something else|leaving that where it is|pushing your luck|not something I get into|No\. What else|keep to the work)/i);
      expect(reply).not.toContain("Saturday evening or otherwise");
    });

    it("answerPersonalFollowUp delivers approved canon decline for personal invitation without hardcoded prose", async () => {
      const store = createInMemoryProgressionStore();
      const recentTurns: Array<{ speaker: "operator" | "claire"; text: string }> = [
        { speaker: "operator", text: "Would you want to grab a drink?" },
        { speaker: "claire", text: "Not that one." },
      ];

      const reply = await answerPersonalFollowUp(
        {
          tenantId: "default",
          operatorUserId: "adam-test",
          conversationId: "conv-invitation-test",
          topic: null,
          utterance: "On Saturday evening?",
          recentTurns,
          businessOpen: false,
          surface: "voice",
        },
        {
          invokeText: async () => "",
          recordGeneration: async () => {},
          progressionStore: store,
          syncProgression: false,
        }
      );

      // Must draw from approved canon declines, not hardcoded strings
      expect(reply).toMatch(/(?:Not that one|Ask me something else|leaving that where it is|pushing your luck|not something I get into|No\. What else|keep to the work)/i);
      expect(reply).not.toContain("Saturday evening or otherwise");
    });

    it("answerPersonalFollowUp with unresolved business steers back to open items", async () => {
      const store = createInMemoryProgressionStore();
      const recentTurns: Array<{ speaker: "operator" | "claire"; text: string }> = [
        { speaker: "operator", text: "Would you want to grab a drink?" },
        { speaker: "claire", text: "Not that one." },
      ];

      const reply = await answerPersonalFollowUp(
        {
          tenantId: "default",
          operatorUserId: "adam-test",
          conversationId: "conv-invitation-test-2",
          topic: null,
          utterance: "How about Saturday night?",
          recentTurns,
          businessOpen: true,
          surface: "voice",
        },
        {
          invokeText: async () => "",
          recordGeneration: async () => {},
          progressionStore: store,
          syncProgression: false,
        }
      );

      expect(reply).toMatch(/(?:Not that one|Ask me something else|leaving that where it is|pushing your luck|not something I get into|No\. What else|keep to the work)/i);
      expect(reply).not.toContain("Saturday night or otherwise");
    });
  });
});
