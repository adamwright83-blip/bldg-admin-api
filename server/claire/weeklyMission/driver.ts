/**
 * Driver entry for the four weekly operations.
 * Picture and decline do not open a planning session.
 * Begin resumes an existing session. It does not restart one.
 */

import { resolveCanonicalOperatorIdentity } from "../../agents/persistentOperator/identity";
import { latestStrategicProposal, loadStrategicProposal, strategicResponses, requireCallableStrategicProposal, strategicProposalIsCallable } from "../../strategy/strategicStore";
import { formatInTimeZone } from "date-fns-tz";
import {
  buildWeeklyMissionCard,
  type WeeklyMissionCardModel,
} from "../../../shared/weeklyMissionCard";
import {
  deriveWeekStatus,
  remainingWeekHorizon,
  targetWeekHorizon,
  type RemainingWeekHorizon,
  type WeeklyIntentRecord,
} from "../../../shared/weeklyMissionReadiness";
import { advanceWeeklySession, speakProposal } from "./advance";
import { reopenWeeklySession } from "./commit";
import { deriveInternalHypothesis, draftFromDossier, loadWeeklyDossier, type WeeklyDossierReaders } from "./dossier";
import { latestWeeklyIntent } from "./intentStore";
import { readWeeklyDossierFacts, readWeeklyGrowthCandidatesForDossier } from "./productionReaders";
import { routeActiveWeeklySession } from "./route";
import { completeWeeklyActWithClaire } from "./weeklyModel";
import {
  bindWeeklyAppointmentLineage,
  loadWeeklySessionForScope,
  loadWeeklySurface,
  newWeeklySession,
  saveWeeklySurface,
  saveWeeklySession,
  type WeeklyPlanningSession,
} from "./session";

export type WeeklyDriverScope = {
  tenantId: string;
  operatorId: string;
  operatorIdentities?: ReadonlyArray<{
    operatorId: string;
    dayDirectorActorId: string;
  }>;
  dayDirectorActorId: string;
  dayDirectorActorIds?: readonly string[];
  timeZone: string;
  now?: Date;
  /** Durable appointments can plan the coming Monday-Friday while called on Sunday. */
  weekStartOverride?: string;
  weeklyPlanningSourceReference?: string | null;
  weeklyPlanningAppointmentId?: string | null;
  preparedProposalIdOverride?: string;
};

export type WeeklyDriverDeps = {
  factsForDates?: WeeklyDossierReaders["factsForDates"];
  latestIntent?: (input: {
    tenantId: string;
    operatorId: string;
    weekStart: string;
  }) => Promise<WeeklyIntentRecord | null>;
};

export type WeeklyDriverTurn = {
  speech: string;
  resumed: boolean;
  card: WeeklyMissionCardModel;
};

function identityPairs(scope: WeeklyDriverScope): Array<{
  operatorId: string;
  dayDirectorActorId: string;
}> {
  const candidates = [
    { operatorId: scope.operatorId, dayDirectorActorId: scope.dayDirectorActorId },
    ...(scope.operatorIdentities ?? []),
  ];
  const seen = new Set<string>();
  return candidates
    .map(pair => ({
      operatorId: pair.operatorId.trim(),
      dayDirectorActorId: pair.dayDirectorActorId.trim(),
    }))
    .filter(pair => {
      if (!pair.operatorId || !pair.dayDirectorActorId || seen.has(pair.operatorId)) return false;
      seen.add(pair.operatorId);
      return true;
    });
}

function actorForOperator(scope: WeeklyDriverScope, operatorId: string): string {
  return identityPairs(scope).find(pair => pair.operatorId === operatorId)?.dayDirectorActorId
    ?? scope.dayDirectorActorId;
}

async function existingSession(
  scope: WeeklyDriverScope,
  horizon: RemainingWeekHorizon
): Promise<{ operatorId: string; dayDirectorActorId: string; session: WeeklyPlanningSession } | null> {
  const pairs = identityPairs(scope);
  const session = await loadWeeklySessionForScope({
    tenantId: scope.tenantId,
    operatorId: scope.operatorId,
    operatorIds: pairs.map(pair => pair.operatorId),
    dayDirectorActorId: scope.dayDirectorActorId,
    dayDirectorActorIds: scope.dayDirectorActorIds ?? pairs.map(pair => pair.dayDirectorActorId),
    weekStart: horizon.weekStart,
    now: scope.now,
    timeZone: scope.timeZone,
  });
  return session ? {
    operatorId: session.operatorId,
    dayDirectorActorId: session.dayDirectorActorId,
    session,
  } : null;
}

async function surfaceFor(
  scope: WeeklyDriverScope,
  horizon: RemainingWeekHorizon
): Promise<{
  operatorId: string;
  receipt: { surfacedAt: string | null; declinedAt: string | null };
}> {
  const pairs = identityPairs(scope);
  const canonical = pairs[0] ?? {
    operatorId: scope.operatorId,
    dayDirectorActorId: scope.dayDirectorActorId,
  };
  let owner = canonical.operatorId;
  let foundMeaningful = false;
  let surfacedAt: string | null = null;
  let declinedAt: string | null = null;
  for (const pair of pairs) {
    const receipt = await loadWeeklySurface({
      tenantId: scope.tenantId,
      operatorId: pair.operatorId,
      weekStart: horizon.weekStart,
    });
    if ((receipt.surfacedAt || receipt.declinedAt) && !foundMeaningful) {
      owner = pair.operatorId;
      foundMeaningful = true;
    }
    if (receipt.surfacedAt && (!surfacedAt || receipt.surfacedAt < surfacedAt)) {
      surfacedAt = receipt.surfacedAt;
    }
    if (receipt.declinedAt && (!declinedAt || receipt.declinedAt > declinedAt)) {
      declinedAt = receipt.declinedAt;
    }
  }
  return { operatorId: owner, receipt: { surfacedAt, declinedAt } };
}

async function intentFor(
  scope: WeeklyDriverScope,
  horizon: RemainingWeekHorizon,
  deps: WeeklyDriverDeps
): Promise<WeeklyIntentRecord | null> {
  const load = deps.latestIntent ?? latestWeeklyIntent;
  const intents = (
    await Promise.all(
      identityPairs(scope).map(pair =>
        load({
          tenantId: scope.tenantId,
          operatorId: pair.operatorId,
          weekStart: horizon.weekStart,
        })
      )
    )
  ).filter((intent): intent is WeeklyIntentRecord => Boolean(intent));
  intents.sort(
    (a, b) => b.lockedAt.localeCompare(a.lockedAt) || b.revision - a.revision
  );
  return intents[0] ?? null;
}

export async function loadWeeklyMissionPicture(
  scope: WeeklyDriverScope,
  deps: WeeklyDriverDeps = {}
): Promise<WeeklyMissionCardModel> {
  const card = await assembleCard(scope, deps);
  if (card.status === "UNPLANNED" && card.showCard) {
    const horizon = horizonFor(scope);
    const surface = await surfaceFor(scope, horizon);
    if (!surface.receipt.surfacedAt && !surface.receipt.declinedAt) {
      await saveWeeklySurface({
        tenantId: scope.tenantId,
        operatorId: surface.operatorId,
        weekStart: horizon.weekStart,
        receipt: { surfacedAt: (scope.now ?? new Date()).toISOString(), declinedAt: null },
      });
    }
  }
  return card;
}

export async function beginWeeklyMission(
  scope: WeeklyDriverScope,
  deps: WeeklyDriverDeps = {}
): Promise<WeeklyDriverTurn> {
  const horizon = horizonFor(scope);
  const existing = await existingSession(scope, horizon);
  if (existing) {
    if (existing.session.draft.pendingRecommendation) {
      const resolved = await resolveCanonicalOperatorIdentity({ tenantId: scope.tenantId, source: { type: "open_id", value: scope.operatorId }, subsystem: "weekly.resume_proposal" });
      if (!resolved.ok) throw new Error("Canonical operator unavailable");
      await requireCallableStrategicProposal(resolved.identity, existing.session.draft.pendingRecommendation.proposalId, scope.now ?? new Date());
    }
    await bindWeeklyAppointmentLineage(existing.session, scope);
    if (scope.preparedProposalIdOverride && existing.session.draft.pendingRecommendation?.proposalId !== scope.preparedProposalIdOverride) throw new Error("A different weekly conversation revision is already active");
    return {
      speech: resumeSpeech(existing.session),
      resumed: true,
      card: await assembleCard(scope, deps),
    };
  }
  if (horizon.remainingDates.length === 0) {
    return {
      speech: "The weekday week is already over. I won't invent another one.",
      resumed: false,
      card: await assembleCard(scope, deps),
    };
  }
  const dossier = await loadWeeklyDossier({ horizon }, readersFor(scope, deps));
  if (!deps.factsForDates) {
    const identity = await resolveCanonicalOperatorIdentity({ tenantId: scope.tenantId, source: { type: "open_id", value: scope.operatorId }, subsystem: "weekly.prepared_proposal" });
    if (identity.ok) {
      const prepared = scope.preparedProposalIdOverride ? await loadStrategicProposal(identity.identity, scope.preparedProposalIdOverride) : await latestStrategicProposal(identity.identity, horizon.weekStart);
      const decisions = prepared ? await strategicResponses(identity.identity, prepared.id) : [];
      if (prepared && prepared.weekStart === horizon.weekStart && strategicProposalIsCallable(prepared, decisions, scope.now ?? new Date()) && (await latestStrategicProposal(identity.identity, horizon.weekStart))?.id === prepared.id) {
        dossier.preparedRecommendation = { proposalId: prepared.id, revision: prepared.revision, opening: prepared.opening };
      }
    }
  }
  if (scope.preparedProposalIdOverride && !dossier.preparedRecommendation) throw new Error("Prepared proposal unavailable for this weekly conversation");
  const session = newWeeklySession({
    tenantId: scope.tenantId,
    operatorId: scope.operatorId,
    dayDirectorActorId: scope.dayDirectorActorId,
    weekStart: horizon.weekStart,
    draft: draftFromDossier(dossier),
  });
  session.internalHypothesis = deriveInternalHypothesis(dossier);
  await bindWeeklyAppointmentLineage(session, scope);
  if (session.draft.pendingRecommendation) {
    session.phase = "awaiting_confirmation";
    await saveWeeklySession(session);
    return { speech: session.draft.pendingRecommendation.opening, resumed: false, card: await assembleCard(scope, deps) };
  }
  const advanced = await advanceWeeklySession(
    { dossier, session, operatorUtterance: "" },
    {
      completeAct: act =>
        completeWeeklyActWithClaire({
          tenantId: scope.tenantId,
          operatorId: scope.operatorId,
          dossier: act.dossier,
          session: act.session,
          operatorUtterance: act.operatorUtterance,
        }),
    }
  );
  return {
    speech: advanced.speech,
    resumed: false,
    card: await assembleCard(scope, deps),
  };
}

export async function declineWeeklyMission(
  scope: WeeklyDriverScope,
  deps: WeeklyDriverDeps = {}
): Promise<WeeklyMissionCardModel> {
  const horizon = horizonFor(scope);
  const surface = await surfaceFor(scope, horizon);
  await saveWeeklySurface({
    tenantId: scope.tenantId,
    operatorId: surface.operatorId,
    weekStart: horizon.weekStart,
    receipt: {
      surfacedAt: surface.receipt.surfacedAt ?? (scope.now ?? new Date()).toISOString(),
      declinedAt: (scope.now ?? new Date()).toISOString(),
    },
  });
  return assembleCard(scope, deps);
}

export async function adjustWeeklyMission(
  scope: WeeklyDriverScope,
  deps: WeeklyDriverDeps = {}
): Promise<WeeklyDriverTurn> {
  const horizon = horizonFor(scope);
  if (horizon.remainingDates.length === 0) {
    return {
      speech: "The weekday week is already over. I won't invent another one.",
      resumed: false,
      card: await assembleCard(scope, deps),
    };
  }
  const dossier = await loadWeeklyDossier({ horizon }, readersFor(scope, deps));
  const prior = await intentFor(scope, horizon, deps);
  const ownerOperatorId = prior?.operatorId ?? scope.operatorId;
  await reopenWeeklySession({
    tenantId: scope.tenantId,
    operatorId: ownerOperatorId,
    dayDirectorActorId: actorForOperator(scope, ownerOperatorId),
    dossier,
    prior,
  });
  return {
    speech: "The week is open again. What should change?",
    resumed: true,
    card: await assembleCard(scope, deps),
  };
}

export async function replyWeeklyMission(
  scope: WeeklyDriverScope,
  utterance: string,
  deps: WeeklyDriverDeps = {}
): Promise<WeeklyDriverTurn> {
  const horizon = horizonFor(scope);
  const existing = await existingSession(scope, horizon);
  const routed = await routeActiveWeeklySession({
    tenantId: scope.tenantId,
    operatorId: existing?.operatorId ?? scope.operatorId,
    operatorIds: identityPairs(scope).map(pair => pair.operatorId),
    dayDirectorActorId: existing?.dayDirectorActorId ?? scope.dayDirectorActorId,
    dayDirectorActorIds: scope.dayDirectorActorIds
      ? [...scope.dayDirectorActorIds]
      : identityPairs(scope).map(pair => pair.dayDirectorActorId),
    utterance,
    weekStartOverride: scope.weekStartOverride,
    weeklyPlanningSourceReference: scope.weeklyPlanningSourceReference,
    weeklyPlanningAppointmentId: scope.weeklyPlanningAppointmentId,
    now: scope.now ?? new Date(),
    timeZone: scope.timeZone,
  });
  return {
    speech: routed?.receiptBackedCommit || routed?.speak || "The week isn't open. Plan it first.",
    resumed: true,
    card: await assembleCard(scope, deps),
  };
}

async function assembleCard(scope: WeeklyDriverScope, deps: WeeklyDriverDeps): Promise<WeeklyMissionCardModel> {
  const horizon = horizonFor(scope);
  const [session, surface, intent] = await Promise.all([
    existingSession(scope, horizon),
    surfaceFor(scope, horizon),
    intentFor(scope, horizon, deps),
  ]);
  return buildWeeklyMissionCard({
    status: deriveWeekStatus({ activeSession: Boolean(session), lockedIntent: Boolean(intent) }),
    weekStart: horizon.weekStart,
    horizon,
    declined: Boolean(surface.receipt.declinedAt),
    days: intent?.days ?? [],
  });
}

function horizonFor(scope: WeeklyDriverScope): RemainingWeekHorizon {
  const now = scope.now ?? new Date();
  const input = {
    businessDate: formatInTimeZone(now, scope.timeZone, "yyyy-MM-dd"),
    localTime: formatInTimeZone(now, scope.timeZone, "HH:mm"),
  };
  return scope.weekStartOverride
    ? targetWeekHorizon({ ...input, weekStart: scope.weekStartOverride })
    : remainingWeekHorizon(input);
}

function readersFor(scope: WeeklyDriverScope, deps: WeeklyDriverDeps): WeeklyDossierReaders {
  if (deps.factsForDates) return { factsForDates: deps.factsForDates };
  return {
    factsForDates: dates =>
      readWeeklyDossierFacts({
        tenantId: scope.tenantId,
        operatorId: scope.operatorId,
        operatorUserIds: identityPairs(scope).map(pair => pair.operatorId),
        dayDirectorActorId: scope.dayDirectorActorId,
        dayDirectorActorIds: scope.dayDirectorActorIds,
        dates,
        now: scope.now ?? new Date(),
        timeZone: scope.timeZone,
      }),
    growthCandidates: () =>
      readWeeklyGrowthCandidatesForDossier({
        tenantId: scope.tenantId,
        operatorId: scope.operatorId,
        operatorUserIds: identityPairs(scope).map(pair => pair.operatorId),
        dayDirectorActorId: scope.dayDirectorActorId,
        dayDirectorActorIds: scope.dayDirectorActorIds,
        dates: horizonFor(scope).remainingDates,
        now: scope.now ?? new Date(),
        timeZone: scope.timeZone,
      }),
  };
}

function resumeSpeech(session: WeeklyPlanningSession): string {
  if (session.draft.pendingRecommendation) return session.draft.pendingRecommendation.opening;
  if (session.phase === "proposal" || session.phase === "awaiting_confirmation") {
    return speakProposal(session.draft);
  }
  return "We're still on this week. Answer the open question, or tell me what changed.";
}
