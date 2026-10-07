import { formatInTimeZone } from "date-fns-tz";
import {
  executeClairePersistentOperatorAction,
  startClairePreDriveCall,
} from "../claire/claireTwilio";
import { beginWeeklyMission } from "../claire/weeklyMission/driver";
import { latestWeeklyIntentForOperators } from "../claire/weeklyMission/intentStore";
import { logAgentEvent } from "../agents/agentEvents";
import { defaultVerticalRegistry } from "../strategy/verticalTemplates/defaultRegistry";
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

  if (step.unprompted && !insideSundayStandingWindow(step, now)) {
    return {
      skipped: "outside_authorized_sunday_window",
      weekStart: step.weekStart,
    };
  }

  const approvedByUserId =
    context.actor.kind === "user_delegation"
      ? identity.canonicalOpenId
      : null;
  const result = await executeClairePersistentOperatorAction({
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
    exactAction: SUNDAY_WEEKLY_PLANNING_ACTION,
    standingAuthorizationId: context.actor.standingAuthorizationId,
    approvedByUserId,
    expiresAtMs: Date.now() + 5 * 60_000,
    scope: { identity: identity.canonicalOpenId },
    execute: async () => {
      let opening: string;
      let sessionKind: "weekly_planning_invite" | "weekly_planning";
      if (step.appointmentKind === "weekly_planning_callback") {
        const weekly = await beginWeeklyMission({
          tenantId: context.scope.tenantId,
          operatorId: identity.weeklyOperatorId,
          operatorIdentities: identity.aliases.map(alias => ({
            operatorId: alias.openId,
            dayDirectorActorId: String(alias.userId),
          })),
          dayDirectorActorId: identity.dayDirectorActorId,
          dayDirectorActorIds: identity.dayDirectorActorIds,
          timeZone: step.timeZone,
          now,
          weekStartOverride: step.weekStart,
        });
        opening = weekly.speech;
        sessionKind = "weekly_planning";
      } else {
        const pace = await macroGoalPaceLine({
          tenantId: context.scope.tenantId,
          canonicalOperatorId: identity.canonicalOperatorId,
          now,
        });
        opening = [
          "The week isn't planned yet.",
          pace,
          "Want to do it now, or what time tonight?",
        ]
          .filter(Boolean)
          .join(" ");
        sessionKind = "weekly_planning_invite";
      }

      if (!store) {
        throw new Error("Operator appointment execution requires its durable store");
      }
      const dispatchClaimed = await store.beginCallDispatch(step);
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
