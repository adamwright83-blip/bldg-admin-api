/**
 * Attach Field Journal actions to buildings Goldline already knows.
 *
 * Lookup only. If the transcript does not uniquely match an existing
 * physicalEntityId, nothing is written — a visit is not invented onto a
 * neighbour, and a new building is not created from a sentence.
 */

import type { FieldJournalExtraction } from "../../shared/fieldJournal";
import { eventClassificationForType } from "../../shared/goldlineWorld";
import { findPhysicalEntityIdByAddress } from "./entityLookup";
import { appendGoldlineWorldEvent } from "./worldEventStore";

const JOURNAL_ACTION_TO_WORLD = {
  visited: "visited",
  visit_attempted: "visit_attempted",
  called: "call_completed",
  texted: "text_sent",
  emailed: "email_sent",
  proposal_sent: "proposal_sent",
  collateral_delivered: "collateral_delivered",
} as const;

export function worldEventTypeForJournalAction(
  type: string
): (typeof JOURNAL_ACTION_TO_WORLD)[keyof typeof JOURNAL_ACTION_TO_WORLD] | null {
  return type in JOURNAL_ACTION_TO_WORLD
    ? JOURNAL_ACTION_TO_WORLD[type as keyof typeof JOURNAL_ACTION_TO_WORLD]
    : null;
}

export async function recordJournalActionsOnMatchedEntities(input: {
  tenantId: string;
  journalEntryId: string;
  actorId: string;
  extraction: FieldJournalExtraction;
}): Promise<{ recorded: number; unmatched: number }> {
  let recorded = 0;
  let unmatched = 0;
  for (const [index, action] of input.extraction.actions.entries()) {
    const eventType = worldEventTypeForJournalAction(action.type);
    if (!eventType) continue;
    const classification = eventClassificationForType(eventType);
    if (classification !== "action") continue;
    const entity = input.extraction.entities.find(
      item => item.clientEntityKey === action.entityClientKey
    );
    const clues = [
      entity?.addressClue?.value,
      entity?.propertyName?.value,
    ].filter((value): value is string => Boolean(value?.trim()));
    let physicalEntityId: string | null = null;
    for (const clue of clues) {
      physicalEntityId = await findPhysicalEntityIdByAddress({
        tenantId: input.tenantId,
        address: clue,
      });
      if (physicalEntityId) break;
    }
    if (!physicalEntityId) {
      unmatched += 1;
      continue;
    }
    await appendGoldlineWorldEvent({
      tenantId: input.tenantId,
      physicalEntityId,
      eventType,
      classification: "action",
      actorType: "field",
      actorId: input.actorId,
      occurredAt: new Date().toISOString(),
      observedAt: null,
      sourceType: "driver_sales_journals",
      sourceId: input.journalEntryId,
      sourceEvidenceReference: `driver_sales_journals:${input.journalEntryId}:${action.type}:${index}`,
      provenanceClass: "operator_reported",
      verificationClass: "ATTESTED",
      confidence: "medium",
      idempotencyKey: `journal-action:${input.tenantId}:${input.journalEntryId}:${eventType}:${physicalEntityId}`,
      correlationId: `field-journal:${input.journalEntryId}`,
      metadata: {
        journalActionType: action.type,
        actionOnly: true,
        doesNotImplyOutcome: true,
      },
    });
    recorded += 1;
  }
  return { recorded, unmatched };
}
