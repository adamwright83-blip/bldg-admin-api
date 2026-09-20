/**
 * Business Memory adapter. Delegates to existing authoritative readers later.
 * This phase only filters evidence at the boundary. It does not reimplement businessQuery.
 */

import type { BusinessRetrievalRequest, PriorClaimRecheckRequest } from "../contracts/retrieval";
import type { EvidenceItem } from "../contracts/evidence";
import { isOperatorVisibleEvidencePayload } from "./sourceVisibility";

export type BusinessMemoryContext = {
  tenantId: string;
  operatorUserId: string;
  nowIso: string;
};

function operatorVisible(item: EvidenceItem): boolean {
  const payload = (item.payload ?? {}) as {
    accountType?: string | null;
    providerName?: string | null;
    identityKey?: string | null;
    fixture?: boolean;
    synthetic?: boolean;
    evidence?: Array<Record<string, unknown>> | null;
  };
  if (!isOperatorVisibleEvidencePayload({ ...item.provenance, ...payload })) return false;
  return item.operatorVisible;
}

export function admitBusinessEvidence(items: EvidenceItem[]): EvidenceItem[] {
  return items.filter(item => operatorVisible(item));
}

/**
 * Phase A: no live reader calls. Executive Function will pass queries here in Phase C.
 * Returning [] is honest: we have not retrieved, so we must not invent.
 */
export async function retrieveBusinessEvidence(
  _request: BusinessRetrievalRequest | PriorClaimRecheckRequest,
  _ctx: BusinessMemoryContext
): Promise<EvidenceItem[]> {
  return [];
}
