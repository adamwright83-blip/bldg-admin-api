import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./productionReaders", () => ({
  readWeeklyDossierFacts: async () => [],
  readWeeklyGrowthCandidatesForDossier: async () => [],
}));
import { readFileSync } from "node:fs";
import { remainingWeekHorizon, type WeeklyDraft } from "../../../shared/weeklyMissionReadiness";
import { runClaireTurn, type ClaireTurnDeps, type ClaireTurnState } from "../turn/claireTurn";
import {
  createMemoryConversationStateStore,
  setClaireConversationStateStoreForTests,
} from "../turn/conversationStateStore";
import { advanceWeeklySession, guardSpeech } from "./advance";
import { loadWeeklyDossier, type WeeklyDossier } from "./dossier";
import { acceptPlanningDecision } from "./planningDecision";
import { newWeeklySession, saveWeeklySession } from "./session";

const NOW = new Date("2026-09-15T16:00:00Z");
const HORIZON = remainingWeekHorizon({ businessDate: "2026-09-15", localTime: "09:00" });

function dossierWithTuesdayWindow(): Promise<WeeklyDossier> {
  return loadWeeklyDossier(
    { horizon: HORIZON },
    {
      factsForDates: async () => [
        {
          id: "day-director:jetro",
          class: "fixed_window",
          businessDate: "2026-09-15",
          title: "JETRO",
          scheduleLabel: "14:00",
          weekday: null,
          provenance: {
            reader: "dayDirector.getDayDirectorState",
            sourceType: "day_director",
            sourceIds: ["jetro"],
            quote: "JETRO Tuesday 14:00",
          },
        },
      ],
    }
  );
}

function sessionFor(dossier: WeeklyDossier, draft?: WeeklyDraft) {
  return newWeeklySession({
    tenantId: "default",
    operatorId: "adam-admin",
    dayDirectorActorId: "1",
    weekStart: dossier.horizon.weekStart,
    draft: draft ?? {
      weekStart: dossier.horizon.weekStart,
      days: dossier.horizon.remainingDates.map(businessDate => ({
        businessDate,
        weekday: businessDate === "2026-09-15" ? "Tuesday" as const
          : businessDate === "2026-09-16" ? "Wednesday" as const
          : businessDate === "2026-09-17" ? "Thursday" as const
          : "Friday" as const,
        disposition: "primary" as const,
        primary: businessDate === "2026-09-15"
          ? { text: "Field the six buildings", source: "operator_stated" as const, existingCommitmentId: null }
          : null,
        fixedConstraints: dossier.fixedConstraints.filter(item => item.businessDate === businessDate),
        readinessRequirements: [],
        uncertainty: null,
      })),
    },
  });
}

describe("advanceWeeklySession", () => {
  afterEach(() => setClaireConversationStateStoreForTests(null));

  it("revises Tuesday onto Thursday and writes no business truth", async () => {
    setClaireConversationStateStoreForTests(createMemoryConversationStateStore());
    const dossier = await dossierWithTuesdayWindow();
    const session = sessionFor(dossier);
    const writes = vi.fn();
    const result = await advanceWeeklySession({
      dossier,
      session,
      operatorUtterance: "Thursday, not Tuesday",
    });
    expect(result.act).toBe("REVISE");
    expect(result.writesBusinessTruth).toBe(false);
    expect(writes).not.toHaveBeenCalled();
    expect(result.draft.days.find(day => day.weekday === "Thursday")?.primary?.text).toBe("Field the six buildings");
    expect(result.draft.days.find(day => day.weekday === "Tuesday")?.primary).toBeNull();
    expect(result.speech).not.toMatch(/I have enough/);
  });

  it("keeps jacket and packets on the draft during a readiness question", async () => {
    setClaireConversationStateStoreForTests(createMemoryConversationStateStore());
    const dossier = await dossierWithTuesdayWindow();
    const session = sessionFor(dossier);
    session.lastQuestionKind = "readiness";
    session.lastQuestionDate = "2026-09-15";
    session.readinessAskedDates = ["2026-09-15"];
    const result = await advanceWeeklySession({
      dossier,
      session,
      operatorUtterance: "Jacket needs washing and six packets printed",
    });
    const tuesday = result.draft.days.find(day => day.businessDate === "2026-09-15");
    expect(tuesday?.readinessRequirements.map(item => item.text)).toEqual([
      "Jacket needs washing",
      "six packets printed",
    ]);
    expect(tuesday?.readinessRequirements.map(item => item.kind)).toEqual(["physical", "document"]);
    expect(tuesday?.readinessRequirements[0]?.completeByDate).toBe("2026-09-14");
    expect(result.writesBusinessTruth).toBe(false);
    expect(result.speech.split("?").length - 1).toBeLessThanOrEqual(1);
  });

  it("asks from the known Tuesday window instead of making the operator restate it", async () => {
    setClaireConversationStateStoreForTests(createMemoryConversationStateStore());
    const dossier = await dossierWithTuesdayWindow();
    const session = sessionFor(dossier, {
      weekStart: dossier.horizon.weekStart,
      days: dossier.horizon.remainingDates.map(businessDate => ({
        businessDate,
        weekday: businessDate === "2026-09-15" ? "Tuesday" : businessDate === "2026-09-16" ? "Wednesday" : businessDate === "2026-09-17" ? "Thursday" : "Friday",
        disposition: "primary",
        primary: null,
        fixedConstraints: dossier.fixedConstraints.filter(item => item.businessDate === businessDate),
        readinessRequirements: [],
        uncertainty: null,
      })),
    });
    const result = await advanceWeeklySession({ dossier, session, operatorUtterance: "" });
    expect(result.act).toBe("ASK");
    expect(result.speech).toMatch(/JETRO/);
    expect(result.speech).toMatch(/one mission/i);
    expect(result.writesBusinessTruth).toBe(false);
  });

  it("chooses the higher-value uncertainty instead of walking weekdays", async () => {
    setClaireConversationStateStoreForTests(createMemoryConversationStateStore());
    const dossier = await loadWeeklyDossier(
      { horizon: HORIZON },
      {
        factsForDates: async () => [
          {
            id: "recurrence-rule:print",
            class: "recurrence_rule",
            businessDate: null,
            title: "Plant print run",
            scheduleLabel: "09:00–10:00",
            weekday: "Tuesday",
            provenance: {
              reader: "workdayRecurrence.listActiveRecurrenceRules",
              sourceType: "recurrence_rule",
              sourceIds: ["print"],
              quote: "Tuesdays at the plant",
            },
          },
          {
            id: "day-director:jetro-thu",
            class: "fixed_window",
            businessDate: "2026-09-17",
            title: "JETRO",
            scheduleLabel: "14:00",
            weekday: null,
            provenance: {
              reader: "dayDirector.getDayDirectorState",
              sourceType: "day_director",
              sourceIds: ["jetro-thu"],
              quote: "JETRO Thursday 14:00",
            },
          },
        ],
      }
    );
    const session = sessionFor(dossier, {
      weekStart: dossier.horizon.weekStart,
      days: dossier.horizon.remainingDates.map(businessDate => ({
        businessDate,
        weekday: businessDate === "2026-09-15" ? "Tuesday" as const
          : businessDate === "2026-09-16" ? "Wednesday" as const
          : businessDate === "2026-09-17" ? "Thursday" as const
          : "Friday" as const,
        disposition: "primary" as const,
        primary: null,
        fixedConstraints: dossier.fixedConstraints.filter(item => item.businessDate === businessDate),
        readinessRequirements: [],
        uncertainty: null,
      })),
    });
    let seenTuesdayRecurrence: string | null = null;
    const result = await advanceWeeklySession(
      { dossier, session, operatorUtterance: "" },
      {
        completeAct: async input => {
          seenTuesdayRecurrence =
            input.dossier.facts.find(fact => fact.id === "recurrence-rule:print:2026-09-15")?.businessDate ?? null;
          return {
            act: "ASK",
            speech: "I've got a rough shape. Plant print run holds Tuesday morning, but I don't trust what owns Thursday yet.",
            hypothesisSummary: "Plant print run holds Tuesday. Thursday is still open.",
            uncertainties: [{ text: "what owns Thursday", businessDate: "2026-09-17", status: "open" }],
            focusUncertainty: "what owns Thursday",
            draftDays: null,
          };
        },
      }
    );
    expect(seenTuesdayRecurrence).toBe("2026-09-15");
    expect(result.act).toBe("ASK");
    expect(result.speech).toMatch(/Thursday/);
    expect(result.speech).not.toMatch(/^What is the one mission/);
    expect(result.session.internalHypothesis.summary).toMatch(/Plant print run/);
    expect(result.draft.days.every(day => day.primary?.text !== result.session.internalHypothesis.summary)).toBe(true);
    expect(JSON.stringify(result.draft)).not.toContain("internalHypothesis");
    expect(result.writesBusinessTruth).toBe(false);
  });

  it("derives a private hypothesis before the first question and does not restate a known pickup", async () => {
    setClaireConversationStateStoreForTests(createMemoryConversationStateStore());
    const dossier = await loadWeeklyDossier(
      { horizon: HORIZON },
      {
        factsForDates: async () => [
          {
            id: "recurrence-rule:pickup",
            class: "recurrence_rule",
            businessDate: null,
            title: "Plant pickup",
            scheduleLabel: "08:00–09:00",
            weekday: "Tuesday",
            provenance: {
              reader: "workdayRecurrence.listActiveRecurrenceRules",
              sourceType: "recurrence_rule",
              sourceIds: ["pickup"],
              quote: "Tuesdays 8 to 9",
            },
          },
        ],
      }
    );
    const session = sessionFor(dossier, {
      weekStart: dossier.horizon.weekStart,
      days: dossier.horizon.remainingDates.map(businessDate => ({
        businessDate,
        weekday: businessDate === "2026-09-15" ? "Tuesday" as const
          : businessDate === "2026-09-16" ? "Wednesday" as const
          : businessDate === "2026-09-17" ? "Thursday" as const
          : "Friday" as const,
        disposition: "primary" as const,
        primary: null,
        fixedConstraints: dossier.fixedConstraints.filter(item => item.businessDate === businessDate),
        readinessRequirements: [],
        uncertainty: null,
      })),
    });
    expect(session.internalHypothesis.summary).toBe("");
    const restated = await advanceWeeklySession(
      { dossier, session, operatorUtterance: "" },
      {
        completeAct: async () => ({
          act: "ASK",
          speech: "What time is the Plant pickup?",
          hypothesisSummary: "Plant pickup is already on Tuesday.",
          uncertainties: [{ text: "what time is the Plant pickup", businessDate: "2026-09-15", status: "open" }],
          focusUncertainty: "what time is the Plant pickup",
          draftDays: null,
        }),
      }
    );
    expect(restated.session.internalHypothesis.summary).toMatch(/08:00–09:00/);
    expect(restated.session.internalHypothesis.summary).toMatch(/Primaries are not decided/);
    expect(restated.speech).not.toMatch(/what time/i);
    expect(restated.speech).not.toMatch(/^What is the one mission/);
    expect(restated.writesBusinessTruth).toBe(false);
    expect(JSON.stringify(restated.draft)).not.toContain("internalHypothesis");
    const invented = acceptPlanningDecision(
      {
        act: "ASK",
        speech: "Meet Dana at 500 Fake Street at 19:00.",
        hypothesisSummary: "",
        uncertainties: [],
        focusUncertainty: null,
        draftDays: null,
      },
      { dossier, session: restated.session, utterance: "" }
    );
    expect(invented).toBeNull();
    const earlyPropose = acceptPlanningDecision(
      {
        act: "PROPOSE",
        speech: "I have enough. Here's the week I'd run.",
        hypothesisSummary: "Plant pickup holds Tuesday.",
        uncertainties: [],
        focusUncertainty: null,
        draftDays: null,
      },
      { dossier, session: restated.session, utterance: "" }
    );
    expect(earlyPropose).toBeNull();
  });

  it("kills a hypothesis line when the operator corrects it", async () => {
    setClaireConversationStateStoreForTests(createMemoryConversationStateStore());
    const dossier = await dossierWithTuesdayWindow();
    const session = sessionFor(dossier);
    session.internalHypothesis = {
      summary: "JETRO might be the Tuesday mission.",
      uncertainties: [{ id: "u1", text: "whether JETRO is the mission", businessDate: "2026-09-15", status: "open" }],
    };
    const result = await advanceWeeklySession(
      { dossier, session, operatorUtterance: "JETRO is only the window." },
      {
        completeAct: async () => ({
          act: "REVISE",
          speech: "JETRO stays a window. It is not the mission.",
          hypothesisSummary: "JETRO is a fixed window, not the Tuesday mission.",
          uncertainties: [{ text: "whether JETRO is the mission", businessDate: "2026-09-15", status: "killed" }],
          focusUncertainty: null,
          draftDays: null,
        }),
      }
    );
    expect(result.session.internalHypothesis.uncertainties[0]?.status).toBe("killed");
    expect(result.session.internalHypothesis.summary).toMatch(/not the Tuesday mission/);
    expect(result.draft.days.every(day => day.primary?.text !== result.session.internalHypothesis.summary)).toBe(true);
    expect(result.writesBusinessTruth).toBe(false);
  });

  it("fails closed when the model invents a name or a mutation", async () => {
    setClaireConversationStateStoreForTests(createMemoryConversationStateStore());
    const dossier = await dossierWithTuesdayWindow();
    const session = sessionFor(dossier);
    session.lastQuestionKind = "primary";
    session.lastQuestionDate = "2026-09-16";
    const result = await advanceWeeklySession(
      { dossier, session, operatorUtterance: "Walk the plant." },
      {
        completeAct: async () => ({
          act: "PROPOSE",
          speech: "I scheduled Dana at a building I invented.",
          draft: {
            ...session.draft,
            days: session.draft.days.map(day =>
              day.businessDate === "2026-09-16"
                ? { ...day, primary: { text: "Meet Dana invented", source: "claire_recommended" as const, existingCommitmentId: null } }
                : day
            ),
          },
        }),
      }
    );
    expect(result.draft.days.find(day => day.businessDate === "2026-09-16")?.primary?.text).toBe("Walk the plant.");
    expect(result.speech).not.toMatch(/Dana/);
    expect(result.speech).not.toMatch(/I scheduled/);
    expect(result.writesBusinessTruth).toBe(false);
  });

  it("allows dossier facts in speech and refuses an unverified recommendation as fact", () => {
    const speech = guardSpeech("I scheduled a new customer.", {
      horizon: HORIZON,
      facts: [],
      fixedConstraints: [],
      writesBusinessTruth: false,
    });
    expect(speech).toMatch(/won't claim/i);
  });

  it("does not import a business writer", () => {
    const source = readFileSync(new URL("./advance.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/acceptProposal|designateDayDirectorPrimary|insert\(/);
  });
});

describe("weekly mode gate", () => {
  afterEach(() => setClaireConversationStateStoreForTests(null));

  function deps(): ClaireTurnDeps {
    return {
      now: () => NOW,
      timeZone: () => "America/Los_Angeles",
      business: { now: () => NOW, timeZone: () => "America/Los_Angeles", plan: async () => null, runQuery: vi.fn() as never },
      commitment: vi.fn(async () => ({ kind: "not_applicable" as const })) as never,
      followUp: vi.fn(async () => "Brief follow-up.") as never,
      extractModel: null,
      loadExisting: async () => [],
      commit: vi.fn() as never,
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
      classifyPriorClaim: vi.fn(async () => null) as never,
      rerunBusinessQuery: vi.fn() as never,
    };
  }

  async function seed(phase: "interview" | "proposal" | "awaiting_confirmation", readiness = false) {
    const store = createMemoryConversationStateStore();
    setClaireConversationStateStoreForTests(store);
    const dossier = await dossierWithTuesdayWindow();
    const session = sessionFor(dossier);
    session.phase = phase;
    if (readiness) {
      session.lastQuestionKind = "readiness";
      session.lastQuestionDate = "2026-09-15";
      session.readinessAskedDates = ["2026-09-15"];
    }
    await saveWeeklySession(session);
    return session;
  }

  async function turn(utterance: string, turnDeps: ClaireTurnDeps) {
    const state: ClaireTurnState = {};
    return runClaireTurn(
      {
        tenantId: "default",
        operatorUserId: "adam-admin",
        dayDirectorActorId: "1",
        surface: "text",
        utterance,
        state,
        conversationKey: "desk-weekly",
        context: { businessDate: "2026-09-15", actorId: "1", blockers: [], relevantTimeline: [] } as never,
      },
      turnDeps
    );
  }

  it("routes Thursday-not-Tuesday to the draft and not the briefing commit", async () => {
    await seed("interview");
    const turnDeps = deps();
    const result = await turn("Thursday, not Tuesday", turnDeps);
    expect(turnDeps.commit).not.toHaveBeenCalled();
    expect(turnDeps.commitment).not.toHaveBeenCalled();
    expect(result.kind).not.toBe("briefing_proposed");
    expect(result.kind).toBe("answered");
    expect(result.speak.toLowerCase()).toMatch(/thursday/);
  });

  it("routes jacket and packets away from generic commitments", async () => {
    await seed("interview", true);
    const turnDeps = deps();
    const result = await turn("Jacket needs washing and six packets printed", turnDeps);
    expect(turnDeps.commit).not.toHaveBeenCalled();
    expect(turnDeps.commitment).not.toHaveBeenCalled();
    expect(result.kind).not.toBe("commitment");
    expect(result.kind).not.toBe("briefing_saved");
  });

  it("routes Looks good and Lock it onto the weekly confirmation path", async () => {
    await seed("proposal");
    const looks = deps();
    const looksResult = await turn("Looks good", looks);
    expect(looks.commit).not.toHaveBeenCalled();
    expect(looksResult.kind).not.toBe("briefing_proposed");
    expect(looksResult.speak.toLowerCase()).toMatch(/lock/);

    await seed("awaiting_confirmation");
    const lock = deps();
    const lockResult = await turn("Lock it.", lock);
    expect(lock.commit).not.toHaveBeenCalled();
    expect(lockResult.kind).not.toBe("briefing_proposed");
    expect(lockResult.speak.toLowerCase()).toMatch(/lock/);
  });
});
