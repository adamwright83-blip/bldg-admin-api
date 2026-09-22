import {
  claireQueuedSpeechMetadata,
  claireSpeechDeliveryOf,
  isConfirmedHeardClaireSpeech,
  SPEECH_DELIVERY,
  type SpeechDelivery,
} from "./conversation/speechDelivery";
import {
  isTrustedNarrativePresentationPlan,
  type NarrativePresentationPlan,
} from "../narratorOs/presentationPlan";
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
  if (!isTrustedNarrativePresentationPlan(plan)) return null;
  if (!plan.claire.knows || !plan.claire.mayDisclose || !plan.claire.maySpeak) {
    return null;
  }
  const facts = plan.authoredReaction.knowledgeMutationRefs
    .filter(ref => ref.plane === "CLAIRE")
    .map(ref => `${ref.op} ${ref.factId}`);
  return [
    AUTHORED_NARRATIVE_MATERIAL_RULE,
    `Occurrence ledger id: ${plan.occurrenceLedgerEntryId}.`,
    `Beat id: ${plan.beatId}.`,
    `Occurred at: ${plan.occurredAt}.`,
    `Authored source: ${plan.authoredSourceRef}.`,
    `Authored Claire facts: ${facts.join("; ") || "(none)"}.`,
  ].join(" ");
}

export type NarrativeClaireSpeechAttachment = {
  narratorOccurrenceLedgerId: string;
  narratorBeatId: string;
  narrativePresentationId: string;
  speechDelivery: typeof SPEECH_DELIVERY.GENERATED_QUEUED;
  heardConfirmed: false;
};

const trustedNarrativeSpeechAttachments = new WeakSet<object>();

export function isTrustedNarrativeSpeechAttachment(
  value: unknown
): value is NarrativeClaireSpeechAttachment {
  return (
    typeof value === "object" &&
    value !== null &&
    trustedNarrativeSpeechAttachments.has(value)
  );
}

/**
 * Prompt context is not a spoken segment. Production has no validated
 * narrative-segment issuer, so a plan — trusted or forged — does not
 * become delivery metadata.
 */
export function narrativeClaireSpeechMetadata(
  plan: NarrativePresentationPlan | null | undefined
): null {
  void plan;
  return null;
}

export function claireProviderMetadataWithNarrative(
  attachment: NarrativeClaireSpeechAttachment | null | undefined
): Record<string, unknown> {
  const queued = claireQueuedSpeechMetadata();
  if (!isTrustedNarrativeSpeechAttachment(attachment)) return { ...queued };
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
