import type { ClaireRelationshipStore } from "../store";
import type {
  CharacterId,
  ClaireRelationshipEvent,
  ClaireRelationshipEventInput,
  ClaireRelationshipState,
  ClaireTierTransition,
} from "../types";

/**
 * Deterministic in-memory fake for ClaireRelationshipStore. Exists so tests
 * can prove the full "append -> recompute -> tier transition -> retrieval"
 * loop end to end without a live MySQL database (none is available in this
 * environment — see docs on Railway-only MySQL). Never used in production.
 */
export function createInMemoryClaireStore(): ClaireRelationshipStore {
  const events: ClaireRelationshipEvent[] = [];
  const states = new Map<string, ClaireRelationshipState>();
  const transitions: ClaireTierTransition[] = [];
  let nextEventId = 1;

  const stateKey = (tenantId: string, operatorUserId: string, characterId: CharacterId) =>
    `${tenantId}::${operatorUserId}::${characterId}`;

  return {
    async appendEvent(input: ClaireRelationshipEventInput) {
      const now = new Date();
      const record: ClaireRelationshipEvent = {
        id: nextEventId++,
        tenantId: input.tenantId,
        operatorUserId: input.operatorUserId,
        characterId: input.characterId ?? "claire",
        eventType: input.eventType,
        summary: input.summary,
        provenance: input.provenance,
        relatedEntityType: input.relatedEntityType ?? null,
        relatedEntityId: input.relatedEntityId ?? null,
        evidenceSource: input.evidenceSource ?? null,
        occurredAt: (input.occurredAt ?? now).toISOString(),
        createdAt: now.toISOString(),
      };
      events.push(record);
      return record;
    },

    async listEvents(input) {
      const rows = events
        .filter(
          event =>
            event.tenantId === input.tenantId &&
            event.operatorUserId === input.operatorUserId &&
            event.characterId === input.characterId
        )
        .sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
      return input.limit ? rows.slice(-input.limit) : rows;
    },

    async getState(input) {
      return states.get(stateKey(input.tenantId, input.operatorUserId, input.characterId)) ?? null;
    },

    async upsertState(state) {
      states.set(stateKey(state.tenantId, state.operatorUserId, state.characterId), {
        ...state,
        updatedAt: new Date().toISOString(),
      });
    },

    async insertTierTransition(transition) {
      transitions.push({ ...transition, createdAt: new Date().toISOString() });
    },

    async listTierTransitions(input) {
      return transitions.filter(
        transition =>
          transition.tenantId === input.tenantId &&
          transition.operatorUserId === input.operatorUserId &&
          transition.characterId === input.characterId
      );
    },
  };
}
