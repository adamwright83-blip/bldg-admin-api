/**
 * Thin weekly-planning route. One seam for runClaireTurn.
 * An open weekly session is context, not automatic conversational authority.
 * Deterministic rules own explicit controls; ambiguous turns are semantically
 * classified and fail toward parking the weekly session.
 */

import { formatInTimeZone } from "date-fns-tz";
import type { MutationReceipt } from "../assertionGuard";
import {
  isWeeklyCancel,
  isWeeklyLockBind,
  isWeeklyRejection,
  parseDayMove,
  remainingWeekHorizon,
  targetWeekHorizon,
  type WeeklyAct,
} from "../../../shared/weeklyMissionReadiness";
import { advanceWeeklySession, type WeeklyAdvanceResult } from "./advance";
import { commitWeeklyPlan } from "./commit";
import { loadWeeklyDossier } from "./dossier";
import { readWeeklyDossierFacts, readWeeklyGrowthCandidatesForDossier } from "./productionReaders";
import { isWeeklySessionValid, loadWeeklySession, type WeeklyPlanningSession } from "./session";
import {
  classifyWeeklyTurnWithClaire,
  completeWeeklyActWithClaire,
} from "./weeklyModel";
import { interpretTurn } from "../turn/interpretTurn";

export type WeeklyTurnIntent =
  | "weekly_continue"
  | "weekly_lock"
  | "weekly_cancel"
  | "operational_today"
  | "clarify"
  | "chit_chat"
  | "semantic_review";

/**
 * Cheap deterministic boundary checks only. This deliberately does not decide
 * that arbitrary work-like speech answers the weekly planner. Ambiguous turns
 * are sent to a bounded semantic classifier; classifier failure parks the
 * weekly session rather than hijacking the conversation.
 */
export function arbitrateWeeklyTurnIntent(input: {
  utterance: string;
  session: WeeklyPlanningSession;
  now?: Date;
  timeZone?: string;
}): WeeklyTurnIntent {
  const utterance = input.utterance.trim();
  const session = input.session;

  if (isWeeklyCancel(utterance)) return "weekly_cancel";
  if (lockBindApplies(session, utterance)) return "weekly_lock";
  if (parseDayMove(utterance)) return "weekly_continue";

  if (
    /\b(?:weekly plan|plan the week|review the week|look at the week|back to (?:the )?week|back to weekly planning)\b/i.test(
      utterance
    )
  ) {
    return "weekly_continue";
  }

  if (/\b(?:day ?line|to-?do|my list|today'?s line)\b/i.test(utterance)) {
    return "operational_today";
  }

  if (/\b(?:stop|hold on|wait|pause|hang on)\b/i.test(utterance)) {
    return "chit_chat";
  }

  const interpreted = interpretTurn(utterance);
  if (interpreted.callControl === "end" || interpreted.conversationControl) {
    return "chit_chat";
  }
  if (
    interpreted.correction ||
    interpreted.correctnessChallenge ||
    interpreted.provenanceQuestion ||
    interpreted.hasBusinessQuestion
  ) {
    return "clarify";
  }

  const openDay = session.lastQuestionDate
    ? session.draft.days.find(day => day.businessDate === session.lastQuestionDate)?.weekday ?? null
    : null;
  if (openDay && new RegExp(`\\b${openDay}\\b`, "i").test(utterance)) {
    return "weekly_continue";
  }

  if (isWeeklyRejection(utterance) && session.phase !== "interview") {
    return "weekly_continue";
  }

  return "semantic_review";
}

export type WeeklyRouteResult = {
  speak: string;
  receiptBackedCommit?: string;
  mutationReceipts?: MutationReceipt[];
  actionIds?: string[];
  act: WeeklyAct;
};

export async function routeActiveWeeklySession(
  input: {
    tenantId: string;
    operatorId: string;
    operatorIds?: readonly string[];
    dayDirectorActorId: string;
    dayDirectorActorIds?: readonly string[];
    utterance: string;
    now: Date;
    timeZone: string;
    weekStartOverride?: string;
  },
  deps: {
    classifyIntent?: typeof classifyWeeklyTurnWithClaire;
  } = {}
): Promise<WeeklyRouteResult | null> {
  const businessDate = formatInTimeZone(input.now, input.timeZone, "yyyy-MM-dd");
  const localTime = formatInTimeZone(input.now, input.timeZone, "HH:mm");
  const horizon = input.weekStartOverride
    ? targetWeekHorizon({
        businessDate,
        localTime,
        weekStart: input.weekStartOverride,
      })
    : remainingWeekHorizon({ businessDate, localTime });
  const session = await loadWeeklySession({
    tenantId: input.tenantId,
    operatorId: input.operatorId,
    weekStart: horizon.weekStart,
  });
  if (!session) return null;
  if (!["interview", "proposal", "awaiting_confirmation"].includes(session.phase)) return null;

  if (!isWeeklySessionValid(session, { now: input.now, timeZone: input.timeZone, businessDate })) {
    return null;
  }

  let intent = arbitrateWeeklyTurnIntent({
    utterance: input.utterance,
    session,
    now: input.now,
    timeZone: input.timeZone,
  });

  if (intent === "semantic_review") {
    const semantic = await (deps.classifyIntent ?? classifyWeeklyTurnWithClaire)({
      tenantId: input.tenantId,
      operatorId: input.operatorId,
      session,
      utterance: input.utterance,
    }).catch(() => null);
    intent = semantic === "continue_weekly" ? "weekly_continue" : "operational_today";
  }

  if (intent === "operational_today" || intent === "clarify" || intent === "chit_chat") {
    return null;
  }

  try {
    return await routeLoadedSession(input, horizon, session);
  } catch (error) {
    if (isMissingTable(error)) throw error;
    return {
      speak: "I still have the week open. Say that once more.",
      act: "ASK",
      actionIds: [],
    };
  }
}

function isMissingTable(error: unknown): boolean {
  const code = error && typeof error === "object" && "code" in error
    ? String((error as { code: unknown }).code)
    : "";
  const message = error instanceof Error ? error.message : "";
  return code === "ER_NO_SUCH_TABLE" || message.includes("ER_NO_SUCH_TABLE");
}

async function routeLoadedSession(
  input: {
    tenantId: string;
    operatorId: string;
    operatorIds?: readonly string[];
    dayDirectorActorId: string;
    dayDirectorActorIds?: readonly string[];
    utterance: string;
    now: Date;
    timeZone: string;
    weekStartOverride?: string;
  },
  horizon: ReturnType<typeof remainingWeekHorizon>,
  session: WeeklyPlanningSession
): Promise<WeeklyRouteResult> {
  if (lockBindApplies(session, input.utterance)) {
    const committed = await commitWeeklyPlan({
      session,
      dayDirectorActorIds: input.dayDirectorActorIds,
      now: input.now,
    });
    return {
      speak: committed.speech,
      receiptBackedCommit: committed.locked ? committed.speech : undefined,
      mutationReceipts: committed.receipts,
      actionIds: committed.commitmentIds,
      act: committed.locked ? "AWAIT_CONFIRMATION" : "REVISE",
    };
  }

  const dossier = await loadWeeklyDossier(
    { horizon },
    {
      factsForDates: dates =>
        readWeeklyDossierFacts({
          tenantId: input.tenantId,
          operatorId: input.operatorId,
          operatorUserIds: input.operatorIds,
          dayDirectorActorId: input.dayDirectorActorId,
          dayDirectorActorIds: input.dayDirectorActorIds,
          dates,
          now: input.now,
          timeZone: input.timeZone,
        }),
      growthCandidates: () =>
        readWeeklyGrowthCandidatesForDossier({
          tenantId: input.tenantId,
          operatorId: input.operatorId,
          operatorUserIds: input.operatorIds,
          dayDirectorActorId: input.dayDirectorActorId,
          dayDirectorActorIds: input.dayDirectorActorIds,
          dates: horizon.remainingDates,
          now: input.now,
          timeZone: input.timeZone,
        }),
    }
  );

  const advanced = await advanceWeeklySession(
    {
      dossier,
      session,
      operatorUtterance: input.utterance,
    },
    {
      completeAct: modelInput =>
        completeWeeklyActWithClaire({
          tenantId: input.tenantId,
          operatorId: input.operatorId,
          ...modelInput,
        }),
    }
  );

  return {
    speak: advanced.speech,
    act: advanced.act,
    actionIds: [],
  };
}

export function lockBindApplies(session: WeeklyPlanningSession, utterance: string): boolean {
  if (session.phase !== "proposal" && session.phase !== "awaiting_confirmation") return false;
  if (parseDayMove(utterance)) return false;
  return isWeeklyLockBind(utterance);
}

export function advanceResultWritesNothing(result: WeeklyAdvanceResult): boolean {
  return result.writesBusinessTruth === false;
}
