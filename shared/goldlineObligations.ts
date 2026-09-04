/**
 * Unresolved promises, as world state.
 *
 * An obligation is not a task record. It is a *projection* over the same
 * append-only Chronicle every other Goldline fact comes from, which is what
 * keeps it honest: there is no second store to drift, nothing to tick off, and
 * no way to clear a promise except by appending something that actually
 * resolved it.
 *
 * The rule that shapes everything here:
 *
 *   Looking at a promise does not keep it. Only doing it, or being released
 *   from it, or learning it no longer applies, ends it.
 *
 * So there is deliberately no `dismiss`, no `seen`, no `snooze`, and no code
 * path that lets a render clear one.
 */

import type { GoldlineWorldEvent } from "./goldlineWorld";
import {
  claimCreatesObligation,
  describeTemporalClaim,
  type TemporalClaim,
} from "./goldlineTemporal";

/** The event that records a promise being made. */
export const COMMITMENT_MADE_EVENT = "field_commitment_made";
/** The event that records one being legitimately discharged or withdrawn. */
export const COMMITMENT_RESOLVED_EVENT = "field_commitment_resolved";

export type ObligationResolution =
  /** The operator actually did the thing they promised. */
  | "fulfilled"
  /** The other party released them, or it was explicitly withdrawn. */
  | "released"
  /** Later evidence means the promise no longer applies. */
  | "superseded";

export type ObligationRecord = {
  /** Stable across sessions and devices: the event that created the promise. */
  id: string;
  physicalEntityId: string | null;
  /** The promise in the operator's own words. */
  statement: string;
  /** Who it was made to, when the source said. */
  promisedTo: string | null;
  /** Local date it comes due, or null when the source named no time. */
  dueDate: string | null;
  madeAt: string;
  sourceEvidenceReference: string;
  resolution: ObligationResolution | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  /** Plain language, for "why is this here?". */
  explanation: string;
};

/**
 * The one physical grammar for an unfinished promise, per the v1 lock.
 *
 * A restrained Gold Line tether attached to the real building, and a sealed
 * node at its destination. One grammar, not five — a building never has to be
 * read as vines *and* ropes *and* a red badge to mean the same thing.
 */
export type ObligationPresentation = {
  physicalEntityId: string;
  /** How many real promises are outstanding at this place. */
  count: number;
  /** Taut once something is due or overdue; slack while it is still ahead. */
  tension: "slack" | "taut" | "overdue";
  /** What a screen reader and the inspector both say. Never colour alone. */
  explanation: string;
  /** Every outstanding promise here, newest first. */
  obligations: ObligationRecord[];
};

function metadataString(
  event: GoldlineWorldEvent,
  key: string
): string | null {
  const value = event.metadata[key];
  return typeof value === "string" && value.trim() ? value : null;
}

/**
 * Builds the promise ledger from world events.
 *
 * Resolution is matched by the id of the commitment event, so a resolution can
 * only ever discharge a promise that genuinely exists, and replaying the same
 * event stream always yields the same answer.
 */
export function projectObligations(
  events: GoldlineWorldEvent[]
): ObligationRecord[] {
  const resolutions = new Map<
    string,
    { resolution: ObligationResolution; at: string; by: string | null }
  >();
  for (const event of events) {
    if (event.eventType !== COMMITMENT_RESOLVED_EVENT) continue;
    const target = metadataString(event, "commitmentEventId");
    const how = metadataString(event, "resolution");
    if (!target) continue;
    resolutions.set(target, {
      resolution:
        how === "released" || how === "superseded" ? how : "fulfilled",
      at: event.occurredAt,
      by: event.sourceEvidenceReference,
    });
  }

  const records: ObligationRecord[] = [];
  for (const event of events) {
    if (event.eventType !== COMMITMENT_MADE_EVENT) continue;
    const resolved = resolutions.get(event.id) ?? null;
    records.push({
      id: event.id,
      physicalEntityId: event.physicalEntityId,
      statement: metadataString(event, "statement") ?? event.sourceEvidenceReference,
      promisedTo: metadataString(event, "promisedTo"),
      dueDate: metadataString(event, "dueDate"),
      madeAt: event.occurredAt,
      sourceEvidenceReference: event.sourceEvidenceReference,
      resolution: resolved?.resolution ?? null,
      resolvedAt: resolved?.at ?? null,
      resolvedBy: resolved?.by ?? null,
      explanation: metadataString(event, "explanation") ?? "A promise you made in the field.",
    });
  }
  return records.sort(
    (a, b) => Date.parse(b.madeAt) - Date.parse(a.madeAt) || a.id.localeCompare(b.id)
  );
}

export function openObligations(records: ObligationRecord[]): ObligationRecord[] {
  return records.filter(record => record.resolution === null);
}

/**
 * How a building wears its outstanding promises.
 *
 * Returns null when there is nothing owed, so a place with a clean slate shows
 * no restraint at all rather than an empty one.
 */
export function presentObligations(
  physicalEntityId: string,
  records: ObligationRecord[],
  today: string
): ObligationPresentation | null {
  const open = openObligations(records).filter(
    record => record.physicalEntityId === physicalEntityId
  );
  if (!open.length) return null;

  const overdue = open.filter(
    record => record.dueDate !== null && record.dueDate < today
  );
  const dueNow = open.filter(record => record.dueDate === today);
  const tension = overdue.length ? "overdue" : dueNow.length ? "taut" : "slack";

  const lead = open[0]!;
  const explanation = overdue.length
    ? `${overdue.length} promise${overdue.length === 1 ? "" : "s"} here ${overdue.length === 1 ? "is" : "are"} past the day you gave. ${lead.explanation}`
    : dueNow.length
      ? `A promise you made here comes due today. ${lead.explanation}`
      : `Something you promised here is still open. ${lead.explanation}`;

  return { physicalEntityId, count: open.length, tension, explanation, obligations: open };
}

/**
 * Turns a classified promise into the metadata its Chronicle event carries.
 *
 * Only claims that genuinely create an obligation are accepted; anything else
 * returns null, so a musing or a third-party report cannot become a tether by
 * taking a different code path.
 */
export function commitmentEventMetadata(
  claim: TemporalClaim
): Record<string, unknown> | null {
  if (!claimCreatesObligation(claim)) return null;
  return {
    statement: claim.sourceText,
    promisedTo: claim.promisedTo,
    dueDate: claim.when?.startDate ?? null,
    duePrecision: claim.when?.precision ?? "none",
    daypart: claim.when?.daypart ?? null,
    explanation: describeTemporalClaim(claim),
    // The world may show this promise. It never implies the other party agreed
    // to anything, and it is never a scheduled appointment.
    impliesAppointment: false,
  };
}
