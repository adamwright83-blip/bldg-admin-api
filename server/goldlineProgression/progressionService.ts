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
import { recordLevelFromOutcomes, recordRookFromOutcomes } from "./progressionWrites";

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

async function loadCapability(input: { tenantId: string; operatorId: string }): Promise<{
  granted: boolean;
  readable: boolean;
}> {
  try {
    const db = await getDb();
    if (!db) return { granted: false, readable: false };
    return {
      granted: await isCompanionEarned({
        tenantId: input.tenantId,
        operatorId: input.operatorId,
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
  operatorId: string;
}): Promise<GoldlineProgressionRead> {
  rejectClientProgressionForge(input);
  const [outcomes, capability, stored] = await Promise.all([
    loadOutcomes(input),
    loadCapability(input),
    findDomainProgression(input).catch(() => ({ readable: false as const })),
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
 * Records level.colosseum when colosseumKingdomBindingSatisfied is true.
 * Does not own Rook and does not complete kingdom.brass_republic.
 * A second call keeps the first timestamp.
 */
export async function recordLevelColosseumResolved(input: {
  tenantId: string;
  operatorId: string;
  clientPayload?: unknown;
}): Promise<GoldlineProgressionRead> {
  const outcomes = await loadOutcomes(input);
  await recordLevelFromOutcomes({ ...input, ...outcomes });
  return readGoldlineProgression(input);
}

/**
 * Separate authored write for companion.rook. Requires the level timestamp
 * already stored for this tenant and operator. Idempotent. Does not complete
 * the Kingdom and does not grant capability.rook.contact.
 */
export async function recordCompanionRookOwned(input: {
  tenantId: string;
  operatorId: string;
  clientPayload?: unknown;
}): Promise<GoldlineProgressionRead> {
  const outcomes = await loadOutcomes(input);
  await recordRookFromOutcomes({ ...input, ...outcomes });
  return readGoldlineProgression(input);
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
