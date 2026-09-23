/**
 * Tenant/operator progression read. Uses the authenticated identity the
 * caller already resolved. Does not create Day 1 missions, kingdom rows,
 * companion unlocks, or progression rows.
 */
import { isCompanionEarned } from "../companions/companionService";
import { getDb } from "../db";
import { getDay1TenDoorsMissionReadOnly } from "../openChannel/day1TenDoorsService";
import {
  projectGoldlineProgression,
  rejectClientProgressionForge,
  type GoldlineProgressionRead,
} from "./progressionContract";

export async function readGoldlineProgression(input: {
  tenantId: string;
  operatorId: string;
}): Promise<GoldlineProgressionRead> {
  rejectClientProgressionForge(input);

  let outcomes: Record<string, unknown> | null = null;
  let outcomesAvailable = false;
  try {
    const mission = await getDay1TenDoorsMissionReadOnly({
      tenantId: input.tenantId,
      driverId: input.operatorId,
    });
    outcomesAvailable = true;
    outcomes = mission?.outcomes ?? {};
  } catch {
    outcomesAvailable = false;
    outcomes = null;
  }

  let capabilityGranted = false;
  let capabilityReadable = false;
  try {
    const db = await getDb();
    if (db) {
      capabilityGranted = await isCompanionEarned({
        tenantId: input.tenantId,
        operatorId: input.operatorId,
        companionId: "rook",
      });
      capabilityReadable = true;
    }
  } catch {
    capabilityGranted = false;
    capabilityReadable = false;
  }

  return projectGoldlineProgression({
    tenantId: input.tenantId,
    operatorId: input.operatorId,
    outcomes,
    outcomesAvailable,
    capabilityRookContactGranted: capabilityGranted,
    capabilityRookContactReadable: capabilityReadable,
  });
}
