import {
  claireQueuedSpeechMetadata,
  claireSpeechDeliveryOf,
  isConfirmedHeardClaireSpeech,
  SPEECH_DELIVERY,
  type SpeechDelivery,
} from "./conversation/speechDelivery";
import type { NarrativePresentationPlan } from "../narratorOs/presentationPlan";
import type { ClaireOccurrenceDelivery } from "../narratorOs/presentationMemory";

/**
 * Claire consumes an already-derived Narrator presentation.
 * This module does not load Narrator state, run eligibility, or decide
 * whether a beat occurred. Claire remains Claire.
 */
export const AUTHORED_NARRATIVE_MATERIAL_RULE =
  "Authored narrative material. Not business truth. Do not add facts beyond these supplied authored facts.";

export function narratorPromptSectionForClaire(
  plan: NarrativePresentationPlan | null | undefined
): string | null {
  if (!plan?.occurrenceLedgerEntryId) return null;
  if (!plan.claire.knows || !plan.claire.mayDisclose || !plan.claire.maySpeak) {
    return null;
  }
  const facts = plan.authoredReaction.knowledgeMutationRefs
    .filter(ref => ref.plane === "CLAIRE")
    .map(ref => `${ref.plane}:${ref.factId}:${ref.op}`);
  const states = plan.authoredReaction.stateMutationRefs.map(
    ref => `${ref.key}=${String(ref.value)}`
  );
  return [
    AUTHORED_NARRATIVE_MATERIAL_RULE,
    `Occurrence ledger id: ${plan.occurrenceLedgerEntryId}.`,
    `Beat id: ${plan.beatId}.`,
    `Authored title: ${plan.player.title ?? ""}.`,
    `Occurred at: ${plan.occurredAt}.`,
    `Authored source: ${plan.authoredSourceRef}.`,
    `Authored facts: ${facts.join("; ") || "(none)"}.`,
    `Authored state references: ${states.join("; ") || "(none)"}.`,
  ].join(" ");
}

export type NarrativeClaireSpeechAttachment = {
  narratorOccurrenceLedgerId: string;
  narratorBeatId: string;
  narrativePresentationId: string;
  speechDelivery: typeof SPEECH_DELIVERY.GENERATED_QUEUED;
  heardConfirmed: false;
};

/**
 * Generated narrative speech starts at queued / heard-unconfirmed.
 * Playback completion is a separate evidence event. This helper cannot
 * record confirmed_heard.
 */
export function narrativeClaireSpeechMetadata(
  plan: NarrativePresentationPlan
): NarrativeClaireSpeechAttachment {
  const queued = claireQueuedSpeechMetadata();
  if (
    queued.speechDelivery !== SPEECH_DELIVERY.GENERATED_QUEUED ||
    queued.heardConfirmed !== false
  ) {
    throw new Error("Claire queued speech is not generated_queued");
  }
  return {
    narratorOccurrenceLedgerId: plan.occurrenceLedgerEntryId,
    narratorBeatId: plan.beatId,
    narrativePresentationId: plan.presentationId,
    speechDelivery: SPEECH_DELIVERY.GENERATED_QUEUED,
    heardConfirmed: false,
  };
}

export function claireProviderMetadataWithNarrative(
  attachment: NarrativeClaireSpeechAttachment | null | undefined
): Record<string, unknown> {
  const queued = claireQueuedSpeechMetadata();
  if (!attachment) return { ...queued };
  return {
    narratorOccurrenceLedgerId: attachment.narratorOccurrenceLedgerId,
    narratorBeatId: attachment.narratorBeatId,
    narrativePresentationId: attachment.narrativePresentationId,
    speechDelivery: SPEECH_DELIVERY.GENERATED_QUEUED,
    heardConfirmed: false,
  };
}

export function claireDeliveryForOccurrence(
  metadata: Record<string, unknown> | null | undefined
): ClaireOccurrenceDelivery | null {
  const occurrenceLedgerEntryId = metadata?.narratorOccurrenceLedgerId;
  if (typeof occurrenceLedgerEntryId !== "string" || !occurrenceLedgerEntryId) {
    return null;
  }
  const speechDelivery: SpeechDelivery = claireSpeechDeliveryOf(metadata);
  return {
    occurrenceLedgerEntryId,
    speechDelivery,
    heardConfirmed: isConfirmedHeardClaireSpeech(metadata),
  };
}
