import { describe, expect, it, vi } from "vitest";
import { compileClaireCharacterContext } from "./compiler";
import { CLAIRE_CHARACTER_DEFINITION } from "./characterDefinition";
import { CLAIRE_FIELD_MODE_OVERRIDE } from "./personalityLock";
import { CLAIRE_ROUTINE_FEW_SHOTS } from "./fewShots";
import { CLAIRE_DEFAULT_RELATIONSHIP_STATE } from "./types";
import { answerClairePreDriveFollowUp } from "../preDriveConversation";
import { writeClairePreDriveBrief } from "../reasoning";
import type { ClaireDriveContext } from "../contextAssembler";

/**
 * PR1 Claire Intelligence Repair -- corrective pass triggered by ChatGPT's
 * independent review, which found that server/claire/character/ still
 * carried three suppression mechanisms PR1's original pass had not
 * touched: a hidden per-mode maxWords cap compiled straight into the
 * prompt, a field-mode override banning "teasing"/"expressive flourishes"
 * outright, and a computed-but-never-injected fewShotBlock. This file
 * proves each is fixed, and that fixing them did not loosen tier/
 * disclosure gating.
 */

const relationshipStateTier0 = {
  ...CLAIRE_DEFAULT_RELATIONSHIP_STATE,
  tenantId: "tenant-1",
  operatorUserId: "operator-1",
  characterId: "claire" as const,
  updatedAt: new Date().toISOString(),
};

describe("PR1 corrective pass — character voice fix", () => {
  it("1 — no hidden numeric word/char cap remains reachable in the pre_drive compiled prompt", () => {
    const compiled = compileClaireCharacterContext({
      mode: "pre_drive",
      relationshipState: relationshipStateTier0,
      recentSharedHistory: [],
    });
    expect(compiled.promptSection).not.toMatch(/keep it under \d+ spoken words/i);
    expect(compiled.promptSection).not.toMatch(/\b\d+\s*words\b/i);
    // Structural: the mode policy itself no longer carries a numeric cap.
    for (const policy of Object.values(CLAIRE_CHARACTER_DEFINITION.modes)) {
      expect(policy).not.toHaveProperty("maxWords");
      expect(typeof policy.lengthGuidance).toBe("string");
      expect(policy.lengthGuidance.length).toBeGreaterThan(0);
    }
  });

  it("2 — the field-mode override no longer bans teasing/expressive flourishes/personality, and no mode's compiled prompt does either", () => {
    expect(CLAIRE_FIELD_MODE_OVERRIDE).not.toMatch(/do not use this call for.*teasing/i);
    expect(CLAIRE_FIELD_MODE_OVERRIDE).not.toContain("expressive flourishes");
    // Still keeps the operational-focus limit, just scoped correctly.
    expect(CLAIRE_FIELD_MODE_OVERRIDE).toContain("Do not initiate personal storytelling");
    expect(CLAIRE_FIELD_MODE_OVERRIDE).toContain("stay exactly yourself");

    const compiled = compileClaireCharacterContext({
      mode: "pre_drive",
      relationshipState: relationshipStateTier0,
      recentSharedHistory: [],
    });
    expect(compiled.promptSection).not.toMatch(/teasing.*even if eligible canon exists/i);
  });

  it("3 — safe character grounding (promptSection with the personality lock) is always present, in every mode", () => {
    for (const mode of Object.keys(CLAIRE_CHARACTER_DEFINITION.modes) as Array<
      keyof typeof CLAIRE_CHARACTER_DEFINITION.modes
    >) {
      const compiled = compileClaireCharacterContext({
        mode,
        relationshipState: relationshipStateTier0,
        recentSharedHistory: [],
      });
      expect(compiled.promptSection).toContain("You are Claire: direct, dry, truthful, concise, observant.");
      expect(compiled.personalityLock).toContain("You are Claire");
    }
  });

  it("4 — backstory disclosure remains tier-gated (unchanged): a Tier 0 operator in field mode gets no tier-gated canon without explicit ask", () => {
    // In field mode, canon may still be *retrieved* (core facts remain
    // available for other callers), but this PR change did not alter
    // whether it's *inserted into the prompt* -- that's still gated by
    // `!fieldOverride || explicitlyRequestedTopic` in compiler.ts, exactly
    // as before. Assert on promptSection (what the model actually sees),
    // not the raw retrieval array.
    const compiledNoAsk = compileClaireCharacterContext({
      mode: "pre_drive",
      relationshipState: relationshipStateTier0,
      recentSharedHistory: [],
    });
    expect(compiledNoAsk.promptSection).not.toContain("Eligible personal canon");
    expect(compiledNoAsk.promptSection).not.toContain("Claire's father");
    expect(compiledNoAsk.promptSection).not.toContain("six-year romantic relationship");

    // Even a Tier 3 operator gets nothing inserted into the prompt in
    // field mode without an explicit ask.
    const compiledTier3NoAsk = compileClaireCharacterContext({
      mode: "pre_drive",
      relationshipState: { ...relationshipStateTier0, disclosureTier: 3 },
      recentSharedHistory: [],
    });
    expect(compiledTier3NoAsk.promptSection).not.toContain("Eligible personal canon");

    // Explicit ask + sufficient tier surfaces the tier_gated fact; explicit
    // ask alone at Tier 0 does not (gating logic itself untouched).
    const compiledTier0Ask = compileClaireCharacterContext({
      mode: "pre_drive",
      relationshipState: relationshipStateTier0,
      recentSharedHistory: [],
      explicitlyRequestedTopic: "father",
    });
    expect(compiledTier0Ask.eligibleCanonFacts.join(" ")).not.toContain("intelligence work");

    // A legacy tier number no longer opens canon; only a controller-bounded fragment does.
    const compiledTier1Ask = compileClaireCharacterContext({
      mode: "pre_drive",
      relationshipState: { ...relationshipStateTier0, disclosureTier: 3 },
      recentSharedHistory: [],
      explicitlyRequestedTopic: "father",
    });
    expect(compiledTier1Ask.eligibleCanonFacts.join(" ")).not.toContain("intelligence work");

    const compiledBounded = compileClaireCharacterContext({
      mode: "pre_drive",
      relationshipState: relationshipStateTier0,
      recentSharedHistory: [],
      explicitlyRequestedTopic: "father",
      boundedCanonFragmentIds: ["core_father_career"],
    });
    expect(compiledBounded.eligibleCanonFacts.join(" ")).toContain("intelligence work");

    // permanently_private never surfaces regardless of tier or ask.
    const compiledMaxAsk = compileClaireCharacterContext({
      mode: "casual",
      relationshipState: { ...relationshipStateTier0, disclosureTier: 3 },
      recentSharedHistory: [],
      explicitlyRequestedTopic: "father",
    });
    expect(compiledMaxAsk.eligibleCanonFacts.join(" ")).not.toMatch(/last exchange/i);
  });

  it("5 — audited/safe few-shots actually reach the model prompts built by preDriveConversation.ts and reasoning.ts", async () => {
    const context: ClaireDriveContext = {
      phase: "pre_drive",
      generatedAt: "2026-09-17T12:00:00.000Z",
      businessDate: "2026-09-17",
      actorId: "operator-1",
      truthLaw: "game_projection_never_creates_business_truth",
      nextFixedCommitment: null,
      blockers: [],
      relevantTimeline: [],
      mission: null,
    };

    const followInvoke = vi.fn().mockResolvedValue("Answer.");
    await answerClairePreDriveFollowUp(
      { tenantId: "tenant-1", utterance: "What's next?", brief: "Visit The Wilshire.", context },
      { invokeText: followInvoke, recordGeneration: vi.fn().mockResolvedValue(undefined) }
    );
    const followSystem = followInvoke.mock.calls[0][0].messages[0].content as string;
    // The audited routine few-shots (voice examples) actually reach the
    // prompt now, not just promptSection alone.
    expect(followSystem).toContain("Voice reference only");
    expect(followSystem).toContain("Don't give them the same pitch again");
    // The rewritten line replaces the unsupported memory/learning claim.
    expect(followSystem).not.toContain("I weight pitch fatigue much higher");
    expect(followSystem).not.toContain("You shouldn't have to remind me. I'll remember.");
    expect(followSystem).toContain("We keep the miss, plainly, and move on");

    const briefInvoke = vi.fn().mockResolvedValue("Brief.");
    await writeClairePreDriveBrief(
      { tenantId: "tenant-1", context },
      { invokeText: briefInvoke, recordGeneration: vi.fn().mockResolvedValue(undefined) }
    );
    const briefSystem = briefInvoke.mock.calls[0][0].messages[0].content as string;
    expect(briefSystem).toContain("Voice reference only");
    expect(briefSystem).toContain("Don't give them the same pitch again");
  });

  it("6 — every routine few-shot avoids unsupported durable-memory/learning claims and operator trait-diagnosis claims", () => {
    for (const shot of CLAIRE_ROUTINE_FEW_SHOTS) {
      expect(shot.text).not.toMatch(/i'?ll remember/i);
      expect(shot.text).not.toMatch(/next time.*i (weight|will remember|adjust)/i);
      expect(shot.text).not.toMatch(/you (are|'re) (avoiding|an avoider)\b/i);
      expect(shot.text).not.toMatch(/your pattern (is|of)/i);
    }
  });

  it("7 — identity test: Claire's actual prompt-builder differs structurally from a generic prompt built from the same business facts", async () => {
    const context: ClaireDriveContext = {
      phase: "pre_drive",
      generatedAt: "2026-09-17T12:00:00.000Z",
      businessDate: "2026-09-17",
      actorId: "operator-1",
      truthLaw: "game_projection_never_creates_business_truth",
      nextFixedCommitment: null,
      blockers: [],
      relevantTimeline: [],
      mission: null,
    };
    // A generic prompt built from the SAME business facts, with no
    // character system at all -- what a plain, un-Claire-ified assistant
    // would receive.
    const genericSystemPrompt = [
      "You are a helpful assistant for a laundry business operator.",
      `Business date: ${context.businessDate}.`,
      "Answer the operator's question using only the supplied context.",
    ].join(" ");

    const invokeText = vi.fn().mockResolvedValue("Answer.");
    await answerClairePreDriveFollowUp(
      { tenantId: "tenant-1", utterance: "What's next?", brief: "Visit The Wilshire.", context },
      { invokeText, recordGeneration: vi.fn().mockResolvedValue(undefined) }
    );
    const claireSystemPrompt = invokeText.mock.calls[0][0].messages[0].content as string;

    // Structural, not subjective: Claire's real prompt contains
    // character-specific grounding and voice examples the generic prompt
    // does not and never will (it wasn't built with a character system).
    const claireOnlyMarkers = [
      "You are Claire: direct, dry, truthful, concise, observant.",
      "Voice reference only",
      "Don't give them the same pitch again",
    ];
    for (const marker of claireOnlyMarkers) {
      expect(claireSystemPrompt).toContain(marker);
      expect(genericSystemPrompt).not.toContain(marker);
    }
  });
});
