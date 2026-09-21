/**
 * Episodic Memory adapter — read-only.
 *
 * Wraps the existing conversation ledger. It does not own a store and does not
 * reimplement retrieval.
 *
 * LAW: episodic evidence proves "Adam said X" or "X was recorded on date Y".
 * It NEVER proves that X is currently true. Every item this adapter emits is
 * stamped `historical_observation` only, and the governor throws if a
 * `conversation_turn` ever claims `current_business_truth`. That stamping is
 * the enforcement point — do not widen it to make an answer easier.
 */

import { searchOperatorConversation, type RememberedTurn } from "../../knowledge/conversationMemory";
import type { EpisodicRetrievalRequest } from "../contracts/retrieval";
import type { EvidenceItem } from "../contracts/evidence";

export type EpisodicMemoryContext = {
  tenantId: string;
  operatorUserId: string;
  nowIso: string;
  excludeSessionId?: string | null;
};

export type EpisodicMemoryDeps = {
  search: (input: {
    tenantId: string;
    operatorUserId: string;
    terms: string[];
    limit?: number;
    excludeSessionId?: string | null;
  }) => Promise<RememberedTurn[]>;
};

export const defaultEpisodicMemoryDeps: EpisodicMemoryDeps = {
  search: input => searchOperatorConversation(input),
};

/** One remembered turn becomes one historical observation. Never current truth. */
export function evidenceFromRememberedTurn(turn: RememberedTurn, observedAtIso: string): EvidenceItem {
  return {
    id: `conversation_turn:${turn.sessionId}:${turn.at}`,
    type: "conversation_turn",
    source: "claireConversationTurns",
    provenance: { reader: "searchOperatorConversation" },
    observedAt: observedAtIso,
    // As-of is when it was SAID, which is precisely why it cannot speak for now.
    asOf: turn.at,
    freshness: null,
    coverage: null,
    authoritativeFor: ["historical_observation"],
    payload: { speaker: turn.speaker, text: turn.text, at: turn.at, sessionId: turn.sessionId },
    operatorVisible: true,
  };
}

export async function retrieveEpisodicEvidence(
  request: EpisodicRetrievalRequest,
  ctx: EpisodicMemoryContext,
  deps: EpisodicMemoryDeps = defaultEpisodicMemoryDeps
): Promise<EvidenceItem[]> {
  // Search semantics belong to Executive Function, never the transport context.
  const terms = (request.terms ?? []).filter(term => term.trim().length >= 3);
  // No search terms means we have nothing to recall — not that nothing happened.
  if (!terms.length) return [];
  if (request.kind !== "conversation_history" && request.kind !== "prior_actions") return [];

  const turns = await deps.search({
    tenantId: ctx.tenantId,
    operatorUserId: ctx.operatorUserId,
    terms,
    limit: 6,
    excludeSessionId: ctx.excludeSessionId ?? null,
  });
  return turns.map(turn => evidenceFromRememberedTurn(turn, ctx.nowIso));
}
