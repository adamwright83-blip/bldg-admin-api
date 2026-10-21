/**
 * Call hygiene — replays of the real utterances from the 2026-10-13 → 2026-10-20 production
 * call audit. Every utterance below was spoken by Adam on a live call; the session ids are the
 * ledger's `claire_conversation_sessions.id` prefixes.
 *
 *   - 2026-10-19 evening_debrief e6c19580 / 2026-10-20 morning_readiness 80d6bcbb:
 *       "Do you remember what my goal is?" and "I love you, Claire." both got "No. What else?"
 *   - 2026-10-18 evening_planning e1c240ba: "What did you say?" answered with
 *       "I didn't have enough to state that as fact."
 *   - 2026-10-13 morning_reconciliation 62df3040: "Yes." answered with
 *       "I couldn't verify that action completed…"
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../turn/claireTurn", async importOriginal => {
  const actual = await importOriginal<typeof import("../../turn/claireTurn")>();
  return {
    ...actual,
    runClaireTurn: vi.fn(async () => {
      throw new Error("legacy Claire must not answer a Brain V2 primary turn");
    }),
  };
});

import type { ClaireTurnResult } from "../../turn/claireTurn";
import type { BusinessMemoryDeps } from "../businessMemory/adapter";
import type { ExecutiveActionGrant } from "../contracts/grants";
import { perceiveTurn } from "../perception/perceive";
import { isRomanticAdvance } from "../perception/conversationalActs";
import { applySemanticReading } from "../perception/semanticPerception";
import {
  runClaireV2PrimaryTurn,
  V2_NOTHING_TO_REPEAT_SPEECH,
  type ClaireV2PrimaryDeps,
  type ClaireV2PrimaryInput,
  type ClaireV2PrimaryState,
} from "../live/primaryTurn";
import {
  BrainV2ExecutionFailedError,
  BrainV2GrantNotExecutableError,
  brainV2ExecutionFailureResult,
  executeGrantBoundLegacyAdapter,
} from "../live/grantBoundLegacyAdapter";
import { runClaireBrainV2LiveTurn, shouldFallbackToClaireLegacy } from "../live/runClaireBrainV2LiveTurn";
import { mintActionGrant } from "../executive/grants";
import { AUTHORED_DIALOGUE, ADVANCE_DECLINE_AUTHORING_SLOTS } from "../../progression/authoredDialogue";
import { selectAdvanceDeflection } from "../../progression/dialogueRegistry";

const business: BusinessMemoryDeps = {
  runQuery: vi.fn(async () => {
    throw new Error("no query expected");
  }),
  listAccounts: async () => [],
  listContacts: async () => [],
  loadHistory: async () => ({}) as never,
  loadOpenOrders: async () => [],
  loadOperations: async ({ businessDate }) => ({ businessDate, open: [], completed: [], routeAvailable: true }) as never,
  verifyClaim: async receipt => ({ receipt, outcome: "unsupported", resolution: "not_attempted", evidenceChanged: null }) as never,
};

const GOAL = "Get to 50 active customers";
const context = {
  businessDate: "2026-10-20",
  actorId: "adam-admin",
  macroGoalKnown: true,
  macroGoal: { objective: GOAL },
  relevantTimeline: [],
  blockers: [],
  nextFixedCommitment: null,
  clock: { localTime: "7:35 AM", tomorrowBusinessDate: "2026-10-21" },
} as never;

/**
 * The production semantic model read all three of these as a personal question to Claire.
 * Reproducing that misreading is what makes these tests meaningful: the fix must hold even
 * when the model gets it wrong.
 */
const PRODUCTION_MISREADING = /love you|encouragement|my goal|what did you say|repeat yourself|what you said/i;

function harness() {
  const speak = vi.fn(async (input: { utterance: string }) => `Composed reply to: ${input.utterance}`);
  const executeGrant = vi.fn(async (_grant: ExecutiveActionGrant, _state: ClaireV2PrimaryState): Promise<ClaireTurnResult> => {
    throw new Error("executeGrant not configured for this test");
  });
  const recordAdvance = vi.fn(async () => undefined);
  const deps: ClaireV2PrimaryDeps = {
    now: () => new Date("2026-10-20T14:35:00.000Z"),
    speak: speak as never,
    interpretPerception: async ({ utterance }) => ({
      turnKind: PRODUCTION_MISREADING.test(utterance) ? "personal_question_to_claire" : "unclear",
      endsConversation: false,
    }),
    planBusinessQuery: undefined,
    liveDeps: { business },
    executeGrant: executeGrant as never,
    routeWeekly: vi.fn(async () => null),
    beginWeekly: vi.fn(async () => ""),
    ingestDaphne: vi.fn(async () => ({ status: "persisted" })),
    capturePreference: vi.fn(async () => ({ status: "disabled" as const, corrections: [], observationIds: [], readbackVerified: false })) as never,
    loadDaphneGuidance: vi.fn(async () => null),
    commitPendingDisclosures: vi.fn(async () => undefined),
    legacyShadow: null,
    recordAdvance,
  };
  return { deps, speak, executeGrant, recordAdvance };
}

function turnInput(state: ClaireV2PrimaryState, utterance: string, over: Partial<ClaireV2PrimaryInput> = {}): ClaireV2PrimaryInput {
  return {
    authority: { authorized: true, tenantId: "laundry_farm", operatorUserId: "adam-admin", role: "owner", basis: "verified_membership" },
    tenantId: "laundry_farm",
    operatorUserId: "adam-admin",
    dayDirectorActorId: "42",
    surface: "voice",
    utterance,
    state,
    conversationKey: "claire-call:hygiene",
    conversationId: "hygiene",
    timeZone: "America/Los_Angeles",
    businessDate: "2026-10-20",
    brief: `Good morning, it's Claire. This week is about: ${GOAL}. On today's line: Jojo Test.`,
    context,
    allowFragmentWait: false,
    ...over,
  };
}

const registryText = (category: string) =>
  AUTHORED_DIALOGUE.filter(line => line.category === category).map(line => line.text);

describe("D6 — a romantic advance is deflected with authored lines and remembered (session 80d6bcbb)", () => {
  let h: ReturnType<typeof harness>;
  let state: ClaireV2PrimaryState;
  beforeEach(() => {
    h = harness();
    state = {};
  });

  it("perceives 'I love you, Claire.' as its own act, not a biography probe", () => {
    const perceived = perceiveTurn({ rawText: "I love you, Claire.", completeness: "complete" });
    expect(perceived.dialogueActs).toContain("romantic_or_personal_advance");
    expect(perceived.personalProbe).toBe(false);
    // The model calling it a personal question must not reopen the biography lane.
    const refined = applySemanticReading(perceived, { turnKind: "personal_question_to_claire", endsConversation: false }, { hasPriorClaims: false });
    expect(refined.dialogueActs).toContain("romantic_or_personal_advance");
    expect(refined.personalProbe).toBe(false);
  });

  it("answers with the band's authored decline plus an authored pivot, never the composer, and records it", async () => {
    const result = await runClaireV2PrimaryTurn(turnInput(state, "I love you, Claire."), h.deps);
    const declines = registryText("decline");
    const pivots = registryText("business_pivot");
    const decline = declines.find(text => result.speak.startsWith(text));
    expect(decline, `"${result.speak}" must start with an authored decline line`).toBeTruthy();
    expect(pivots.some(text => result.speak.endsWith(text))).toBe(true);
    expect(result.brainV2.composition).toBe("deterministic");
    expect(h.speak).not.toHaveBeenCalled();
    // Never a warm acceptance.
    expect(result.speak).not.toMatch(/love you too|i love|thank you|flattered|aw/i);
    // Durable game state, with the band and the line that declined it.
    expect(h.recordAdvance).toHaveBeenCalledTimes(1);
    expect(h.recordAdvance).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "laundry_farm", operatorUserId: "adam-admin", rapportBand: 0, declineId: expect.any(String) })
    );
  });

  it("is deterministic: the same advance at the same band yields the same pair", () => {
    const a = selectAdvanceDeflection({ rapportBand: 0, seed: "I love you, Claire." });
    const b = selectAdvanceDeflection({ rapportBand: 0, seed: "I love you, Claire." });
    expect(a.decline?.id).toBe(b.decline?.id);
    expect(a.pivot?.id).toBe(b.pivot?.id);
    expect(a.pivot?.category).toBe("business_pivot");
  });

  it("ships empty authoring slots for Adam and writes no dialogue of its own", () => {
    expect(ADVANCE_DECLINE_AUTHORING_SLOTS.map(slot => slot.id)).toEqual(
      expect.arrayContaining(["decline_r0_advance_a", "decline_r1_advance_a", "decline_r2_advance_a"])
    );
    // A slot is not a line: nothing in the registry carries the advance category yet.
    expect(AUTHORED_DIALOGUE.filter(line => line.category === "advance_decline")).toHaveLength(0);
    for (const slot of ADVANCE_DECLINE_AUTHORING_SLOTS) {
      expect(AUTHORED_DIALOGUE.some(line => line.id === slot.id)).toBe(false);
    }
  });

  it("'I want your encouragement.' is a work request: the composer answers, the decline registry never does", async () => {
    const perceived = perceiveTurn({ rawText: "I want your encouragement.", completeness: "complete" });
    expect(perceived.dialogueActs).toContain("encouragement_request");
    expect(perceived.dialogueActs).not.toContain("romantic_or_personal_advance");
    expect(perceived.personalProbe).toBe(false);

    const result = await runClaireV2PrimaryTurn(turnInput(state, "I want your encouragement."), h.deps);
    const allDeclines = [...registryText("decline"), ...registryText("thread_closer")];
    expect(allDeclines.some(text => result.speak.includes(text))).toBe(false);
    expect(result.brainV2.composition).toBe("composed");
    expect(h.speak).toHaveBeenCalledTimes(1);
    const organ = h.speak.mock.calls[0]![0] as { conversationalModeOverride?: string };
    expect(organ.conversationalModeOverride).toBe("operational");
    expect(h.recordAdvance).not.toHaveBeenCalled();
  });

  it("'Do you remember what my goal is?' is business memory: the goal is stated, never declined", async () => {
    const perceived = perceiveTurn({ rawText: "Do you remember what my goal is?", completeness: "complete" });
    expect(perceived.personalProbe).toBe(false);
    expect(perceived.businessIntent).not.toBe("none");

    const result = await runClaireV2PrimaryTurn(turnInput(state, "Do you remember what my goal is?"), h.deps);
    expect(result.speak).toBe(`Your goal is: ${GOAL}.`);
    expect(registryText("decline").some(text => result.speak.includes(text))).toBe(false);
    expect(h.recordAdvance).not.toHaveBeenCalled();
  });

  it("does not mistake ordinary operator speech for an advance", () => {
    for (const text of [
      "I'd like you to call Dana.",
      "I like you to follow up with the Louise.",
      "I would love you to look at Tuesday.",
      "You're pretty good at this.",
      "You're hot on the Louise lead.",
      "Would you like me to send that?",
      "Love the new Day Line layout.",
      "I love you guys' new feature.",
    ]) {
      expect(isRomanticAdvance(text), text).toBe(false);
    }
    for (const text of ["I love you, Claire.", "I miss you.", "You're gorgeous.", "Will you marry me?", "Do you love me?"]) {
      expect(isRomanticAdvance(text), text).toBe(true);
    }
  });

  it("still declines a real biography probe with the authored decline (canon guard unchanged)", async () => {
    const perceived = perceiveTurn({ rawText: "Where did you grow up?", completeness: "complete" });
    expect(perceived.personalProbe).toBe(true);
    expect(perceived.dialogueActs).not.toContain("romantic_or_personal_advance");
  });
});

describe("D14 — a repeat request re-speaks the previous turn verbatim (session e1c240ba)", () => {
  const CLAIM = "Anna Marie Carlos pickup scheduled 2PM at Wilshire.";

  it.each([
    "What did you say?",
    "I don't I don't know what you said. You have to repeat yourself.",
    "I'm asking you what you said.",
    "Say that again.",
    "Repeat that.",
    "I didn't catch that.",
  ])("%s → the previous Claire turn, word for word", async utterance => {
    const h = harness();
    const state: ClaireV2PrimaryState = {
      history: [
        { speaker: "operator", text: "I just dropped off 2 orders at Opus.", at: 1 },
        { speaker: "claire", text: CLAIM, at: 2 },
      ],
      claimReceipts: [
        {
          id: "claim_1",
          answerText: CLAIM,
          answerPath: "brain_v2_composed",
          claimType: "retrieved_evidence",
          grounding: "ungrounded",
          claireTurnOrdinal: 1,
        } as never,
      ],
    };
    const result = await runClaireV2PrimaryTurn(turnInput(state, utterance), h.deps);
    expect(result.speak).toBe(CLAIM);
    expect(result.speak).not.toMatch(/enough to state that as fact|not sure which statement/i);
    expect(result.brainV2.composition).toBe("repeat");
    expect(result.brainV2.businessIntent).toBe("none");
    expect(h.speak).not.toHaveBeenCalled();
    expect(h.executeGrant).not.toHaveBeenCalled();
  });

  it("is not a repeat request when it also carries work, or when it is another kind of recheck", () => {
    expect(perceiveTurn({ rawText: "Check it one more time.", completeness: "complete" }).dialogueActs).not.toContain("repeat_request");
    expect(perceiveTurn({ rawText: "What's that number for The Louise?", completeness: "complete" }).dialogueActs).not.toContain("repeat_request");
    expect(
      perceiveTurn({ rawText: "Say that again, and I need to call Dana Tuesday.", completeness: "complete" }).dialogueActs
    ).not.toContain("repeat_request");
  });

  it("is a different act from a correctness challenge", () => {
    const repeat = perceiveTurn({ rawText: "What did you say?", completeness: "complete" });
    expect(repeat.dialogueActs).toEqual(["repeat_request"]);
    expect(repeat.correction).toBe(false);
    const challenge = perceiveTurn({ rawText: "Are you sure about that?", completeness: "complete" });
    expect(challenge.businessIntent).toBe("correctness_challenge");
  });

  it("says so honestly when Claire has not spoken yet", async () => {
    const h = harness();
    const result = await runClaireV2PrimaryTurn(turnInput({}, "What did you say?"), h.deps);
    expect(result.speak).toBe(V2_NOTHING_TO_REPEAT_SPEECH);
  });
});

describe("D15 — the execution-failure line is only for a write that was attempted (session 62df3040)", () => {
  const roleFeedback = "You haven't been doing your job, Claire.";

  it("a grant refused before any write is never spoken as a failed action", async () => {
    const h = harness();
    h.executeGrant.mockRejectedValue(
      new BrainV2GrantNotExecutableError(
        "Brain V2 Day Line grant scope did not resolve to executable work",
        mintActionGrant({
          actionClass: "propose_day_line",
          scope: { titles: ["Call Dana"] },
          authorityBasis: "current_turn_operator_commitment",
          sourceTurnAssembledText: "I think I should call Dana after Louise.",
          expiresAtMs: Date.now() + 60_000,
          constraints: { mutationAllowed: true, shadowOnly: false },
        })
      )
    );
    const state: ClaireV2PrimaryState = {};
    const result = await runClaireV2PrimaryTurn(turnInput(state, "I need to call Dana Tuesday."), h.deps);
    expect(h.executeGrant).toHaveBeenCalledTimes(1);
    expect(result.speak).not.toMatch(/couldn't verify that action completed|won't retry/i);
    expect(result.brainV2.composition).not.toBe("execution_failed");
    expect(result.brainV2.composition).not.toBe("recovery");
    expect(state.pendingBriefing ?? null).toBeNull();
    // The organ is told nothing was saved or attempted, so it cannot promise a save.
    const organ = h.speak.mock.calls.at(-1)?.[0] as { retrievedEvidence?: Array<{ text: string }> } | undefined;
    expect(organ?.retrievedEvidence?.some(item => /nothing was saved/i.test(item.text))).toBe(true);
  });

  it("a non-action turn with no grant never reaches it", async () => {
    const h = harness();
    const result = await runClaireV2PrimaryTurn(turnInput({}, roleFeedback), h.deps);
    expect(h.executeGrant).not.toHaveBeenCalled();
    expect(result.speak).not.toMatch(/couldn't verify that action completed/i);
  });

  it("'Yes.' on a pending item whose write throws says WHAT was attempted", async () => {
    const h = harness();
    h.executeGrant.mockRejectedValue(
      new BrainV2ExecutionFailedError(
        'saving "Visit competitor laundromats in Huntington Park" to the Day Line',
        new Error("database unavailable")
      )
    );
    const state: ClaireV2PrimaryState = {
      pendingBriefing: {
        parsed: { items: [{ kind: "new_work", title: "Visit competitor laundromats in Huntington Park" }] } as never,
        createdAt: Date.now(),
      },
    };
    const result = await runClaireV2PrimaryTurn(turnInput(state, "Yes."), h.deps);
    expect(h.executeGrant).toHaveBeenCalledTimes(1);
    expect(result.brainV2.composition).toBe("execution_failed");
    expect(result.speak).toMatch(/I tried saving "Visit competitor laundromats in Huntington Park" to the Day Line/);
    expect(result.speak).toMatch(/couldn't verify it completed/);
  });

  it("the failure line itself names the attempt and cannot be built without one", () => {
    const line = brainV2ExecutionFailureResult({ assembledUtterance: "Yes.", attempted: 'saving "Call Dana" to the Day Line' });
    expect(line.speak).toBe(
      'I tried saving "Call Dana" to the Day Line and couldn\'t verify it completed, so I won\'t retry it through another path.'
    );
  });

  it("the real adapter refuses an unresolved grant with a typed refusal, before touching any store", async () => {
    const grant = mintActionGrant({
      actionClass: "propose_day_line",
      scope: { titles: ["Zebra migration"] },
      authorityBasis: "current_turn_operator_commitment",
      sourceTurnAssembledText: "I think I should call Dana after Louise.",
      expiresAtMs: Date.now() + 60_000,
      constraints: { mutationAllowed: true, shadowOnly: false },
    });
    await expect(
      executeGrantBoundLegacyAdapter({
        grant,
        state: { pendingBriefing: null },
        tenantId: "laundry_farm",
        operatorUserId: "adam-admin",
        dayDirectorActorId: "42",
        conversationKey: "claire-call:hygiene",
        timeZone: "America/Los_Angeles",
        surface: "voice",
      })
    ).rejects.toBeInstanceOf(BrainV2GrantNotExecutableError);
  });

  it("the live cutover falls back (no failure line) on a refusal and reports the attempt on a real failure", async () => {
    const base = {
      rawText: "I need to call Dana Tuesday.",
      state: {},
      tenantId: "laundry_farm",
      operatorUserId: "adam-admin",
      surface: "voice" as const,
      conversationKey: "claire-call:hygiene",
      live: { tenantId: "laundry_farm", operatorUserId: "adam-admin", conversationId: "h", dayDirectorActorId: "42", timeZone: "America/Los_Angeles", businessDate: "2026-10-20", surface: "voice" as const, priorClaimReceipts: [] },
      liveDeps: { business },
      resolveMembership: async ({ tenantId, operatorUserId }: { tenantId: string; operatorUserId: string }) => ({ tenantId, userOpenId: operatorUserId, role: "owner" as const }),
    };
    const env = { CLAIRE_BRAIN_V2_LIVE: "1" } as unknown as NodeJS.ProcessEnv;
    const refusedAdapter = vi.fn(async () => {
      throw new BrainV2GrantNotExecutableError("no scope", { actionClass: "propose_day_line" } as ExecutiveActionGrant);
    });
    const refused = await runClaireBrainV2LiveTurn({ ...base, executeLegacyAdapter: refusedAdapter }, { env });
    expect(refusedAdapter).toHaveBeenCalledTimes(1);
    expect(refused).toMatchObject({ active: false, reason: "error" });
    expect(shouldFallbackToClaireLegacy(refused)).toBe(true);

    const failedAdapter = vi.fn(async () => {
      throw new BrainV2ExecutionFailedError('saving "Call Dana" to the Day Line', new Error("db"));
    });
    const failed = await runClaireBrainV2LiveTurn({ ...base, executeLegacyAdapter: failedAdapter }, { env });
    expect(failedAdapter).toHaveBeenCalledTimes(1);
    expect(failed).toMatchObject({ active: false, reason: "execution_error", attempted: 'saving "Call Dana" to the Day Line' });
    expect(shouldFallbackToClaireLegacy(failed)).toBe(false);
  });
});
