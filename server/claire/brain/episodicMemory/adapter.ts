/**
 * Episodic Memory adapter. History proves "was recorded then", never "is true now".
 * Does not reimplement the conversation ledger.
 */

import type { EpisodicRetrievalRequest } from "../contracts/retrieval";
import type { EvidenceItem } from "../contracts/evidence";

export async function retrieveEpisodicEvidence(_request: EpisodicRetrievalRequest): Promise<EvidenceItem[]> {
  return [];
}

export function asHistorical(item: EvidenceItem): EvidenceItem {
  return {
    ...item,
    authoritativeFor: item.authoritativeFor.filter(authority => authority !== "current_business_truth"),
    type: item.type === "business_query" ? "conversation_turn" : item.type,
  };
}
