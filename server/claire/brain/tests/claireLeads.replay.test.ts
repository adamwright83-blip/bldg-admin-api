/**
 * W1 acceptance — "Claire leads" — replaying the 2026-10-20 evening debrief.
 *
 * Production call: claire_conversation_sessions 5909ad4e-a3b1-4f1e-8a7e-8c7b07ec9868,
 * conversationKey claire-call:3b15eb7a-f41a-4b2a-969d-403c0ab73d48, Brain V2 primary.
 * Adam: "I feel like you're never running me."
 *
 * The operator turns are replayed, in order, through the real V2 primary path
 * (deterministic perception, semantic refinement, executive, integration,
 * routing) on a scheduled evening_debrief state. Readers are stubbed with the
 * prod facts of that evening:
 *   - macro goal "Get to 50 active customers", run baseline 23, no verified current count;
 *   - tomorrow's Day Line with the duplicates Claire read out (two "Los Feliz Towers"
 *     follow-ups with different ids, "The Louise" and "The Louise Los Feliz");
 *   - Kingdom 1 (kingdom-1-colosseum) active; Day 1 Ten Doors under adam-admin with
 *     rise-koreatown, avana-on-wilshire and the-pearl-on-wilshire pitched, so
 *     wilshire-vermont and the-chadwick remain of the Colosseum five and five more
 *     Day 1 Greystar buildings sit beyond it ("seven open" was the undifferentiated count);
 *   - no domain progression row, no companion unlocks (empty in prod).
 *
 * The semantic interpreter is stubbed with the readings prod logged, including
 * its misreadings (report_or_narration for the dictated example,
 * challenge_prior_claim for "you should already know them").
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
import { projectGameMasterView, type GameMasterView } from "../businessMemory/gameMasterView";
import type { GoalProgress } from "../businessMemory/goalProgress";
import {
  assembleV2Thought,
  runClaireV2PrimaryTurn,
  type ClaireV2PrimaryDeps,
  type ClaireV2PrimaryInput,
  type ClaireV2PrimaryState,
} from "../live/primaryTurn";
import { showrunnerOpening, type ShowrunnerBriefing } from "../../showrunner/showrunnerBriefing";
import { dropRepeatedQuestions } from "../../showrunner/showrunnerTurn";
import { speakDriverDayLineCall, type DriverDayLineCallFacts } from "../../showrunner/driverDayLineCall";
import { executeGrantBoundLegacyAdapter } from "../live/grantBoundLegacyAdapter";
import { mintActionGrant } from "../executive/grants";

const TODAY = "2026-10-20";
const TOMORROW = "2026-10-21";
const START_MS = Date.parse("2026-10-21T00:30:00.000Z"); // 17:30 PT

// ── The prod facts of the evening ──────────────────────────────────────────────

const GOAL: GoalProgress = {
  goalId: "goal-50",
  objective: "Get to 50 active customers",
  metricKey: "active_customers",
  unit: "customers",
  targetValue: 50,
  targetDate: null,
  baselineValue: 23,
  currentValue: null,
  currentNote: "active-customer count is partial",
};

const TARGETS = [
  ["rise-koreatown", "Rise Koreatown"],
  ["avana-on-wilshire", "Avana on Wilshire"],
  ["the-pearl-on-wilshire", "The Pearl on Wilshire"],
  ["wilshire-vermont", "Wilshire Vermont"],
  ["the-chadwick", "The Chadwick"],
  ["vermont-towers", "Vermont Towers"],
  ["the-mark-ktown", "The Mark"],
  ["ardmore-place", "Ardmore Place"],
  ["kenmore-lofts", "Kenmore Lofts"],
  ["serrano-court", "Serrano Court"],
] as const;

function day1Mission() {
  return {
    missionId: "day1-adam-admin",
    taskId: "task-1",
    businessDate: "2026-09-10",
    title: "Day 1 — Ten Doors",
    briefing: "",
    targets: TARGETS.map(([id, name]) => ({
      id,
      name,
      address: `${name} address`,
      neighborhood: "Koreatown",
      phone: null,
      lat: 0,
      lng: 0,
      managerLabel: "Greystar",
      isGreystar: true,
    })),
    outcomes: { "rise-koreatown": "pitched", "avana-on-wilshire": "pitched", "the-pearl-on-wilshire": "pitched" },
    currentTarget: null,
    progressLabel: null,
    visitedCount: 3,
    totalCount: 10,
    isComplete: false,
    outcomeCounts: { pitched: 3, couldntReach: 0 },
    evidenceEvents: [],
    visitEvidence: {},
  } as never;
}

function kingdomRows() {
  const row = (kingdomId: string, sequence: number, title: string, lanternCityStatus: "active" | "locked") => ({
    id: kingdomId,
    tenantId: "laundry_farm",
    kingdomId,
    sequence,
    title,
    realCampaignId: null,
    fictionalFieldMission: "",
    lanternCityStatus,
    driverDayRelevance: "",
    companionEarnedId: null,
    enablesKingdomId: null,
    capabilityRequirement: null,
    selectedAt: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  });
  return [row("kingdom-1-colosseum", 1, "The Colosseum", "active"), row("kingdom-2-the-last-valet", 2, "The Last Valet", "locked")];
}

function gameMasterView(): GameMasterView {
  return projectGameMasterView({
    driverId: "adam-admin",
    kingdoms: kingdomRows(),
    mission: day1Mission(),
    domainProgression: { readable: true, row: null },
    companions: [],
    chapters: [],
    hiddenGames: [],
  });
}

const TOMORROW_WORK = {
  businessDate: TOMORROW,
  open: [
    { id: "dl-1", title: "Follow up with The Louise", status: "open", source: "day_line", timing: null, completedAt: null },
    { id: "dl-2", title: "Los Feliz Towers follow-up", status: "open", source: "day_line", timing: null, completedAt: null },
    { id: "dl-3", title: "Los Feliz Towers follow-up", status: "open", source: "day_line", timing: null, completedAt: null },
    { id: "dl-4", title: "The Louise Los Feliz", status: "open", source: "day_line", timing: null, completedAt: null },
    { id: "dl-5", title: "Visit sageLA", status: "open", source: "day_line", timing: null, completedAt: null },
    { id: "dl-6", title: "Visit Argyle House", status: "open", source: "day_line", timing: null, completedAt: null },
  ],
  completed: [],
  routeAvailable: true,
};

const business: BusinessMemoryDeps = {
  runQuery: async () => {
    throw new Error("no ledger query is expected on a lead turn");
  },
  listAccounts: async () => [],
  listContacts: async () => [],
  loadHistory: async () => ({}) as never,
  loadOpenOrders: async () => [],
  loadOperations: async ({ businessDate }) =>
    (businessDate === TOMORROW ? TOMORROW_WORK : { businessDate, open: [], completed: [], routeAvailable: true }) as never,
  verifyClaim: async receipt => ({ receipt, outcome: "unverifiable", resolution: "not_attempted", evidenceChanged: false }) as never,
  loadGameMasterView: async () => gameMasterView(),
  loadGoalProgress: async () => GOAL,
};

const context = {
  businessDate: TODAY,
  actorId: "adam-admin",
  macroGoalKnown: true,
  relevantTimeline: [],
  blockers: [],
  nextFixedCommitment: null,
  clock: { localTime: "5:30 PM", tomorrowBusinessDate: TOMORROW },
} as never;

/** Prod's semantic readings for each operator turn of the call. */
function prodReading(utterance: string) {
  if (/what do you have for me tomorrow/i.test(utterance)) return { turnKind: "daily_briefing_request" as const, endsConversation: false };
  if (/what is my goal/i.test(utterance)) return { turnKind: "business_judgment_or_strategy" as const, endsConversation: false };
  if (/you're gonna hit/i.test(utterance)) return { turnKind: "report_or_narration" as const, endsConversation: false };
  if (/already know them/i.test(utterance)) return { turnKind: "challenge_prior_claim" as const, endsConversation: false };
  if (/^yes\b/i.test(utterance)) return { turnKind: "acknowledgement" as const, endsConversation: false };
  return { turnKind: "report_or_narration" as const, endsConversation: false };
}

function briefing(): ShowrunnerBriefing {
  return {
    purpose: "evening_debrief",
    businessDate: TODAY,
    weekday: "Tuesday",
    objective: "maximize sales in Silver Lake",
    weekPlan: null,
    today: [],
    tomorrow: [],
    developments: [],
    pendingDecision: null,
    adaptations: [],
    uncertain: [],
    weekToDate: { reportedOutcomes: [], planChanges: [] },
    driverDayLine: null,
    gameState: { ...gameMasterView(), readForDriverId: "adam-admin" },
    goal: GOAL,
  };
}

type Harness = {
  deps: ClaireV2PrimaryDeps;
  clock: { ms: number };
  showrunner: ReturnType<typeof vi.fn>;
  executeGrant: ReturnType<typeof vi.fn>;
  grants: ExecutiveActionGrant[];
};

function harness(): Harness {
  const clock = { ms: START_MS };
  const grants: ExecutiveActionGrant[] = [];
  const replies = ["Got it. How did the Opus drop go?", "Noted. When does the Instagram ad go live?", "Anything else from today?"];
  const showrunner = vi.fn(async ({ state, utterance }: { state: never; utterance: string }) => ({
    state,
    end: false,
    // What the evening_debrief conductor said on 2026-10-20 to the dictated example.
    speak: /hit 3 locations/i.test(utterance) ? "Which three buildings are you hitting tomorrow?" : replies.shift() ?? "Okay.",
  }));
  // The real adapter's propose path, so a lead offer is held exactly as in prod.
  const executeGrant = vi.fn(async (grant: ExecutiveActionGrant, state: ClaireV2PrimaryState): Promise<ClaireTurnResult> => {
    grants.push(grant);
    if (grant.actionClass === "commit_briefing") {
      state.pendingBriefing = null;
      return {
        speak: "",
        receiptBackedCommit: "Saved. Pitch Wilshire Vermont and The Chadwick is on tomorrow's Day Line.",
        mutationReceipts: [{ claimedState: "created", entityId: "c-1", statement: "Pitch Wilshire Vermont and The Chadwick" } as never],
        kind: "briefing_saved",
        actionIds: ["c-1"],
      };
    }
    return executeGrantBoundLegacyAdapter({
      grant,
      state,
      tenantId: "laundry_farm",
      operatorUserId: "adam-admin",
      dayDirectorActorId: "42",
      conversationKey: "claire-call:3b15eb7a",
      timeZone: "America/Los_Angeles",
      surface: "voice",
      now: new Date(clock.ms),
    });
  });
  // A speaking organ that phrases V2's lead plan faithfully (the real one is a model).
  const speak = vi.fn(async (input: { utterance: string; retrievedEvidence?: Array<{ source: string; text: string }> }) => {
    const plan = input.retrievedEvidence?.find(item => item.source.startsWith("brain_v2_lead_plan"));
    return plan ? plan.text : `Composed reply to: ${input.utterance}`;
  });
  const deps: ClaireV2PrimaryDeps = {
    now: () => new Date(clock.ms),
    speak: speak as never,
    interpretPerception: async ({ utterance }) => prodReading(utterance),
    planBusinessQuery: undefined,
    liveDeps: { business },
    executeGrant: executeGrant as never,
    routeWeekly: vi.fn(async () => null),
    beginWeekly: vi.fn(async () => ""),
    ingestDaphne: vi.fn(async () => ({ status: "persisted" })),
    capturePreference: vi.fn(async () => ({ status: "disabled" as const, corrections: [], observationIds: [], readbackVerified: false })) as never,
    loadDaphneGuidance: vi.fn(async () => null),
    commitPendingDisclosures: vi.fn(async () => undefined),
    showrunner: showrunner as never,
    legacyShadow: null,
  };
  return { deps, clock, showrunner, executeGrant, grants };
}

function turn(state: ClaireV2PrimaryState, utterance: string, allowFragmentWait = false): ClaireV2PrimaryInput {
  return {
    authority: { authorized: true, tenantId: "laundry_farm", operatorUserId: "adam-admin", role: "owner", basis: "verified_membership" },
    tenantId: "laundry_farm",
    operatorUserId: "adam-admin",
    dayDirectorActorId: "42",
    surface: "voice",
    utterance,
    state,
    conversationKey: "claire-call:3b15eb7a-f41a-4b2a-969d-403c0ab73d48",
    conversationId: "3b15eb7a-f41a-4b2a-969d-403c0ab73d48",
    timeZone: "America/Los_Angeles",
    businessDate: TODAY,
    brief: null,
    context,
    allowFragmentWait,
  };
}

function scheduledState(opening: string): ClaireV2PrimaryState {
  return {
    showrunner: {
      purpose: "evening_debrief",
      tenantId: "laundry_farm",
      canonicalOperatorId: "operator:adam",
      operatorUserId: "adam-admin",
      dayDirectorActorId: "42",
      dayDirectorActorIds: ["42"],
      timeZone: "America/Los_Angeles",
      businessDate: TODAY,
      briefing: briefing(),
      captured: { missionUpdates: [], developments: [], readinessNeeds: [] },
      replan: null,
      turns: 0,
    } as never,
    history: [{ speaker: "claire", text: opening, at: START_MS - 1_000, delivery: "generated" }],
  };
}

const NO_SAVE = /\b(?:I(?:'ve| have)? (?:added|saved|scheduled|put)|it'?s on (?:the|your|tomorrow'?s) Day Line|locked in|Saved\.)/i;

describe("W1 acceptance — the 2026-10-20 evening debrief, replayed", () => {
  let h: Harness;
  let state: ClaireV2PrimaryState;
  let opening: string;
  const claireLines: string[] = [];

  beforeEach(() => {
    h = harness();
    opening = showrunnerOpening(briefing());
    state = scheduledState(opening);
    claireLines.length = 0;
    claireLines.push(opening);
  });

  async function say(utterance: string, gapMs: number, allowFragmentWait = false) {
    h.clock.ms += gapMs;
    const result = await runClaireV2PrimaryTurn(turn(state, utterance, allowFragmentWait), h.deps);
    if (result.speak) claireLines.push(result.speak);
    return result;
  }

  it("leads the whole call: goal first, a plan with buildings and the game move, no interview, no false save", async () => {
    // The opening names the goal before Adam ever raises it, macro goal over the week's focus.
    expect(opening.indexOf("get to 50 active customers")).toBeGreaterThan(-1);
    expect(opening).toMatch(/It started at 23; I don't have a verified current count\./);
    expect(opening).toMatch(/This week's focus inside that is maximize sales in Silver Lake\./);
    expect(opening.indexOf("50 active customers")).toBeLessThan(opening.indexOf("Silver Lake"));
    expect(opening).toMatch(/Wilshire Vermont or The Chadwick: two left for the Colosseum/);

    // ── The opening report, split by the phone into three fragments, is one thought. ──
    // Prod released this first fragment and answered it; the next two are what folding fixes.
    await say("I dropped off the bags at Opus and bought supplies for kids treats.", 20_000, false);
    const second = await say("And for OPUS LA And I am currently about to run an advertisement for Laundry Farm.", 2_000, true);
    expect(second.listenOnly).toBe(true);
    await say("On Instagram, so I am preparing that currently.", 2_500, false);
    expect(h.showrunner).toHaveBeenCalledTimes(2);
    expect(h.showrunner.mock.calls[1]![0].utterance).toMatch(/OPUS LA[\s\S]*Instagram/);

    // ── (a) "What do you have for me tomorrow? What do you want me to do?" ──
    const plan = await say("What do you have for me tomorrow? What do you want me to do?", 30_000);
    expect(plan.speak).not.toMatch(/recorded evidence shows|business date|title:/i);
    expect(plan.brainV2.composition).toBe("composed");
    expect(h.showrunner).toHaveBeenCalledTimes(2); // the conductor's analysis reader never ran
    // The goal was already said in the opening, so it is not recited again.
    expect(plan.speak).not.toMatch(/The goal is to get to 50 active customers/);
    expect(plan.speak).toMatch(/Tomorrow, the first move is follow up with The Louise\./);
    expect(plan.speak).toMatch(/After that: Los Feliz Towers follow-up, visit sageLA and visit Argyle House\./);
    expect(plan.speak.match(/Los Feliz Towers/g)).toHaveLength(1);
    expect(plan.speak).not.toMatch(/The Louise Los Feliz/);
    // Where Adam is in Kingdom 1, reconciled: three of five, two left, five more beyond.
    expect(plan.speak).toMatch(/Kingdom 1, The Colosseum: you've pitched three of the five Greystar targets/);
    expect(plan.speak).toMatch(/Wilshire Vermont or The Chadwick next, two left for the Colosseum; five more Greystar buildings beyond it\./);
    expect(plan.speak).not.toMatch(/\bseven\b/i);
    // A stage with no server record is "no record", never done.
    expect(plan.speak).toMatch(/No record yet for the Coastal Market Rook hunt, the Wayward contact gate and companions earned\./);
    expect(plan.speak).not.toMatch(/(?:Coastal Market|Wayward|Rook)[^.]*\b(?:done|complete|completed|caught)\b/i);
    // The Day Line move is a question, held pending, and nothing is written.
    // Named, so a yes is a yes to exactly this move.
    expect(plan.speak).toMatch(/Want me to put that on tomorrow's Day Line: pitch Wilshire Vermont and The Chadwick in person\?$/);
    expect(plan.speak).not.toMatch(NO_SAVE);
    expect(h.grants.map(grant => [grant.actionClass, grant.authorityBasis])).toEqual([["propose_day_line", "standing_goal_policy"]]);
    expect(state.pendingBriefing?.parsed?.items?.map(item => [item.title, item.businessDate])).toEqual([
      ["Pitch Wilshire Vermont and The Chadwick in person (Greystar Koreatown)", TOMORROW],
    ]);

    // ── "What is my goal… tell me what to do": goal-led, still no recital. ──
    const goal = await say("What is my goal? Tell me what to do.", 30_000);
    expect(goal.brainV2.composition).toBe("composed");
    expect(goal.speak).toMatch(/^Your goal on record is "Get to 50 active customers"; you started at 23, and I still have no verified current count\./);
    expect(goal.speak).not.toMatch(NO_SAVE);

    // ── (b) The dictated example is not Adam's commitment and gets no "which three?". ──
    const grantsBeforeFeedback = h.grants.length;
    const example = await say(
      "Tomorrow you're gonna hit 3 locations in person. Open up the first Kingdom in the driver app and complete it.",
      30_000
    );
    expect(example.speak).not.toMatch(/which (?:three|3)|which buildings|which locations/i);
    expect(h.showrunner).toHaveBeenCalledTimes(2);
    // Role feedback and dictated lines get the plan, never a grant of their own.
    expect(h.grants).toHaveLength(grantsBeforeFeedback);
    expect(h.grants.every(grant => grant.actionClass === "propose_day_line" && grant.authorityBasis === "standing_goal_policy")).toBe(true);
    expect(JSON.stringify(state.pendingBriefing ?? {})).not.toMatch(/hit 3 locations|Open up the first Kingdom/i);

    // ── (c) "You should already know them… coded in you" is not a correctness challenge. ──
    expect(state.claimReceipts?.length).toBeGreaterThan(0); // a receipt existed, as in prod
    const coded = await say("You should already know them. I need to have that coded in you.", 30_000);
    expect(coded.brainV2.businessIntent).not.toBe("correctness_challenge");
    expect(coded.speak).not.toMatch(/can't freshly verify|That is what you intend to do/i);
    expect(coded.speak).not.toMatch(NO_SAVE);
    expect(h.grants).toHaveLength(grantsBeforeFeedback);
    // No day named on an evening call means tomorrow; the same offer is not re-asked.
    expect(coded.speak).not.toMatch(/today's Day Line|Want me to put/);
    expect(state.pendingBriefing?.parsed?.items?.[0]?.businessDate).toBe(TOMORROW);

    // Nothing was written without a yes.
    expect(h.grants.some(grant => grant.actionClass === "commit_briefing" || grant.actionClass === "commit_day_line")).toBe(false);

    // No Claire sentence repeats within the call.
    const sentences = claireLines.flatMap(line => line.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? []).map(s => s.trim().toLowerCase());
    const repeated = sentences.filter((sentence, index) => sentence.length > 12 && sentences.indexOf(sentence) !== index);
    expect(repeated).toEqual([]);
    if (process.env.W1_PRINT) console.log(`LINES\n${claireLines.join("\n---\n")}`);
  });

  it("a plain yes to the offered move commits it through the pending lifecycle", async () => {
    await say("What do you have for me tomorrow? What do you want me to do?", 30_000);
    expect(state.pendingBriefing).toBeTruthy();
    const yes = await say("Yes.", 10_000);
    expect(h.grants.map(grant => grant.actionClass)).toEqual(["propose_day_line", "commit_briefing"]);
    expect(h.grants[1]!.authorityBasis).toBe("pending_lifecycle");
    expect(yes.speak).toMatch(/Saved\. Pitch Wilshire Vermont and The Chadwick/);
  });

  it("responsibility feedback with full evidence still mints no Day Line grant", async () => {
    const result = await say("You're supposed to be proactively preparing the work.", 30_000);
    expect(h.grants).toEqual([]);
    expect(result.speak).toMatch(/Wilshire Vermont or The Chadwick next/);
  });

  it("a lead-plan grant can never commit by itself", async () => {
    const offer = mintActionGrant({
      actionClass: "commit_day_line",
      scope: { titles: ["Pitch Wilshire Vermont in person"], businessDate: TOMORROW },
      authorityBasis: "standing_goal_policy",
      sourceTurnAssembledText: "What do you have for me tomorrow?",
      expiresAtMs: Date.now() + 60_000,
      constraints: { mutationAllowed: true, shadowOnly: false },
    });
    await expect(
      executeGrantBoundLegacyAdapter({
        grant: offer,
        state: {},
        tenantId: "laundry_farm",
        operatorUserId: "adam-admin",
        dayDirectorActorId: "42",
        conversationKey: "k",
        timeZone: "America/Los_Angeles",
        surface: "voice",
      })
    ).rejects.toThrow(/may propose, never commit/);
  });
});

describe("W1 — the game master view reports every stage, and 'no record' is never 'done'", () => {
  it("keeps every stage present when the stores are empty", () => {
    const view = projectGameMasterView({
      driverId: "adam-admin",
      kingdoms: [],
      mission: null,
      domainProgression: { readable: true, row: null },
      companions: [],
      chapters: [],
      hiddenGames: [],
    });
    for (const stage of [view.kingdoms, view.day1TenDoors, view.colosseum, view.domainProgression, view.companions, view.chapters, view.hiddenGames, view.levels.centuryParkEast, view.levels.beverlyHills, view.levels.channel382]) {
      expect(stage).toMatchObject({ record: "none" });
    }
    expect(view.activeKingdom).toBeNull();
  });

  it("derives Kingdom 1 complete only from all five Colosseum outcomes, in memory, without a write", () => {
    const mission = day1Mission() as { outcomes: Record<string, string> };
    mission.outcomes = { ...mission.outcomes, "wilshire-vermont": "pitched", "the-chadwick": "couldnt_reach" };
    const view = projectGameMasterView({ driverId: "adam-admin", kingdoms: kingdomRows(), mission: mission as never });
    const kingdoms = view.kingdoms as Array<{ kingdomId: string; status: string; derivedStatus: string }>;
    expect(kingdoms[0]).toMatchObject({ kingdomId: "kingdom-1-colosseum", status: "active", derivedStatus: "complete" });
  });
});

describe("W1 — call hygiene units", () => {
  it("(a) an unanswered question is asked at most once more, then dropped", () => {
    const asked = ["Did any of The Louise, Los Feliz Towers or sageLA get done?"];
    const again = dropRepeatedQuestions("Okay. Did any of The Louise, Los Feliz Towers or sageLA get done?", asked);
    expect(again.speak).toMatch(/\?$/);
    const third = dropRepeatedQuestions("Got it. Did The Louise, Los Feliz Towers or sageLA get done today?", [...asked, ...again.asked]);
    expect(third.speak).toBe("Got it.");
    const which = ["Which three buildings are you hitting?", "Which three buildings will you hit?"];
    expect(dropRepeatedQuestions("Which three buildings are you hitting tomorrow?", which).speak).toBe("");
  });

  it("(b) a fragment opening with And/On/So within six seconds folds into the thought just released", () => {
    const state: ClaireV2PrimaryState = {
      history: [{ speaker: "operator", text: "I bought supplies for kids treats.", at: 1_000 }],
    };
    const folded = assembleV2Thought({ surface: "voice", utterance: "And for OPUS LA.", state, allowFragmentWait: true, nowMs: 4_000 });
    expect(folded).toEqual({ kind: "hold", combined: "I bought supplies for kids treats. And for OPUS LA." });
    const released = assembleV2Thought({ surface: "voice", utterance: "On Instagram.", state, allowFragmentWait: false, nowMs: 6_000 });
    expect(released).toMatchObject({ kind: "release", utterance: "I bought supplies for kids treats. And for OPUS LA. On Instagram." });
    // Outside the window, or on the Desk, nothing folds.
    const late: ClaireV2PrimaryState = { history: [{ speaker: "operator", text: "Earlier thing.", at: 1_000 }] };
    expect(assembleV2Thought({ surface: "voice", utterance: "And another.", state: late, allowFragmentWait: false, nowMs: 20_000 })).toMatchObject({
      kind: "release",
      utterance: "And another.",
    });
    expect(assembleV2Thought({ surface: "text", utterance: "And another.", state: late, nowMs: 2_000 })).toMatchObject({ utterance: "And another." });
  });

  it("(c) the Day Line is deduped by normalized title before it is spoken", () => {
    const stop = (id: string, title: string) => ({
      id,
      title,
      status: "planned",
      timeLabel: "",
      executable: true,
      completion: "unfinished",
      needsApproval: false,
      evidence: null,
    });
    const line = {
      read: "read",
      businessDate: TODAY,
      stops: [
        stop("a", "Los Feliz Towers follow-up"),
        stop("b", "Los Feliz Towers follow-up"),
        stop("c", "The Louise"),
        stop("d", "The Louise Los Feliz"),
        stop("e", "Visit sageLA"),
      ],
      designatedMission: null,
      fieldBlockers: [],
      pendingApproval: [],
      omissions: [],
    } as unknown as DriverDayLineCallFacts;
    const spoken = speakDriverDayLineCall(line, "evening_debrief");
    expect(spoken).toBe("Still open: Los Feliz Towers follow-up, The Louise and Visit sageLA.");
  });
});

/**
 * 2026-10-27 evening call, replayed on the same harness. Adam: "I'm, like,
 * overwhelmed right now. And I feel, like, mentally drained. So my hope is that
 * you will tell me what to do." Prod answered with 459 characters, two
 * suggestions and two questions, then put the follow-up on TODAY's line and kept
 * it there after "I'll do it tomorrow."
 */
describe("2026-10-27 — relief and deferral on the evening call", () => {
  it("relief: one move in one breath, no question back, no Day Line offer", async () => {
    const h = harness();
    const state = scheduledState(showrunnerOpening(briefing()));
    const result = await runClaireV2PrimaryTurn(
      turn(state, "I'm, like, overwhelmed right now. And I feel, like, mentally drained. So my hope is that you will tell me what to do tomorrow."),
      h.deps
    );
    expect(result.brainV2.businessIntent).toBe("broad_briefing");
    expect(result.speak).toBe("One thing tomorrow: follow up with The Louise. That's it; the rest can wait.");
    expect(result.speak).not.toMatch(/\?/);
    expect(result.speak).not.toMatch(/After that|Colosseum|50 active customers/);
    expect(h.grants).toHaveLength(0);
    expect(state.pendingBriefing ?? null).toBeNull();
  });

  it("a composed relief reply is capped to two sentences and zero questions in code", async () => {
    const h = harness();
    // A speaking organ that ignores the brevity instruction, as the 10-27 model did.
    (h.deps as { speak: unknown }).speak = async () =>
      "One thing tomorrow: follow up with The Louise. Dana has been overdue since August. Tomorrow, pitch Wilshire Vermont in person. Want me to draft the email? Want me to put that on tomorrow's Day Line?";
    const state = scheduledState(showrunnerOpening(briefing()));
    const result = await runClaireV2PrimaryTurn(turn(state, "I'm overwhelmed. Just tell me what to do tomorrow."), h.deps);
    expect(result.speak).toBe("One thing tomorrow: follow up with The Louise. Dana has been overdue since August.");
  });

  it("deferral: 'I'll do it tomorrow' moves what Claire just placed, with a receipt", async () => {
    const h = harness();
    const move = vi.fn(async ({ commitmentIds }: { commitmentIds: string[] }) => commitmentIds);
    h.deps.moveDayLineCommitments = move;
    const state = scheduledState(showrunnerOpening(briefing()));
    state.recentDayLineCommits = [{ ids: ["c-dana"], title: "Follow up with Dana", businessDate: TODAY, atMs: START_MS - 30_000 }];
    const result = await runClaireV2PrimaryTurn(turn(state, "Yeah. I'll do it tomorrow."), h.deps);
    expect(move).toHaveBeenCalledWith({ commitmentIds: ["c-dana"], toBusinessDate: TOMORROW });
    expect(result.speak).toBe("Moved to tomorrow: Follow up with Dana.");
    expect(state.recentDayLineCommits?.[0]?.businessDate).toBe(TOMORROW);
    expect(h.grants).toHaveLength(0);
  });

  it("deferral moves only the item meant, not everything placed this half hour", async () => {
    const h = harness();
    const move = vi.fn(async ({ commitmentIds }: { commitmentIds: string[] }) => commitmentIds);
    h.deps.moveDayLineCommitments = move;
    const state = scheduledState(showrunnerOpening(briefing()));
    state.recentDayLineCommits = [
      { ids: ["c-dana"], title: "Follow up with Dana", businessDate: TODAY, atMs: START_MS - 120_000 },
      { ids: ["c-opus"], title: "Pickup at OPUS", businessDate: TODAY, atMs: START_MS - 90_000 },
      { ids: ["c-ad"], title: "Post the Instagram ad", businessDate: TODAY, atMs: START_MS - 30_000 },
    ];
    // Named: the Dana one, even though two later rows were placed after it.
    const named = await runClaireV2PrimaryTurn(turn(state, "I'll send the Dana email tomorrow."), h.deps);
    expect(move).toHaveBeenLastCalledWith({ commitmentIds: ["c-dana"], toBusinessDate: TOMORROW });
    expect(named.speak).toBe("Moved to tomorrow: Follow up with Dana.");
    expect(state.recentDayLineCommits.map(c => [c.ids[0], c.businessDate])).toEqual([
      ["c-dana", TOMORROW],
      ["c-opus", TODAY],
      ["c-ad", TODAY],
    ]);
    // Unnamed: the most recent one only.
    const latest = await runClaireV2PrimaryTurn(turn(state, "Tomorrow."), h.deps);
    expect(move).toHaveBeenLastCalledWith({ commitmentIds: ["c-ad"], toBusinessDate: TOMORROW });
    expect(latest.speak).toBe("Moved to tomorrow: Post the Instagram ad.");
    expect(state.recentDayLineCommits.find(c => c.ids[0] === "c-opus")?.businessDate).toBe(TODAY);
  });

  it("deferral confirms only the rows the table shows moved", async () => {
    const h = harness();
    // Two rows behind one title; the database moves one.
    h.deps.moveDayLineCommitments = vi.fn(async () => ["c-1"]);
    const state = scheduledState(showrunnerOpening(briefing()));
    state.recentDayLineCommits = [{ ids: ["c-1", "c-2"], title: "Follow up with Dana", businessDate: TODAY, atMs: START_MS - 30_000 }];
    const result = await runClaireV2PrimaryTurn(turn(state, "I'll do it tomorrow."), h.deps);
    expect(result.speak).toBe("Part of Follow up with Dana moved to tomorrow; I couldn't move the rest.");
    expect(result.actionIds).toEqual(["c-1"]);
    expect(result.mutationReceipts?.map(r => r.entityId)).toEqual(["c-1"]);
    expect(state.recentDayLineCommits.map(c => [c.ids, c.businessDate])).toEqual([
      [["c-1"], TOMORROW],
      [["c-2"], TODAY],
    ]);
    // A mover that reports nothing moved is never a success.
    h.deps.moveDayLineCommitments = vi.fn(async () => []);
    const none = await runClaireV2PrimaryTurn(turn(state, "Push it to tomorrow."), h.deps);
    expect(none.speak).toBe("I couldn't move that to tomorrow just now.");
  });

  it("one briefing that saves two tasks is remembered per task; naming one moves only that one", async () => {
    const h = harness();
    // The operator states two tasks, Claire proposes, "Yes." commits both rows in one briefing,
    // each with its own receipt, as commitBriefing does.
    h.deps.interpretPerception = async ({ utterance }) =>
      /^yes/i.test(utterance)
        ? { turnKind: "acknowledgement" as const, endsConversation: false }
        : /need to/i.test(utterance)
          ? { turnKind: "work_instruction" as const, endsConversation: false }
          : { turnKind: "unclear" as const, endsConversation: false };
    h.deps.executeGrant = vi.fn(async (grant: ExecutiveActionGrant, state: ClaireV2PrimaryState): Promise<ClaireTurnResult> => {
      h.grants.push(grant);
      if (grant.actionClass === "propose_day_line") {
        state.pendingBriefing = { parsed: { items: [{ kind: "new_work", title: grant.scope.titles?.[0] ?? "work" }] } as never, createdAt: Date.now() };
        return { speak: "Want both on today's Day Line?", kind: "briefing_proposed", actionIds: [] };
      }
      state.pendingBriefing = null;
      return {
        speak: "",
        receiptBackedCommit: "Saved. Follow up with Dana and Pickup at OPUS are on today's Day Line.",
        mutationReceipts: [
          { claimedState: "created", entityId: "c-dana", statement: "Follow up with Dana" },
          { claimedState: "created", entityId: "c-opus", statement: "Pickup at OPUS" },
        ] as never,
        kind: "briefing_saved",
        actionIds: ["c-dana", "c-opus"],
      };
    }) as never;
    const move = vi.fn(async ({ commitmentIds }: { commitmentIds: string[] }) => commitmentIds);
    h.deps.moveDayLineCommitments = move;
    const state: ClaireV2PrimaryState = { history: [] };
    await runClaireV2PrimaryTurn(turn(state, "I need to follow up with Dana and do the pickup at OPUS."), h.deps);
    h.clock.ms += 10_000;
    await runClaireV2PrimaryTurn(turn(state, "Yes."), h.deps);
    expect(h.grants.map(grant => grant.actionClass)).toEqual(["propose_day_line", "commit_briefing"]);
    expect(state.recentDayLineCommits?.map(c => [c.ids, c.title])).toEqual([
      [["c-dana"], "Follow up with Dana"],
      [["c-opus"], "Pickup at OPUS"],
    ]);
    h.clock.ms += 30_000;
    const deferred = await runClaireV2PrimaryTurn(turn(state, "I'll send the Dana email tomorrow."), h.deps);
    expect(move).toHaveBeenCalledTimes(1);
    expect(move).toHaveBeenCalledWith({ commitmentIds: ["c-dana"], toBusinessDate: TOMORROW });
    expect(deferred.speak).toBe("Moved to tomorrow: Follow up with Dana.");
  });

  it("deferral naming a task Claire did not place moves nothing", async () => {
    const h = harness();
    const move = vi.fn(async ({ commitmentIds }: { commitmentIds: string[] }) => commitmentIds);
    h.deps.moveDayLineCommitments = move;
    const state = scheduledState(showrunnerOpening(briefing()));
    state.recentDayLineCommits = [{ ids: ["c-opus"], title: "Pickup at OPUS", businessDate: TODAY, atMs: START_MS - 30_000 }];
    const result = await runClaireV2PrimaryTurn(turn(state, "I'll do the Louise email tomorrow."), h.deps);
    expect(move).not.toHaveBeenCalled();
    expect(result.speak).toBe("I didn't put that on today's line on this call, so I left the line as it is.");
    expect(state.recentDayLineCommits[0]?.businessDate).toBe(TODAY);
  });

  it("deferral without a mover never claims the move", async () => {
    const h = harness();
    const state = scheduledState(showrunnerOpening(briefing()));
    state.recentDayLineCommits = [{ ids: ["c-dana"], title: "Follow up with Dana", businessDate: TODAY, atMs: START_MS - 30_000 }];
    const result = await runClaireV2PrimaryTurn(turn(state, "I'll do it tomorrow."), h.deps);
    expect(result.speak).toBe("I couldn't move that to tomorrow just now.");
  });
});
