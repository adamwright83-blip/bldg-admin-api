/**
 * Tenant/operator progression. Reads do not insert rows. Level resolution
 * and Rook ownership are separate writes. Kingdom completion is not written.
 */
import { isCompanionEarned } from "../companions/companionService";
import { getDb } from "../db";
import { getDay1TenDoorsMissionReadOnly } from "../openChannel/day1TenDoorsService";
import {
  attemptRecordKingdomBrassRepublicCompleted,
  projectGoldlineProgression,
  rejectClientProgressionForge,
  type GoldlineProgressionRead,
} from "./progressionContract";
import { findDomainProgression } from "./progressionStore";
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
 * Tenant and operator are supplied by the session, never by the payload.
 * This is the only supported way to record companion.rook.
 */
export async function acknowledgeColosseumAuthoredFinale(input: {
  tenantId: string;
  operatorId: string;
  capabilityOperatorId?: string | null;
  authoredConsequence: unknown;
  clientPayload?: unknown;
}): Promise<GoldlineProgressionRead> {
  rejectClientProgressionForge(input);
  return recordCompanionRookOwned(input);
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
