import { CLAIRE_CHARACTER_DEFINITION } from "./characterDefinition";
import { listClaireRelationshipEvents } from "./relationshipEvents";
import { getClaireRelationshipStore } from "./store";
import { computeClaireDisclosureTier, deriveClaireRelationshipDimensions } from "./tierEngine";
import {
  CLAIRE_DEFAULT_RELATIONSHIP_STATE,
  type CharacterId,
  type ClaireRelationshipState,
} from "./types";

function defaultState(
  tenantId: string,
  operatorUserId: string,
  characterId: CharacterId
): ClaireRelationshipState {
  return {
    tenantId,
    operatorUserId,
    characterId,
    ...CLAIRE_DEFAULT_RELATIONSHIP_STATE,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Read-only, cache-first accessor. Fails closed to Tier 0 whenever the DB
 * is unavailable, no operatorUserId was resolvable, or no state has been
 * computed yet — never fails toward deeper disclosure (Slice 17).
 */
export async function getClaireRelationshipState(input: {
  tenantId: string;
  operatorUserId: string | null | undefined;
  characterId?: CharacterId;
}): Promise<ClaireRelationshipState> {
  const characterId = input.characterId ?? "claire";
  if (!input.operatorUserId) {
    return defaultState(input.tenantId, "unresolved", characterId);
  }
  const row = await getClaireRelationshipStore().getState({
    tenantId: input.tenantId,
    operatorUserId: input.operatorUserId,
    characterId,
  });
  return row ?? defaultState(input.tenantId, input.operatorUserId, characterId);
}

/**
 * Recomputes state from the full relationship-event history (never trusts
 * the previous cached row as an input) and persists both the refreshed
 * cache row and, if the tier changed, an auditable transition record
 * (Slice 7). Call this after appending a new relationship event — never
 * let the model call this itself.
 */
export async function recomputeClaireRelationshipState(input: {
  tenantId: string;
  operatorUserId: string;
  characterId?: CharacterId;
}): Promise<ClaireRelationshipState> {
  const characterId = input.characterId ?? "claire";
  const store = getClaireRelationshipStore();

  const previous = await getClaireRelationshipState({ ...input, characterId });
  const events = await listClaireRelationshipEvents({
    tenantId: input.tenantId,
    operatorUserId: input.operatorUserId,
    characterId,
  });
  const dimensions = deriveClaireRelationshipDimensions(events);
  const tierComputation = computeClaireDisclosureTier(
    events,
    CLAIRE_CHARACTER_DEFINITION.relationshipPolicy
  );
  const lastEventId = events.length ? events[events.length - 1].id : null;

  await store.upsertState({
    tenantId: input.tenantId,
    operatorUserId: input.operatorUserId,
    characterId,
    professionalRespect: dimensions.professionalRespect,
    reliability: dimensions.reliability,
    disclosureSafety: dimensions.disclosureSafety,
    familiarity: dimensions.familiarity,
    disclosureTier: tierComputation.tier,
    qualifyingInteractionCount: dimensions.qualifyingInteractionCount,
    distinctInteractionDays: dimensions.distinctInteractionDays,
    lastEventId,
  });

  if (tierComputation.tier !== previous.disclosureTier) {
    await store.insertTierTransition({
      tenantId: input.tenantId,
      operatorUserId: input.operatorUserId,
      characterId,
      fromTier: previous.disclosureTier,
      toTier: tierComputation.tier,
      reasons: tierComputation.reasons,
      supportingEventIds: tierComputation.supportingEventIds,
    });
  }

  return getClaireRelationshipState({ ...input, characterId });
}

export async function listClaireTierTransitions(input: {
  tenantId: string;
  operatorUserId: string;
  characterId?: CharacterId;
}) {
  return getClaireRelationshipStore().listTierTransitions({
    tenantId: input.tenantId,
    operatorUserId: input.operatorUserId,
    characterId: input.characterId ?? "claire",
  });
}
