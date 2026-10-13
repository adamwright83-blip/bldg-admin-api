import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { formatInTimeZone } from "date-fns-tz";
import {
  operatorAppointments,
  tenantStandingAuthorizations,
  users,
} from "../../../drizzle/schema";
import {
  WEEKDAY_STRATEGIC_PLANNING_ACTION,
  strategicCallAuthorizedNow,
  validStrategicCallBounds,
} from "../../../shared/strategicCallAuthorization";
import { getDb } from "../../db";
import type { CanonicalOperatorIdentity } from "./identity";
import { evaluatePersistentActionPolicy } from "./actionPolicy";
import { resolveOperatorTimeZone } from "./operatorAppointmentPolicy";
import { OperatorAppointmentStore } from "./operatorAppointmentStore";
import { weekStartMonday } from "../../../shared/weeklyMissionReadiness";
import {
  strategicResponses,
  loadStrategicProposal,
} from "../../strategy/strategicStore";

export async function grantStrategicCallAuthorization(input: {
  identity: CanonicalOperatorIdentity;
  weekdays: number[];
  localStart: string;
  localEnd: string;
  timeZone: string;
  dailyLimit: number;
  sourceReference: string;
}) {
  if (
    !["owner", "admin", "operator"].includes(input.identity.membership.source)
  )
    throw new Error("Authenticated operator consent required");
  if (!input.sourceReference.startsWith("authenticated_app:"))
    throw new Error("Authenticated consent source required");
  const zone = await resolveOperatorTimeZone(input.identity.tenantId);
  if (zone !== input.timeZone)
    throw new Error("Consent timezone must match configured business timezone");
  const row = {
    id: randomUUID(),
    tenantId: input.identity.tenantId,
    canonicalOperatorId: input.identity.canonicalOperatorId,
    operatorUserId: input.identity.canonicalOpenId,
    channel: "call",
    recipientClass: "authorized_operator",
    exactAction: WEEKDAY_STRATEGIC_PLANNING_ACTION,
    dailyLimit: input.dailyLimit,
    allowedWeekdaysJson: [...new Set(input.weekdays)].sort(),
    allowedLocalStart: input.localStart,
    allowedLocalEnd: input.localEnd,
    timeZone: input.timeZone,
    version: 1,
    sourceReference: input.sourceReference,
    authorizedByUserId: input.identity.canonicalOpenId,
    revokedAt: null,
  };
  if (!validStrategicCallBounds(row))
    throw new Error("Invalid weekday call consent bounds");
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.transaction(async tx => {
    await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, input.identity.canonicalUserId))
      .for("update");
    const rows = await tx
      .select()
      .from(tenantStandingAuthorizations)
      .where(
        and(
          eq(tenantStandingAuthorizations.tenantId, row.tenantId),
          eq(
            tenantStandingAuthorizations.canonicalOperatorId,
            row.canonicalOperatorId
          ),
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
          eq(
            tenantStandingAuthorizations.canonicalOperatorId,
            row.canonicalOperatorId
          ),
          eq(tenantStandingAuthorizations.exactAction, row.exactAction),
          isNull(tenantStandingAuthorizations.revokedAt)
        )
      );
    await tx.insert(tenantStandingAuthorizations).values(row);
  });
  const [stored] = await db
    .select()
    .from(tenantStandingAuthorizations)
    .where(
      and(
        eq(tenantStandingAuthorizations.tenantId, row.tenantId),
        eq(tenantStandingAuthorizations.id, row.id)
      )
    )
    .limit(1);
  if (!stored || !validStrategicCallBounds(stored))
    throw new Error("Consent readback failed");
  return stored;
}
export async function revokeStrategicCallAuthorization(
  identity: CanonicalOperatorIdentity
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db
    .update(tenantStandingAuthorizations)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(tenantStandingAuthorizations.tenantId, identity.tenantId),
        eq(
          tenantStandingAuthorizations.canonicalOperatorId,
          identity.canonicalOperatorId
        ),
        eq(
          tenantStandingAuthorizations.exactAction,
          WEEKDAY_STRATEGIC_PLANNING_ACTION
        ),
        isNull(tenantStandingAuthorizations.revokedAt)
      )
    );
  return { revoked: true };
}
export async function scheduleAuthorizedStrategicCall(input: {
  identity: CanonicalOperatorIdentity;
  timeZone: string;
  proposalId: string;
  store: OperatorAppointmentStore;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [a] = await db
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
          WEEKDAY_STRATEGIC_PLANNING_ACTION
        ),
        isNull(tenantStandingAuthorizations.revokedAt)
      )
    )
    .orderBy(desc(tenantStandingAuthorizations.version))
    .limit(1);
  if (!a || !strategicCallAuthorizedNow(a, now, input.timeZone))
    return { scheduled: false, reason: "no_authorized_channel" };
  const proposal = await loadStrategicProposal(
    input.identity,
    input.proposalId
  );
  if (!proposal || Date.parse(proposal.expiresAt) <= now.getTime())
    return { scheduled: false, reason: "proposal_unavailable_or_stale" };
  const responses = await strategicResponses(input.identity, input.proposalId);
  if (
    responses.some(r => ["reject", "defer", "revise"].includes(r.action)) ||
    proposal.items.every(i =>
      responses.some(r => r.action === "approve" && r.itemIds.includes(i.id))
    )
  )
    return { scheduled: false, reason: "operator_decision_already_recorded" };
  const policy = await evaluatePersistentActionPolicy({
    tenantId: input.identity.tenantId,
    canonicalOperatorId: input.identity.canonicalOperatorId,
    operatorUserId: input.identity.canonicalOpenId,
    exactAction: WEEKDAY_STRATEGIC_PLANNING_ACTION,
    riskClass: "EXTERNAL_COMMUNICATION",
    standingAuthorizationId: a.id,
    now,
  });
  if (!policy.allowed) return { scheduled: false, reason: policy.reason };
  const date = formatInTimeZone(now, a.timeZone, "yyyy-MM-dd");
  const idempotencyKey = `weekday_strategy:${input.identity.canonicalOperatorId}:${date}`;
  const [existing] = await db
    .select({ id: operatorAppointments.id })
    .from(operatorAppointments)
    .where(
      and(
        eq(operatorAppointments.tenantId, input.identity.tenantId),
        eq(operatorAppointments.idempotencyKey, idempotencyKey)
      )
    )
    .limit(1);
  if (existing)
    return { scheduled: false, reason: "already_scheduled_for_business_date" };
  try {
    const result = await input.store.enqueue({
      tenantId: input.identity.tenantId,
      canonicalOperatorId: input.identity.canonicalOperatorId,
      operatorUserId: input.identity.canonicalOpenId,
      appointmentKind: "weekday_strategic_planning",
      weekStart: weekStartMonday(date),
      scheduledFor: now,
      timeZone: a.timeZone,
      source: "standing_weekly_authorization",
      sourceReference: `strategic_proposal:${input.proposalId}`,
      standingAuthorizationId: a.id,
      unprompted: true,
      idempotencyKey,
    });
    return { scheduled: true, ...result };
  } catch (error) {
    if (
      error instanceof Error &&
      error.message ===
        "Operator appointment idempotency key is bound to different work"
    )
      return {
        scheduled: false,
        reason: "already_scheduled_for_business_date",
      };
    throw error;
  }
}

/** Canonical consent read port for authenticated application delivery. */
export async function readStrategicCallConsent(
  identity: CanonicalOperatorIdentity
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [authorization] = await db
    .select()
    .from(tenantStandingAuthorizations)
    .where(
      and(
        eq(tenantStandingAuthorizations.tenantId, identity.tenantId),
        eq(
          tenantStandingAuthorizations.canonicalOperatorId,
          identity.canonicalOperatorId
        ),
        eq(
          tenantStandingAuthorizations.exactAction,
          WEEKDAY_STRATEGIC_PLANNING_ACTION
        ),
        isNull(tenantStandingAuthorizations.revokedAt)
      )
    )
    .orderBy(desc(tenantStandingAuthorizations.version))
    .limit(1);
  return {
    authorization: authorization ?? null,
    timeZone: await resolveOperatorTimeZone(identity.tenantId),
  };
}
