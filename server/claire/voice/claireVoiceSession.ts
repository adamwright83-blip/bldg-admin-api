/**
 * Shared Claire voice identity. Gather and Conversation Relay both use this.
 * Relay does not mint a second operator, conversation, or state key.
 */

export const CLAIRE_VOICE_BOUNDARIES = {
  operatorIdentity: "token_verified_operator",
  conversationId: "shared_claire_conversation",
  conversationState: "claire-call",
  reasoningAuthority: "existing_goldline_anthropic",
  businessTruth: "transport_must_not_decide",
  ledger: "generated_queued_playback_started_heard_completely_are_distinct",
} as const;

/** Decisions Conversation Relay is not allowed to make. Claire's existing turn loop remains the authority. */
export const CONVERSATION_RELAY_DOES_NOT_DECIDE = [
  "business_truth",
  "daily_command",
  "weekly_mission",
  "narrator_disclosure",
  "commitment",
  "sales_strategy",
] as const;

export type ClaireVoiceSession = {
  tenantId: string;
  operatorUserId: string;
  conversationId: string;
  /** Durable call-state key. Same shape as claireTwilio's `claire-call:${conversationId}`. */
  conversationStateKey: string;
};

export function claireVoiceConversationStateKey(conversationId: string): string {
  return `claire-call:${conversationId}`;
}

export function claireVoiceSession(input: {
  tenantId: string;
  operatorUserId: string;
  conversationId: string;
}): ClaireVoiceSession {
  return {
    tenantId: input.tenantId,
    operatorUserId: input.operatorUserId,
    conversationId: input.conversationId,
    conversationStateKey: claireVoiceConversationStateKey(input.conversationId),
  };
}
