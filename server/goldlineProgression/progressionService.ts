/**
 * Tenant/operator progression. Reads do not insert rows. The authored
 * Clockhead finale records level.colosseum and then companion.rook.
 * Kingdom completion is not written.
 */
import { isCompanionEarned } from "../companions/companionService";
import { getDb } from "../db";
import { getDay1TenDoorsMissionReadOnly } from "../openChannel/day1TenDoorsService";
import { COLOSSEUM_AUTHORED_FINALE_CONSEQUENCE } from "../../shared/colosseumAuthoredFinale";
import {
  assertLevelColosseumRecordPermitted,
  attemptRecordKingdomBrassRepublicCompleted,
  projectGoldlineProgression,
  ProgressionNotPermittedError,
  rejectClientProgressionForge,
  type GoldlineProgressionRead,
} from "./progressionContract";
import { findDomainProgression, recordAuthoredColosseumFinale } from "./progressionStore";
import { recordRookFromOutcomes } from "./progressionWrites";

async function loadOutcomes(input: { tenantId: string; operatorId: string }): Promise<{
  outcomes: Record<string, unknown> | null;
  outcomesAvailable: boolean;
}> {
  try {
    const mission = await getDay1TenDoorsMissionReadOnly({
      tenantId: input.tenantId,
      driverId: input.operatorId,
    });
    return { outcomesAvailable: true, outcomes: mission?.outcomes ?? {} };
  } catch {
    return { outcomesAvailable: false, outcomes: null };
  }
}

async function loadCapability(input: {
  tenantId: string;
  capabilityOperatorId: string | null;
}): Promise<{
  granted: boolean;
  readable: boolean;
}> {
  if (!input.capabilityOperatorId) return { granted: false, readable: false };
  try {
    const db = await getDb();
    if (!db) return { granted: false, readable: false };
    return {
      granted: await isCompanionEarned({
        tenantId: input.tenantId,
        operatorId: input.capabilityOperatorId,
        companionId: "rook",
      }),
      readable: true,
    };
  } catch {
    return { granted: false, readable: false };
  }
}

export async function readGoldlineProgression(input: {
  tenantId: string;
  /** Day 1 openId. Progression rows and mission outcomes use this key. */
  operatorId: string;
  /**
   * `String(user.id)`. Companion unlocks are stored under this key.
   * Null skips the lookup instead of querying the Day 1 openId.
   */
  capabilityOperatorId: string | null;
}): Promise<GoldlineProgressionRead> {
  rejectClientProgressionForge(input);
  const [outcomes, capability, stored] = await Promise.all([
    loadOutcomes({ tenantId: input.tenantId, operatorId: input.operatorId }),
    loadCapability({
      tenantId: input.tenantId,
      capabilityOperatorId: input.capabilityOperatorId,
    }),
    findDomainProgression({ tenantId: input.tenantId, operatorId: input.operatorId }).catch(() => ({
      readable: false as const,
    })),
  ]);
  return projectGoldlineProgression({
    tenantId: input.tenantId,
    operatorId: input.operatorId,
    outcomes: outcomes.outcomes,
    outcomesAvailable: outcomes.outcomesAvailable,
    capabilityRookContactGranted: capability.granted,
    capabilityRookContactReadable: capability.readable,
    stored,
  });
}

/**
 * Separate authored write for companion.rook. Requires the level timestamp
 * already stored for this tenant and operator and the Clockhead finale's
 * authored consequence. Idempotent. Does not complete the Kingdom and does
 * not grant capability.rook.contact. Five visits are not this write.
 */
export async function recordCompanionRookOwned(input: {
  tenantId: string;
  operatorId: string;
  capabilityOperatorId?: string | null;
  authoredConsequence?: unknown;
  clientPayload?: unknown;
}): Promise<GoldlineProgressionRead> {
  const outcomes = await loadOutcomes(input);
  await recordRookFromOutcomes({ ...input, ...outcomes });
  return readGoldlineProgression({
    tenantId: input.tenantId,
    operatorId: input.operatorId,
    capabilityOperatorId: input.capabilityOperatorId ?? null,
  });
}

/**
 * Production acknowledgement of the authored Clockhead finale.
 * Tenant and operator come from the session. The exact consequence is
 * checked, then kingdom_binding.level.colosseum is re-read. An unsatisfied
 * binding writes nothing. A satisfied binding records level.colosseum and
 * then companion.rook in one transaction. This is the only production
 * caller that writes levelColosseumResolvedAt.
 */
export async function acknowledgeColosseumAuthoredFinale(input: {
  tenantId: string;
  operatorId: string;
  capabilityOperatorId?: string | null;
  authoredConsequence: unknown;
  clientPayload?: unknown;
}): Promise<GoldlineProgressionRead> {
  rejectClientProgressionForge(input);
  rejectClientProgressionForge(input.clientPayload);
  if (input.authoredConsequence !== COLOSSEUM_AUTHORED_FINALE_CONSEQUENCE) {
    throw new ProgressionNotPermittedError(
      "level.colosseum and companion.rook require the authored Clockhead finale clockhead_finale.rook_joined_the_party"
    );
  }
  const outcomes = await loadOutcomes(input);
  assertLevelColosseumRecordPermitted({
    outcomes: outcomes.outcomes,
    outcomesAvailable: outcomes.outcomesAvailable,
    clientPayload: input.clientPayload,
  });
  await recordAuthoredColosseumFinale({
    tenantId: input.tenantId,
    operatorId: input.operatorId,
    at: new Date(),
  });
  return readGoldlineProgression({
    tenantId: input.tenantId,
    operatorId: input.operatorId,
    capabilityOperatorId: input.capabilityOperatorId ?? null,
  });
}

/** Kingdom completion stays refused. The Colosseum binding is not that write. */
export async function recordKingdomBrassRepublicCompleted(input: {
  tenantId: string;
  operatorId: string;
  outcomes: Record<string, unknown> | null;
  outcomesAvailable: boolean;
  clientPayload?: unknown;
}): Promise<never> {
  return attemptRecordKingdomBrassRepublicCompleted(input);
}
