import { getClaireRelationshipStore } from "./store";
import type {
  CharacterId,
  ClaireRelationshipEvent,
  ClaireRelationshipEventInput,
} from "./types";

/**
 * Append-only write. There is no update/delete for relationship events —
 * durable memory is only durable if it can't be quietly edited after the
 * fact. Identity must already be resolved by the caller (operatorUserId is
 * required, not derived here); see types.ts for the fail-closed contract.
 */
export async function appendClaireRelationshipEvent(
  input: ClaireRelationshipEventInput
): Promise<ClaireRelationshipEvent | null> {
  return getClaireRelationshipStore().appendEvent(input);
}

/**
 * Bounded, operator-scoped retrieval — never an unrestricted dump of
 * everything an operator has ever said (Slice 4). `limit` defaults to a
 * small number of recent events; callers doing tier computation should
 * pass a much larger bound (or omit it) since tier math needs the full
 * history, while prompt-time "shared history" retrieval should stay small.
 */
export async function listClaireRelationshipEvents(input: {
  tenantId: string;
  operatorUserId: string;
  characterId?: CharacterId;
  limit?: number;
}): Promise<ClaireRelationshipEvent[]> {
  return getClaireRelationshipStore().listEvents({
    tenantId: input.tenantId,
    operatorUserId: input.operatorUserId,
    characterId: input.characterId ?? "claire",
    limit: input.limit,
  });
}
