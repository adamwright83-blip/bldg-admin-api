import { overworldPostRookOpen } from "../../../../../shared/goldlineDomainProgression";
import type { DestinationAvailability, DestinationStateMap } from "./types";

/**
 * world.overworld consumes `goldlineProgression.get` / `readGoldlineProgression`.
 * localStorage is not an input. Unrecorded flags are not ownership.
 *
 * Pre-Rook the only meaningful destination is the existing Colosseum entrance
 * (Brass Republic → level.colosseum). The broken-span linehooks are the walk
 * to that entrance, not a second system.
 *
 * Post-Rook opens exactly one existing place: THE WAYWARD (`ship.wayward`).
 * That requires both server fields to have value true, and neither field may
 * be unrecorded. Kingdom Two is not a destination.
 */

export const COLOSSEUM_DESTINATION_ID = "greystar-6";
export const COLOSSEUM_PATH_DESTINATION_IDS = [
  "colosseum-linehook",
  "colosseum-linehook-return",
] as const;
export const POST_ROOK_DESTINATION_ID = "wayward-approach";

const COLOSSEUM_PATH = new Set<string>(COLOSSEUM_PATH_DESTINATION_IDS);

export type ServerProgressionFlag = {
  status?: unknown;
  value?: unknown;
};

/**
 * Structural read of `readGoldlineProgression`. Extra server fields are ignored.
 * A missing read fails closed.
 */
export type OverworldProgressionReading = {
  tenantId?: unknown;
  operatorId?: unknown;
  levelColosseumResolved?: ServerProgressionFlag | null;
  companionRookOwned?: ServerProgressionFlag | null;
  kingdomBrassRepublicCompleted?: ServerProgressionFlag | null;
  overworldUnlocks?: { status?: unknown; flags?: unknown } | null;
  capabilityRookContact?: { granted?: unknown } | null;
  localStorage?: unknown;
} | null | undefined;

export function serverProgressionFlagTrue(
  flag: ServerProgressionFlag | null | undefined
): boolean {
  return flag?.status === "earned" && flag.value === true;
}

/**
 * Drop a cached read that belongs to someone else, or that never named a
 * tenant and operator. The server stamps progression `operatorId` with
 * `user.openId` (`goldlineProgression.get`). The numeric user id is the
 * companion-capability key, not a substitute for this match. A missing
 * session fails closed.
 */
export function progressionForSignedInOperator(
  read: OverworldProgressionReading,
  operator: { id?: unknown; openId?: unknown; tenantId?: unknown } | null | undefined
): OverworldProgressionReading {
  if (!read || operator?.id == null || operator.id === "") return null;
  if (typeof operator.openId !== "string" || operator.openId.length === 0) return null;
  if (typeof read.operatorId !== "string" || read.operatorId !== operator.openId) return null;
  if (typeof read.tenantId !== "string" || read.tenantId.length === 0) return null;
  const operatorTenant = typeof operator.tenantId === "string" ? operator.tenantId.trim() : "";
  if (operatorTenant.length > 0 && read.tenantId !== operatorTenant) return null;
  return read;
}

/** Both server flags earned and true. Unrecorded, unearned, and uncertain stay closed. */
export function postRookContentOpen(read: OverworldProgressionReading): boolean {
  const level = read?.levelColosseumResolved;
  const rook = read?.companionRookOwned;
  if (!serverProgressionFlagTrue(level) || !serverProgressionFlagTrue(rook)) return false;
  return overworldPostRookOpen({
    levelColosseumResolved: { value: true },
    companionRookOwned: { value: true },
  });
}

export function overworldDestinationStates(
  read: OverworldProgressionReading,
  destinationIds: readonly string[]
): DestinationStateMap {
  const postRook = postRookContentOpen(read);
  const states: DestinationStateMap = {};
  for (const id of destinationIds) {
    if (id === COLOSSEUM_DESTINATION_ID || COLOSSEUM_PATH.has(id)) {
      states[id] = "active";
    } else if (id === POST_ROOK_DESTINATION_ID && postRook) {
      states[id] = "active";
    } else {
      states[id] = "dormant";
    }
  }
  return states;
}

export function destinationPresented(
  availability: DestinationAvailability | undefined
): boolean {
  return availability !== "dormant";
}

export function activeDestinationIds(states: DestinationStateMap): string[] {
  return Object.entries(states)
    .filter(([, availability]) => availability === "active")
    .map(([id]) => id);
}
