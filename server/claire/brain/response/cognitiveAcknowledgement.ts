/**
 * Phrases for cognitive acknowledgement.
 *
 * Executive Function chooses the kind. This module only phrases it.
 * None of these sentences claim a durable write.
 */

import type { CognitiveAcknowledgementKind } from "../contracts/responsePlan";

/** Spoken forms that would claim a mission, Day Line, or other planning write. */
export const DURABLE_WRITE_CLAIM =
  /\b(?:locked|committed|on the (?:day )?line|added|logged|created|saved|set as primary|made (?:it |that )?today'?s mission)\b|\bdone\b/i;

export function phraseCognitiveAcknowledgement(kind: CognitiveAcknowledgementKind): string {
  switch (kind) {
    case "awaiting_strategic_content":
      return "Understood. You're introducing today's mission, and I'm listening for what it is.";
    case "strategic_content_understood":
      return "Understood. That is the mission you stated for today.";
    case "operator_intent_understood":
      return "Understood. That is what you intend to do.";
    case "attention_repaired":
      return "I'm with you.";
    case "pending_reactivated":
      return "That earlier item is still unresolved.";
  }
}
