import { narrativeMemoryView } from "./narrativeReadModels";
import type { PlayerPresentationReceipt } from "./presentationStore";
import type { NarratorSnapshot } from "./store";

/**
 * Presentation truth beside the Slice G memory read.
 * `narrativeMemoryView` is unchanged. Occurrences stay keyed by ledger id,
 * so two firings of the same beat keep separate presentation states.
 */
export type ClaireOccurrenceDelivery = {
  readonly occurrenceLedgerEntryId: string;
  readonly speechDelivery:
    | "generated_queued"
    | "unconfirmed"
    | "confirmed_heard"
    | "confirmed_not_heard";
  readonly heardConfirmed: boolean;
};

export type OccurrencePresentationMemory = {
  readonly ledgerEntryId: string;
  readonly beatId: string;
  readonly occurredAt: string;
  readonly playerVisible: boolean;
  readonly presentationStatus: PlayerPresentationReceipt["status"] | null;
  readonly presentationId: string | null;
  readonly claireSpeechDelivery: ClaireOccurrenceDelivery["speechDelivery"] | null;
  readonly claireHeardConfirmed: boolean | null;
};

export function narrativePresentationMemory(input: {
  snapshot: NarratorSnapshot;
  presentationReceipts?: readonly PlayerPresentationReceipt[];
  claireDeliveries?: readonly ClaireOccurrenceDelivery[];
}) {
  const base = narrativeMemoryView(input.snapshot);
  const receipts = input.presentationReceipts ?? [];
  const deliveries = input.claireDeliveries ?? [];
  const occurrences = base.firedAuthoredBeats.map(row => {
    const receipt =
      receipts.find(
        item => item.occurrenceLedgerEntryId === row.ledgerEntryId
      ) ?? null;
    const claire =
      deliveries.find(
        item => item.occurrenceLedgerEntryId === row.ledgerEntryId
      ) ?? null;
    return Object.freeze({
      ledgerEntryId: row.ledgerEntryId,
      beatId: row.beatId,
      occurredAt: row.occurredAt,
      playerVisible: row.playerVisible,
      presentationStatus: receipt?.status ?? null,
      presentationId: receipt?.presentationId ?? null,
      claireSpeechDelivery: claire?.speechDelivery ?? null,
      claireHeardConfirmed: claire ? claire.heardConfirmed : null,
    });
  });
  return Object.freeze({
    ...base,
    occurrences: Object.freeze(occurrences),
  });
}
