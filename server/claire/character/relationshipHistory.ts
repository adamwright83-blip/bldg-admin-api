import { getProgressionStore } from "../progression/drizzleStore";
import type { ProgressionStore } from "../progression/store";
import {
  assembleClaireRelationshipHistory,
  type ClaireAssembledRelationshipHistory,
  type ClaireDeclaredPreference,
  type ClaireExperimentObservation,
  type ClaireInferenceRecord,
  type ClaireObservedPattern,
  type CurrentTruthLookup,
} from "../../../shared/claireRelationshipHistory";
import type { VerifiedFactInventory } from "../assertionGuard";
import { compileClaireCharacterContext } from "./compiler";
import { listClaireRelationshipEvents } from "./relationshipEvents";
import { getClaireRelationshipState } from "./relationshipState";
import type {
  CharacterId,
  ClaireCompiledContext,
  ClaireMode,
  ClaireRelationshipEvent,
} from "./types";

const EVENT_RETRIEVAL_LIMIT = 40;

export function truthLookupFromInventory(
  inventory: VerifiedFactInventory | null | undefined
): CurrentTruthLookup | null {
  if (!inventory) return null;
  return {
    supportsCurrentClaim(claimedState, entityRef) {
      return inventory.hasVerifiedClaim(
        claimedState as "queued" | "scheduled" | "sent" | "created" | "counted",
        entityRef
      );
    },
  };
}

async function listEventsFailClosed(input: {
  tenantId: string;
  operatorUserId: string;
  characterId?: CharacterId;
}): Promise<ClaireRelationshipEvent[]> {
  try {
    return await listClaireRelationshipEvents({
      tenantId: input.tenantId,
      operatorUserId: input.operatorUserId,
      characterId: input.characterId,
      limit: EVENT_RETRIEVAL_LIMIT,
    });
  } catch {
    return [];
  }
}

/**
 * Bounded, fail-closed load of relationship history from existing stores.
 * Callers may attach optional declared / observed / experiment / inference
 * records already in hand — this function never dumps transcripts into a
 * new memory table.
 */
export async function loadClaireRelationshipHistory(input: {
  tenantId: string;
  operatorUserId: string | null | undefined;
  characterId?: CharacterId;
  topic?: string;
  declaredPreferences?: readonly ClaireDeclaredPreference[];
  observedPatterns?: readonly ClaireObservedPattern[];
  experimentObservations?: readonly ClaireExperimentObservation[];
  inferences?: readonly ClaireInferenceRecord[];
  inventory?: VerifiedFactInventory | null;
  relationshipEvents?: readonly ClaireRelationshipEvent[];
}): Promise<ClaireAssembledRelationshipHistory> {
  if (!input.operatorUserId) {
    return assembleClaireRelationshipHistory({
      tenantId: input.tenantId,
      operatorUserId: null,
    });
  }
  const relationshipEvents =
    input.relationshipEvents ??
    (await listEventsFailClosed({
      tenantId: input.tenantId,
      operatorUserId: input.operatorUserId,
      characterId: input.characterId,
    }));
  return assembleClaireRelationshipHistory({
    tenantId: input.tenantId,
    operatorUserId: input.operatorUserId,
    relationshipEvents,
    declaredPreferences: input.declaredPreferences,
    observedPatterns: input.observedPatterns,
    experimentObservations: input.experimentObservations,
    inferences: input.inferences,
    topic: input.topic,
    truthLookup: truthLookupFromInventory(input.inventory),
  });
}

/**
 * Single production compiler contract for character-enabled Claire surfaces.
 * Fails closed to Tier 0 / empty history; never a precondition for business
 * truth generation.
 */
export async function compileClaireContextForOperator(input: {
  tenantId: string;
  operatorUserId: string | null | undefined;
  mode: ClaireMode;
  topic?: string;
  declaredPreferences?: readonly ClaireDeclaredPreference[];
  observedPatterns?: readonly ClaireObservedPattern[];
  experimentObservations?: readonly ClaireExperimentObservation[];
  inferences?: readonly ClaireInferenceRecord[];
  inventory?: VerifiedFactInventory | null;
  /** Test seam; production reads the shared progression store. */
  progressionStore?: ProgressionStore;
  /** Set by the personal-turn controller: the only canon this turn may draw on. */
  boundedCanonFragmentIds?: readonly string[];
}): Promise<ClaireCompiledContext> {
  const relationshipState = await getClaireRelationshipState({
    tenantId: input.tenantId,
    operatorUserId: input.operatorUserId,
  });
  const relationshipEvents = input.operatorUserId
    ? await listEventsFailClosed({
        tenantId: input.tenantId,
        operatorUserId: input.operatorUserId,
      })
    : [];
  const assembledHistory = await loadClaireRelationshipHistory({
    ...input,
    relationshipEvents,
  });
  // Hidden, progress-backed state. Any failure fails closed to rapport 0 / rung 0.
  let progression: { rapportBand: 0 | 1 | 2 | 3; personalRung: 0 | 1 | 2 | 3 } = { rapportBand: 0, personalRung: 0 };
  if (input.operatorUserId) {
    try {
      const grant = await (input.progressionStore ?? getProgressionStore()).getGrant({
        tenantId: input.tenantId,
        operatorUserId: input.operatorUserId,
      });
      if (grant) progression = { rapportBand: grant.rapportBand, personalRung: grant.personalRung };
    } catch {
      // fail closed
    }
  }
  return compileClaireCharacterContext({
    mode: input.mode,
    progression,
    boundedCanonFragmentIds: input.boundedCanonFragmentIds,
    relationshipState,
    recentSharedHistory: assembledHistory.failClosed ? [] : relationshipEvents,
    assembledHistory,
    explicitlyRequestedTopic: input.topic,
  });
}
