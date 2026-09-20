/**
 * Self / social memory adapter. Tone and disclosure only. Never business truth.
 */

import type { SelfMemoryRequest } from "../contracts/retrieval";
import type { EvidenceItem } from "../contracts/evidence";

export async function retrieveSelfEvidence(_request: SelfMemoryRequest): Promise<EvidenceItem[]> {
  return [];
}
