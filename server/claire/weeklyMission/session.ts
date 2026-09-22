/**
 * Weekly planning session. Conversation state, not business truth.
 * Key: weekly-planning:{tenant}:{operator}:{weekStart}
 */

import {
  emptyWeeklyHypothesis,
  weeklySessionKey,
  weeklySurfaceKey,
  type WeeklyDraft,
  type WeeklyInternalHypothesis,
  type WeeklySessionPhase,
} from "../../../shared/weeklyMissionReadiness";
import {
  claireConversationStateStore,
  type ClaireConversationStateStore,
} from "../turn/conversationStateStore";

export const WEEKLY_SESSION_TTL_MS = 12 * 24 * 60 * 60 * 1000;

export type WeeklyCommittedRef = {
  commitmentId: string;
  idempotencyKey: string;
};

export type WeeklyPlanningSession = {
  key: string;
  tenantId: string;
  operatorId: string;
  dayDirectorActorId: string;
  weekStart: string;
  phase: WeeklySessionPhase;
  substantiveQuestions: number;
  lastQuestionKind: "primary" | "readiness" | "blocking" | "confirm" | null;
  lastQuestionDate: string | null;
  readinessAskedDates: string[];
  askedBlocking: boolean;
  draft: WeeklyDraft;
  /** Provisional. Never shown as the decided week and never written to WeeklyIntent. */
  internalHypothesis: WeeklyInternalHypothesis;
  operatorEvidence: string[];
  committedRefs: Record<string, WeeklyCommittedRef>;
  adjust: boolean;
};

export type WeeklySurfaceReceipt = {
  surfacedAt: string | null;
  declinedAt: string | null;
};

function store(): ClaireConversationStateStore {
  return claireConversationStateStore();
}

export async function loadWeeklySession(input: {
  tenantId: string;
  operatorId: string;
  weekStart: string;
  now?: number;
}): Promise<WeeklyPlanningSession | null> {
  const key = weeklySessionKey(input.tenantId, input.operatorId, input.weekStart);
  const row = await store().load<WeeklyPlanningSession>(key, input.now);
  if (!row) return null;
  if (row.tenantId !== input.tenantId || row.operatorUserId !== input.operatorId) return null;
  return normalizeWeeklySession(row.state);
}

export async function saveWeeklySession(session: WeeklyPlanningSession, now = Date.now()): Promise<void> {
  await store().save(
    session.key,
    { tenantId: session.tenantId, operatorUserId: session.operatorId, surface: "text" },
    session,
    WEEKLY_SESSION_TTL_MS,
    now
  );
}

export async function clearWeeklySession(session: Pick<WeeklyPlanningSession, "key">): Promise<void> {
  await store().remove(session.key);
}

export async function loadWeeklySurface(input: {
  tenantId: string;
  operatorId: string;
  weekStart: string;
}): Promise<WeeklySurfaceReceipt> {
  const row = await store().load<WeeklySurfaceReceipt>(weeklySurfaceKey(input.tenantId, input.operatorId, input.weekStart));
  return row?.state ?? { surfacedAt: null, declinedAt: null };
}

export async function saveWeeklySurface(input: {
  tenantId: string;
  operatorId: string;
  weekStart: string;
  receipt: WeeklySurfaceReceipt;
}): Promise<void> {
  await store().save(
    weeklySurfaceKey(input.tenantId, input.operatorId, input.weekStart),
    { tenantId: input.tenantId, operatorUserId: input.operatorId, surface: "text" },
    input.receipt,
    WEEKLY_SESSION_TTL_MS
  );
}

export function newWeeklySession(input: {
  tenantId: string;
  operatorId: string;
  dayDirectorActorId: string;
  weekStart: string;
  draft: WeeklyDraft;
  adjust?: boolean;
}): WeeklyPlanningSession {
  return {
    key: weeklySessionKey(input.tenantId, input.operatorId, input.weekStart),
    tenantId: input.tenantId,
    operatorId: input.operatorId,
    dayDirectorActorId: input.dayDirectorActorId,
    weekStart: input.weekStart,
    phase: "interview",
    substantiveQuestions: 0,
    lastQuestionKind: null,
    lastQuestionDate: null,
    readinessAskedDates: [],
    askedBlocking: false,
    draft: input.draft,
    internalHypothesis: emptyWeeklyHypothesis(),
    operatorEvidence: [],
    committedRefs: {},
    adjust: Boolean(input.adjust),
  };
}

export function normalizeWeeklySession(session: WeeklyPlanningSession): WeeklyPlanningSession {
  session.internalHypothesis ??= emptyWeeklyHypothesis();
  session.internalHypothesis.uncertainties ??= [];
  session.operatorEvidence ??= [];
  session.readinessAskedDates ??= [];
  session.committedRefs ??= {};
  return session;
}
