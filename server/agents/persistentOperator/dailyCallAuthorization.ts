import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { operatorAppointments, tenantStandingAuthorizations, users } from "../../../drizzle/schema";
import {
  DAILY_CLAIRE_CALLS,
  DAILY_CLAIRE_PURPOSES,
  dailyCallStillDueToday,
  dailyPurposeForAction,
  validDailyCallBounds,
  windowsOverlap,
  type DailyClairePurpose,
} from "../../../shared/dailyClaireCalls";
import { weekStartMonday } from "../../../shared/weeklyMissionReadiness";
import { getDb } from "../../db";
import type { CanonicalOperatorIdentity } from "./identity";
import { resolveOperatorTimeZone } from "./operatorAppointmentPolicy";
import type { OperatorAppointmentStore } from "./operatorAppointmentStore";

/**
 * Standing grants for the two daily Claire calls. Each purpose has its own
 * exact action, versioned grant row, and revocation. Nothing here reads or
 * migrates the Sunday or weekday strategic-planning grants.
 */

async function activeGrant(identity: Pick<CanonicalOperatorIdentity, "tenantId" | "canonicalOperatorId">, purpose: DailyClairePurpose) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [row] = await db
    .select()
    .from(tenantStandingAuthorizations)
    .where(
      and(
        eq(tenantStandingAuthorizations.tenantId, identity.tenantId),
        eq(tenantStandingAuthorizations.canonicalOperatorId, identity.canonicalOperatorId),
        eq(tenantStandingAuthorizations.exactAction, DAILY_CLAIRE_CALLS[purpose].exactAction),
        isNull(tenantStandingAuthorizations.revokedAt)
      )
    )
    .orderBy(desc(tenantStandingAuthorizations.version))
    .limit(1);
  return row ?? null;
}

export async function grantDailyClaireCall(input: {
  identity: CanonicalOperatorIdentity;
  purpose: DailyClairePurpose;
  weekdays: number[];
  localStart: string;
  localEnd: string;
  timeZone: string;
  sourceReference: string;
}) {
  if (!["owner", "admin", "operator"].includes(input.identity.membership.source))
    throw new Error("Authenticated operator consent required");
  if (!input.sourceReference.startsWith("authenticated_app:"))
    throw new Error("Authenticated consent source required");
  const zone = await resolveOperatorTimeZone(input.identity.tenantId);
  if (zone !== input.timeZone) throw new Error("Consent timezone must match configured business timezone");
  const row = {
    id: randomUUID(),
    tenantId: input.identity.tenantId,
    canonicalOperatorId: input.identity.canonicalOperatorId,
    operatorUserId: input.identity.canonicalOpenId,
    channel: "call",
    recipientClass: "authorized_operator",
    exactAction: DAILY_CLAIRE_CALLS[input.purpose].exactAction,
    dailyLimit: 1,
    allowedWeekdaysJson: [...new Set(input.weekdays)].sort(),
    allowedLocalStart: input.localStart,
    allowedLocalEnd: input.localEnd,
    timeZone: input.timeZone,
    version: 1,
    sourceReference: input.sourceReference,
    authorizedByUserId: input.identity.canonicalOpenId,
    revokedAt: null,
  };
  if (!validDailyCallBounds(row, input.purpose)) throw new Error("Invalid daily call consent bounds");
  const other = DAILY_CLAIRE_PURPOSES.find(p => p !== input.purpose)!;
  const otherGrant = await activeGrant(input.identity, other);
  if (otherGrant && windowsOverlap(row, otherGrant))
    throw new Error(`${DAILY_CLAIRE_CALLS[input.purpose].label} window overlaps the ${DAILY_CLAIRE_CALLS[other].label.toLowerCase()} window`);
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.transaction(async tx => {
    await tx.select({ id: users.id }).from(users).where(eq(users.id, input.identity.canonicalUserId)).for("update");
    const rows = await tx
      .select()
      .from(tenantStandingAuthorizations)
      .where(
        and(
          eq(tenantStandingAuthorizations.tenantId, row.tenantId),
          eq(tenantStandingAuthorizations.canonicalOperatorId, row.canonicalOperatorId),
          eq(tenantStandingAuthorizations.exactAction, row.exactAction)
        )
      )
      .orderBy(desc(tenantStandingAuthorizations.version));
    row.version = (rows[0]?.version ?? 0) + 1;
    await tx
      .update(tenantStandingAuthorizations)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(tenantStandingAuthorizations.tenantId, row.tenantId),
          eq(tenantStandingAuthorizations.canonicalOperatorId, row.canonicalOperatorId),
          eq(tenantStandingAuthorizations.exactAction, row.exactAction),
          isNull(tenantStandingAuthorizations.revokedAt)
        )
      );
    await tx.insert(tenantStandingAuthorizations).values(row);
  });
  const stored = await activeGrant(input.identity, input.purpose);
  if (!stored || stored.id !== row.id || !validDailyCallBounds(stored, input.purpose))
    throw new Error("Consent readback failed");
  return stored;
}

/** Revokes only this purpose; future appointments for it fail their dispatch fence. */
export async function revokeDailyClaireCall(identity: CanonicalOperatorIdentity, purpose: DailyClairePurpose) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db
    .update(tenantStandingAuthorizations)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(tenantStandingAuthorizations.tenantId, identity.tenantId),
        eq(tenantStandingAuthorizations.canonicalOperatorId, identity.canonicalOperatorId),
        eq(tenantStandingAuthorizations.exactAction, DAILY_CLAIRE_CALLS[purpose].exactAction),
        isNull(tenantStandingAuthorizations.revokedAt)
      )
    );
  return { revoked: true, purpose };
}

/** Settings read: grant, next scheduled call and recent outcomes per purpose. */
export async function readDailyClaireCallStatus(identity: CanonicalOperatorIdentity) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const timeZone = await resolveOperatorTimeZone(identity.tenantId);
  const out: Record<DailyClairePurpose, unknown> = {} as never;
  for (const purpose of DAILY_CLAIRE_PURPOSES) {
    const grant = await activeGrant(identity, purpose);
    const recent = await db
      .select({
        id: operatorAppointments.id,
        scheduledFor: operatorAppointments.scheduledFor,
        status: operatorAppointments.status,
        callSid: operatorAppointments.callSid,
      })
      .from(operatorAppointments)
      .where(
        and(
          eq(operatorAppointments.tenantId, identity.tenantId),
          eq(operatorAppointments.canonicalOperatorId, identity.canonicalOperatorId),
          eq(operatorAppointments.appointmentKind, DAILY_CLAIRE_CALLS[purpose].appointmentKind)
        )
      )
      .orderBy(desc(operatorAppointments.scheduledFor))
      .limit(5);
    out[purpose] = {
      enabled: Boolean(grant),
      grant: grant
        ? {
            weekdays: typeof grant.allowedWeekdaysJson === "string" ? JSON.parse(grant.allowedWeekdaysJson) : grant.allowedWeekdaysJson,
            localStart: grant.allowedLocalStart,
            localEnd: grant.allowedLocalEnd,
            version: grant.version,
          }
        : null,
      nextScheduled: recent.find(r => r.status === "scheduled" || r.status === "retry_scheduled")?.scheduledFor ?? null,
      recent: recent.map(r => ({ scheduledFor: r.scheduledFor, status: r.status, placed: Boolean(r.callSid) })),
    };
  }
  return { timeZone, ...out };
}

export function dailyCallIdempotencyKey(purpose: DailyClairePurpose, canonicalOperatorId: string, businessDate: string) {
  return `${DAILY_CLAIRE_CALLS[purpose].appointmentKind}:${canonicalOperatorId}:${businessDate}`;
}

/**
 * Seeds today's appointment for every active, valid daily grant whose window has
 * not ended. One appointment per purpose, operator and business date; the store's
 * idempotency key makes repeated seeding (and restarts) harmless.
 */
export async function ensureDailyClaireAppointments(input: { store: OperatorAppointmentStore; now?: Date; tenantId?: string }) {
  const now = input.now ?? new Date();
  const db = await getDb();
  if (!db) return { seeded: 0 };
  const grants = await db
    .select()
    .from(tenantStandingAuthorizations)
    .where(
      and(
        inArray(
          tenantStandingAuthorizations.exactAction,
          DAILY_CLAIRE_PURPOSES.map(p => DAILY_CLAIRE_CALLS[p].exactAction)
        ),
        isNull(tenantStandingAuthorizations.revokedAt),
        ...(input.tenantId ? [eq(tenantStandingAuthorizations.tenantId, input.tenantId)] : [])
      )
    );
  let seeded = 0;
  for (const grant of grants) {
    const purpose = dailyPurposeForAction(grant.exactAction);
    if (!purpose || !dailyCallStillDueToday(grant, purpose, now)) continue;
    const businessDate = formatInTimeZone(now, grant.timeZone, "yyyy-MM-dd");
    const windowStart = fromZonedTime(`${businessDate}T${grant.allowedLocalStart}:00`, grant.timeZone);
    const result = await input.store
      .enqueue({
        tenantId: grant.tenantId,
        canonicalOperatorId: grant.canonicalOperatorId,
        operatorUserId: grant.operatorUserId,
        appointmentKind: DAILY_CLAIRE_CALLS[purpose].appointmentKind,
        weekStart: weekStartMonday(businessDate),
        scheduledFor: windowStart > now ? windowStart : now,
        timeZone: grant.timeZone,
        source: "standing_weekly_authorization",
        sourceReference: `${DAILY_CLAIRE_CALLS[purpose].appointmentKind}:${businessDate}`,
        standingAuthorizationId: grant.id,
        unprompted: true,
        idempotencyKey: dailyCallIdempotencyKey(purpose, grant.canonicalOperatorId, businessDate),
        maxAttempts: 2,
      })
      .catch(error => {
        if (error instanceof Error && error.message === "Operator appointment idempotency key is bound to different work")
          return { created: false };
        throw error;
      });
    if (result.created) seeded += 1;
  }
  return { seeded };
}
