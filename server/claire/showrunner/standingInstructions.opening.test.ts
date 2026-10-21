/**
 * The next call obeys what the operator said on the last one (production audit 2026-10-13 .. 2026-10-20):
 * - 10-18: "ask me about that on the Sunday 5 to 7 PM call" -> not raised on any other call.
 * - 10-19: Claire promised the open property visits for the morning -> the morning opening carries them.
 * - 10-13 / 10-20: "you're the chief of staff" -> every call opens with the goal and the plan.
 * - 10-19: "I want that on every call" -> one grounded encouraging sentence.
 */
import { describe, expect, it, vi } from "vitest";
import {
  captureStandingInstructions,
  inMemoryStandingInstructionStore,
} from "../../agents/daphne/standingInstructions";
import {
  FIXTURE_CHIEF_OF_STAFF,
  FIXTURE_ENCOURAGEMENT,
  FIXTURE_SUNDAY_REVIEW,
} from "../../agents/daphne/standingInstructions/productionFixtures";
import { inMemoryPreparedItemStore } from "../../agents/persistentOperator/preparedItems";
import { reconcileSpokenPromises } from "../promiseReconciler";
import type { DriverDayLineCallFacts, DriverDayLineStopFact } from "./driverDayLineCall";
import {
  buildShowrunnerBriefing,
  dayLineWithoutHeldTopics,
  loadPreparedItemsForCall,
  openingEncouragement,
  showrunnerOpening,
  type ShowrunnerBriefing,
} from "./showrunnerBriefing";
import { runShowrunnerTurn, type ShowrunnerCallState } from "./showrunnerTurn";

const TZ = "America/Los_Angeles";
const identity = { tenantId: "default", canonicalOperatorId: "adam-admin", dayDirectorActorId: "1", dayDirectorActorIds: ["1"], canonicalOpenId: "adam-admin", membership: { source: "owner", canonical: "owner" } } as never;
const resolver = async () => ({ ok: true as const, identity: { canonicalOperatorId: "adam-admin" } }) as never;
const noObservation = async () => ({}) as never;

const stop = (id: string, title: string, over: Partial<DriverDayLineStopFact> = {}): DriverDayLineStopFact => ({
  id, title, status: "upcoming", timeLabel: "Flexible", executable: true, completion: "unfinished", needsApproval: false, evidence: null, ...over,
});
const dayLine = (stops: DriverDayLineStopFact[]): DriverDayLineCallFacts => ({
  read: "read", businessDate: "2026-10-19", stops, designatedMission: null, fieldBlockers: [], pendingApproval: [], omissions: [],
});
const LOUISE = stop("fu-louise", "Follow up with The Louise (overdue)", { timeLabel: "Overdue" });
const PICKUP = stop("pickup-1", "Pickup at OPUS");

async function adamsRules() {
  const store = inMemoryStandingInstructionStore();
  const cap = (turnId: string, utterance: string, priorClaireTurn?: string) =>
    captureStandingInstructions(
      { tenantId: "default", operatorUserId: "adam-admin", conversationId: "c", turnId, utterance, priorClaireTurn },
      { resolveIdentity: resolver, store, recordObservation: noObservation }
    );
  await cap("a", FIXTURE_ENCOURAGEMENT.utterance, FIXTURE_ENCOURAGEMENT.priorClaireTurn);
  await cap("b", FIXTURE_SUNDAY_REVIEW.utterance, FIXTURE_SUNDAY_REVIEW.priorClaireTurn);
  await cap("c", FIXTURE_CHIEF_OF_STAFF.utterance);
  return store.listActive({ tenantId: "default", canonicalOperatorId: "adam-admin" });
}

const getDay = (async () => ({ commitments: [] })) as never;

function briefingFor(purpose: "morning_readiness" | "evening_debrief", now: Date, line: DriverDayLineCallFacts, extra: Parameters<typeof buildShowrunnerBriefing>[0] extends infer T ? Partial<T> : never = {}) {
  return buildShowrunnerBriefing({
    identity,
    purpose,
    timeZone: TZ,
    now,
    getDay,
    loadDriverDayLine: async () => line,
    loadPreparedItems: async () => [],
    ...extra,
  } as never);
}

describe("the next call's briefing carries the saved rules", () => {
  it("the evening briefing holds the Louise item off a Monday and the opening never says it", async () => {
    const rules = await adamsRules();
    const monday = new Date("2026-10-20T01:00:00Z"); // Mon 6 PM PT
    const briefing = await briefingFor("evening_debrief", monday, dayLine([LOUISE, PICKUP]), { loadStandingInstructions: async () => rules });
    expect(briefing.standing?.section).toContain("OPERATOR STANDING INSTRUCTIONS");
    expect(briefing.standing?.heldTopics).toEqual(["overdue_followups"]);
    const opening = showrunnerOpening(briefing);
    expect(opening).not.toMatch(/Louise/i);
    expect(opening).toContain("Pickup at OPUS");
  });

  it("inside the Sunday 5 to 7 PM window the same item is raised", async () => {
    const rules = await adamsRules();
    const sunday = new Date("2026-10-19T00:30:00Z"); // Sun 5:30 PM PT
    const briefing = await briefingFor("evening_debrief", sunday, dayLine([LOUISE, PICKUP]), { loadStandingInstructions: async () => rules });
    expect(briefing.standing?.askNowTopics).toEqual(["overdue_followups"]);
    expect(showrunnerOpening(briefing)).toMatch(/Louise/);
  });

  it("without the rule the old opening is unchanged", async () => {
    const briefing = await briefingFor("evening_debrief", new Date("2026-10-20T01:00:00Z"), dayLine([LOUISE, PICKUP]), { loadStandingInstructions: async () => [] });
    expect(briefing.standing?.section).toBeNull();
    expect(showrunnerOpening(briefing)).toMatch(/Louise/);
    expect(showrunnerOpening(briefing)).toMatch(/How did it go\?$/);
  });

  it("an unreadable rule store never blocks the call", async () => {
    const briefing = await briefingFor("evening_debrief", new Date("2026-10-20T01:00:00Z"), dayLine([PICKUP]), {
      loadStandingInstructions: async () => { throw new Error("db down"); },
    });
    expect(briefing.standing?.section).toBeNull();
    expect(showrunnerOpening(briefing)).toContain("Pickup at OPUS");
  });

  it("the showrunner model prompt for the next turn carries the section", async () => {
    const rules = await adamsRules();
    const briefing = await briefingFor("evening_debrief", new Date("2026-10-20T01:00:00Z"), dayLine([PICKUP]), { loadStandingInstructions: async () => rules });
    const state: ShowrunnerCallState = {
      purpose: "evening_debrief", tenantId: "default", canonicalOperatorId: "adam-admin", operatorUserId: "adam-admin",
      dayDirectorActorId: "1", dayDirectorActorIds: ["1"], timeZone: TZ, businessDate: "2026-10-19", briefing,
      captured: { missionUpdates: [], developments: [], readinessNeeds: [] }, replan: null, turns: 0,
    };
    const invoke = vi.fn(async () => ({
      choices: [{ message: { content: JSON.stringify({ speak: "Okay.", operatorIsDone: false, missionUpdates: [], developments: [], readinessNeeds: [], planEdits: [] }) } }],
    })) as never;
    await runShowrunnerTurn({ state, history: [], utterance: "It went fine.", sourceEventId: "e", conversationKey: "k", invoke, record: async () => undefined, replan: async () => null, salesHold: async () => null });
    const system = ((invoke as unknown as { mock: { calls: Array<[{ messages: Array<{ role: string; content: string }> }]> } }).mock.calls[0]![0].messages[0]!.content);
    expect(system).toContain("OPERATOR STANDING INSTRUCTIONS");
    expect(system).toContain("ENCOURAGEMENT");
    expect(system).toContain("HOLD");
    expect(system).toContain("open this call with the goal and the plan");
  });
});

describe("the morning opening keeps last night's promise", () => {
  const scope = { tenantId: "default", canonicalOperatorId: "adam-admin" };
  const campaign = (names: string[]) => async () =>
    ({ campaignName: "Colosseum", active: names.length > 0, completedCount: 3, remainingCount: names.length, totalCount: 10, remainingTargets: names.map(name => ({ name, address: null })) }) as never;

  it("the evening promise becomes a prepared row; the morning opening offers those visits and asks which", async () => {
    const store = inMemoryPreparedItemStore();
    const spoken = await reconcileSpokenPromises(
      "Tomorrow morning I'll have the open property visits ready so you can choose one.",
      { scope: { ...scope, dayDirectorActorId: "1", dayDirectorActorIds: ["1"] }, conversationKey: "evening-call", now: new Date("2026-10-20T03:00:00Z"), timeZone: TZ },
      { store, loadCampaign: campaign(["Elan", "Solaire", "The Edge", "Vue"]) }
    );
    expect(spoken.prepared).toHaveLength(1);

    const morning = new Date("2026-10-20T15:05:00Z"); // Tue 8:05 AM PT
    const prepared = await loadPreparedItemsForCall({ identity, businessDate: "2026-10-20" }, { store, loadCampaign: campaign(["Elan", "Solaire", "The Edge", "Vue"]) });
    const briefing = await briefingFor("morning_readiness", morning, dayLine([PICKUP]), { loadStandingInstructions: async () => [], loadPreparedItems: async () => prepared });
    const opening = showrunnerOpening({ ...briefing, objective: "Get to 50 active customers" });
    expect(opening).toContain("Last night I said I'd have the open property visits ready: Elan, Solaire and The Edge (4 open in all). Which one do you want first?");
    expect(opening).not.toContain("Are you ready to get going?");
  });

  it("a visit done since last night is not offered, and nothing open means no stale offer", async () => {
    const store = inMemoryPreparedItemStore();
    await store.upsert({
      ...scope, kind: "property_visit_choice", forBusinessDate: "2026-10-20", promiseText: "p", sourceConversationKey: "c",
      payload: { targets: [{ name: "Elan", address: null }, { name: "Solaire", address: null }], remainingCount: 2, totalCount: 10 },
    });
    const live = await loadPreparedItemsForCall({ identity, businessDate: "2026-10-20" }, { store, loadCampaign: campaign(["Solaire"]) });
    expect(live[0]!.targets.map(t => t.name)).toEqual(["Solaire"]);
    expect(await loadPreparedItemsForCall({ identity, businessDate: "2026-10-20" }, { store, loadCampaign: campaign([]) })).toEqual([]);
    expect(await loadPreparedItemsForCall({ identity, businessDate: "2026-10-20" }, { store, loadCampaign: async () => null })).toEqual([]);
  });

  it("consumed items are not offered again", async () => {
    const store = inMemoryPreparedItemStore();
    const item = await store.upsert({
      ...scope, kind: "property_visit_choice", forBusinessDate: "2026-10-20", promiseText: "p", sourceConversationKey: "c",
      payload: { targets: [{ name: "Elan", address: null }], remainingCount: 1, totalCount: 10 },
    });
    await store.markConsumed(scope, [item.id], "appointment:1");
    expect(await loadPreparedItemsForCall({ identity, businessDate: "2026-10-21" }, { store, loadCampaign: campaign(["Elan"]) })).toEqual([]);
  });
});

describe("role feedback and encouragement shape the opening", () => {
  const base = {
    purpose: "evening_debrief", businessDate: "2026-10-20", weekday: "Tuesday", objective: "Get to 50 active customers", weekPlan: null,
    today: [], tomorrow: [{ id: "t1", title: "Greystar visit at Elan", objective: null, status: "open", window: null, note: null }],
    developments: [], pendingDecision: null, adaptations: [], uncertain: [], weekToDate: { reportedOutcomes: [], planChanges: [] },
  } as unknown as ShowrunnerBriefing;

  it("the 'chief of staff' obligation opens the evening wrap with the goal and tomorrow's plan", () => {
    const opening = showrunnerOpening({
      ...base,
      driverDayLine: dayLine([PICKUP]),
      standing: { section: "s", heldTopics: [], askNowTopics: [], encouragement: false, roleObligation: true },
    });
    expect(opening).toContain("This week is about: Get to 50 active customers.");
    expect(opening).toContain("Tomorrow's plan: Greystar visit at Elan.");
    expect(opening.indexOf("This week is about")).toBeLessThan(opening.indexOf("Still open"));
  });

  it("encouragement is one grounded sentence from verified facts, or nothing", () => {
    const done = stop("d1", "Pickup at OPUS", { status: "completed", completion: "completed_with_evidence", executable: false, evidence: "scan" });
    const evening = {
      ...base,
      driverDayLine: dayLine([done, PICKUP]),
      standing: { section: "s", heldTopics: [], askNowTopics: [], encouragement: true, roleObligation: false },
    } as ShowrunnerBriefing;
    expect(openingEncouragement(evening)).toBe('1 done with proof today, and that is the work that moves "Get to 50 active customers".');
    expect(openingEncouragement({ ...evening, driverDayLine: dayLine([PICKUP]) })).toBeNull();
    expect(openingEncouragement({ ...evening, objective: null })).toBeNull();
    expect(openingEncouragement({ ...evening, standing: { ...evening.standing!, encouragement: false } })).toBeNull();
    const text = showrunnerOpening(evening);
    expect(text).not.toMatch(/!/);
    expect(text).toContain("that is the work that moves");
  });

  it("holding a topic filters only matching items", () => {
    const filtered = dayLineWithoutHeldTopics(dayLine([LOUISE, PICKUP]), ["overdue_followups"]);
    expect(filtered?.stops.map(s => s.id)).toEqual(["pickup-1"]);
    expect(dayLineWithoutHeldTopics(dayLine([LOUISE, PICKUP]), [])?.stops).toHaveLength(2);
  });
});
