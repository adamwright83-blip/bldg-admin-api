/**
 * What the world has been holding for a given day.
 *
 * Reads the Chronicle and answers the relevance question fresh every time it is
 * asked. Nothing here is stored: there is no "tomorrow's plan" row that can go
 * stale, so when reality moves, the next call simply gives a different answer
 * while yesterday's evidence stays exactly as it was recorded.
 */

import { eq } from "drizzle-orm";
import { goldlineWorldEvents } from "../../drizzle/schema";
import { projectObligations } from "../../shared/goldlineObligations";
import {
  projectFuturePressure,
  type FuturePressure,
} from "../../shared/goldlineFuturePressure";
import type { GoldlineWorldEvent } from "../../shared/goldlineWorld";
import {
  resolveTemporalReference,
  type TemporalClaim,
  type TemporalClaimKind,
} from "../../shared/goldlineTemporal";
import { getDb } from "../db";

/** Soft signals are recorded alongside promises, under their own event type. */
export const FIELD_SIGNAL_EVENT = "field_temporal_signal";
/** Later evidence can supersede a soft signal without deleting its history. */
export const FIELD_SIGNAL_SUPERSEDED_EVENT = "field_temporal_signal_superseded";

function eventFromRow(row: typeof goldlineWorldEvents.$inferSelect): GoldlineWorldEvent {
  return {
    id: row.id,
    tenantId: row.tenantId,
    physicalEntityId: row.physicalEntityId,
    eventType: row.eventType,
    classification: row.classification,
    actorType: row.actorType,
    actorId: row.actorId,
    occurredAt: row.occurredAt.toISOString(),
    observedAt: row.observedAt?.toISOString() ?? null,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    sourceEvidenceReference: row.sourceEvidenceReference,
    provenanceClass: row.provenanceClass,
    verificationClass: row.verificationClass,
    confidence: row.confidence,
    idempotencyKey: row.idempotencyKey,
    correlationId: row.correlationId,
    metadata: (row.metadataJson ?? {}) as Record<string, unknown>,
  };
}

const SIGNAL_KINDS: TemporalClaimKind[] = [
  "reported_availability",
  "operator_intent",
  "suggested_action",
  "uncertain_possibility",
];

/** Rebuilds a stored soft signal into the claim shape the projector expects. */
function claimFromSignal(event: GoldlineWorldEvent): TemporalClaim | null {
  const metadata = event.metadata as {
    kind?: unknown;
    statement?: unknown;
    subject?: unknown;
    whenText?: unknown;
    anchorDate?: unknown;
  };
  const kind = SIGNAL_KINDS.find(item => item === metadata.kind);
  const statement = typeof metadata.statement === "string" ? metadata.statement : null;
  const anchorDate =
    typeof metadata.anchorDate === "string"
      ? metadata.anchorDate
      : event.occurredAt.slice(0, 10);
  if (!kind || !statement) return null;
  const whenText = typeof metadata.whenText === "string" ? metadata.whenText : statement;
  return {
    kind,
    sourceText: statement,
    subject: typeof metadata.subject === "string" ? metadata.subject : statement,
    promisedTo: null,
    when: resolveTemporalReference(whenText, anchorDate),
  };
}

/**
 * Returns only soft signals that still describe the future.
 *
 * Supersession is append-only: the old Wednesday sentence stays in Chronicle,
 * but a later correction can point at it so Wednesday no longer materializes a
 * stale chapter. This is the server-side half of "reality recompiles the
 * future without rewriting the past."
 */
export function activeFieldSignals(events: readonly GoldlineWorldEvent[]): GoldlineWorldEvent[] {
  const superseded = new Set(
    events
      .filter(event => event.eventType === FIELD_SIGNAL_SUPERSEDED_EVENT)
      .map(event => event.metadata.signalEventId)
      .filter((value): value is string => typeof value === "string")
  );
  return events.filter(
    event => event.eventType === FIELD_SIGNAL_EVENT && !superseded.has(event.id)
  );
}

/** Pure projection used by the live reader and by the Tuesday→Wednesday proof. */
export function futurePressureFromEvents(input: {
  events: readonly GoldlineWorldEvent[];
  date: string;
}): FuturePressure {
  const claims = activeFieldSignals(input.events)
    .map(event => ({
      claim: claimFromSignal(event),
      physicalEntityId: event.physicalEntityId,
      sourceEvidenceReference: event.sourceEvidenceReference,
    }))
    .filter(
      (entry): entry is {
        claim: TemporalClaim;
        physicalEntityId: string | null;
        sourceEvidenceReference: string;
      } => entry.claim !== null
    );

  return projectFuturePressure({
    date: input.date,
    obligations: projectObligations([...input.events]),
    claims,
  });
}

export async function listFuturePressure(input: {
  tenantId: string;
  date: string;
}): Promise<FuturePressure> {
  const db = await getDb();
  if (!db) return { date: input.date, items: [] };

  const rows = await db
    .select()
    .from(goldlineWorldEvents)
    .where(eq(goldlineWorldEvents.tenantId, input.tenantId));
  return futurePressureFromEvents({
    date: input.date,
    events: rows.map(eventFromRow),
  });
}

/** The same answer, narrowed to one building. */
export async function futurePressureForEntity(input: {
  tenantId: string;
  date: string;
  physicalEntityId: string;
}) {
  const pressure = await listFuturePressure(input);
  return {
    ...pressure,
    items: pressure.items.filter(
      item => item.physicalEntityId === input.physicalEntityId
    ),
  };
}
