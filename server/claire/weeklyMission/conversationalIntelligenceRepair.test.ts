import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { remainingWeekHorizon, type WeeklyDraft } from "../../../shared/weeklyMissionReadiness";
import { runClaireTurn, type ClaireTurnDeps, type ClaireTurnState } from "../turn/claireTurn";
import {
  createMemoryConversationStateStore,
  setClaireConversationStateStoreForTests,
} from "../turn/conversationStateStore";
import {
  advanceWeeklySession,
  capturePrimary,
  isActionablePrimaryCandidate,
} from "./advance";
import { loadWeeklyDossier } from "./dossier";
import { arbitrateWeeklyTurnIntent, routeActiveWeeklySession } from "./route";
import {
  isWeeklySessionValid,
  loadWeeklySession,
  newWeeklySession,
  saveWeeklySession,
  WEEKLY_SESSION_TTL_MS,
  type WeeklyPlanningSession,
} from "./session";

// Monday of test week
const WEEK_START = "2026-09-28";
const TUESDAY = "2026-09-29";
const NOW = new Date("2026-09-29T16:00:00Z"); // Tuesday 09:00 AM Pacific
const TIMEZONE = "America/Los_Angeles";

const SEVEN_DORMANT_CUSTOMERS = [
  { id: "cust_1", name: "Sarah Connor" },
  { id: "cust_2", name: "John Miller" },
  { id: "cust_3", name: "Alice Wong" },
  { id: "cust_4", name: "David Kim" },
  { id: "cust_5", name: "Elena Rostova" },
  { id: "cust_6", name: "Marcus Brody" },
  { id: "cust_7", name: "Chloe Price" },
];

function initialWeeklyDraft(): WeeklyDraft {
  return {
    weekStart: WEEK_START,
    days: [
      {
        businessDate: "2026-09-28",
        weekday: "Monday",
        disposition: "stand_down",
        primary: { text: "Monday plant run", source: "operator_stated", existingCommitmentId: null },
        fixedConstraints: [],
        readinessRequirements: [],
        uncertainty: null,
      },
      {
        businessDate: "2026-09-29",
        weekday: "Tuesday",
        disposition: "primary",
        primary: { text: "Greystar follow up", source: "operator_stated", existingCommitmentId: null },
        fixedConstraints: [],
        readinessRequirements: [],
        uncertainty: null,
      },
      {
        businessDate: "2026-09-30",
        weekday: "Wednesday",
        disposition: "primary",
        primary: null,
        fixedConstraints: [],
        readinessRequirements: [],
        uncertainty: null,
      },
      {
        businessDate: "2026-10-01",
        weekday: "Thursday",
        disposition: "primary",
        primary: null,
        fixedConstraints: [],
        readinessRequirements: [],
        uncertainty: null,
      },
      {
        businessDate: "2026-10-02",
        weekday: "Friday",
        disposition: "primary",
        primary: null,
        fixedConstraints: [],
        readinessRequirements: [],
        uncertainty: null,
      },
    ],
  };
}

describe("Claire Conversational-Intelligence Repair — Production Incident Regression", () => {
  let memoryStore: ReturnType<typeof createMemoryConversationStateStore>;

  beforeEach(() => {
    memoryStore = createMemoryConversationStateStore();
    setClaireConversationStateStoreForTests(memoryStore);
  });

  afterEach(() => {
    setClaireConversationStateStoreForTests(null);
  });

  function createTestFixture(overrides: { failCommit?: boolean } = {}) {
    const state: ClaireTurnState = {
      history: [],
      surfacedRecoveryAccounts: SEVEN_DORMANT_CUSTOMERS,
    };

    const committedReceipts: any[] = [];
    const committedItems: any[] = [];

    const commitMock = vi.fn(async (parsed: any) => {
      if (overrides.failCommit) {
        return {
          added: [],
          completed: [],
          failed: (parsed.items ?? []).map((item: any) => ({ item, error: "persistence_error" })),
          commitmentIds: [],
          receipts: [],
        };
      }
      const added = parsed.items ?? [];
      const receipts = added.map((item: any, idx: number) => ({
        claimId: `claim_write_${idx + 1}`,
        statement: `${item.title} on ${item.businessDate}`,
        entityRef: `action_${idx + 1}`,
        status: "verified",
        provenance: "dayDirector.commitBriefing",
        claimedState: "created",
        writtenTruthStatus: "persisted",
      }));
      const commitmentIds = added.map((_: any, idx: number) => `commitment_dd_${idx + 1}`);
      committedReceipts.push(...receipts);
      committedItems.push(...added);
      return {
        added,
        completed: [],
        failed: [],
        commitmentIds,
        receipts,
      };
    });

    const deps = (extra: Partial<ClaireTurnDeps> = {}): ClaireTurnDeps => ({
      now: () => NOW,
      timeZone: () => TIMEZONE,
      business: {
        now: () => NOW,
        timeZone: () => TIMEZONE,
        plan: async () => null,
        runQuery: vi.fn() as never,
      },
      commitment: vi.fn(async () => ({ kind: "not_applicable" as const })) as never,
      followUp: vi.fn(async () => "Dormant customer recovery.") as never,
      extractModel: null,
      loadExisting: async () => [],
      commit: commitMock as never,
      campaign: async () => null,
      vocabulary: async () => [],
      accounts: async () => [],
      accountHistory: vi.fn() as never,
      commitFollowUp: vi.fn() as never,
      dayWork: vi.fn() as never,
      unpaid: vi.fn() as never,
      searchMemory: vi.fn(async () => []) as never,
      memoryBetween: vi.fn(async () => []) as never,
      encyclopedia: null,
      classifyPriorClaim: (async () => false) as never,
      rerunBusinessQuery: vi.fn() as never,
      classifierBudgetMs: 30,
      ...extra,
    });

    const say = async (utterance: string, extra: Partial<ClaireTurnDeps> = {}) => {
      return runClaireTurn(
        {
          tenantId: "default",
          operatorUserId: "adam",
          dayDirectorActorId: "actor-adam",
          surface: "voice",
          utterance,
          state,
          conversationKey: "call:prod-repair",
          allowFragmentWait: false,
          context: {
            businessDate: TUESDAY,
            actorId: "actor-adam",
            macroGoalKnown: false,
            blockers: [],
            relevantTimeline: [],
          } as never,
        },
        deps(extra)
      );
    };

    return { state, say, commitMock, committedReceipts, committedItems };
  }

  it("reproduces and passes the exact 9-turn production sequence without weekly hijacking", async () => {
    // Step 1: Active in-progress weekly-planning session exists from earlier in the week
    const initialDraft = initialWeeklyDraft();
    const session: WeeklyPlanningSession = newWeeklySession({
      tenantId: "default",
      operatorId: "adam",
      dayDirectorActorId: "actor-adam",
      weekStart: WEEK_START,
      draft: initialDraft,
    });
    session.phase = "interview";
    session.substantiveQuestions = 2;
    session.lastQuestionKind = "primary";
    session.lastQuestionDate = "2026-09-30"; // Wednesday
    await saveWeeklySession(session);

    // Save initial JSON snapshot of weekly draft to verify bit-identical invariance
    const beforeCallWeeklyJson = JSON.stringify(session.draft);

    const fixture = createTestFixture();

    // Step 2: Operator says they dropped off an order and are heading to the dry cleaner
    const turn2 = await fixture.say(
      "I just dropped off an order and I'm on my way to the dry cleaner for another order."
    );
    expect(turn2.speak).not.toMatch(/What owns Thursday|What owns Friday|blocks the week/i);
    expect(turn2.kind).not.toBe("fallback");

    // Step 3: Operator says they're going home afterward because there are no more orders and they need customers
    const turn3 = await fixture.say(
      "After that I'm going home because I have no more orders and I need customers."
    );
    expect(turn3.speak).not.toMatch(/What owns Thursday|What owns Friday|blocks the week/i);

    // Step 4: Claire intelligently surfaced dormant-customer recovery texts (7 customers)
    // Recorded in history
    fixture.state.history!.push({
      speaker: "claire",
      text: "I identified seven dormant customers who haven't ordered in over 60 days. We can send recovery texts to Sarah Connor, John Miller, Alice Wong, David Kim, Elena Rostova, Marcus Brody, and Chloe Price.",
      at: Date.now(),
    });

    // Step 5: Operator asks what “recovery texts” means
    const turn5 = await fixture.say("What does recovery texts mean?");
    expect(turn5.speak).not.toMatch(/What owns Thursday|What owns Friday|blocks the week/i);

    // Step 6: Claire explains it naturally
    fixture.state.history!.push({
      speaker: "claire",
      text: "Recovery texts are short win-back messages offering a discount to re-engage accounts that haven't ordered recently.",
      at: Date.now(),
    });

    // Step 7: Operator says: “I wanna batch them all for today. Great idea.”
    const turn7 = await fixture.say("I wanna batch them all for today. Great idea.");
    // PASS REQUIREMENT: No weekly-planning hijack! No "What owns Thursday?"!
    expect(turn7.speak).not.toMatch(/What owns Thursday|What owns Friday|One thing still blocks the week/i);
    // PASS REQUIREMENT: Raw operator utterance MUST NOT become a task
    expect(turn7.speak).not.toMatch(/I wanna batch them all for today/i);
    // Interpreted as today's dormant-customer recovery work for the 7 identified customers
    expect(fixture.state.pendingBriefing).not.toBeNull();
    const pendingItem = fixture.state.pendingBriefing!.parsed.items[0];
    expect(pendingItem).toBeDefined();
    expect(pendingItem.title).toBe("Send 7 dormant-customer recovery texts");
    expect(pendingItem.businessDate).toBe(TUESDAY);
    expect(pendingItem.executionType).toBe("challenge");

    // Step 8: Operator says: “Put them on the Day Line.”
    const turn8 = await fixture.say("Put them on the Day Line.");
    // PASS REQUIREMENT: Real receipt-backed write before Claire claims success
    expect(fixture.commitMock).toHaveBeenCalledTimes(1);
    expect(fixture.committedReceipts.length).toBeGreaterThan(0);
    expect(turn8.receiptBackedCommit).toBeDefined();
    expect(turn8.receiptBackedCommit).toMatch(/Done\.\s+1 on today's line/i);
    expect(turn8.speak).not.toMatch(/tell me the items again/i);

    // Step 9: Verify persisted weekly draft remains completely bit-identical!
    const afterCallSession = await loadWeeklySession({
      tenantId: "default",
      operatorId: "adam",
      weekStart: WEEK_START,
    });
    expect(afterCallSession).not.toBeNull();
    const afterCallWeeklyJson = JSON.stringify(afterCallSession!.draft);
    expect(afterCallWeeklyJson).toBe(beforeCallWeeklyJson);

    // Unrelated weekly days were not mutated
    expect(afterCallSession!.draft.days.find(d => d.weekday === "Thursday")?.primary).toBeNull();
    expect(afterCallSession!.draft.days.find(d => d.weekday === "Friday")?.primary).toBeNull();
    expect(afterCallSession!.draft.days.find(d => d.weekday === "Wednesday")?.primary).toBeNull();
  });

  it("handles write failure truthfully: retains the 7 items in working memory without asking the operator to repeat them", async () => {
    const fixture = createTestFixture({ failCommit: true });

    fixture.state.history!.push({
      speaker: "claire",
      text: "I identified seven dormant customers. We can send recovery texts to them.",
      at: Date.now(),
    });

    // Propose batch for today
    await fixture.say("I wanna batch them all for today. Great idea.");
    expect(fixture.state.pendingBriefing).not.toBeNull();

    // Confirm write, which fails
    const failTurn = await fixture.say("Put them on the Day Line.");

    // Truthful status communicated
    expect(failTurn.speak).toMatch(/nothing saved|try again/i);
    expect(failTurn.speak).not.toMatch(/tell me the items again/i);

    // CRITICAL REQUIREMENT: Claire retains the intended items in working memory!
    expect(fixture.state.pendingBriefing).not.toBeNull();
    expect(fixture.state.pendingBriefing!.parsed.items[0]?.title).toBe("Send 7 dormant-customer recovery texts");
    expect(fixture.state.surfacedRecoveryAccounts).toHaveLength(7);
  });

  it("unit test: capturePrimary('I wanna batch them all for today. Great idea.') writes nothing durable and leaves draft empty", () => {
    const draft = initialWeeklyDraft();
    const session: WeeklyPlanningSession = newWeeklySession({
      tenantId: "default",
      operatorId: "adam",
      dayDirectorActorId: "actor-adam",
      weekStart: WEEK_START,
      draft,
    });
    session.lastQuestionKind = "primary";
    session.lastQuestionDate = "2026-10-01"; // Thursday

    // Call capturePrimary with the exact utterance from the production incident
    capturePrimary(session, "I wanna batch them all for today. Great idea.");

    const thursday = session.draft.days.find(d => d.businessDate === "2026-10-01");
    expect(thursday?.primary).toBeNull();
    expect(thursday?.uncertainty).toBe("Unconfirmed mission.");
    expect(JSON.stringify(session.draft)).not.toContain("I wanna batch them all for today");
    expect(JSON.stringify(session.draft)).not.toContain("Great idea");
  });

  it("unit test: capturePrimary rejects conversational confusion and questions as tasks", () => {
    const draft = initialWeeklyDraft();
    const session = newWeeklySession({
      tenantId: "default",
      operatorId: "adam",
      dayDirectorActorId: "actor-adam",
      weekStart: WEEK_START,
      draft,
    });
    session.lastQuestionKind = "primary";
    session.lastQuestionDate = "2026-10-01";

    capturePrimary(session, "What blocks the week? What do you mean?");
    expect(session.draft.days.find(d => d.businessDate === "2026-10-01")?.primary).toBeNull();

    capturePrimary(session, "I don't know what you're saying...");
    expect(session.draft.days.find(d => d.businessDate === "2026-10-01")?.primary).toBeNull();

    capturePrimary(session, "One thing still blocks the week. What owns Thursday?");
    expect(session.draft.days.find(d => d.businessDate === "2026-10-01")?.primary).toBeNull();
  });

  describe("adversarial cases", () => {
    it("operator interrupts Claire with 'stop' or 'hold on'", async () => {
      const draft = initialWeeklyDraft();
      const session = newWeeklySession({
        tenantId: "default",
        operatorId: "adam",
        dayDirectorActorId: "actor-adam",
        weekStart: WEEK_START,
        draft,
      });
      await saveWeeklySession(session);

      const intent1 = arbitrateWeeklyTurnIntent({ utterance: "stop", session, now: NOW, timeZone: TIMEZONE });
      expect(intent1).toBe("chit_chat");

      const intent2 = arbitrateWeeklyTurnIntent({ utterance: "hold on a second", session, now: NOW, timeZone: TIMEZONE });
      expect(intent2).toBe("chit_chat");

      const routed = await routeActiveWeeklySession({
        tenantId: "default",
        operatorId: "adam",
        dayDirectorActorId: "actor-adam",
        utterance: "stop",
        now: NOW,
        timeZone: TIMEZONE,
      });
      expect(routed).toBeNull(); // Escaped to operational lane!
    });

    it("operator changes subject to weather or trivia", async () => {
      const session = newWeeklySession({
        tenantId: "default",
        operatorId: "adam",
        dayDirectorActorId: "actor-adam",
        weekStart: WEEK_START,
        draft: initialWeeklyDraft(),
      });
      await saveWeeklySession(session);

      const intent = arbitrateWeeklyTurnIntent({
        utterance: "What's the weather like outside right now?",
        session,
        now: NOW,
        timeZone: TIMEZONE,
      });
      expect(intent).toBe("clarify");

      const routed = await routeActiveWeeklySession({
        tenantId: "default",
        operatorId: "adam",
        dayDirectorActorId: "actor-adam",
        utterance: "What's the weather like outside right now?",
        now: NOW,
        timeZone: TIMEZONE,
      });
      expect(routed).toBeNull();
    });

    it("operator asks 'what did you say?'", async () => {
      const session = newWeeklySession({
        tenantId: "default",
        operatorId: "adam",
        dayDirectorActorId: "actor-adam",
        weekStart: WEEK_START,
        draft: initialWeeklyDraft(),
      });
      const intent = arbitrateWeeklyTurnIntent({
        utterance: "Wait, what did you say?",
        session,
        now: NOW,
        timeZone: TIMEZONE,
      });
      expect(intent).toBe("clarify");
    });

    it("operator gives an operational status update with several clauses and no request", async () => {
      const session = newWeeklySession({
        tenantId: "default",
        operatorId: "adam",
        dayDirectorActorId: "actor-adam",
        weekStart: WEEK_START,
        draft: initialWeeklyDraft(),
      });
      const utterance = "I was at the plant, then drove to 5th Street, talked to Dave for a minute, and now I'm waiting in the truck.";
      const intent = arbitrateWeeklyTurnIntent({ utterance, session, now: NOW, timeZone: TIMEZONE });
      expect(intent).toBe("operational_today");

      const routed = await routeActiveWeeklySession({
        tenantId: "default",
        operatorId: "adam",
        dayDirectorActorId: "actor-adam",
        utterance,
        now: NOW,
        timeZone: TIMEZONE,
      });
      expect(routed).toBeNull();
    });

    it("operator gives an explicit Day Line command while weekly session is open", async () => {
      const session = newWeeklySession({
        tenantId: "default",
        operatorId: "adam",
        dayDirectorActorId: "actor-adam",
        weekStart: WEEK_START,
        draft: initialWeeklyDraft(),
      });
      await saveWeeklySession(session);

      const fixture = createTestFixture();
      const result = await fixture.say("Put fix the plant boiler on the Day Line.");

      // Must NOT be intercepted by weekly planning
      expect(result.speak).not.toMatch(/What owns Thursday|What owns Friday/i);
      // Commits to Day Line
      expect(fixture.commitMock).toHaveBeenCalled();
      expect(fixture.committedItems.some((i: any) => i.title.toLowerCase().includes("plant boiler"))).toBe(true);

      // Weekly session is still parked and untouched
      const loaded = await loadWeeklySession({ tenantId: "default", operatorId: "adam", weekStart: WEEK_START });
      expect(loaded?.phase).toBe("interview");
      expect(loaded?.draft.days.find(d => d.weekday === "Thursday")?.primary).toBeNull();
    });

    it("operator later deliberately returns to weekly planning", async () => {
      const session = newWeeklySession({
        tenantId: "default",
        operatorId: "adam",
        dayDirectorActorId: "actor-adam",
        weekStart: WEEK_START,
        draft: initialWeeklyDraft(),
      });
      session.lastQuestionKind = "primary";
      session.lastQuestionDate = "2026-10-01"; // Thursday
      await saveWeeklySession(session);

      // Explicit return to weekly planning
      const intent1 = arbitrateWeeklyTurnIntent({
        utterance: "Let's go back to weekly planning.",
        session,
        now: NOW,
        timeZone: TIMEZONE,
      });
      expect(intent1).toBe("weekly_continue");

      // Day move in weekly planning
      const intent2 = arbitrateWeeklyTurnIntent({
        utterance: "Thursday, not Tuesday",
        session,
        now: NOW,
        timeZone: TIMEZONE,
      });
      expect(intent2).toBe("weekly_continue");
    });
  });

  describe("Session lifetime invariants", () => {
    it("a weekly session is valid only for its weekStart and expires once the week ends", () => {
      const session = newWeeklySession({
        tenantId: "default",
        operatorId: "adam",
        dayDirectorActorId: "actor-adam",
        weekStart: "2026-09-14",
        draft: initialWeeklyDraft(),
      });

      // Valid during that week (Friday 2026-09-18)
      expect(isWeeklySessionValid(session, { businessDate: "2026-09-18", timeZone: TIMEZONE })).toBe(true);

      // Invalid after Friday of that week (e.g. 2026-09-19 or 2026-09-29)
      expect(isWeeklySessionValid(session, { businessDate: "2026-09-19", timeZone: TIMEZONE })).toBe(false);
      expect(isWeeklySessionValid(session, { businessDate: "2026-09-29", timeZone: TIMEZONE })).toBe(false);
    });

    it("WEEKLY_SESSION_TTL_MS is at most 7 days", () => {
      expect(WEEKLY_SESSION_TTL_MS).toBeLessThanOrEqual(7 * 24 * 60 * 60 * 1000);
    });
  });
});
