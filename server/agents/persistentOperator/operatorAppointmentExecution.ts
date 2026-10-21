import { requireCallableStrategicProposal } from "../../strategy/strategicStore";
import { drizzlePreparedItemStore } from "./preparedItems";
import { DAILY_CLAIRE_CALLS, dailyPurposeForKind, type DailyClairePurpose } from "../../../shared/dailyClaireCalls";
import { buildShowrunnerBriefing, showrunnerOpening } from "../../claire/showrunner/showrunnerBriefing";
import { prepareDaphneCallDecision } from "../daphne/decisionPointSeam";
import { prepareStrategicProposal } from "../../strategy/strategicPreparation";
import { loadStrategicProposal } from "../../strategy/strategicStore";
import { WEEKDAY_STRATEGIC_PLANNING_ACTION } from "../../../shared/strategicCallAuthorization";
import { formatInTimeZone } from "date-fns-tz";
import { startClairePreDriveCall } from "../../claire/claireTwilio";
import { executePersistentOperatorAction } from "./actionExecution";
import { beginWeeklyMission } from "../../claire/weeklyMission/driver";
import { latestWeeklyIntentForOperators } from "../../claire/weeklyMission/intentStore";
import { logAgentEvent } from "../agentEvents";
import { defaultVerticalRegistry } from "../../strategy/verticalTemplates/defaultRegistry";
import { parseAuthoritativeMetricObservation } from "./macroGoalRuns";
import { findActiveMacroGoalRun } from "./goalCycleService";
import { resolveCanonicalOperatorIdentity } from "./identity";
import {
  SUNDAY_PLANNING_LOCAL_END,
  SUNDAY_PLANNING_LOCAL_START,
  SUNDAY_WEEKLY_PLANNING_ACTION,
} from "./operatorAppointmentPolicy";
import {
  OperatorAppointmentStore,
  type ClaimedOperatorAppointment,
} from "./operatorAppointmentStore";
import {
  admitOperatorAppointmentExecution,
  assertOperatorAppointmentExecutionContext,
  type OperatorAppointmentExecutionContext,
} from "./operatorAppointmentExecutionContext";

function numberLabel(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

async function macroGoalPaceLine(input: {
  tenantId: string;
  canonicalOperatorId: string;
  now: Date;
}): Promise<string> {
  try {
    const run = await findActiveMacroGoalRun({
      tenantId: input.tenantId,
      canonicalOperatorId: input.canonicalOperatorId,
    });
    if (!run) return "";
    const metric = defaultVerticalRegistry.resolveMetric(
      run.verticalKey,
      run.metricKey
    );
    const observation = parseAuthoritativeMetricObservation(
      await metric.reader({ tenantId: input.tenantId, asOf: input.now })
    );
    if (
      observation.value === null ||
      observation.precision !== "exact" ||
      observation.coverage !== "complete" ||
      !observation.observationRef
    ) {
      return "";
    }

    const snapshot =
      run.goalSnapshotJson &&
      typeof run.goalSnapshotJson === "object" &&
      !Array.isArray(run.goalSnapshotJson)
        ? (run.goalSnapshotJson as Record<string, unknown>)
        : {};
    const targetDate =
      typeof snapshot.targetDate === "string" ? snapshot.targetDate : null;
    if (!targetDate || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) return "";
    const targetEnd = new Date(`${targetDate}T23:59:59Z`);
    const days = Math.max(
      1,
      Math.ceil((targetEnd.getTime() - input.now.getTime()) / 86_400_000)
    );
    if (!Number.isFinite(days) || targetEnd.getTime() <= input.now.getTime()) {
      return "";
    }
    const remaining = Math.max(0, run.targetValue - observation.value);
    const pacePerWeek = remaining / (days / 7);
    return [
      `Verified ${run.metricKey.replaceAll("_", " ")} is ${numberLabel(observation.value)}`,
      `against ${numberLabel(run.targetValue)} by ${targetDate}.`,
      remaining > 0
        ? `That's about ${numberLabel(Math.ceil(pacePerWeek))} ${run.unit} a week from here.`
        : "The verified target is already met.",
    ].join(" ");
  } catch {
    return "";
  }
}

async function resolveAppointmentIdentity(
  context: OperatorAppointmentExecutionContext
) {
  const resolution = await resolveCanonicalOperatorIdentity({
    tenantId: context.scope.tenantId,
    source: { type: "open_id", value: context.actor.operatorUserId },
    subsystem: "persistent_operator.operator_appointment",
  });
  if (!resolution.ok) {
    throw new Error(`Operator appointment identity unresolved: ${resolution.reason}`);
  }
  if (
    resolution.identity.canonicalOperatorId !== context.actor.canonicalOperatorId
  ) {
    throw new Error("Operator appointment canonical identity changed");
  }
  return resolution.identity;
}

export function requireClaireCallExecutionProof(result: unknown): {
  callSid: string;
  communicationReceiptId: string;
} {
  const call =
    result && typeof result === "object" && !Array.isArray(result)
      ? (result as Record<string, unknown>)
      : {};
  const callSid =
    typeof call.callSid === "string" && call.callSid.trim()
      ? call.callSid.trim()
      : null;
  const communicationReceiptId =
    typeof call.communicationReceiptId === "string" &&
    call.communicationReceiptId.trim()
      ? call.communicationReceiptId.trim()
      : null;
  if (!callSid) {
    throw new Error("Claire weekly planning call returned no call SID");
  }
  if (!communicationReceiptId) {
    throw new Error(
      "Claire weekly planning call returned no durable communication receipt"
    );
  }
  return { callSid, communicationReceiptId };
}

export function insideSundayStandingWindow(
  step: Pick<ClaimedOperatorAppointment, "timeZone">,
  now: Date
): boolean {
  const weekday = Number(formatInTimeZone(now, step.timeZone, "i"));
  const hm = formatInTimeZone(now, step.timeZone, "HH:mm");
  return (
    weekday === 7 &&
    hm >= SUNDAY_PLANNING_LOCAL_START &&
    hm <= SUNDAY_PLANNING_LOCAL_END
  );
}

export async function executeOperatorAppointment(
  step: ClaimedOperatorAppointment,
  now = new Date(),
  store?: OperatorAppointmentStore,
  context: OperatorAppointmentExecutionContext =
    admitOperatorAppointmentExecution(step)
): Promise<Record<string, unknown>> {
  assertOperatorAppointmentExecutionContext(step, context);
  const identity = await resolveAppointmentIdentity(context);
  const dailyPurpose = dailyPurposeForKind(step.appointmentKind);
  if (dailyPurpose) return executeDailyClaireCall({ step, now, store, context, identity, purpose: dailyPurpose });
  const operatorIds = [
    identity.canonicalOpenId,
    ...identity.aliases.map(alias => alias.openId),
  ];
  const locked = await latestWeeklyIntentForOperators({
    tenantId: context.scope.tenantId,
    operatorIds,
    weekStart: step.weekStart,
  });
  if (locked) {
    return {
      skipped: "week_already_locked",
      weekStart: step.weekStart,
    };
  }

  if (step.unprompted && step.appointmentKind !== "weekday_strategic_planning" && !insideSundayStandingWindow(step, now)) {
    return {
      skipped: "outside_authorized_sunday_window",
      weekStart: step.weekStart,
    };
  }

  const approvedByUserId =
    context.actor.kind === "user_delegation"
      ? identity.canonicalOpenId
      : null;
  const result = await executePersistentOperatorAction({
    identity,
    actionClass: "place_weekly_planning_call",
    authorityBasis: "scheduled_operator_appointment",
    source: {
      type: "scheduled_operator_appointment",
      tenantId: context.scope.tenantId,
      canonicalOperatorId: identity.canonicalOperatorId,
      appointmentId: context.jobId,
      appointmentKind: context.source.appointmentKind,
      standingAuthorizationId: context.actor.standingAuthorizationId,
    },
    riskClass: "EXTERNAL_COMMUNICATION",
    exactAction: step.appointmentKind === "weekday_strategic_planning" ? WEEKDAY_STRATEGIC_PLANNING_ACTION : SUNDAY_WEEKLY_PLANNING_ACTION,
    sourceReference: context.source.sourceReference,
    idempotencyKey: context.idempotencyKey,
    standingAuthorizationId: context.actor.standingAuthorizationId,
    approvedByUserId,
    expiresAtMs: Date.now() + 5 * 60_000,
    execute: async () => {
      const storedId = step.sourceReference.startsWith("strategic_proposal:") ? step.sourceReference.slice("strategic_proposal:".length) : null;
      const proposal = storedId
        ? await loadStrategicProposal(identity, storedId)
        : await prepareStrategicProposal({ identity, timeZone: step.timeZone, weekStart: step.weekStart, now });
      if (!proposal || Date.parse(proposal.expiresAt) <= now.getTime()) throw new Error("Scheduled strategic proposal is stale or unavailable; no call placed");
      await requireCallableStrategicProposal(identity, proposal.id, now);
      const weekly = await beginWeeklyMission({ tenantId: identity.tenantId, operatorId: identity.weeklyOperatorId,
        operatorIdentities: identity.aliases.map(alias => ({ operatorId: alias.openId, dayDirectorActorId: String(alias.userId) })),
        dayDirectorActorId: identity.dayDirectorActorId, dayDirectorActorIds: identity.dayDirectorActorIds,
        timeZone: step.timeZone, now, weekStartOverride: step.weekStart, preparedProposalIdOverride: proposal.id, weeklyPlanningSourceReference: context.source.sourceReference, weeklyPlanningAppointmentId: context.jobId });
      const opening = weekly.speech;
      const sessionKind = "weekly_planning" as const;

      if (!store) {
        throw new Error("Operator appointment execution requires its durable store");
      }
      const dispatchClaimed = await store.beginCallDispatch(step, proposal.id);
      if (!dispatchClaimed) {
        throw new Error("Operator appointment call dispatch already attempted");
      }
      return startClairePreDriveCall({
        tenantId: context.scope.tenantId,
        actorId: identity.communicationOperatorUserId,
        dayDirectorActorId: identity.dayDirectorActorId,
        timeZone: step.timeZone,
        openingOverride: opening,
        sessionKindOverride: sessionKind,
        weeklyPlanningWeekStart: step.weekStart,
        weeklyPlanningSourceReference: context.source.sourceReference,
        weeklyPlanningAppointmentId: context.jobId,
        strategicProposalId: proposal.id,
        strategicProposalRevision: proposal.revision,
      });
    },
  });
  if (!result.executed) {
    return { skipped: result.reason };
  }

  const { callSid, communicationReceiptId } =
    requireClaireCallExecutionProof(result.result);
  await logAgentEvent({
    ctx: {
      tenantId: context.scope.tenantId,
      agentType: "goal_cycle_agent",
      actorType: "system",
      actorId: identity.canonicalOpenId,
      canonicalOperatorId: identity.canonicalOperatorId,
      standingAuthorizationId: context.actor.standingAuthorizationId,
      approvedByUserId,
    },
    toolName: "placeClaireWeeklyPlanningCall",
    inputJson: {
      appointmentId: context.jobId,
      appointmentKind: context.source.appointmentKind,
      weekStart: step.weekStart,
      source: step.source,
      sourceReference: context.source.sourceReference,
      idempotencyKey: context.idempotencyKey,
    },
    outputJson: { callSid, communicationReceiptId },
    status: "success",
    entityType: "operator_appointment",
    entityId: context.jobId,
  }).catch(() => undefined);

  return {
    callSid,
    communicationReceiptId,
    appointmentId: context.jobId,
    appointmentKind: context.source.appointmentKind,
    weekStart: step.weekStart,
  };
}

/**
 * Morning readiness and evening debrief. Independent of any strategic proposal:
 * the call happens when its own grant authorizes it, even if the Day Line is
 * complete. Authority is rechecked at policy time and again at dispatch.
 */
async function executeDailyClaireCall(input: {
  step: ClaimedOperatorAppointment;
  now: Date;
  store?: OperatorAppointmentStore;
  context: OperatorAppointmentExecutionContext;
  identity: Awaited<ReturnType<typeof resolveAppointmentIdentity>>;
  purpose: DailyClairePurpose;
}): Promise<Record<string, unknown>> {
  const { step, now, store, context, identity, purpose } = input;
  if (!context.actor.standingAuthorizationId) return { skipped: "daily_call_requires_standing_authorization" };
  const businessDate = formatInTimeZone(now, step.timeZone, "yyyy-MM-dd");
  const result = await executePersistentOperatorAction({
    identity,
    actionClass: purpose === "morning_readiness" ? "place_morning_readiness_call" : "place_evening_debrief_call",
    authorityBasis: "scheduled_operator_appointment",
    source: {
      type: "scheduled_operator_appointment",
      tenantId: context.scope.tenantId,
      canonicalOperatorId: identity.canonicalOperatorId,
      appointmentId: context.jobId,
      appointmentKind: context.source.appointmentKind,
      standingAuthorizationId: context.actor.standingAuthorizationId,
    },
    riskClass: "EXTERNAL_COMMUNICATION",
    exactAction: DAILY_CLAIRE_CALLS[purpose].exactAction,
    sourceReference: context.source.sourceReference,
    idempotencyKey: context.idempotencyKey,
    standingAuthorizationId: context.actor.standingAuthorizationId,
    approvedByUserId: null,
    expiresAtMs: Date.now() + 5 * 60_000,
    now,
    execute: async () => {
      if (!store) throw new Error("Operator appointment execution requires its durable store");
      const briefing = await buildShowrunnerBriefing({ identity, purpose, timeZone: step.timeZone, now });
      const dispatchClaimed = await store.beginDailyCallDispatch(step, now);
      if (!dispatchClaimed) throw new Error("Daily call dispatch fence refused: authorization, window or duplicate check failed");
      // Daphne decision point (off unless DAPHNE_V2_DECISION_POINTS): recorded before the call
      // is placed; a Daphne failure never blocks or changes the call itself.
      const daphneDecision = await prepareDaphneCallDecision({ identity, purpose, briefing, timeZone: step.timeZone, now });
      const started = await startClairePreDriveCall({
        tenantId: context.scope.tenantId,
        actorId: identity.communicationOperatorUserId,
        dayDirectorActorId: identity.dayDirectorActorId,
        timeZone: step.timeZone,
        openingOverride: showrunnerOpening(briefing),
        sessionKindOverride: purpose,
        showrunner: {
          purpose,
          tenantId: identity.tenantId,
          canonicalOperatorId: identity.canonicalOperatorId,
          operatorUserId: identity.canonicalOpenId,
          dayDirectorActorId: identity.dayDirectorActorId,
          dayDirectorActorIds: identity.dayDirectorActorIds,
          timeZone: step.timeZone,
          businessDate,
          briefing,
          captured: { missionUpdates: [], developments: [], readinessNeeds: [] },
          replan: null,
          turns: 0,
          clockOffsetMs: now.getTime() - Date.now(),
          daphneDecision,
        },
      });
      // The opening just spoke what Claire promised on an earlier call; that promise is now kept.
      const promisedIds = (briefing.preparedItems ?? []).map(item => item.id);
      if (promisedIds.length) {
        await drizzlePreparedItemStore()
          .markConsumed({ tenantId: identity.tenantId, canonicalOperatorId: identity.canonicalOperatorId }, promisedIds, `appointment:${context.jobId}`)
          .catch(error => console.warn("[Claire] could not mark prepared items consumed", error instanceof Error ? error.message : error));
      }
      return started;
    },
  });
  if (!result.executed) return { skipped: result.reason };
  const { callSid, communicationReceiptId } = requireClaireCallExecutionProof(result.result);
  await logAgentEvent({
    ctx: {
      tenantId: context.scope.tenantId,
      agentType: "goal_cycle_agent",
      actorType: "system",
      actorId: identity.canonicalOpenId,
      canonicalOperatorId: identity.canonicalOperatorId,
      standingAuthorizationId: context.actor.standingAuthorizationId,
      approvedByUserId: null,
    },
    toolName: purpose === "morning_readiness" ? "placeClaireMorningReadinessCall" : "placeClaireEveningDebriefCall",
    inputJson: { appointmentId: context.jobId, appointmentKind: context.source.appointmentKind, businessDate, idempotencyKey: context.idempotencyKey },
    outputJson: { callSid, communicationReceiptId },
    status: "success",
    entityType: "operator_appointment",
    entityId: context.jobId,
  }).catch(() => undefined);
  return { callSid, communicationReceiptId, appointmentId: context.jobId, appointmentKind: context.source.appointmentKind, businessDate };
}
