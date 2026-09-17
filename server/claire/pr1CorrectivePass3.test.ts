import { describe, expect, it, vi } from "vitest";
import type { ClaireDriveContext } from "./contextAssembler";
import { buildClaireClock, CLAIRE_BUSINESS_TIME_ZONE } from "./contextAssembler";
import { answerClairePreDriveFollowUp } from "./preDriveConversation";
import { writeClairePreDriveBrief } from "./reasoning";
import { GOLDLINE_OFFER_CONTEXT } from "./offerContext";
import {
  buildPersonalRetryConstraint,
  recoverPersonalAnswer,
  CANON_SCOPED_PERSONAL_DEFLECTION,
} from "./character/personalAnswerRecovery";
import { VOICE_NATIVE_ANSWER_GUIDANCE } from "./conversationVoiceGuidance";

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
  it("BOTH HALVES, half 1: an invented specific is still blocked and never reaches the operator", async () => {
    // First generation invents a city; retry also overreaches (invents a
    // different one), so recovery must land on the canon-scoped deflection.
    const invokeText = vi
      .fn()
      .mockResolvedValueOnce("Marseille, originally.")
      .mockResolvedValueOnce("Fine — Lyon, then.");
    const recordGeneration = vi.fn().mockResolvedValue(undefined);
    const result = await answerClairePreDriveFollowUp(
      { tenantId: "tenant-1", utterance: "Where are you from, Claire?", brief: "Visit The Wilshire.", context: baseContext },
      { invokeText, recordGeneration }
    );
    expect(result).not.toContain("Marseille");
    expect(result).not.toContain("Lyon");
    expect(result).toBe(CANON_SCOPED_PERSONAL_DEFLECTION);
    // And critically: NOT the generic conversation stall.
    expect(result).not.toContain("ask me that once more");
    expect(result).not.toContain("the brief is");
  });

  it("BOTH HALVES, half 2: available safe canon still produces a useful personal answer -- safety did not cost us the answer", async () => {
    // First generation invents a city (guard trips); the constrained retry
    // answers from eligible canon without naming one.
    const invokeText = vi
      .fn()
      .mockResolvedValueOnce("London, originally.")
      .mockResolvedValueOnce("British. Moved around a lot as a kid, so no one place really claims me.");
    const recordGeneration = vi.fn().mockResolvedValue(undefined);
    const result = await answerClairePreDriveFollowUp(
      { tenantId: "tenant-1", utterance: "Where are you from, Claire?", brief: "Visit The Wilshire.", context: baseContext },
      { invokeText, recordGeneration }
    );
    // The real answer survived -- this is the whole point of the item.
    expect(result).toBe("British. Moved around a lot as a kid, so no one place really claims me.");
    expect(result).not.toContain("London");
    expect(result).not.toContain("ask me that once more");
    expect(invokeText).toHaveBeenCalledTimes(2);
    // Recorded honestly as a model answer that needed recovery.
    expect(recordGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        diagnostic: expect.objectContaining({
          source: "model",
          failureReason: "ungrounded_personal_specificity_recovered",
        }),
      })
    );
  });

  it("the retry is constrained to the exact eligible canon and forbids new specifics", () => {
    const constraint = buildPersonalRetryConstraint(CANON_AT_TIER_0);
    expect(constraint).toContain("Claire is British.");
    expect(constraint).toContain("nothing more specific than what they literally state");
    expect(constraint).toContain("Do not name a city");
  });

  it("with no eligible canon at all, the retry is told to decline rather than invent", () => {
    const constraint = buildPersonalRetryConstraint([]);
    expect(constraint).toContain("NO eligible personal canon");
    expect(constraint).toContain("Do not answer the personal question with any specific at all");
  });

  it("recovery never widens disclosure: it only ever passes canon already deemed eligible", async () => {
    const seen: string[] = [];
    const recovery = await recoverPersonalAnswer({
      eligibleCanonFacts: CANON_AT_TIER_0,
      retry: async constraint => {
        seen.push(constraint);
        return "British.";
      },
    });
    expect(recovery.via).toBe("canon_retry");
    // Gated canon (father's disappearance, the six-year relationship) must
    // not appear anywhere in what the retry was given.
    expect(seen.join(" ")).not.toContain("disappeared");
    expect(seen.join(" ")).not.toContain("six-year");
  });

  it("the guard does not false-positive on ordinary sentence-initial words, which would silently cost good answers", async () => {
    const { assertNoUngroundedPersonalSpecificity } = await import("./character/personalSpecificityGuard");
    // Regression: "Moved" (a common verb capitalized because it starts a
    // sentence) was being treated as a proper noun, downgrading a correct,
    // canon-grounded answer to the deflection.
    expect(() =>
      assertNoUngroundedPersonalSpecificity(
        "British. Moved around a lot as a kid, so no one place really claims me.",
        CANON_AT_TIER_0
      )
    ).not.toThrow();
    expect(() =>
      assertNoUngroundedPersonalSpecificity("Honestly? Nowhere in particular. Fine question though.", CANON_AT_TIER_0)
    ).not.toThrow();
    // ...while still catching real invented specifics, including
    // multi-word ones and surnames it has never seen.
    expect(() => assertNoUngroundedPersonalSpecificity("New York, originally.", CANON_AT_TIER_0)).toThrow();
    expect(() => assertNoUngroundedPersonalSpecificity("A place called Ashworth.", CANON_AT_TIER_0)).toThrow();
  });

  it("a genuine generation failure still goes to the generic fallback, not the canon deflection (step 5)", async () => {
    const invokeText = vi.fn().mockRejectedValue(new Error("provider down"));
    const result = await answerClairePreDriveFollowUp(
      { tenantId: "tenant-1", utterance: "Where are you from, Claire?", brief: "Visit The Wilshire.", context: baseContext },
      { invokeText, recordGeneration: vi.fn().mockResolvedValue(undefined) }
    );
    expect(result).not.toBe(CANON_SCOPED_PERSONAL_DEFLECTION);
    expect(result).toContain("ask me that once more");
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
      { invokeText, recordGeneration: vi.fn().mockResolvedValue(undefined) }
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
    expect(system).toContain("Lead with the one or two things that actually matter most right now");
    // Explicitly NOT a terseness rule -- guard against a future regression
    // that reintroduces the failure mode two passes were spent removing.
    expect(system).toContain("not being asked to be terse");
    expect(system).not.toMatch(/no more than \d+ words/i);
    expect(system).not.toMatch(/never exceed \d+ words/i);
    expect(system).not.toMatch(/under \d+ spoken words/i);
  });

  it("the opening brief carries the same delivery rules, also last", async () => {
    const invokeText = vi.fn().mockResolvedValue("Brief.");
    await writeClairePreDriveBrief(
      { tenantId: "tenant-1", context: baseContext },
      { invokeText, recordGeneration: vi.fn().mockResolvedValue(undefined) }
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
      { invokeText: followInvoke, recordGeneration: vi.fn().mockResolvedValue(undefined) }
    );
    expect(followInvoke.mock.calls[0][0].messages[0].content).toContain(GOLDLINE_OFFER_CONTEXT);

    const briefInvoke = vi.fn().mockResolvedValue("Brief.");
    await writeClairePreDriveBrief(
      { tenantId: "tenant-1", context: baseContext },
      { invokeText: briefInvoke, recordGeneration: vi.fn().mockResolvedValue(undefined) }
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
      { invokeText, recordGeneration: vi.fn().mockResolvedValue(undefined) }
    );
    expect(invokeText.mock.calls[0][0].messages[0].content).toContain("does not sell, lease, install");
  });

  it("general professional knowledge is explicitly bound to this business's actual model", async () => {
    const invokeText = vi.fn().mockResolvedValue("ok");
    await answerClairePreDriveFollowUp(
      { tenantId: "tenant-1", utterance: "Any advice on pricing?", brief: "Visit The Wilshire.", context: baseContext },
      { invokeText, recordGeneration: vi.fn().mockResolvedValue(undefined) }
    );
    const system = invokeText.mock.calls[0][0].messages[0].content as string;
    expect(system).toContain("do not import a sales model from a different industry");
  });
});
