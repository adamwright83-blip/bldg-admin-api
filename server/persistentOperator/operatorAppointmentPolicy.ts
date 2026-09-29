import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import {
  legacyDayforgeSaasMemberships,
  legacyDayforgeSaasTenants,
  tenantStandingAuthorizations,
  users,
} from "../../drizzle/schema";
import { PERSISTENT_OPERATOR_ENTITLEMENT } from "../../shared/saasTenant";
import { addDaysYmd } from "../analytics/businessPeriods";
import { ENV } from "../_core/env";
import { getDb } from "../db";
import { getDashboardTimeZone } from "../dashboardZoned";
import { logAgentEvent } from "../agents/agentEvents";
import { createClairePlanningCalendarEvent } from "../googleCalendar/googleCalendarService";
import {
  hasTenantEntitlement,
  isLegacyDayforgeTenant,
} from "../saas/tenantAccess";
import { latestWeeklyIntentForOperators } from "../claire/weeklyMission/intentStore";
import {
  resolveCanonicalOperatorIdentity,
  type CanonicalOperatorIdentity,
} from "./identity";
import { getDefaultGoalCyclePool } from "./goalCycleStore";
import { OperatorAppointmentStore } from "./operatorAppointmentStore";

export const SUNDAY_WEEKLY_PLANNING_ACTION = "claire.weekly_planning.call";
export const SUNDAY_WEEKLY_PLANNING_SOURCE =
  "operator_rule:2026-09-28:sunday_weekly_planning";
export const SUNDAY_PLANNING_LOCAL_START = "17:00";
export const SUNDAY_PLANNING_LOCAL_END = "20:00";
export const SUNDAY_PLANNING_DEFAULT_LOCAL_TIME = "18:00";

type ResolvedConfiguredOwner = {
  identity: CanonicalOperatorIdentity;
  timeZone: string;
};

function validTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export async function resolveOperatorTimeZone(
  tenantId: string
): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const [tenant] = await db
    .select({ timeZone: legacyDayforgeSaasTenants.timeZone })
    .from(legacyDayforgeSaasTenants)
    .where(eq(legacyDayforgeSaasTenants.id, tenantId))
    .limit(1);
  const configured = tenant?.timeZone?.trim() ?? "";
  if (configured && validTimeZone(configured)) return configured;
  if (isLegacyDayforgeTenant(tenantId)) {
    const fallback = getDashboardTimeZone();
    return validTimeZone(fallback) ? fallback : null;
  }
  return null;
}

async function resolveConfiguredOwner(): Promise<ResolvedConfiguredOwner | null> {
  const ownerOpenId = ENV.ownerOpenId.trim();
  if (!ownerOpenId) return null;
  const db = await getDb();
  if (!db) return null;
  const [owner] = await db
    .select({
      id: users.id,
      openId: users.openId,
      tenantId: users.tenantId,
    })
    .from(users)
    .where(eq(users.openId, ownerOpenId))
    .limit(1);
  if (!owner) return null;

  let tenantId = owner.tenantId?.trim() || "";
  if (!tenantId) {
    const memberships = await db
      .select({ tenantId: legacyDayforgeSaasMemberships.tenantId })
      .from(legacyDayforgeSaasMemberships)
      .where(
        and(
          eq(legacyDayforgeSaasMemberships.userOpenId, owner.openId),
          eq(legacyDayforgeSaasMemberships.active, true)
        )
      );
    const unique = [...new Set(memberships.map(row => row.tenantId.trim()).filter(Boolean))];
    if (unique.length !== 1) return null;
    tenantId = unique[0]!;
  }

  const resolution = await resolveCanonicalOperatorIdentity({
    tenantId,
    source: {
      type: "open_id",
      value: owner.openId,
      expectedUserId: owner.id,
    },
    subsystem: "persistent_operator.sunday_planning",
  });
  if (!resolution.ok) return null;

  const timeZone = await resolveOperatorTimeZone(tenantId);
  if (!timeZone) return null;
  return { identity: resolution.identity, timeZone };
}

export async function ensureSundayPlanningStandingAuthorization(input: {
  identity: CanonicalOperatorIdentity;
  timeZone: string;
}): Promise<{ id: string } | null> {
  // This is intentionally narrow. The product-level authorization in the PR3
  // contract belongs to the configured owner only; it is not a generic rule
  // that grants every tenant operator unsolicited calls.
  if (
    !ENV.ownerOpenId.trim() ||
    input.identity.sourceOpenId !== ENV.ownerOpenId.trim()
  ) {
    return null;
  }

  const entitled = await hasTenantEntitlement({
    tenantId: input.identity.tenantId,
    entitlement: PERSISTENT_OPERATOR_ENTITLEMENT,
  });
  if (!entitled) return null;

  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(tenantStandingAuthorizations)
    .where(
      and(
        eq(tenantStandingAuthorizations.tenantId, input.identity.tenantId),
        eq(
          tenantStandingAuthorizations.canonicalOperatorId,
          input.identity.canonicalOperatorId
        ),
        eq(
          tenantStandingAuthorizations.exactAction,
          SUNDAY_WEEKLY_PLANNING_ACTION
        )
      )
    )
    .orderBy(desc(tenantStandingAuthorizations.version));

  const latest = rows[0] ?? null;
  if (latest?.revokedAt) return null;
  if (
    latest &&
    latest.timeZone === input.timeZone &&
    latest.allowedLocalStart === SUNDAY_PLANNING_LOCAL_START &&
    latest.allowedLocalEnd === SUNDAY_PLANNING_LOCAL_END
  ) {
    return { id: latest.id };
  }

  if (latest) {
    await db
      .update(tenantStandingAuthorizations)
      .set({ revokedAt: new Date() })
      .where(eq(tenantStandingAuthorizations.id, latest.id));
  }

  const id = randomUUID();
  const version = (latest?.version ?? 0) + 1;
  await db.insert(tenantStandingAuthorizations).values({
    id,
    tenantId: input.identity.tenantId,
    canonicalOperatorId: input.identity.canonicalOperatorId,
    operatorUserId: input.identity.canonicalOpenId,
    channel: "call",
    recipientClass: "authorized_operator",
    exactAction: SUNDAY_WEEKLY_PLANNING_ACTION,
    dailyLimit: 1,
    allowedLocalStart: SUNDAY_PLANNING_LOCAL_START,
    allowedLocalEnd: SUNDAY_PLANNING_LOCAL_END,
    timeZone: input.timeZone,
    version,
    sourceReference: SUNDAY_WEEKLY_PLANNING_SOURCE,
    authorizedByUserId: input.identity.canonicalOpenId,
  });
  return { id };
}

export function upcomingSundayPlanningSlot(input: {
  now: Date;
  timeZone: string;
}): { scheduledFor: Date; sundayYmd: string; weekStart: string } {
  const localYmd = formatInTimeZone(input.now, input.timeZone, "yyyy-MM-dd");
  const weekday = Number(formatInTimeZone(input.now, input.timeZone, "i"));
  const localHm = formatInTimeZone(input.now, input.timeZone, "HH:mm");
  let daysUntilSunday = (7 - weekday + 7) % 7;
  if (
    weekday === 7 &&
    localHm > SUNDAY_PLANNING_LOCAL_END
  ) {
    daysUntilSunday = 7;
  }
  const sundayYmd = addDaysYmd(localYmd, daysUntilSunday);
  return {
    scheduledFor: fromZonedTime(
      `${sundayYmd}T${SUNDAY_PLANNING_DEFAULT_LOCAL_TIME}:00`,
      input.timeZone
    ),
    sundayYmd,
    weekStart: addDaysYmd(sundayYmd, 1),
  };
}

export async function ensureSundayPlanningAppointment(input: {
  store: OperatorAppointmentStore;
  now?: Date;
}): Promise<{ id: string; created: boolean } | null> {
  const configured = await resolveConfiguredOwner();
  if (!configured) return null;
  const { identity, timeZone } = configured;
  const authorization = await ensureSundayPlanningStandingAuthorization({
    identity,
    timeZone,
  });
  if (!authorization) return null;

  const slot = upcomingSundayPlanningSlot({
    now: input.now ?? new Date(),
    timeZone,
  });
  const locked = await latestWeeklyIntentForOperators({
    tenantId: identity.tenantId,
    operatorIds: [
      identity.canonicalOpenId,
      ...identity.aliases.map(alias => alias.openId),
    ],
    weekStart: slot.weekStart,
  });
  if (locked) return null;

  const result = await input.store.enqueue({
    tenantId: identity.tenantId,
    canonicalOperatorId: identity.canonicalOperatorId,
    operatorUserId: identity.canonicalOpenId,
    appointmentKind: "sunday_weekly_planning",
    weekStart: slot.weekStart,
    scheduledFor: slot.scheduledFor,
    timeZone,
    source: "standing_weekly_authorization",
    sourceReference: SUNDAY_WEEKLY_PLANNING_SOURCE,
    standingAuthorizationId: authorization.id,
    unprompted: true,
    idempotencyKey: `sunday_weekly_planning:${identity.canonicalOperatorId}:${slot.weekStart}`,
  });

  if (result.created) {
    await logAgentEvent({
      ctx: {
        tenantId: identity.tenantId,
        agentType: "goal_cycle_agent",
        actorType: "system",
        actorId: identity.canonicalOpenId,
        canonicalOperatorId: identity.canonicalOperatorId,
        standingAuthorizationId: authorization.id,
      },
      toolName: "scheduleClaireSundayPlanningCall",
      inputJson: {
        appointmentId: result.id,
        weekStart: slot.weekStart,
        scheduledFor: slot.scheduledFor.toISOString(),
        timeZone,
      },
      outputJson: { scheduled: true },
      status: "success",
      entityType: "operator_appointment",
      entityId: result.id,
    }).catch(() => undefined);
  }

  return result;
}

export type WeeklyPlanningCallbackParseResult =
  | { kind: "not_request" }
  | { kind: "invalid"; speech: string }
  | {
      kind: "request";
      scheduledFor: Date;
      readback: string;
      inferredMeridiem: boolean;
    };

export function parseWeeklyPlanningCallbackRequest(input: {
  utterance: string;
  now: Date;
  timeZone: string;
}): WeeklyPlanningCallbackParseResult {
  const text = input.utterance.trim();
  if (
    !/\bcall me(?: back)?\b/i.test(text) &&
    !/\blet'?s do (?:this|it) at\b/i.test(text)
  ) {
    return { kind: "not_request" };
  }
  const match = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\b/i);
  if (!match) {
    return { kind: "invalid", speech: "What time should I call you?" };
  }
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  if (hour < 1 || hour > 12 || minute < 0 || minute > 59) {
    return { kind: "invalid", speech: "Give me a valid call time." };
  }
  const meridiem = match[3]?.toLowerCase().replaceAll(".", "") ?? null;
  const inferredMeridiem = !meridiem;
  if (meridiem === "pm" && hour !== 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  if (!meridiem) {
    // An unqualified callback time is resolved only inside the authorized
    // Sunday 5–8 PM planning window. Anything else needs explicit AM/PM.
    if (hour < 5 || hour > 8) {
      return {
        kind: "invalid",
        speech: "Say AM or PM for that time.",
      };
    }
    hour += 12;
  }

  const localYmd = formatInTimeZone(input.now, input.timeZone, "yyyy-MM-dd");
  const scheduledFor = fromZonedTime(
    `${localYmd}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`,
    input.timeZone
  );
  if (scheduledFor.getTime() <= input.now.getTime()) {
    return {
      kind: "invalid",
      speech: "That time has already passed. Pick another time.",
    };
  }
  const readback = formatInTimeZone(
    scheduledFor,
    input.timeZone,
    "h:mm a"
  );
  return {
    kind: "request",
    scheduledFor,
    readback,
    inferredMeridiem,
  };
}

export async function scheduleWeeklyPlanningCallback(input: {
  identity: CanonicalOperatorIdentity;
  timeZone: string;
  weekStart: string;
  scheduledFor: Date;
  sourceReference: string;
  store: OperatorAppointmentStore;
}): Promise<{ id: string; created: boolean; readback: string }> {
  const cancelledPriorCallbacks = await input.store.cancelPendingCallbacks({
    tenantId: input.identity.tenantId,
    canonicalOperatorId: input.identity.canonicalOperatorId,
    weekStart: input.weekStart,
  });

  const key = [
    "weekly_planning_callback",
    input.identity.canonicalOperatorId,
    input.weekStart,
    input.sourceReference,
    input.scheduledFor.toISOString(),
  ].join(":");
  const result = await input.store.enqueue({
    tenantId: input.identity.tenantId,
    canonicalOperatorId: input.identity.canonicalOperatorId,
    operatorUserId: input.identity.canonicalOpenId,
    appointmentKind: "weekly_planning_callback",
    weekStart: input.weekStart,
    scheduledFor: input.scheduledFor,
    timeZone: input.timeZone,
    source: "explicit_operator_request",
    sourceReference: input.sourceReference,
    standingAuthorizationId: null,
    unprompted: false,
    idempotencyKey: key,
  });

  await logAgentEvent({
    ctx: {
      tenantId: input.identity.tenantId,
      agentType: "goal_cycle_agent",
      actorType: "human",
      actorId: input.identity.canonicalOpenId,
      canonicalOperatorId: input.identity.canonicalOperatorId,
      approvedByUserId: input.identity.canonicalOpenId,
    },
    toolName:
      cancelledPriorCallbacks > 0
        ? "rescheduleClaireWeeklyPlanningCallback"
        : "scheduleClaireWeeklyPlanningCallback",
    inputJson: {
      appointmentId: result.id,
      scheduledFor: input.scheduledFor.toISOString(),
      sourceReference: input.sourceReference,
    },
    outputJson: { scheduled: true },
    status: "success",
    entityType: "operator_appointment",
    entityId: result.id,
  }).catch(() => undefined);

  const calendar = await createClairePlanningCalendarEvent({
    tenantId: input.identity.tenantId,
    userId: input.identity.canonicalOpenId,
    appointmentId: result.id,
    scheduledFor: input.scheduledFor,
    timeZone: input.timeZone,
  });
  await input.store.recordCalendarResult({
    tenantId: input.identity.tenantId,
    appointmentId: result.id,
    status: calendar.status,
    eventId: calendar.eventId,
  });

  return {
    ...result,
    readback: formatInTimeZone(input.scheduledFor, input.timeZone, "h:mm a"),
  };
}


export function createDefaultOperatorAppointmentStore(): OperatorAppointmentStore {
  return new OperatorAppointmentStore(getDefaultGoalCyclePool());
}

export async function scheduleWeeklyPlanningCallbackForOperator(input: {
  tenantId: string;
  operatorUserId: string;
  timeZone: string;
  weekStart: string;
  scheduledFor: Date;
  sourceReference: string;
  store?: OperatorAppointmentStore;
}) {
  const resolution = await resolveCanonicalOperatorIdentity({
    tenantId: input.tenantId,
    source: { type: "open_id", value: input.operatorUserId },
    subsystem: "persistent_operator.weekly_planning_callback",
  });
  if (!resolution.ok) {
    throw new Error(`Unable to resolve callback operator identity: ${resolution.reason}`);
  }
  return scheduleWeeklyPlanningCallback({
    identity: resolution.identity,
    timeZone: input.timeZone,
    weekStart: input.weekStart,
    scheduledFor: input.scheduledFor,
    sourceReference: input.sourceReference,
    store: input.store ?? createDefaultOperatorAppointmentStore(),
  });
}
