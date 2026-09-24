/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { and, eq } from "drizzle-orm";
import {
  legacyDayforgeAuditEvents,
  legacyDayforgeProductEvents,
} from "../../drizzle/schema";
import {
  sanitizeDayforgeProductEventProperties,
  type LegacyDayforgeProductEventName,
} from "@shared/legacyDayforgeEvents";
import { getDb } from "../db";

const PRODUCT_ANALYTICS_RETENTION_MS = 400 * 24 * 60 * 60 * 1000;

export type LegacyDayforgeServerActor = {
  type:
    | "public"
    | "owner"
    | "admin"
    | "operator"
    | "field"
    | "game"
    | "stripe"
    | "system";
  id: string | null;
};

type LegacyDayforgeDatabase = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type LegacyDayforgeTransaction = Parameters<
  Parameters<LegacyDayforgeDatabase["transaction"]>[0]
>[0];

export type LegacyDayforgeEventConnection = LegacyDayforgeDatabase | LegacyDayforgeTransaction;

export type LegacyDayforgeEventInput = {
  tenantId?: string | null;
  anonymousSessionId?: string | null;
  systemScopeId?: string | null;
  actor: LegacyDayforgeServerActor;
  entityType: string;
  entityId: string;
  eventName: string;
  before?: unknown;
  after?: unknown;
  source: string;
  correlationId: string;
  idempotencyKey: string;
  occurredAt?: Date;
  productEvent?: {
    name: LegacyDayforgeProductEventName;
    properties?: Record<string, unknown>;
    missionId?: number | null;
    accountId?: number | null;
    opportunityId?: number | null;
    customerId?: number | null;
    purgeAfter?: Date | null;
  };
};

function assertIdentifier(label: string, value: string, max: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new Error(`${label} must be between 1 and ${max} characters`);
  }
  return normalized;
}

export function legacyDayforgeEventScope(input: {
  tenantId?: string | null;
  anonymousSessionId?: string | null;
  systemScopeId?: string | null;
}): string {
  if (input.tenantId?.trim()) {
    return `tenant:${assertIdentifier("tenantId", input.tenantId, 64)}`;
  }
  if (input.anonymousSessionId?.trim()) {
    return `public:${assertIdentifier("anonymousSessionId", input.anonymousSessionId, 64)}`;
  }
  if (input.systemScopeId?.trim()) {
    return `system:${assertIdentifier("systemScopeId", input.systemScopeId, 128)}`;
  }
  throw new Error(
    "A DayForge event requires a tenant, anonymous session, or system scope"
  );
}

export function buildDayforgeEventRows(input: LegacyDayforgeEventInput) {
  const scopeKey = legacyDayforgeEventScope(input);
  const tenantId = input.tenantId?.trim() || null;
  const anonymousSessionId = input.anonymousSessionId?.trim() || null;
  const occurredAt = input.occurredAt ?? new Date();
  const entityType = assertIdentifier("entityType", input.entityType, 96);
  const entityId = assertIdentifier("entityId", input.entityId, 128);
  const eventName = assertIdentifier("eventName", input.eventName, 96);
  const source = assertIdentifier("source", input.source, 96);
  const correlationId = assertIdentifier(
    "correlationId",
    input.correlationId,
    191
  );
  const idempotencyKey = assertIdentifier(
    "idempotencyKey",
    input.idempotencyKey,
    191
  );
  const actorId = input.actor.id
    ? assertIdentifier("actorId", input.actor.id, 128)
    : null;
  const audit = {
    scopeKey,
    tenantId,
    actorType: input.actor.type,
    actorId,
    entityType,
    entityId,
    eventName,
    beforeJson: input.before ?? null,
    afterJson: input.after ?? null,
    source,
    correlationId,
    idempotencyKey,
    createdAt: occurredAt,
  };
  const product = input.productEvent
    ? {
        id: crypto.randomUUID(),
        scopeKey,
        tenantId,
        anonymousSessionId,
        actorType: input.actor.type,
        actorId,
        entityType,
        entityId,
        missionId: input.productEvent.missionId ?? null,
        accountId: input.productEvent.accountId ?? null,
        opportunityId: input.productEvent.opportunityId ?? null,
        customerId: input.productEvent.customerId ?? null,
        eventName: input.productEvent.name,
        eventVersion: 1,
        propertiesJson: sanitizeDayforgeProductEventProperties(
          input.productEvent.name,
          input.productEvent.properties ?? {}
        ),
        source,
        correlationId,
        idempotencyKey,
        occurredAt,
        purgeAfter:
          input.productEvent.purgeAfter ??
          new Date(occurredAt.getTime() + PRODUCT_ANALYTICS_RETENTION_MS),
      }
    : null;
  return { audit, product };
}

/**
 * Appends both projections using the caller's transaction. Callers must pass
 * actor, source and correlation values derived by trusted server code, never
 * values accepted directly from an API payload.
 */
export async function writeDayforgeEventWith(
  connection: LegacyDayforgeEventConnection,
  input: LegacyDayforgeEventInput
) {
  const rows = buildDayforgeEventRows(input);
  await connection
    .insert(legacyDayforgeAuditEvents)
    .values(rows.audit)
    .onDuplicateKeyUpdate({
      // Deliberately immutable: this acquires the unique-key lock without
      // changing the original event when concurrent retries race.
      set: { idempotencyKey: rows.audit.idempotencyKey },
    });
  const persistedAudit = await connection
    .select({
      id: legacyDayforgeAuditEvents.id,
      entityType: legacyDayforgeAuditEvents.entityType,
      entityId: legacyDayforgeAuditEvents.entityId,
      eventName: legacyDayforgeAuditEvents.eventName,
      correlationId: legacyDayforgeAuditEvents.correlationId,
    })
    .from(legacyDayforgeAuditEvents)
    .where(
      and(
        eq(legacyDayforgeAuditEvents.scopeKey, rows.audit.scopeKey),
        eq(legacyDayforgeAuditEvents.idempotencyKey, rows.audit.idempotencyKey)
      )
    )
    .limit(1);
  const audit = persistedAudit[0];
  if (!audit) throw new Error("DayForge audit event was not persisted");
  if (
    audit.entityType !== rows.audit.entityType ||
    audit.entityId !== rows.audit.entityId ||
    audit.eventName !== rows.audit.eventName ||
    audit.correlationId !== rows.audit.correlationId
  ) {
    throw new Error(
      "DayForge event idempotency key is bound to a different event"
    );
  }

  if (rows.product) {
    await connection
      .insert(legacyDayforgeProductEvents)
      .values(rows.product)
      .onDuplicateKeyUpdate({
        set: { idempotencyKey: rows.product.idempotencyKey },
      });
    const persistedProduct = await connection
      .select({
        eventName: legacyDayforgeProductEvents.eventName,
        entityType: legacyDayforgeProductEvents.entityType,
        entityId: legacyDayforgeProductEvents.entityId,
        correlationId: legacyDayforgeProductEvents.correlationId,
      })
      .from(legacyDayforgeProductEvents)
      .where(
        and(
          eq(legacyDayforgeProductEvents.scopeKey, rows.product.scopeKey),
          eq(legacyDayforgeProductEvents.idempotencyKey, rows.product.idempotencyKey)
        )
      )
      .limit(1);
    const product = persistedProduct[0];
    if (
      !product ||
      product.eventName !== rows.product.eventName ||
      product.entityType !== rows.product.entityType ||
      product.entityId !== rows.product.entityId ||
      product.correlationId !== rows.product.correlationId
    ) {
      throw new Error(
        "DayForge product-event idempotency key is bound to a different event"
      );
    }
  }
  return {
    auditEventId: audit.id,
  } as const;
}

export async function writeDayforgeEvent(input: LegacyDayforgeEventInput) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(tx => writeDayforgeEventWith(tx, input));
}
