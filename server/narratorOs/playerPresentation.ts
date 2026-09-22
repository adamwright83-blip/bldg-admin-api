import type { AuthoredReactionReceipt } from "./narrativeReadModels";
import type { NarrativePresentationPlan } from "./presentationPlan";

/**
 * Structured player payload. The authored title is copied as a field.
 * This module does not write scene prose, setting, dialogue, facial
 * reaction, villain behavior, or new lore.
 */
export type PlayerPresentationPayload = {
  readonly beatId: string;
  readonly title: string | null;
  readonly occurredAt: string;
  readonly characters: readonly string[];
  readonly occurrenceLedgerEntryId: string;
  readonly authoredSourceRef: string;
  readonly reaction: {
    readonly knowledgeMutationRefs: AuthoredReactionReceipt["knowledgeMutationRefs"];
    readonly stateMutationRefs: AuthoredReactionReceipt["stateMutationRefs"];
  };
};

export function playerPresentationPayload(
  plan: NarrativePresentationPlan | null
): PlayerPresentationPayload | null {
  if (!plan?.player.maySurface) return null;
  return Object.freeze({
    beatId: plan.beatId,
    title: plan.player.title,
    occurredAt: plan.occurredAt,
    characters: plan.authoredReaction.characters,
    occurrenceLedgerEntryId: plan.occurrenceLedgerEntryId,
    authoredSourceRef: plan.authoredSourceRef,
    reaction: Object.freeze({
      knowledgeMutationRefs: plan.authoredReaction.knowledgeMutationRefs,
      stateMutationRefs: plan.authoredReaction.stateMutationRefs,
    }),
  });
}
