/**
 * Turning what the operator promised into world state.
 *
 * This runs inside the Field Journal pipeline, immediately after extraction and
 * deliberately independent of everything downstream. Property research, place
 * lookup, weapon concepts and art generation can all fail without costing the
 * operator a promise they actually made — the promise came from their own
 * words, so it survives on its own evidence.
 *
 * A commitment whose building cannot be resolved yet is still recorded, with
 * the address it referred to, rather than discarded. An unattached promise is
 * recoverable; a forgotten one is not.
 */

import { and, eq, inArray } from "drizzle-orm";
import { goldlineWorldEvents } from "../../drizzle/schema";
import type { FieldJournalExtraction } from "../../shared/fieldJournal";
import {
  claimCreatesObligation,
  resolveTranscriptClaims,
  type ProposedTemporalClaim,
  type ValidatedTemporalClaim,
} from "../../shared/goldlineTemporal";
import {
  COMMITMENT_MADE_EVENT,
  commitmentEventMetadata,
} from "../../shared/goldlineObligations";
import { appendGoldlineWorldEvent } from "./worldEventStore";
import {
  FIELD_SIGNAL_EVENT,
  FIELD_SIGNAL_SUPERSEDED_EVENT,
} from "./futurePressureService";
import { findPhysicalEntityIdByAddress } from "./entityLookup";
import { getDb } from "../db";

/** The address a claim's entity was described by, if the transcript named one. */
function addressForClaim(
  extraction: FieldJournalExtraction,
  claim: { entityClientKey?: string | null }
): string | null {
  const entity = extraction.entities.find(
    item => item.clientEntityKey === claim.entityClientKey
  );
  return entity?.addressClue?.value ?? entity?.propertyName?.value ?? null;
}

function correctionLike(text: string): boolean {
  return /\b(actually|instead|correction|correcting|changed|change of plans|now back|now available|now there)\b|\bnot\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(text);
}

function normalizeSignalPlace(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function signalPlaceKey(row: typeof goldlineWorldEvents.$inferSelect): string | null {
  if (row.physicalEntityId) return `id:${row.physicalEntityId}`;
  const metadata = (row.metadataJson ?? {}) as { addressClue?: unknown };
  if (typeof metadata.addressClue !== "string" || !metadata.addressClue.trim()) return null;
  return `address:${normalizeSignalPlace(metadata.addressClue)}`;
}

function signalKind(row: typeof goldlineWorldEvents.$inferSelect): string | null {
  const metadata = (row.metadataJson ?? {}) as { kind?: unknown };
  return typeof metadata.kind === "string" ? metadata.kind : null;
}

export type RecordedCommitment = {
  eventId: string;
  physicalEntityId: string | null;
  claim: ValidatedTemporalClaim;
};

/**
 * Records every promise in one journal entry.
 *
 * Idempotent on the journal entry and the promise's own words, so reprocessing
 * a journal — a retry, a replay, a second pass after transcription finally
 * succeeded — never doubles a promise.
 */
export async function recordFieldCommitments(input: {
  tenantId: string;
  journalEntryId: string;
  actorId: string;
  transcript: string;
  extraction: FieldJournalExtraction;
  /** The journal's own capture date, in the tenant's timezone. */
  anchorDate: string;
  capturedAt: string;
}): Promise<RecordedCommitment[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const proposed: ProposedTemporalClaim[] = input.extraction.temporalClaims.map(
    claim => ({
      kind: claim.kind,
      sourceText: claim.sourceText,
      subject: claim.subject,
      promisedTo: claim.promisedTo,
      when: claim.when,
    })
  );

  const claims = resolveTranscriptClaims({
    transcript: input.transcript,
    anchorDate: input.anchorDate,
    proposed,
  });

  const recorded: RecordedCommitment[] = [];
  for (let index = 0; index < claims.length; index += 1) {
    const claim = claims[index]!;
    const proposalForClaim = input.extraction.temporalClaims[index];
    const claimAddress = proposalForClaim
      ? addressForClaim(input.extraction, proposalForClaim)
      : null;

    /*
      Everything that is not a promise is still worth remembering — it is the
      reason to go back at all. It is recorded as a signal, never as an
      obligation, so it can shape a future day without ever restraining a
      building or implying the operator owes anyone anything.
    */
    if (!claimCreatesObligation(claim)) {
      if (!claim.when?.startDate) continue;
      const physicalEntityId = claimAddress
        ? await findPhysicalEntityIdByAddress({ tenantId: input.tenantId, address: claimAddress })
        : null;
      const storedSignal = await appendGoldlineWorldEvent({
        tenantId: input.tenantId,
        physicalEntityId,
        eventType: FIELD_SIGNAL_EVENT,
        classification: "evidence",
        actorType: "operator",
        actorId: input.actorId,
        occurredAt: input.capturedAt,
        observedAt: null,
        sourceType: "driver_sales_journals",
        sourceId: input.journalEntryId,
        sourceEvidenceReference: `driver_sales_journals:${input.journalEntryId}`,
        provenanceClass: "operator_reported",
        verificationClass: "ATTESTED",
        confidence: claim.when.hedged ? "low" : "medium",
        idempotencyKey: `field-signal:${input.journalEntryId}:${claim.sourceText.slice(0, 80)}`,
        correlationId: `field-journal:${input.journalEntryId}`,
        metadata: {
          kind: claim.kind,
          statement: claim.sourceText,
          subject: claim.subject,
          whenText: claim.when.sourceText,
          anchorDate: input.anchorDate,
          hedged: claim.when.hedged,
          addressClue: claimAddress,
          // A report about somebody's availability is never a commitment and
          // never an appointment, however it later gets displayed.
          impliesAppointment: false,
          impliesCommitment: false,
        },
      });

      /*
        "Actually Thursday" must remove Wednesday from the *future* without
        deleting Tuesday's sentence. A correction therefore appends a
        supersession edge to the Chronicle. We only do this when the source
        itself signals a correction, and only against the newest still-active
        signal of the same kind at the same real place. Ordinary independent
        reports are never collapsed just because they share a building.
      */
      const currentPlaceKey = physicalEntityId
        ? `id:${physicalEntityId}`
        : claimAddress
          ? `address:${normalizeSignalPlace(claimAddress)}`
          : null;
      if (currentPlaceKey && correctionLike(claim.sourceText)) {
        const related = await db
          .select()
          .from(goldlineWorldEvents)
          .where(
            and(
              eq(goldlineWorldEvents.tenantId, input.tenantId),
              inArray(goldlineWorldEvents.eventType, [
                FIELD_SIGNAL_EVENT,
                FIELD_SIGNAL_SUPERSEDED_EVENT,
              ])
            )
          );
        const alreadySuperseded = new Set(
          related
            .filter(row => row.eventType === FIELD_SIGNAL_SUPERSEDED_EVENT)
            .map(row => (row.metadataJson as { signalEventId?: unknown } | null)?.signalEventId)
            .filter((value): value is string => typeof value === "string")
        );
        const prior = related
          .filter(row =>
            row.eventType === FIELD_SIGNAL_EVENT &&
            row.id !== storedSignal.id &&
            !alreadySuperseded.has(row.id) &&
            signalKind(row) === claim.kind &&
            signalPlaceKey(row) === currentPlaceKey
          )
          .sort((left, right) =>
            right.occurredAt.getTime() - left.occurredAt.getTime() ||
            right.createdAt.getTime() - left.createdAt.getTime()
          )[0];
        if (prior) {
          await appendGoldlineWorldEvent({
            tenantId: input.tenantId,
            physicalEntityId,
            eventType: FIELD_SIGNAL_SUPERSEDED_EVENT,
            classification: "evidence",
            actorType: "operator",
            actorId: input.actorId,
            occurredAt: input.capturedAt,
            observedAt: null,
            sourceType: "driver_sales_journals",
            sourceId: input.journalEntryId,
            sourceEvidenceReference: `driver_sales_journals:${input.journalEntryId}`,
            provenanceClass: "operator_reported",
            verificationClass: "ATTESTED",
            confidence: "high",
            idempotencyKey: `field-signal-superseded:${prior.id}:${storedSignal.id}`,
            correlationId: `field-journal:${input.journalEntryId}`,
            metadata: {
              signalEventId: prior.id,
              supersededBySignalEventId: storedSignal.id,
              reason: claim.sourceText,
            },
          });
        }
      }
      continue;
    }
    const metadata = commitmentEventMetadata(claim);
    if (!metadata) continue;

    const address = claimAddress;
    const physicalEntityId = address
      ? await findPhysicalEntityIdByAddress({ tenantId: input.tenantId, address })
      : null;

    /*
      Keyed by the journal entry and the promise's own words. Two genuinely
      different promises in one journal stay separate; the same promise read
      twice collapses into one.
    */
    const idempotencyKey = `field-commitment:${input.journalEntryId}:${claim.sourceText.slice(0, 80)}`;
    await appendGoldlineWorldEvent({
      tenantId: input.tenantId,
      physicalEntityId,
      eventType: COMMITMENT_MADE_EVENT,
      // Evidence of a promise, not a business outcome. Nothing has happened
      // to the customer because the operator said they would do something.
      classification: "evidence",
      actorType: "operator",
      actorId: input.actorId,
      occurredAt: input.capturedAt,
      observedAt: null,
      sourceType: "driver_sales_journals",
      sourceId: input.journalEntryId,
      sourceEvidenceReference: `driver_sales_journals:${input.journalEntryId}`,
      provenanceClass: "operator_reported",
      verificationClass: "ATTESTED",
      confidence: "high",
      idempotencyKey,
      correlationId: `field-journal:${input.journalEntryId}`,
      metadata: {
        ...metadata,
        addressClue: address,
        adjustments: claim.adjustments,
      },
    });

    const [stored] = await db
      .select({ id: goldlineWorldEvents.id })
      .from(goldlineWorldEvents)
      .where(
        and(
          eq(goldlineWorldEvents.tenantId, input.tenantId),
          eq(goldlineWorldEvents.idempotencyKey, idempotencyKey)
        )
      )
      .limit(1);
    if (stored) recorded.push({ eventId: stored.id, physicalEntityId, claim });
  }
  return recorded;
}

/**
 * Attaches promises that were recorded before their building was known.
 *
 * The forge resolves identity asynchronously, so a promise made about a place
 * Goldline had never seen starts life unattached. Once that building exists,
 * this binds the promise to it — without rewriting the promise itself, which
 * stays exactly as the operator said it.
 */
export async function bindUnattachedCommitments(input: {
  tenantId: string;
  physicalEntityId: string;
  address: string;
}): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db
    .select()
    .from(goldlineWorldEvents)
    .where(
      and(
        eq(goldlineWorldEvents.tenantId, input.tenantId),
        eq(goldlineWorldEvents.eventType, COMMITMENT_MADE_EVENT)
      )
    );
  let bound = 0;
  for (const row of rows) {
    if (row.physicalEntityId) continue;
    const metadata = (row.metadataJson ?? {}) as { addressClue?: unknown };
    const clue = typeof metadata.addressClue === "string" ? metadata.addressClue : null;
    if (!clue) continue;
    const resolved = await findPhysicalEntityIdByAddress({
      tenantId: input.tenantId,
      address: clue,
    });
    if (resolved !== input.physicalEntityId) continue;
    await db
      .update(goldlineWorldEvents)
      .set({ physicalEntityId: input.physicalEntityId })
      .where(
        and(
          eq(goldlineWorldEvents.tenantId, input.tenantId),
          eq(goldlineWorldEvents.id, row.id)
        )
      );
    bound += 1;
  }
  return bound;
}
