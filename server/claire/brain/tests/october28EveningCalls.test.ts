/**
 * The two 2026-10-28 evening calls, replayed with Adam's real utterances.
 *
 *   Call A, evening wrap, session d958c334 (conversation fffb8882), 17:30 PT.
 *   Call B, inbound, session cb980810 (conversation 02685366), 17:38 PT.
 *
 * What went wrong, and what each block below proves is fixed:
 *  1. B: Claire asked "Want me to put both on tomorrow's Day Line?" (the landing page and the Louise);
 *     Adam's "Yes." saved the Greystar pitch, an older held offer she never named.
 *  2. B: Adam chose tomorrow's work five times; "Remove the sales stops from the dayline and put the
 *     marketing challenge." got "I can't remove or add anything from here."
 *  3. A: four repeat requests replayed a turn that opened with two sentences of preamble; Adam cut in
 *     each time and never heard the question.
 *  4. B: "[Playback unconfirmed]" was spoken aloud twice.
 */

import { describe, expect, it, vi } from "vitest";

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
import type { EvidenceItem } from "../contracts/evidence";
import {
  runClaireV2PrimaryTurn,
  heldBriefingClarifier,
  type ClaireV2PrimaryDeps,
  type ClaireV2PrimaryInput,
  type ClaireV2PrimaryState,
} from "../live/primaryTurn";
import {
  mayBeDayPlanEdit,
  rowsToRemove,
  titleGroundedInOperatorWords,
  type DayPlanEditReading,
  type DayPlanRow,
} from "../live/dayPlanEdit";
import { buildLeadPlan, leadPlanApprovalAsk } from "../executive/leadPlan";
import { completionConditionForMission } from "../../operatorMissionCommand";
import { repeatSpeech, stripInternalAnnotations } from "../../speech/internalAnnotations";
import type { SemanticReading } from "../perception/semanticPerception";

const TODAY = "2026-10-28";
const TOMORROW = "2026-10-29";
const PITCH = "Pitch Wilshire Vermont and The Chadwick in person (Greystar Koreatown)";

// ── Call B, verbatim (claire_conversation_turns, session cb980810) ──
const B = {
  ad: "Well, I'm concerned that... So we have an October... End of October special running on Instagram in the for... In the form of a static image advertisement.",
  converting:
    "we're not converting anybody, and I think it's because of our funnel, specifically the landing page. So I had MetaMuse create a specified landing page catered to our offer.",
  priority: "And now I just need to put the final touches on it and get it published. So think that should take priority over the Luis",
  credit:
    "marketing challenge, visiting pardon me, launching the landing page that's catered to our Instagram ad offer and if I do that, I really want to make sure that you give me credit for it in terms of remembering that I completed a marketing challenge tomorrow in the case I in the case I do complete it.",
  aboutChallenge: "Wait. Wait. Wait. Wait. I just got done telling you that tomorrow is about the marketing challenge. It's not about the Louise.",
  notOnLine: "I don't want Claire, I don't want those on my ******* day line.",
  remove: "Remove the sales stops from the dayline and put the marketing challenge.",
};

// ── Call A, verbatim (session d958c334) ──
const A = {
  buildItem:
    "Noted, that's a build item for you, not something I can change from here. Until it exists, I'll keep turns short on my end. One question: what time do you want the first leg tomorrow?",
  repeats: [
    "Do what... The 1st what tomorrow?",
    "No. I didn't say anything. I I I wanted to know what your question was. I didn't hear you.",
    "You're just repeating yourself. What did you ask me about tomorrow?",
  ],
  noLouise:
    "I don't wanna talk about sales missions and stuff. I'm just not in the zone to wanna do it, and, uh, we're gonna have to reapproach how we talk about those.",
};

const CHALLENGE = "Publish the Instagram landing page";

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

const context = {
  businessDate: TODAY,
  actorId: "adam-admin",
  macroGoalKnown: true,
  macroGoal: { objective: "Get to 50 active customers" },
  relevantTimeline: [],
  blockers: [],
  nextFixedCommitment: null,
  clock: { localTime: "5:40 PM", tomorrowBusinessDate: TOMORROW },
} as never;

/** Tomorrow's line as production had it after "Yes." saved the pitch, plus a real pickup. */
function tomorrowLine(): DayPlanRow[] {
  return [
    { id: "830992c0", title: PITCH, kind: "growth", status: "open", operatorPrimary: false },
    { id: "pickup-1", title: "Pick up laundry at Century Park East", kind: "operations", status: "open", operatorPrimary: false },
    // An obligation whose title carries a "sales" word. The kind says what it is.
    { id: "visit-1", title: "Visit customer to collect laundry", kind: "operations", status: "open", operatorPrimary: false },
  ];
}

function harness(readings: Record<string, DayPlanEditReading | null> = {}, semantic: Record<string, SemanticReading["turnKind"]> = {}) {
  const line = new Map<string, DayPlanRow[]>([[TOMORROW, tomorrowLine()], [TODAY, []]]);
  const removed: Array<{ businessDate: string; ids: string[] }> = [];
  const designated: Array<{ businessDate: string; title: string }> = [];
  const speak = vi.fn(async (input: { utterance: string }) => `Composed reply to: ${input.utterance}`);
  const executeGrant = vi.fn(async (_grant: ExecutiveActionGrant, _state: ClaireV2PrimaryState): Promise<ClaireTurnResult> => {
    throw new Error("executeGrant must not run in this test");
  });
  const read = vi.fn(async ({ utterance }: { utterance: string }) => readings[utterance] ?? { applies: false, explicit: false, day: "tomorrow" as const, primaryTitle: null, removeSales: false, removeTitles: [] });
  const deps: ClaireV2PrimaryDeps = {
    now: () => new Date("2026-10-29T00:40:00.000Z"),
    speak: speak as never,
    interpretPerception: async ({ utterance }) => ({ turnKind: semantic[utterance] ?? "unclear", endsConversation: false }),
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
    dayPlanEdit: {
      read,
      deps: {
        readDay: async businessDate => [...(line.get(businessDate) ?? [])],
        removeFromDay: async ({ businessDate, commitmentIds }) => {
          const rows = line.get(businessDate) ?? [];
          line.set(businessDate, rows.filter(row => !commitmentIds.includes(row.id)));
          removed.push({ businessDate, ids: commitmentIds });
          return commitmentIds.filter(id => rows.some(row => row.id === id));
        },
        designateMission: async ({ businessDate, title }) => {
          designated.push({ businessDate, title });
          const rows = line.get(businessDate) ?? [];
          line.set(businessDate, [...rows, { id: "challenge-1", title, kind: "growth", status: "open", operatorPrimary: true }]);
          return { ok: true as const, title, completionCondition: completionConditionForMission(title), commitmentId: "challenge-1", outcome: "created" as const };
        },
      },
    },
  };
  return { deps, speak, executeGrant, read, line, removed, designated };
}

function turnInput(state: ClaireV2PrimaryState, utterance: string): ClaireV2PrimaryInput {
  return {
    authority: { authorized: true, tenantId: "default", operatorUserId: "adam-admin", role: "owner", basis: "verified_membership" },
    tenantId: "default",
    operatorUserId: "adam-admin",
    dayDirectorActorId: "1",
    surface: "voice",
    utterance,
    state,
    conversationKey: "claire-call:02685366",
    conversationId: "02685366",
    timeZone: "America/Los_Angeles",
    businessDate: TODAY,
    brief: "Claire here. What's up?",
    context,
    allowFragmentWait: false,
  } as ClaireV2PrimaryInput;
}

/** Call B's state after Claire's opening lead plan: the pitch held pending, asked at Claire turn 1. */
function afterOpening(): ClaireV2PrimaryState {
  return {
    claireTurnCount: 1,
    pendingBriefing: {
      parsed: { items: [{ kind: "new_work", title: PITCH, businessDate: TOMORROW }] } as never,
      createdAt: Date.now(),
    },
    pendingBriefingAskedAtTurn: 1,
    history: [
      { speaker: "claire", text: "Claire here. What's up?", at: 1 },
      { speaker: "operator", text: "Hey, Claire. It's Adam. Uh, what should I do tomorrow?", at: 2 },
      {
        speaker: "claire",
        text: `Tomorrow starts with The Louise. After that, Greystar Koreatown: Wilshire Vermont or The Chadwick. ${leadPlanApprovalAsk({ title: PITCH, businessDate: TOMORROW }, TODAY)}`,
        at: 3,
      },
      { speaker: "operator", text: B.ad, at: 4 },
      { speaker: "claire", text: "What's the concern?", at: 5 },
      { speaker: "operator", text: B.converting, at: 6 },
      { speaker: "claire", text: "A landing page is a reasonable thing to suspect.", at: 7 },
    ],
  };
}

const challengeReading = (explicit: boolean, removeSales = false): DayPlanEditReading => ({
  applies: true,
  explicit,
  day: "tomorrow",
  primaryTitle: CHALLENGE,
  removeSales,
  removeTitles: [],
});

describe("1. a yes approves only what Claire just asked, by name", () => {
  it("the held offer is named in the ask", () => {
    expect(leadPlanApprovalAsk({ title: PITCH, businessDate: TOMORROW }, TODAY)).toBe(
      "Want me to put that on tomorrow's Day Line: pitch Wilshire Vermont and The Chadwick in person?"
    );
  });

  it("a yes several turns after the held ask writes nothing and names the held item", async () => {
    const h = harness({}, { "Yes.": "acknowledgement" });
    const state = afterOpening();
    // Claire's turns 2–4 were conversation; the pitch ask was turn 1.
    state.claireTurnCount = 4;
    const result = await runClaireV2PrimaryTurn(turnInput(state, "Yes."), h.deps);
    expect(h.executeGrant).not.toHaveBeenCalled();
    expect(result.speak).toBe(heldBriefingClarifier([{ title: PITCH, businessDate: TOMORROW }], TODAY));
    expect(result.speak).toMatch(/^Just so I save the right thing: put Pitch Wilshire Vermont/);
    expect(result.speak).toMatch(/tomorrow's Day Line\?$/);
    // The clarifier is now the fresh ask; the pitch is still only pending.
    expect(state.pendingBriefing).not.toBeNull();
    expect(state.pendingBriefingAskedAtTurn).toBe(5);
  });

  it("a yes right after the named ask still goes to the adapter", async () => {
    const h = harness({}, { "Yes.": "acknowledgement" });
    h.executeGrant.mockResolvedValue({ speak: "", receiptBackedCommit: "Added: pitch.", kind: "briefing_saved", actionIds: ["830992c0"], mutationReceipts: [{ claimedState: "created", entityId: "830992c0", statement: PITCH }] });
    const state = afterOpening();
    await runClaireV2PrimaryTurn(turnInput(state, "Yes."), h.deps);
    expect(h.executeGrant).toHaveBeenCalledTimes(1);
  });
});

describe("2. Adam's choice for tomorrow becomes the day's challenge; the sales stops come off tomorrow only", () => {
  it("the gate opens on every way he said it, and stays shut on reports and questions", () => {
    for (const text of [B.priority, B.credit, B.aboutChallenge, B.notOnLine, B.remove]) expect(mayBeDayPlanEdit(text)).toBe(true);
    for (const text of ["Hey, Claire. It's Adam. Uh, what should I do tomorrow?", B.ad, B.converting, "Yes.", A.noLouise]) {
      expect(mayBeDayPlanEdit(text)).toBe(false);
    }
  });

  it("a title nobody said is not used", () => {
    const said = [B.ad, B.converting, B.priority].join(" ");
    expect(titleGroundedInOperatorWords(CHALLENGE, said)).toBe(true);
    expect(titleGroundedInOperatorWords("Call the Greystar regional office", said)).toBe(false);
  });

  it("'that should take priority' is offered once by name, and the next yes saves the challenge — not the pitch", async () => {
    const h = harness({ [B.priority]: challengeReading(false) }, { "Yes.": "acknowledgement" });
    const state = afterOpening();
    const offer = await runClaireV2PrimaryTurn(turnInput(state, B.priority), h.deps);
    expect(offer.speak).toBe("Want me to set tomorrow's challenge to publish the Instagram landing page?");
    expect(h.designated).toEqual([]);

    const yes = await runClaireV2PrimaryTurn(turnInput(state, "Yes."), h.deps);
    expect(h.executeGrant).not.toHaveBeenCalled();
    expect(h.designated).toEqual([{ businessDate: TOMORROW, title: CHALLENGE }]);
    expect(yes.speak).toBe(
      "Saved. Tomorrow's challenge: publish the Instagram landing page. It counts when the Instagram landing page is published."
    );
    // Claire's own held pitch offer is superseded, never left for a later yes.
    expect(state.pendingBriefing ?? null).toBeNull();
    const later = await runClaireV2PrimaryTurn(turnInput(state, "Yes."), h.deps);
    expect(h.executeGrant).not.toHaveBeenCalled();
    expect(later.speak).not.toMatch(/Wilshire|Chadwick|Saved/);
  });

  it("a yes to the day-plan offer that comes a turn late does nothing", async () => {
    const h = harness({ [B.priority]: challengeReading(false) }, { "Yes.": "acknowledgement" });
    const state = afterOpening();
    await runClaireV2PrimaryTurn(turnInput(state, B.priority), h.deps);
    await runClaireV2PrimaryTurn(turnInput(state, "Hmm, let me think about the ad budget first."), h.deps);
    await runClaireV2PrimaryTurn(turnInput(state, "Yes."), h.deps);
    expect(h.designated).toEqual([]);
  });

  it("'Remove the sales stops from the dayline and put the marketing challenge.' does both, reads back, keeps the pickup", async () => {
    const h = harness({ [B.remove]: challengeReading(true, true) });
    const state = afterOpening();
    const result = await runClaireV2PrimaryTurn(turnInput(state, B.remove), h.deps);
    expect(h.removed).toEqual([{ businessDate: TOMORROW, ids: ["830992c0"] }]);
    expect(h.designated).toEqual([{ businessDate: TOMORROW, title: CHALLENGE }]);
    expect(h.line.get(TOMORROW)!.map(row => row.title)).toEqual(["Pick up laundry at Century Park East", "Visit customer to collect laundry", CHALLENGE]);
    expect(result.speak).toBe(
      `I took Pitch Wilshire Vermont and The Chadwick in person off tomorrow's line. It stays on record; only tomorrow changed. Saved. Tomorrow's challenge: publish the Instagram landing page. It counts when the Instagram landing page is published.`
    );
    expect(result.speak).not.toMatch(/can't remove|can't add/i);
    expect(result.mutationReceipts?.map(receipt => receipt.claimedState)).toEqual(["removed", "created"]);
  });

  it("'I don't want those on my day line' with nothing to match says so and writes nothing", async () => {
    const h = harness({ [B.notOnLine]: { applies: true, explicit: true, day: "today", primaryTitle: null, removeSales: true, removeTitles: [] } });
    const result = await runClaireV2PrimaryTurn(turnInput(afterOpening(), B.notOnLine), h.deps);
    expect(result.speak).toBe("There were no sales stops on today's line.");
    expect(h.removed).toEqual([]);
  });

  it("the operator's mission, completed history and operational work are never sales stops", () => {
    const rows: DayPlanRow[] = [
      { id: "m", title: "Pitch The Pearl in person", kind: "growth", status: "open", operatorPrimary: true },
      { id: "c", title: "Visit Avana", kind: "growth", status: "completed", operatorPrimary: false },
      { id: "p", title: PITCH, kind: "growth", status: "open", operatorPrimary: false },
      { id: "v", title: "Visit customer to collect laundry", kind: "operations", status: "open", operatorPrimary: false },
      { id: "w", title: "Walk-in drop-off at the shop", kind: "prep", status: "open", operatorPrimary: false },
      // Growth by kind with no sales word in the title: still a sales stop.
      { id: "g", title: "Coffee with the OPUS LA manager", kind: "growth", status: "open", operatorPrimary: false },
    ];
    expect(rowsToRemove({ ...challengeReading(true, true), primaryTitle: null }, rows).map(row => row.id)).toEqual(["p", "g"]);
  });

  it("a row the operator names comes off whatever its kind", () => {
    const rows: DayPlanRow[] = [{ id: "v", title: "Visit customer to collect laundry", kind: "operations", status: "open", operatorPrimary: false }];
    const reading = { ...challengeReading(true, false), primaryTitle: null, removeTitles: ["the customer laundry visit"] };
    expect(rowsToRemove(reading, rows).map(row => row.id)).toEqual(["v"]);
  });
});

describe("2b. a day the operator chose gets no discretionary Greystar offer", () => {
  const evidence = (withChallenge: boolean): EvidenceItem[] => [
    {
      id: `operations:${TOMORROW}`,
      type: "operations",
      source: "loadDayWork",
      provenance: { reader: "loadDayWork" },
      observedAt: "",
      asOf: TOMORROW,
      freshness: null,
      coverage: { complete: true, gaps: [] },
      authoritativeFor: ["current_business_truth"],
      payload: {
        businessDate: TOMORROW,
        open: [
          ...(withChallenge ? [{ id: "day-director:challenge-1", title: CHALLENGE, status: "open", source: "day_line", workKind: "growth", timing: null, completedAt: null }] : []),
          // The sales work Adam turned down on the call, as the Day Director and the route file it.
          { id: "day-director:louise", title: "Follow up with The Louise", status: "open", source: "day_line", workKind: "growth", timing: null, completedAt: null },
          { id: "route:wv", title: "Rise Koreatown leasing office visit", status: "open", source: "route", workKind: "commercial_visit", timing: null, completedAt: null },
          // Real obligations, one with a "visit" in its title.
          { id: "day-director:pickup-1", title: "Pick up laundry at Century Park East", status: "open", source: "day_line", workKind: "operations", timing: null, completedAt: null },
          { id: "route:visit", title: "Visit customer to collect laundry", status: "open", source: "route", workKind: "pickup", timing: "at 9:00 AM", completedAt: null },
        ],
        completed: [],
        routeAvailable: true,
      },
      operatorVisible: true,
    } as never,
    {
      id: "game",
      type: "game_state",
      source: "readGameMasterView",
      provenance: { reader: "readGameMasterView" },
      observedAt: "",
      asOf: TODAY,
      freshness: null,
      coverage: { complete: true, gaps: [] },
      authoritativeFor: ["current_business_truth"],
      payload: {
        activeKingdom: { kingdomId: "kingdom-1-colosseum", sequence: 1, title: "The Colosseum" },
        kingdoms: [],
        day1TenDoors: { record: "none" },
        domainProgression: { record: "none" },
        companions: { record: "none" },
        colosseum: {
          satisfied: false,
          targetIds: ["rise", "avana", "pearl", "wv", "chadwick"],
          pitched: [{ name: "Rise" }, { name: "Avana" }, { name: "The Pearl" }],
          remaining: [{ name: "Wilshire Vermont" }, { name: "The Chadwick" }],
          beyond: [],
        },
      },
      operatorVisible: true,
    } as never,
    ...(withChallenge
      ? [
          {
            id: `workday_command:${TOMORROW}`,
            type: "workday_command",
            source: "loadDailyCommand",
            provenance: { reader: "loadDailyCommand" },
            observedAt: "",
            asOf: TOMORROW,
            freshness: null,
            coverage: { complete: true, gaps: [] },
            authoritativeFor: ["current_business_truth"],
            payload: {
              command: {
                businessDate: TOMORROW,
                primary: { title: CHALLENGE, status: "open" },
                explicitOperatorMission: { businessDate: TOMORROW, completionCondition: "The Instagram landing page is published." },
              },
            },
            operatorVisible: true,
          } as never,
        ]
      : []),
  ];

  it("without a choice Claire still offers the pitch", () => {
    const plan = buildLeadPlan({ evidence: evidence(false), horizon: "tomorrow", today: TODAY });
    expect(plan.dayLineMove?.title).toBe(PITCH);
  });

  it("with the challenge chosen: it leads, the obligations stay, no sales work, no offer, no Colosseum pitch", () => {
    const plan = buildLeadPlan({ evidence: evidence(true), horizon: "tomorrow", today: TODAY });
    expect(plan.operatorChallenge).toBe(CHALLENGE);
    expect(plan.dayLineMove).toBeNull();
    expect(plan.text).toMatch(/Tomorrow is your challenge: publish the Instagram landing page\./);
    expect(plan.text).toMatch(/After that: pick up laundry at Century Park East and visit customer to collect laundry\./);
    expect(plan.text).not.toMatch(/Louise|Rise Koreatown|Wilshire|Chadwick|Colosseum/);
  });

  it("without a choice the sales work is still in the plan", () => {
    const plan = buildLeadPlan({ evidence: evidence(false), horizon: "tomorrow", today: TODAY });
    expect(plan.text).toMatch(/follow up with The Louise/);
  });
});

describe("3. a repeat leads with the question", () => {
  it("drops the preamble Adam kept cutting into", () => {
    expect(repeatSpeech(A.buildItem)).toBe("My question: what time do you want the first leg tomorrow?");
    // Asked again: the same short question, never the preamble.
    expect(repeatSpeech(repeatSpeech(A.buildItem))).toBe("My question: what time do you want the first leg tomorrow?");
    expect(repeatSpeech("Short turns, no echoing.")).toBe("Short turns, no echoing.");
  });

  it("four repeat requests in a row never replay 'build item'", async () => {
    const semantic = Object.fromEntries(A.repeats.map(text => [text, "repeat_request" as const]));
    const h = harness({}, semantic);
    const state: ClaireV2PrimaryState = {
      claireTurnCount: 14,
      history: [{ speaker: "claire", text: A.buildItem, at: 1, delivery: "interrupted" }],
    };
    for (const text of A.repeats) {
      const result = await runClaireV2PrimaryTurn(turnInput(state, text), h.deps);
      expect(result.brainV2.composition).toBe("repeat");
      expect(result.speak).toBe("My question: what time do you want the first leg tomorrow?");
    }
  });
});

describe("4. internal annotations are never spoken", () => {
  it("strips the playback tag the model copied from history", () => {
    expect(stripInternalAnnotations("[Playback unconfirmed] Okay. Plausible, and a landing page is a reasonable thing to suspect.")).toBe(
      "Okay. Plausible, and a landing page is a reasonable thing to suspect."
    );
    expect(stripInternalAnnotations("Fair. [Playback interrupted] Tomorrow is the landing page.")).toBe("Fair. Tomorrow is the landing page.");
    expect(stripInternalAnnotations("Tomorrow is the landing page [and nothing else].")).toBe("Tomorrow is the landing page [and nothing else].");
  });

  it("a composed reply that carries the tag reaches the operator without it", async () => {
    const h = harness({}, { [B.converting]: "report_or_narration" });
    h.speak.mockResolvedValue("[Playback unconfirmed] Okay. Plausible, and a landing page is a reasonable thing to suspect." as never);
    const state: ClaireV2PrimaryState = { claireTurnCount: 3, history: [{ speaker: "claire", text: "What's the concern?", at: 1 }] };
    const result = await runClaireV2PrimaryTurn(turnInput(state, B.converting), h.deps);
    expect(result.speak).not.toMatch(/Playback/i);
  });
});
