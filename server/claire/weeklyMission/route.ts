/**
 * Thin weekly-planning route. One seam for runClaireTurn.
 * While a session is interview, proposal, or awaiting confirmation,
 * the completed thought comes here and does not fall through to generic capture.
 */

import { formatInTimeZone } from "date-fns-tz";
import type { MutationReceipt } from "../assertionGuard";
import {
  isWeeklyLockBind,
  parseDayMove,
  remainingWeekHorizon,
  type WeeklyAct,
} from "../../../shared/weeklyMissionReadiness";
import { advanceWeeklySession, type WeeklyAdvanceResult } from "./advance";
import { commitWeeklyPlan } from "./commit";
import { loadWeeklyDossier } from "./dossier";
import { readWeeklyDossierFacts, readWeeklyGrowthCandidatesForDossier } from "./productionReaders";
import { loadWeeklySession, type WeeklyPlanningSession } from "./session";
import { completeWeeklyActWithClaire } from "./weeklyModel";

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
  dayDirectorActorId: string;
  utterance: string;
  now: Date;
  timeZone: string;
}): Promise<WeeklyRouteResult | null> {
  const businessDate = formatInTimeZone(input.now, input.timeZone, "yyyy-MM-dd");
  const localTime = formatInTimeZone(input.now, input.timeZone, "HH:mm");
  const horizon = remainingWeekHorizon({ businessDate, localTime });
  const session = await loadWeeklySession({
    tenantId: input.tenantId,
    operatorId: input.operatorId,
    weekStart: horizon.weekStart,
  });
  if (!session) return null;
  if (!["interview", "proposal", "awaiting_confirmation"].includes(session.phase)) return null;

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
    dayDirectorActorId: string;
    utterance: string;
    now: Date;
    timeZone: string;
  },
  horizon: ReturnType<typeof remainingWeekHorizon>,
  session: WeeklyPlanningSession
): Promise<WeeklyRouteResult> {
  if (lockBindApplies(session, input.utterance)) {
    const committed = await commitWeeklyPlan({ session, now: input.now });
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
          dayDirectorActorId: input.dayDirectorActorId,
          dates,
          now: input.now,
          timeZone: input.timeZone,
        }),
      growthCandidates: () =>
        readWeeklyGrowthCandidatesForDossier({
          tenantId: input.tenantId,
          operatorId: input.operatorId,
          dayDirectorActorId: input.dayDirectorActorId,
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
