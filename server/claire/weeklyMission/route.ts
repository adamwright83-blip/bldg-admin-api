/**
 * Thin weekly-planning route. One seam for runClaireTurn.
 * While a session is interview, proposal, or awaiting confirmation,
 * the completed thought comes here and does not fall through to generic capture.
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
import { advanceWeeklySession, isActionablePrimaryCandidate, type WeeklyAdvanceResult } from "./advance";
import { commitWeeklyPlan } from "./commit";
import { loadWeeklyDossier } from "./dossier";
import { readWeeklyDossierFacts, readWeeklyGrowthCandidatesForDossier } from "./productionReaders";
import { isWeeklySessionValid, loadWeeklySession, type WeeklyPlanningSession } from "./session";
import { completeWeeklyActWithClaire } from "./weeklyModel";

export type WeeklyTurnIntent =
  | "weekly_continue"
  | "weekly_lock"
  | "weekly_cancel"
  | "operational_today"
  | "clarify"
  | "chit_chat";

export function arbitrateWeeklyTurnIntent(input: {
  utterance: string;
  session: WeeklyPlanningSession;
  now?: Date;
  timeZone?: string;
}): WeeklyTurnIntent {
  const utterance = input.utterance.trim();
  const session = input.session;

  // 1. Explicit cancellation of the weekly planning interview
  if (isWeeklyCancel(utterance)) return "weekly_cancel";

  // 2. Explicit lock/approval of a proposed week
  if (lockBindApplies(session, utterance)) return "weekly_lock";

  // 3. Clarifications, questions, confusion about what Claire said or meta-questions
  if (
    /\b(?:what (?:do you mean|does that mean|are you talking about|did you say)|i don't know what you're saying|i don't understand|what you mean|say that again|repeat that|who is that|why (?:is|are|did)|what's that)\b/i.test(
      utterance
    ) ||
    /\bwhat owns (?:thursday|friday|monday|tuesday|wednesday)\b/i.test(utterance) ||
    /\bwhat are recovery texts\b/i.test(utterance) ||
    (/^(?:what|why|who|how|when|where)\b/i.test(utterance) && (/\?/i.test(utterance) || /\b(?:mean|saying)\b/i.test(utterance)))
  ) {
    return "clarify";
  }

  // 4. Conversation control / chit-chat / interruptions
  if (
    /\b(?:stop|hold on|wait a second|wait|pause|hang on)\b/i.test(utterance) ||
    /^(?:great idea|thanks|thank you|cool|hello|hi claire|hey claire)[.!]?$/i.test(utterance)
  ) {
    return "chit_chat";
  }

  // 5. Operational commands, Day Line requests, today's status updates, route narration
  if (
    /\b(?:day ?line|my list|the list|my plan|the plan)\b/i.test(utterance) ||
    /\bbatch\s+(?:them|all|those)(?:\s+all)?\s+(?:for\s+today|today)\b/i.test(utterance) ||
    /\b(?:for today|on today|today'?s (?:line|run|route|plan))\b/i.test(utterance) ||
    /\b(?:dropped off|dry cleaner|heading to|going home|no more orders|need customers|finished (?:the )?(?:delivery|order|run)|picked up|on my way|making a stop)\b/i.test(utterance) ||
    /^(?:put|add|place|log|save|track)\s+(?:them|that|it|all of that|everything)\b/i.test(utterance)
  ) {
    return "operational_today";
  }

  // 6. Deliberate weekly continuation:
  // - Day moves ("Thursday, not Tuesday", "Move Wednesday to Friday")
  if (parseDayMove(utterance)) return "weekly_continue";

  // - Explicit weekly keywords ("plan the week", "review the week", "back to weekly planning")
  if (/\b(?:weekly plan|plan the week|the week|look at the week|review the week|back to (?:the )?week|back to weekly planning)\b/i.test(utterance)) {
    return "weekly_continue";
  }

  // - Rejections / adjustments of draft days ("No, that won't work", "Change Tuesday", "Not Wednesday")
  if (isWeeklyRejection(utterance) && session.phase !== "interview") {
    return "weekly_continue";
  }

  // - Answering a weekly question when session is in interview:
  if (session.phase === "interview" || session.phase === "proposal" || session.phase === "awaiting_confirmation") {
    if (session.lastQuestionKind === "readiness") {
      return "weekly_continue";
    }
    if (session.lastQuestionKind === "primary" || session.lastQuestionKind === "blocking") {
      if (/\b(?:monday|tuesday|wednesday|thursday|friday)\b/i.test(utterance)) {
        return "weekly_continue";
      }
      if (/\b(?:skip|stand down|none|leave it open)\b/i.test(utterance)) {
        return "weekly_continue";
      }
      if (isActionablePrimaryCandidate(utterance)) {
        return "weekly_continue";
      }
    }
  }

  // Ambiguous non-weekly turns fail toward escaping the interview (parking the session)
  return "operational_today";
}

export type WeeklyRouteResult = {
  speak: string;
  receiptBackedCommit?: string;
  mutationReceipts?: MutationReceipt[];
  actionIds?: string[];
  act: WeeklyAct;
};

export async function routeActiveWeeklySession(input: {
  tenantId: string;
  operatorId: string;
  operatorIds?: readonly string[];
  dayDirectorActorId: string;
  dayDirectorActorIds?: readonly string[];
  utterance: string;
  now: Date;
  timeZone: string;
  weekStartOverride?: string;
}): Promise<WeeklyRouteResult | null> {
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

  // Session lifetime validation: valid only for its weekStart.
  if (!isWeeklySessionValid(session, { now: input.now, timeZone: input.timeZone, businessDate })) {
    return null;
  }

  // Intent arbitration: an open weekly session is context, not automatic conversational authority.
  const intent = arbitrateWeeklyTurnIntent({
    utterance: input.utterance,
    session,
    now: input.now,
    timeZone: input.timeZone,
  });

  if (intent === "operational_today" || intent === "clarify" || intent === "chit_chat") {
    // Session remains safely parked. Does not cancel, does not lock, draft is untouched.
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
  const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "";
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
