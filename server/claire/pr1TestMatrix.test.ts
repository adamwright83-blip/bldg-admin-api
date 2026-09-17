import { describe, expect, it, vi } from "vitest";
import type { ClaireDriveContext } from "./contextAssembler";
import { answerClairePreDriveFollowUp } from "./preDriveConversation";
import { writeClairePreDriveBrief } from "./reasoning";
import {
  CEO_LANGUAGE_PATTERNS,
  DISAPPOINTMENT_PATTERNS,
  lintCeoLanguage,
  lintDisappointmentFraming,
} from "./disappointmentLint";
import { WARMTH_EMISSION_ALLOWLIST, CLAIRE_ATTESTABLE_EVENT_TYPES } from "./character/relationshipEmitters";

/**
 * PR1 Claire Intelligence Repair -- spec section 16 ("PR 1 TEST
 * REQUIREMENTS"), items not already directly covered by
 * generationPaths.test.ts, llm.test.ts, or slice03AssertionGuardWiring.test.ts.
 * Each `it` names the numbered item it proves. Items 22/23 (shared
 * ClaireConversationCore usable by voice and surface-neutral for a future
 * desktop surface) are intentionally not represented here -- that refactor
 * was not built in PR1 (see the handoff doc); faking a test for a module
 * that does not exist would be worse than leaving it undone and flagged.
 */

const context: ClaireDriveContext = {
  phase: "pre_drive",
  generatedAt: "2026-09-14T12:00:00.000Z",
  businessDate: "2026-09-14",
  actorId: "operator-1",
  truthLaw: "game_projection_never_creates_business_truth",
  nextFixedCommitment: {
    id: "visit-42",
    kind: "commercial_visit",
    title: "The Wilshire",
    subtitle: "Commercial visit",
    urgency: "today",
    scheduledAt: "2026-09-14T17:00:00.000Z",
    destination: "100 Wilshire Boulevard",
    sourceReference: "commercial_missions:42",
    whySurfaced: "scheduled",
    actions: [],
  },
  blockers: [],
  relevantTimeline: [],
  mission: null,
};

describe("PR1 test matrix (spec section 16)", () => {
  it("5 — the prompt allows general professional knowledge as framed advice, not a business fact", async () => {
    const invokeText = vi.fn().mockResolvedValue("Advice, clearly framed.");
    await writeClairePreDriveBrief(
      { tenantId: "tenant-1", context },
      { invokeText, recordGeneration: vi.fn().mockResolvedValue(undefined) }
    );
    const system = invokeText.mock.calls[0][0].messages[0].content as string;
    expect(system).toContain(
      "General professional/strategic knowledge (sales approach, pricing logic, PM dynamics, ops reasoning) may be used to frame your recommendation"
    );
    expect(system).toContain("never asserted as a fact about this business");

    const followInvoke = vi.fn().mockResolvedValue("General advice, framed.");
    await answerClairePreDriveFollowUp(
      { tenantId: "tenant-1", utterance: "How would you handle a pricing objection?", brief: "Visit The Wilshire.", context },
      { invokeText: followInvoke, recordGeneration: vi.fn().mockResolvedValue(undefined) }
    );
    const followSystem = followInvoke.mock.calls[0][0].messages[0].content as string;
    expect(followSystem).toContain(
      "General professional knowledge — sales tactics, objection handling, property-manager dynamics, pricing concepts, negotiation, ops reasoning — is allowed and encouraged"
    );
  });

  it("6 — the prompt still requires business-specific claims to be grounded or admitted unknown", async () => {
    const invokeText = vi.fn().mockResolvedValue("Grounded answer.");
    await writeClairePreDriveBrief(
      { tenantId: "tenant-1", context },
      { invokeText, recordGeneration: vi.fn().mockResolvedValue(undefined) }
    );
    const system = invokeText.mock.calls[0][0].messages[0].content as string;
    expect(system).toContain(
      "Every business-specific factual clause must map directly to a supplied field or the fact inventory, or say plainly it is unknown"
    );

    const followInvoke = vi.fn().mockResolvedValue("Grounded follow-up.");
    await answerClairePreDriveFollowUp(
      { tenantId: "tenant-1", utterance: "What's their laundry setup?", brief: "Visit The Wilshire.", context },
      { invokeText: followInvoke, recordGeneration: vi.fn().mockResolvedValue(undefined) }
    );
    const followSystem = followInvoke.mock.calls[0][0].messages[0].content as string;
    expect(followSystem).toContain(
      "Business-specific claims (this account, this customer, this property, a specific number, a specific completed action) must be grounded"
    );
  });

  it("7 — a prior Claire (assistant) turn is history, not verified truth, on the next turn", async () => {
    const invokeText = vi.fn().mockResolvedValue("Continuing conversationally.");
    await answerClairePreDriveFollowUp(
      {
        tenantId: "tenant-1",
        utterance: "So did you already send that?",
        brief: "Visit The Wilshire.",
        context,
        recentTurns: [
          { speaker: "operator", text: "Can you text them a reminder?" },
          { speaker: "claire", text: "Sure, I sent it just now." },
        ],
      },
      { invokeText, recordGeneration: vi.fn().mockResolvedValue(undefined) }
    );
    const request = invokeText.mock.calls[0][0];
    const historyMessages = request.messages.slice(1, -1);
    // The hallucinated prior Claire turn is relayed as an assistant message
    // (real history), not folded into system/user content as if verified.
    expect(historyMessages).toEqual([
      { role: "user", content: "Can you text them a reminder?" },
      { role: "assistant", content: "Sure, I sent it just now." },
    ]);
    const system = request.messages[0].content as string;
    expect(system).toContain(
      "A prior Claire turn is conversation history, not verified truth — if it asserted something not present in the fact inventory, do not treat it as confirmed on this turn."
    );
    // The fact inventory (verified business truth), not the assistant's
    // own prior claim, is what assertPostGenerationStateVerbs checks the
    // *next* model output against -- proven directly in
    // slice03AssertionGuardWiring.test.ts ("falls back when the model
    // claims a queued send" / "unverified 'sent'").
  });

  it("8 — opening brief no longer carries the old intelligence-suppressing cap", async () => {
    const invokeText = vi.fn().mockResolvedValue("Brief.");
    await writeClairePreDriveBrief(
      { tenantId: "tenant-1", context },
      { invokeText, recordGeneration: vi.fn().mockResolvedValue(undefined) }
    );
    const call = invokeText.mock.calls[0][0];
    const system = call.messages[0].content as string;
    expect(system).not.toContain("never exceed 70 words");
    expect(system).not.toContain("no more than 3 concise sentences");
    expect(system).not.toContain("Do not search, select, cite, or introduce sales doctrine");
    expect(call.maxTokens).toBeGreaterThanOrEqual(400);
    expect(call.temperature).toBeGreaterThan(0.15);
  });

  it("9 — follow-up no longer carries the 55-word / 520-char gag", async () => {
    const invokeText = vi.fn().mockResolvedValue("Answer.");
    await answerClairePreDriveFollowUp(
      { tenantId: "tenant-1", utterance: "What should I ask the PM?", brief: "Visit The Wilshire.", context },
      { invokeText, recordGeneration: vi.fn().mockResolvedValue(undefined) }
    );
    const call = invokeText.mock.calls[0][0];
    const system = call.messages[0].content as string;
    expect(system).not.toContain("no more than 55 words");
    expect(system).not.toContain(
      "The opening brief is advice derived before this turn; explain, simplify, restate, or apply only that advice."
    );
    expect(call.maxTokens).toBeGreaterThanOrEqual(400);
    expect(call.temperature).toBeGreaterThan(0.15);
  });

  it("10 — a long, model-written multi-sentence answer is not hard-truncated mid-sentence", async () => {
    const longAnswer =
      "Here is the first consideration, laid out in full so the operator has real context to work from. " +
      "Here is a second, more strategic point worth making at real length, because the operator asked a substantive question that deserves more than one clipped sentence. " +
      "Here is a third point about timing and sequencing that matters just as much as the first two, and should not be dropped for the sake of brevity. " +
      "A fourth and final sentence closes out the thought with a concrete recommendation for what to do next, and a fifth clause is added here purely to push this fixture comfortably past the old hard character limit.";
    expect(longAnswer.length).toBeGreaterThan(520);
    const invokeText = vi.fn().mockResolvedValue(longAnswer);
    const result = await answerClairePreDriveFollowUp(
      { tenantId: "tenant-1", utterance: "What am I missing here, strategically?", brief: "Visit The Wilshire.", context },
      { invokeText, recordGeneration: vi.fn().mockResolvedValue(undefined) }
    );
    // Not cut at the old 520-char boundary, and not cut mid-sentence.
    expect(result).toBe(longAnswer);
    expect(result.length).toBeGreaterThan(520);
  });

  it("11 — a simple question can still get a short answer (no forced padding)", async () => {
    const shortAnswer = "That's The Wilshire.";
    const invokeText = vi.fn().mockResolvedValue(shortAnswer);
    const result = await answerClairePreDriveFollowUp(
      { tenantId: "tenant-1", utterance: "What's the stop again?", brief: "Visit The Wilshire.", context },
      { invokeText, recordGeneration: vi.fn().mockResolvedValue(undefined) }
    );
    expect(result).toBe(shortAnswer);
    const system = invokeText.mock.calls[0][0].messages[0].content as string;
    // No instruction forces a minimum length -- only that length should
    // match the question, not be padded.
    expect(system).toContain("sized to the question");
    expect(system).not.toMatch(/at least \d+ words/i);
  });

  it("15 — the G2 disappointment/guilt/shame framing lint is still active and still wired into writeClairePreDriveBrief", async () => {
    expect(DISAPPOINTMENT_PATTERNS.length).toBeGreaterThan(0);
    expect(lintDisappointmentFraming("You let me down again, that's disappointing.").passes).toBe(false);
    expect(lintDisappointmentFraming("Here's what's outstanding, and your options.").passes).toBe(true);

    const invokeText = vi.fn().mockResolvedValue("I'm disappointed you didn't finish that.");
    const recordGeneration = vi.fn().mockResolvedValue(undefined);
    const result = await writeClairePreDriveBrief(
      { tenantId: "tenant-1", context },
      { invokeText, recordGeneration }
    );
    // Lint rejection routes to the deterministic fallback, never the
    // disappointment-framed model text.
    expect(result).not.toContain("disappointed");
    expect(recordGeneration).toHaveBeenCalledWith(
      expect.objectContaining({ diagnostic: expect.objectContaining({ source: "fallback" }) })
    );
  });

  it("16 — the CEO-language lint is still active and still wired into writeClairePreDriveBrief", async () => {
    expect(CEO_LANGUAGE_PATTERNS.length).toBeGreaterThan(0);
    expect(lintCeoLanguage("Run this by the board of directors first.").passes).toBe(false);
    expect(lintCeoLanguage("Run this by the property manager first.").passes).toBe(true);

    const invokeText = vi.fn().mockResolvedValue("As CEO, you need board approval for this.");
    const recordGeneration = vi.fn().mockResolvedValue(undefined);
    const result = await writeClairePreDriveBrief(
      { tenantId: "tenant-1", context },
      { invokeText, recordGeneration }
    );
    expect(result).not.toContain("CEO");
    expect(recordGeneration).toHaveBeenCalledWith(
      expect.objectContaining({ diagnostic: expect.objectContaining({ source: "fallback" }) })
    );
  });

  it("17 — recovery/clinical framing prohibition remains in the shared reasoning policy and is not auto-enabled", async () => {
    const invokeText = vi.fn().mockResolvedValue("Plain, non-clinical response.");
    await writeClairePreDriveBrief(
      { tenantId: "tenant-1", context },
      { invokeText, recordGeneration: vi.fn().mockResolvedValue(undefined) }
    );
    const system = invokeText.mock.calls[0][0].messages[0].content as string;
    expect(system).toContain(
      "Do not diagnose, do not use recovery-program language, and do not give motivational speeches."
    );
  });

  it("18 — operator_avoidance remains disabled (absent from both event allowlists)", () => {
    expect(WARMTH_EMISSION_ALLOWLIST.has("operator_avoidance" as never)).toBe(false);
    expect(
      (CLAIRE_ATTESTABLE_EVENT_TYPES as readonly string[]).includes("operator_avoidance")
    ).toBe(false);
  });

  // Item 19 (verified-state guard blocks unsupported sent/completed/scheduled
  // claims) is proven end-to-end, with real fallback routing, in
  // slice03AssertionGuardWiring.test.ts ("falls back when the model claims a
  // queued send", "injects G4 inventory and falls back on unverified
  // 'sent'"). Not duplicated here to avoid two sources of truth for the
  // same behavior; this test just confirms the guard function is still the
  // one imported and called by both edited generation paths.
  it("19 — assertPostGenerationStateVerbs is still imported and invoked by both edited generation paths", async () => {
    const preDrive = await import("./preDriveConversation");
    const reasoning = await import("./reasoning");
    const preDriveSrc = preDrive.answerClairePreDriveFollowUp.toString();
    const reasoningSrc = reasoning.writeClairePreDriveBrief.toString();
    expect(preDriveSrc).toContain("assertPostGenerationStateVerbs");
    expect(reasoningSrc).toContain("assertPostGenerationStateVerbs");
  });

  it("20/21 — fallback telemetry records source/reason and the requested model name", async () => {
    const recordGeneration = vi.fn().mockResolvedValue(undefined);
    await writeClairePreDriveBrief(
      { tenantId: "tenant-1", context },
      { invokeText: vi.fn().mockRejectedValue(new Error("provider down")), recordGeneration }
    );
    expect(recordGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        diagnostic: expect.objectContaining({
          source: "fallback",
          failureReason: "generation_failed",
          modelRequested: expect.any(String),
          surface: "voice",
        }),
      })
    );

    const recordGenerationModel = vi.fn().mockResolvedValue(undefined);
    await writeClairePreDriveBrief(
      { tenantId: "tenant-1", context },
      { invokeText: vi.fn().mockResolvedValue("Model text."), recordGeneration: recordGenerationModel }
    );
    expect(recordGenerationModel).toHaveBeenCalledWith(
      expect.objectContaining({
        diagnostic: expect.objectContaining({
          source: "model",
          failureReason: null,
          modelRequested: expect.any(String),
          surface: "voice",
        }),
      })
    );
  });
});
