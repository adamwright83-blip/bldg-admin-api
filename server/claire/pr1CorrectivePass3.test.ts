import { describe, expect, it, vi } from "vitest";
import type { ClaireDriveContext } from "./contextAssembler";
import { buildClaireClock, CLAIRE_BUSINESS_TIME_ZONE } from "./contextAssembler";
import { answerClairePreDriveFollowUp } from "./preDriveConversation";
import { writeClairePreDriveBrief } from "./reasoning";
import { GOLDLINE_OFFER_CONTEXT } from "./offerContext";
import { AUTHORED_DIALOGUE } from "./progression/authoredDialogue";
import { createInMemoryProgressionStore } from "./progression/store";
import {
  recoverPersonalAnswer,
  renderCanonScopedPersonalAnswer,
  renderCanonFactFirstPerson,
  CANON_SCOPED_PERSONAL_DEFLECTION,
} from "./character/personalAnswerRecovery";
import { VOICE_NATIVE_ANSWER_GUIDANCE, CLAIRE_TEMPORAL_AUTHORITY_INSTRUCTION } from "./conversationVoiceGuidance";

/**
 * PR1 Claire Intelligence Repair -- corrective pass 3, driven by Adam's
 * review of the post-corrective real exam. Three acceptance issues:
 * personal-answer recovery dead-ending in the generic stall, voice
 * guidance not winning over competing instructions, and laundry advice
 * ungrounded in what the business actually sells.
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

const CANON_AT_TIER_0 = ["Claire is British.", "Claire studied archaeology, historical networks, and languages."];

describe("Corrective pass 3 -- item 1: personal-answer recovery", () => {
  it("blocks an invented city: it never reaches the operator, no canon is read aloud, and an approved decline is used without a second model call", async () => {
    // Generation, then the mandatory entailment verifier (which rejects the invented place).
    const invokeText = vi.fn().mockResolvedValueOnce("London, originally.").mockResolvedValue("UNSUPPORTED");
    const recordGeneration = vi.fn().mockResolvedValue(undefined);
    const result = await answerClairePreDriveFollowUp(
      { tenantId: "tenant-1", utterance: "Where are you from, Claire?", brief: "Visit The Wilshire.", context: { ...baseContext, actorId: "op-1" } },
      { invokeText, biographyVerifier: async () => true, recordGeneration, progressionStore: createInMemoryProgressionStore() }
    );

    expect(result).not.toContain("London");
    expect(result).not.toBe("I'm British."); // no robotic canon read-aloud fallback
    expect(AUTHORED_DIALOGUE.map(line => line.text)).toContain(result);
    expect(invokeText).toHaveBeenCalledTimes(2); // one generation, one verification, never a regeneration
    expect(recordGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        diagnostic: expect.objectContaining({
          source: "fallback",
          failureReason: "personal_decline:entailment_unverified",
        }),
      })
    );
  });

  it("routes the requested topic to eligible canon rather than picking an unrelated personal fact", () => {
    expect(
      renderCanonScopedPersonalAnswer({
        eligibleCanonFacts: CANON_AT_TIER_0,
        requestedTopic: "background",
      })
    ).toBe("I studied archaeology, historical networks, and languages.");

    expect(
      renderCanonScopedPersonalAnswer({
        eligibleCanonFacts: CANON_AT_TIER_0,
        requestedTopic: "childhood",
      })
    ).toBe("I'm British.");
  });

  it("can recover from compiler fragment IDs without relying on fact-string equality", () => {
    expect(
      renderCanonScopedPersonalAnswer({
        eligibleCanonFacts: [],
        eligibleCanonFragmentIds: ["core_nationality"],
        requestedTopic: "childhood",
      })
    ).toBe("I'm British.");
  });

  it("does not widen disclosure when the requested topic has no eligible canon", () => {
    const recovery = recoverPersonalAnswer({
      eligibleCanonFacts: CANON_AT_TIER_0,
      requestedTopic: "father",
    });
    expect(recovery).toEqual({
      text: CANON_SCOPED_PERSONAL_DEFLECTION,
      via: "canon_scoped_deflection",
    });
    expect(recovery.text).not.toContain("disappeared");
  });

  it("with no eligible canon at all, returns the canon-scoped deflection", () => {
    expect(
      recoverPersonalAnswer({
        eligibleCanonFacts: [],
        requestedTopic: "childhood",
      })
    ).toEqual({
      text: CANON_SCOPED_PERSONAL_DEFLECTION,
      via: "canon_scoped_deflection",
    });
  });

  it("the deterministic renderer converts stored third-person canon without adding facts", () => {
    expect(renderCanonFactFirstPerson("Claire is British.")).toBe("I'm British.");
    expect(
      renderCanonFactFirstPerson("Claire studied archaeology, historical networks, and languages.")
    ).toBe("I studied archaeology, historical networks, and languages.");
  });

  it("the hard guard still rejects invented specifics", async () => {
    const { assertNoUngroundedPersonalSpecificity } = await import("./character/personalSpecificityGuard");
    expect(() =>
      assertNoUngroundedPersonalSpecificity("New York, originally.", CANON_AT_TIER_0)
    ).toThrow();
    expect(() =>
      assertNoUngroundedPersonalSpecificity("A place called Ashworth.", CANON_AT_TIER_0)
    ).toThrow();
    expect(() =>
      assertNoUngroundedPersonalSpecificity("I'm British.", CANON_AT_TIER_0)
    ).not.toThrow();
  });

  it("a genuine generation failure on a personal question yields an approved decline", async () => {
    const invokeText = vi.fn().mockRejectedValue(new Error("provider down"));
    const result = await answerClairePreDriveFollowUp(
      { tenantId: "tenant-1", utterance: "Where are you from, Claire?", brief: "Visit The Wilshire.", context: { ...baseContext, actorId: "op-1" } },
      { invokeText, biographyVerifier: async () => true, recordGeneration: vi.fn().mockResolvedValue(undefined), progressionStore: createInMemoryProgressionStore() }
    );
    expect(AUTHORED_DIALOGUE.map(line => line.text)).toContain(result);
  });

  it("an unresolved operator identity fails closed to an approved decline with no model call", async () => {
    const invokeText = vi.fn();
    const result = await answerClairePreDriveFollowUp(
      { tenantId: "tenant-1", utterance: "Where are you from, Claire?", brief: "Visit The Wilshire.", context: { ...baseContext, actorId: undefined as never } },
      { invokeText, biographyVerifier: async () => true, recordGeneration: vi.fn().mockResolvedValue(undefined), progressionStore: createInMemoryProgressionStore() }
    );
    expect(invokeText).not.toHaveBeenCalled();
    expect(AUTHORED_DIALOGUE.map(line => line.text)).toContain(result);
  });
});

describe("Corrective pass 3 -- item 2: voice guidance must be authoritative", () => {
  async function followUpSystemPrompt(surface?: "voice" | "desktop"): Promise<string> {
    const invokeText = vi.fn().mockResolvedValue("ok");
    await answerClairePreDriveFollowUp(
      {
        tenantId: "tenant-1",
        utterance: "What am I missing here, strategically?",
        brief: "Visit The Wilshire.",
        context: baseContext,
        ...(surface ? { surface } : {}),
      },
      { invokeText, biographyVerifier: async () => true, recordGeneration: vi.fn().mockResolvedValue(undefined) }
    );
    return invokeText.mock.calls[0][0].messages[0].content as string;
  }

  it("the delivery rules are LAST in the assembled prompt, with nothing competing after them", async () => {
    const system = await followUpSystemPrompt();
    expect(system).toContain(VOICE_NATIVE_ANSWER_GUIDANCE);
    expect(system.endsWith(VOICE_NATIVE_ANSWER_GUIDANCE)).toBe(true);
  });

  it("the instructions that previously competed on length are gone from the assembled prompt", async () => {
    const system = await followUpSystemPrompt();
    // These three were the actual competitors found by dumping the real prompt.
    expect(system).not.toContain("can run several sentences");
    expect(system).not.toContain("run as long as it actually needs");
    expect(system).not.toContain("Do not pad or artificially shorten");
  });

  it("the reasoning order is explicitly reframed as internal thinking, not an output template", async () => {
    const system = await followUpSystemPrompt();
    // The shared policy still supplies the reasoning order...
    expect(system).toContain("goal, reality, plan, gap, bottleneck, blocker, action");
    // ...but is now explicitly not a script to narrate.
    expect(system).toContain("It is not a template to narrate");
  });

  it("states precedence, bans warm-up openers, and sets turn-taking without imposing a length cap", async () => {
    const system = await followUpSystemPrompt();
    expect(system).toContain("take precedence over any earlier instruction");
    expect(system).toContain("Never begin an answer with 'Good question'");
    expect(system).toMatch(/lead with (?:the )?(?:one or two things|what) .*matter/i);
    // Explicitly NOT a terseness rule -- guard against a future regression
    // that reintroduces the failure mode two passes were spent removing.
    expect(system).toMatch(/never pad/i);
    expect(system).not.toMatch(/no more than \d+ words/i);
    expect(system).not.toMatch(/never exceed \d+ words/i);
    expect(system).not.toMatch(/under \d+ spoken words/i);
  });

  it("the opening brief carries the same delivery rules, also last", async () => {
    const invokeText = vi.fn().mockResolvedValue("Brief.");
    await writeClairePreDriveBrief(
      { tenantId: "tenant-1", context: baseContext },
      { invokeText, biographyVerifier: async () => true, recordGeneration: vi.fn().mockResolvedValue(undefined) }
    );
    const system = invokeText.mock.calls[0][0].messages[0].content as string;
    expect(system.endsWith(VOICE_NATIVE_ANSWER_GUIDANCE)).toBe(true);
    expect(system).not.toContain("usually a few concise sentences");
  });

  it("desktop surface still opts out of voice-native delivery rules", async () => {
    const system = await followUpSystemPrompt("desktop");
    expect(system).not.toContain("DELIVERY RULES");
  });
});

describe("Corrective pass 4 -- real-exam instrumentation", () => {
  it("follow-up diagnostics expose provider stop_reason and whether sentence-boundary trimming occurred", async () => {
    let diagnostic: any;
    const invokeText = vi.fn().mockImplementation(async (request: any) => {
      request.onStopReason?.("end_turn");
      return "Five o'clock.";
    });

    await answerClairePreDriveFollowUp(
      {
        tenantId: "tenant-1",
        utterance: "What time's the stop?",
        brief: "Visit The Wilshire.",
        context: baseContext,
        onGeneration: value => { diagnostic = value; },
      },
      { invokeText, biographyVerifier: async () => true, recordGeneration: vi.fn().mockResolvedValue(undefined) }
    );

    expect(diagnostic?.stopReason).toBe("end_turn");
    expect(diagnostic?.trimmedToSentenceBoundary).toBe(false);
    expect(diagnostic?.answerOrigin).toBe("model");
  });

  it("opening diagnostics expose provider stop_reason and trim state too", async () => {
    let diagnostic: any;
    const invokeText = vi.fn().mockImplementation(async (request: any) => {
      request.onStopReason?.("end_turn");
      return "The Wilshire is at five.";
    });

    await writeClairePreDriveBrief(
      {
        tenantId: "tenant-1",
        context: baseContext,
        onGeneration: value => { diagnostic = value; },
      },
      { invokeText, biographyVerifier: async () => true, recordGeneration: vi.fn().mockResolvedValue(undefined) }
    );

    expect(diagnostic?.stopReason).toBe("end_turn");
    expect(diagnostic?.trimmedToSentenceBoundary).toBe(false);
    expect(diagnostic?.answerOrigin).toBe("model");
  });
});

describe("Corrective pass 3 -- item 3: business grounding for what we actually sell", () => {
  it("the offer context states the real model and refuses to invent commercial terms", () => {
    expect(GOLDLINE_OFFER_CONTEXT).toContain("per-resident wash-and-fold laundry service");
    expect(GOLDLINE_OFFER_CONTEXT).toContain("The paying customer is the individual resident");
    expect(GOLDLINE_OFFER_CONTEXT).toContain("does not sell, lease, install, or service laundry machines");
    // Unknown commercial terms are marked unknown, not invented.
    expect(GOLDLINE_OFFER_CONTEXT).toContain("is NOT established in your context");
    // And it must not smuggle in specifics it cannot verify.
    expect(GOLDLINE_OFFER_CONTEXT).not.toMatch(/\$\d/);
    expect(GOLDLINE_OFFER_CONTEXT).not.toMatch(/\d+\s*% (revenue|commission)/i);
  });

  it("both generation paths actually carry the offer grounding", async () => {
    const followInvoke = vi.fn().mockResolvedValue("ok");
    await answerClairePreDriveFollowUp(
      { tenantId: "tenant-1", utterance: "If they push back on price, what's a good way to handle that?", brief: "Visit The Wilshire.", context: baseContext },
      { invokeText: followInvoke, biographyVerifier: async () => true, recordGeneration: vi.fn().mockResolvedValue(undefined) }
    );
    expect(followInvoke.mock.calls[0][0].messages[0].content).toContain(GOLDLINE_OFFER_CONTEXT);

    const briefInvoke = vi.fn().mockResolvedValue("Brief.");
    await writeClairePreDriveBrief(
      { tenantId: "tenant-1", context: baseContext },
      { invokeText: briefInvoke, biographyVerifier: async () => true, recordGeneration: vi.fn().mockResolvedValue(undefined) }
    );
    expect(briefInvoke.mock.calls[0][0].messages[0].content).toContain(GOLDLINE_OFFER_CONTEXT);
  });

  it("the offer grounding is unconditional -- it does not depend on a mission or a MissionSalesBrief being present", async () => {
    // baseContext has mission: null and no missionSalesBrief, which is the
    // exact cold-visit case the real exam ran and where the invented
    // equipment/coin-op sales model appeared.
    expect(baseContext.mission).toBe(null);
    expect(baseContext.missionSalesBrief).toBeUndefined();
    const invokeText = vi.fn().mockResolvedValue("ok");
    await answerClairePreDriveFollowUp(
      { tenantId: "tenant-1", utterance: "How should I even start figuring out what's going on with this account?", brief: "Visit The Wilshire.", context: baseContext },
      { invokeText, biographyVerifier: async () => true, recordGeneration: vi.fn().mockResolvedValue(undefined) }
    );
    expect(invokeText.mock.calls[0][0].messages[0].content).toContain("does not sell, lease, install");
  });

  it("general professional knowledge is explicitly bound to this business's actual model", async () => {
    const invokeText = vi.fn().mockResolvedValue("ok");
    await answerClairePreDriveFollowUp(
      { tenantId: "tenant-1", utterance: "Any advice on pricing?", brief: "Visit The Wilshire.", context: baseContext },
      { invokeText, biographyVerifier: async () => true, recordGeneration: vi.fn().mockResolvedValue(undefined) }
    );
    const system = invokeText.mock.calls[0][0].messages[0].content as string;
    expect(system).toContain("do not import a sales model from a different industry");
  });
});


describe("Claire temporal authority regression", () => {
  const frozenClockContext: ClaireDriveContext = {
    ...baseContext,
    generatedAt: "2026-09-17T22:18:00.000Z",
    businessDate: "2026-09-17",
    clock: {
      isoTimestamp: "2026-09-17T22:18:00.000Z",
      timeZone: "America/Los_Angeles",
      businessDate: "2026-09-17",
      weekday: "Thursday",
      localTime: "3:18 PM",
      daypart: "afternoon",
      fieldSalesDayState: "open",
      tomorrowBusinessDate: "2026-09-18",
    },
  };

  it("tells follow-up generation to ignore ambient provider/server time in favor of the verified context clock", async () => {
    const invokeText = vi.fn().mockResolvedValue("It's 3:18 PM. The stop is at five.");
    await answerClairePreDriveFollowUp(
      {
        tenantId: "tenant-a",
        utterance: "What time is it and when is the stop?",
        brief: "Visit The Wilshire.",
        context: frozenClockContext,
      },
      { invokeText, biographyVerifier: async () => true, recordGeneration: vi.fn().mockResolvedValue(undefined) }
    );
    const captured = invokeText.mock.calls[0][0].messages.map((message: { content: string }) => message.content).join("\n");
    expect(captured).toContain(CLAIRE_TEMPORAL_AUTHORITY_INSTRUCTION);
    expect(captured).toContain("sole temporal authority");
    expect(captured).toContain("Ignore any ambient model/provider/server notion of the current time");
    expect(captured).toContain("3:18 PM");
    expect(captured).toContain("afternoon");
    expect(captured).toContain("nextFixedCommitmentLocalWhen");
  });

  it("tells opening generation to treat the supplied verified clock as the sole temporal authority", async () => {
    const invokeText = vi.fn().mockResolvedValue("The Wilshire is at five.");
    await writeClairePreDriveBrief(
      { tenantId: "tenant-a", context: frozenClockContext },
      { invokeText, biographyVerifier: async () => true, recordGeneration: vi.fn().mockResolvedValue(undefined) }
    );
    const captured = invokeText.mock.calls[0][0].messages.map((message: { content: string }) => message.content).join("\n");
    expect(captured).toContain(CLAIRE_TEMPORAL_AUTHORITY_INSTRUCTION);
    expect(captured).toContain("sole temporal authority");
    expect(captured).toContain("Ignore any ambient model/provider/server notion of the current time");
    expect(captured).toContain("3:18 PM");
    expect(captured).toContain("afternoon");
    expect(captured).toContain("nextFixedCommitmentLocalWhen");
  });
});
