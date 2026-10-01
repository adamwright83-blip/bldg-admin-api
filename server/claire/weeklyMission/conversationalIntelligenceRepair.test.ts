import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WeeklyDraft } from "../../../shared/weeklyMissionReadiness";
import { morningChiefOfStaffBrief, overloadJudgment } from "../../../shared/claireProactive";
import { commitBriefing } from "../briefing/briefingCommit";
import { referencesStructuredRecoveryGroup } from "../briefing/explicitDayLine";
import { runClaireTurn, type ClaireTurnDeps, type ClaireTurnState } from "../turn/claireTurn";
import { interpretTurn } from "../turn/interpretTurn";
import {
  createMemoryConversationStateStore,
  setClaireConversationStateStoreForTests,
} from "../turn/conversationStateStore";
import { capturePrimary } from "./advance";
import { arbitrateWeeklyTurnIntent, routeActiveWeeklySession } from "./route";
import { isSemanticallyNormalizedPrimary } from "./semanticPrimary";
import {
  isWeeklySessionValid,
  loadWeeklySession,
  newWeeklySession,
  saveWeeklySession,
  WEEKLY_SESSION_TTL_MS,
  type WeeklyPlanningSession,
} from "./session";

const WEEK_START = "2026-09-28";
const TUESDAY = "2026-09-29";
const NOW = new Date("2026-09-29T16:00:00Z");
const TIMEZONE = "America/Los_Angeles";

const brainV3Shape = (partial: Record<string, unknown> = {}) => ({
  target: "open_conversation" as const,
  act: "narration" as const,
  workDisposition: "none" as const,
  dayLineDisposition: "none" as const,
  priorClaim: "none" as const,
  weeklyDisposition: "none" as const,
  broadBriefingRequest: false,
  canonicalWork: null,
  referent: null,
  rationale: "test semantic interpretation",
  ...partial,
});

const testBrainV3 = vi.fn(async (input: any) => {
  const text = String(input.utterance ?? "").trim();
  const lower = text.toLowerCase();
  const lastClaire = [...(input.recentTurns ?? [])].reverse().find((turn: any) => turn.speaker === "claire")?.text ?? "";

  if (input.pending?.briefing && /^(?:yes|yeah|yep|sure)[.!]?$/i.test(text) && /day line/i.test(lastClaire)) {
    return brainV3Shape({
      target: "pending_briefing",
      act: "confirmation",
      dayLineDisposition: "accept",
      rationale: "confirmation binds to the immediate Day Line proposal",
    });
  }
  if (/\b(?:put|add)\b[\s\S]*\bday\s*line\b/i.test(text)) {
    return brainV3Shape({
      act: "action_request",
      workDisposition: "commit",
      dayLineDisposition: "reopen",
      canonicalWork: text,
    });
  }
  if (
    input.pending?.briefing &&
    /\b(?:those people|that work|the whole group|them)\b/i.test(text) &&
    /\b(?:put|add|save|schedule)\b/i.test(text)
  ) {
    return brainV3Shape({
      target: "pending_briefing",
      act: "action_request",
      workDisposition: "commit",
      dayLineDisposition: "reopen",
      canonicalWork: text,
      rationale: "Explicitly commits the structured work Claire is holding.",
    });
  }
  if (/\b(?:do the whole group|batch them|batch the whole group|do the whole group)\b/i.test(lower)) {
    return brainV3Shape({
      act: "action_request",
      workDisposition: "propose",
      canonicalWork: text,
    });
  }
  if (/^what should i do today\??$/i.test(text)) {
    return brainV3Shape({ act: "advice_request", broadBriefingRequest: true });
  }
  if (/\?$/.test(text)) return brainV3Shape({ act: "question" });
  if (/^(?:yeah|yes|yep|sure)[.!]?$/i.test(text)) return brainV3Shape({ act: "acknowledgement" });
  return brainV3Shape();
});

const RECOVERY_CUSTOMERS = [
  ["cust_1", "Sarah Connor"],
  ["cust_2", "John Miller"],
  ["cust_3", "Alice Wong"],
  ["cust_4", "David Kim"],
  ["cust_5", "Elena Rostova"],
  ["cust_6", "Marcus Brody"],
  ["cust_7", "Chloe Price"],
] as const;

const RECOVERY_OBLIGATIONS = RECOVERY_CUSTOMERS.map(([id, name]) => ({
  id: `recovery:${id}`,
  kind: "dormant_recovery" as const,
  subjectKey: id,
  subjectName: name,
  status: "scheduled" as const,
  dueDate: TUESDAY,
  title: `Recover ${name}`,
  why: `${name} crossed the dormant threshold.`,
  draft: null,
  historyIntact: true as const,
  moveCount: 0,
}));

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

function openWeeklySession(lastQuestionKind: "primary" | "readiness" = "primary"): WeeklyPlanningSession {
  const session = newWeeklySession({
    tenantId: "default",
    operatorId: "adam",
    dayDirectorActorId: "actor-adam",
    weekStart: WEEK_START,
    draft: initialWeeklyDraft(),
  });
  session.phase = "interview";
  session.substantiveQuestions = 2;
  session.lastQuestionKind = lastQuestionKind;
  session.lastQuestionDate = lastQuestionKind === "readiness" ? TUESDAY : "2026-09-30";
  return session;
}

describe("Claire conversational-intelligence repair", () => {
  let memoryStore: ReturnType<typeof createMemoryConversationStateStore>;

  beforeEach(() => {
    memoryStore = createMemoryConversationStateStore();
    setClaireConversationStateStoreForTests(memoryStore);
  });

  afterEach(() => {
    setClaireConversationStateStoreForTests(null);
  });

  function createTestFixture(overrides: { failCommit?: boolean; noRecoveries?: boolean } = {}) {
    const state: ClaireTurnState = { history: [] };
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
      followUp: vi.fn(async () => "Recovery texts are short win-back messages to dormant customers.") as never,
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
      watchBoard: vi.fn(async () => {
        const recoveries = overrides.noRecoveries ? [] : RECOVERY_OBLIGATIONS;
        return {
          brief: morningChiefOfStaffBrief({
            recoveries,
            sales: [],
            warnings: [],
            overload: overloadJudgment([]),
            skipSales: false,
          }),
          recoveryAccounts: recoveries.map(item => ({
            id: item.subjectKey,
            name: item.subjectName,
          })),
        };
      }),
      recoveryObligations: vi.fn(async () =>
        overrides.noRecoveries ? [] : RECOVERY_OBLIGATIONS
      ) as never,
      doctrineTurn: vi.fn(async () => null),
      classifyPriorClaim: (async () => false) as never,
      rerunBusinessQuery: vi.fn() as never,
      classifierBudgetMs: 30,
      brainV3: testBrainV3 as never,
      ...extra,
    });

    const say = async (utterance: string, extra: Partial<ClaireTurnDeps> = {}) =>
      runClaireTurn(
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

    return { state, say, commitMock, committedReceipts, committedItems };
  }

  async function surfaceRecoveries(fixture: ReturnType<typeof createTestFixture>) {
    const turn = await fixture.say("What should I do today?");
    expect(turn.speak).toContain("Sarah Connor");
    expect(turn.speak).toContain("Chloe Price");
    expect(fixture.state.surfacedRecoveryAccounts).toEqual(
      RECOVERY_CUSTOMERS.map(([id, name]) => ({ id, name }))
    );
  }

  it("discovers structured recovery referents through the real turn runtime and later resolves them", async () => {
    const session = openWeeklySession();
    await saveWeeklySession(session);
    const beforeWeekly = JSON.stringify(session.draft);
    const fixture = createTestFixture();

    const status = await fixture.say(
      "Once I leave here I'm basically done for the day, and business is dead."
    );
    expect(status.speak).not.toMatch(/owns (?:Thursday|Friday)|blocks the week/i);

    await surfaceRecoveries(fixture);

    const explanation = await fixture.say("What are recovery texts?");
    expect(explanation.speak).toMatch(/win-back|dormant/i);
    expect(explanation.speak).not.toMatch(/owns (?:Thursday|Friday)|blocks the week/i);

    const batch = await fixture.say("Yeah, do the whole group this afternoon.");
    expect(batch.speak).not.toMatch(/owns (?:Thursday|Friday)|blocks the week/i);
    expect(fixture.state.pendingBriefing).not.toBeNull();

    const pending = fixture.state.pendingBriefing!.parsed.items[0]!;
    expect(pending.title).toBe("Send 7 dormant-customer recovery texts");
    expect(pending.people).toEqual(RECOVERY_CUSTOMERS.map(([, name]) => name));
    expect(pending.references).toEqual(
      RECOVERY_CUSTOMERS.map(([id, name]) => ({
        kind: "customer",
        id,
        name,
        source: "conversation_referent",
      }))
    );

    const saved = await fixture.say("Those people you just mentioned — put that work on today.");
    expect(fixture.commitMock).toHaveBeenCalledTimes(1);
    expect(fixture.committedReceipts.length).toBeGreaterThan(0);
    expect(saved.receiptBackedCommit).toMatch(/Done\.\s+1 on today's line/i);
    expect(saved.speak).not.toMatch(/tell me the items again/i);
    expect(fixture.committedItems[0]?.references).toEqual(pending.references);

    const after = await loadWeeklySession({
      tenantId: "default",
      operatorId: "adam",
      weekStart: WEEK_START,
    });
    expect(JSON.stringify(after?.draft)).toBe(beforeWeekly);
  });

  it("retains the structured customer set after a failed write and never asks for it again", async () => {
    const fixture = createTestFixture({ failCommit: true });
    await surfaceRecoveries(fixture);
    await fixture.say("Batch them for today.");

    const fail = await fixture.say("Put them on the Day Line.");
    expect(fail.speak).toMatch(/nothing saved|try again/i);
    expect(fail.speak).not.toMatch(/tell me the items again/i);
    expect(fixture.state.pendingBriefing?.parsed.items[0]?.references).toHaveLength(7);
    expect(fixture.state.surfacedRecoveryAccounts).toHaveLength(7);
  });

  it("fails closed instead of inventing a group when no structured referent exists", async () => {
    const fixture = createTestFixture({ noRecoveries: true });
    const result = await fixture.say("Do the whole group this afternoon.");
    expect(result.speak).toBe("Which people do you mean?");
    expect(fixture.commitMock).not.toHaveBeenCalled();
    expect(fixture.state.pendingBriefing ?? null).toBeNull();
  });

  it("carries structured references through commitBriefing into the Day Director proposal", async () => {
    const accept = vi.fn(async (_input: any) => ({ id: "dayline-1" }));
    const refs = RECOVERY_CUSTOMERS.map(([id, name]) => ({
      kind: "customer" as const,
      id,
      name,
      source: "conversation_referent" as const,
    }));
    await commitBriefing(
      {
        items: [
          {
            kind: "new_work",
            title: "Send 7 dormant-customer recovery texts",
            quote: "Send recovery texts today to the seven identified customers",
            businessDate: TUESDAY,
            timing: { kind: "none" },
            quantity: 7,
            people: RECOVERY_CUSTOMERS.map(([, name]) => name),
            place: null,
            needs: null,
            existing: null,
            references: refs,
            executionType: "challenge",
          },
        ],
        context: [],
        questions: [],
        unparsed: [],
        source: "deterministic",
      },
      {
        tenantId: "default",
        dayDirectorActorId: "actor-adam",
        conversationKey: "call:refs",
      },
      {
        accept: accept as never,
        complete: vi.fn() as never,
        update: vi.fn() as never,
        linkVehicleWork: vi.fn() as never,
      }
    );
    expect(accept).toHaveBeenCalledTimes(1);
    expect(accept.mock.calls[0]?.[0]?.proposal.references).toEqual(refs);
  });

  it("requires a normalized action shape before model output can become a weekly primary", () => {
    expect(isSemanticallyNormalizedPrimary("Call Dana", "I need to call Dana Thursday.")).toBe(true);
    expect(isSemanticallyNormalizedPrimary("I need to call Dana", "I need to call Dana Thursday.")).toBe(false);
    expect(isSemanticallyNormalizedPrimary("Business is dead", "Business is dead today.")).toBe(false);
    expect(isSemanticallyNormalizedPrimary("What blocks the week?", "What blocks the week?")).toBe(false);
  });

  it("never turns arbitrary conversational speech into a weekly primary", () => {
    const session = openWeeklySession();
    session.lastQuestionDate = "2026-10-01";

    capturePrimary(session, "I wanna batch them all for today. Great idea.");
    capturePrimary(session, "What blocks the week? What do you mean?");
    capturePrimary(session, "I don't know what you're saying.");

    expect(session.draft.days.find(day => day.businessDate === "2026-10-01")?.primary).toBeNull();
    expect(JSON.stringify(session.draft)).not.toMatch(/I wanna batch|What blocks the week|don't know what you're saying/i);
  });

  it("still persists a direct weekly action after rejecting conversational raw speech", () => {
    const session = openWeeklySession();
    session.lastQuestionDate = "2026-10-01";

    capturePrimary(session, "Text the dormant customers");

    expect(session.draft.days.find(day => day.businessDate === "2026-10-01")?.primary).toMatchObject({
      text: "Text the dormant customers",
      source: "operator_stated",
      executionType: "challenge",
    });
  });

  it("does not confuse ordinary pronouns with the structured recovery group", () => {
    expect(referencesStructuredRecoveryGroup("Add them together.")).toBe(false);
    expect(referencesStructuredRecoveryGroup("Who was my latest sale, and what should I do about them?")).toBe(false);
    expect(interpretTurn("Who was my latest sale, and what should I do about them?").hasExplicitActionRequest).toBe(false);

    expect(referencesStructuredRecoveryGroup("Do the whole group this afternoon.")).toBe(true);
    expect(referencesStructuredRecoveryGroup("Batch them for today.")).toBe(true);
    expect(referencesStructuredRecoveryGroup("Put them on the Day Line.")).toBe(true);
  });

  it("parks an ambiguous operational utterance even while a readiness question is pending", async () => {
    const session = openWeeklySession("readiness");
    await saveWeeklySession(session);

    expect(
      arbitrateWeeklyTurnIntent({
        utterance: "I'm pulling into the laundromat now.",
        session,
        now: NOW,
        timeZone: TIMEZONE,
      })
    ).toBe("semantic_review");

    const classifyIntent = vi.fn(async () => "leave_weekly" as const);
    const routed = await routeActiveWeeklySession(
      {
        tenantId: "default",
        operatorId: "adam",
        dayDirectorActorId: "actor-adam",
        utterance: "I'm pulling into the laundromat now.",
        now: NOW,
        timeZone: TIMEZONE,
      },
      { classifyIntent }
    );
    expect(routed).toBeNull();
    expect(classifyIntent).toHaveBeenCalledOnce();

    const after = await loadWeeklySession({
      tenantId: "default",
      operatorId: "adam",
      weekStart: WEEK_START,
    });
    expect(after?.lastQuestionKind).toBe("readiness");
    expect(after?.draft).toEqual(session.draft);
  });

  it("classifier failure parks the weekly session rather than stealing the turn", async () => {
    const session = openWeeklySession("readiness");
    await saveWeeklySession(session);

    const routed = await routeActiveWeeklySession(
      {
        tenantId: "default",
        operatorId: "adam",
        dayDirectorActorId: "actor-adam",
        utterance: "I'm waiting outside the building now.",
        now: NOW,
        timeZone: TIMEZONE,
      },
      { classifyIntent: vi.fn(async () => null) }
    );
    expect(routed).toBeNull();
  });

  it("recognizes unseen topic changes without incident-specific phrases", () => {
    const session = openWeeklySession("readiness");
    const cases = [
      "Business is dead today. What should I do about that?",
      "Anyway, forget that for a second. What happened with Dana?",
      "Where did the revenue number come from?",
    ];
    for (const utterance of cases) {
      expect(
        arbitrateWeeklyTurnIntent({ utterance, session, now: NOW, timeZone: TIMEZONE })
      ).not.toBe("weekly_continue");
    }
  });

  it("deliberately returns to the weekly plan when the operator names the open day", () => {
    const session = openWeeklySession();
    session.lastQuestionDate = "2026-10-01";
    expect(
      arbitrateWeeklyTurnIntent({
        utterance: "Okay, back to Thursday. I need the sales walk ready before noon.",
        session,
        now: NOW,
        timeZone: TIMEZONE,
      })
    ).toBe("weekly_continue");
  });

  it("explicit Day Line commands bypass a parked weekly session", async () => {
    const session = openWeeklySession();
    await saveWeeklySession(session);
    const fixture = createTestFixture();

    const result = await fixture.say("Put fix the plant boiler on the Day Line.");
    expect(result.speak).not.toMatch(/owns (?:Thursday|Friday)/i);
    expect(fixture.commitMock).toHaveBeenCalled();

    const loaded = await loadWeeklySession({
      tenantId: "default",
      operatorId: "adam",
      weekStart: WEEK_START,
    });
    expect(loaded?.draft).toEqual(session.draft);
  });

  it("binds a plain yes to Claire's immediate Day Line proposal instead of a stale weekly plan", async () => {
    const session = openWeeklySession();
    session.phase = "proposal";
    await saveWeeklySession(session);
    const weeklyBefore = JSON.stringify(session.draft);

    const fixture = createTestFixture();
    fixture.state.pendingBriefing = {
      parsed: {
        items: [
          {
            kind: "new_work",
            title: "Drop off Daniel's dry cleaning",
            quote: "Drop off Daniel's dry cleaning at OPUS LA",
            businessDate: TUESDAY,
            timing: { kind: "none" },
            quantity: null,
            people: ["Daniel"],
            place: "OPUS LA",
            needs: null,
            existing: null,
          },
        ],
        context: [],
        questions: [],
        unparsed: [],
        source: "deterministic",
      },
      createdAt: NOW.getTime(),
    };
    fixture.state.history = [
      {
        speaker: "claire",
        text: "Want me to put all of that on the Day Line?",
        at: NOW.getTime() - 1_000,
      },
    ];

    const brain = vi.fn(async (input: any) => {
      expect(input.pending.briefing).toBe(true);
      expect(input.recentTurns.at(-1)?.text).toMatch(/Day Line/i);
      return brainV3Shape({
        target: "pending_briefing",
        act: "confirmation",
        dayLineDisposition: "accept",
        rationale: "Yes answers the immediately preceding Day Line proposal.",
      });
    });

    const result = await fixture.say("Yes.", { brainV3: brain as never });

    expect(brain).toHaveBeenCalledOnce();
    expect(fixture.commitMock).toHaveBeenCalledTimes(1);
    expect(result.receiptBackedCommit).toMatch(/Done\./i);
    expect(result.receiptBackedCommit).not.toMatch(/Tuesday:|Wednesday:|Thursday:|Friday:/i);

    const weeklyAfter = await loadWeeklySession({
      tenantId: "default",
      operatorId: "adam",
      weekStart: WEEK_START,
    });
    expect(weeklyAfter?.phase).toBe("proposal");
    expect(JSON.stringify(weeklyAfter?.draft)).toBe(weeklyBefore);
  });

  it("parks stale held work when Claude says the operator changed topics", async () => {
    const session = openWeeklySession();
    session.phase = "proposal";
    await saveWeeklySession(session);

    const fixture = createTestFixture();
    fixture.state.pendingBriefing = {
      parsed: {
        items: [
          {
            kind: "new_work",
            title: "Old held task",
            quote: "Old held task",
            businessDate: TUESDAY,
            timing: { kind: "none" },
            quantity: null,
            people: [],
            place: null,
            needs: null,
            existing: null,
          },
        ],
        context: [],
        questions: [],
        unparsed: [],
        source: "deterministic",
      },
      createdAt: NOW.getTime(),
    };
    fixture.state.history = [
      {
        speaker: "claire",
        text: "What happened with Dana?",
        at: NOW.getTime() - 1_000,
      },
    ];

    await fixture.say("Yeah.", {
      brainV3: vi.fn(async () =>
        brainV3Shape({
          target: "open_conversation",
          act: "acknowledgement",
          rationale: "The current reply belongs to the new conversation, not old held work.",
        })
      ) as never,
    });

    expect(fixture.commitMock).not.toHaveBeenCalled();
    expect(fixture.state.pendingBriefing?.parsed.items[0]?.title).toBe("Old held task");

    const weeklyAfter = await loadWeeklySession({
      tenantId: "default",
      operatorId: "adam",
      weekStart: WEEK_START,
    });
    expect(weeklyAfter?.phase).toBe("proposal");
  });

  it("keeps Day Line suppressed after the operator explicitly says not to discuss it", async () => {
    const fixture = createTestFixture();

    const declineBrain = vi.fn(async () =>
      brainV3Shape({
        target: "open_conversation",
        act: "rejection",
        dayLineDisposition: "decline",
        rationale: "Operator explicitly does not want Day Line in this conversation.",
      })
    );
    const declined = await fixture.say("Well, I don't wanna talk about the day line. It's already 7PM.", {
      brainV3: declineBrain as never,
    });
    expect(fixture.state.dayLineSuppressed).toBe(true);
    expect(declined.speak).not.toMatch(/want me to put|day line now|say yes/i);

    const narration = await fixture.say(
      "On Friday, I don't have any pickups or drop offs so far, but same-day orders can still happen.",
      {
        brainV3: vi.fn(async () =>
          brainV3Shape({
            target: "open_conversation",
            act: "narration",
            workDisposition: "none",
            rationale: "Context about Friday capacity, not a tracking request.",
          })
        ) as never,
      }
    );
    expect(fixture.state.pendingBriefing ?? null).toBeNull();
    expect(narration.speak).not.toMatch(/want me to put|day line/i);
  });

  it("does not enter prior-claim verification when the operator is complaining about verification", async () => {
    const fixture = createTestFixture();
    fixture.state.claimReceipts = [
      {
        id: "claim_1",
        conversationKey: "call:prod-repair",
        claireTurnOrdinal: 1,
        createdAt: NOW.getTime(),
        answerText: "The Louise is overdue.",
        answerPath: "business_reader",
        claimType: "account_status",
        grounding: "retrieved",
        sources: ["ledger"],
        assertsFact: true,
        recheck: { kind: "none" },
      } as any,
    ];

    for (const utterance of [
      "No one asked you to verify a property. You already said that earlier.",
      "So",
      "You just say you can't verify the property when nobody is asking you to verify the property.",
      "It's already 7PM, Claire.",
    ]) {
      const result = await fixture.say(utterance, {
        brainV3: vi.fn(async () =>
          brainV3Shape({
            target: "open_conversation",
            act: utterance === "So" ? "unclear" : "correction",
            priorClaim: "none",
            rationale: "This is conversation about Claire's behavior, not a factual challenge.",
          })
        ) as never,
      });
      expect(result.speak).not.toMatch(/can't verify that properly right now/i);
      expect(result.priorClaimRan).toBe(false);
    }
  });

  it("commits the referenced Friday route instead of literalizing 'I can commit to that'", async () => {
    const fixture = createTestFixture();
    fixture.state.dayLineSuppressed = true;
    fixture.state.history = [
      {
        speaker: "claire",
        text: "Want me to schedule Friday as a field day with Argyle House, Jardine Hollywood, and sageLA as the stops?",
        at: NOW.getTime() - 1_000,
      },
    ];

    const result = await fixture.say("I can commit to that.", {
      brainV3: vi.fn(async () =>
        brainV3Shape({
          target: "open_conversation",
          act: "confirmation",
          workDisposition: "commit",
          dayLineDisposition: "reopen",
          canonicalWork:
            "Visit Argyle House on Friday. Visit Jardine Hollywood on Friday. Visit sageLA on Friday.",
          referent: "the three-stop Friday field mission",
          rationale: "The confirmation resolves to the concrete route Claire just proposed.",
        })
      ) as never,
    });

    expect(fixture.state.dayLineSuppressed).toBe(false);
    expect(fixture.commitMock).toHaveBeenCalledTimes(1);
    expect(result.receiptBackedCommit).toMatch(/Done\./i);
    expect(fixture.committedItems.map((item: any) => item.title).join(" | ")).toMatch(
      /Argyle House|Jardine Hollywood|sageLA/i
    );
    expect(fixture.committedItems.map((item: any) => item.title).join(" | ")).not.toMatch(
      /mentally prepare|commit to that/i
    );
  });

  it("weekly session lifetime is bounded to its target week", () => {
    const session = openWeeklySession();
    expect(isWeeklySessionValid(session, { businessDate: "2026-10-02", timeZone: TIMEZONE })).toBe(true);
    expect(isWeeklySessionValid(session, { businessDate: "2026-10-03", timeZone: TIMEZONE })).toBe(false);
    expect(WEEKLY_SESSION_TTL_MS).toBeLessThanOrEqual(7 * 24 * 60 * 60 * 1000);
  });
});
