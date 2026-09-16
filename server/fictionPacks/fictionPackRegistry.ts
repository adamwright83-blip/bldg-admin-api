/**
 * Fiction pack registry.
 *
 * Packs are validated at module load, so a pack that breaks a law in
 * shared/fictionPack.ts fails the process rather than reaching a player.
 *
 * A run stores `fictionPackId` AND `fictionPackVersion` and resolves through
 * here, so editing a pack's copy never silently rewrites the story of a run
 * already in progress (docs/goldline/FICTION_PACKS.md section 5).
 */
import type { FictionPack } from "../../shared/fictionPack";
import { BIO_CONTAINMENT_PACK } from "./bioContainment";
import { PLAIN_OPERATION_PACK } from "./plainOperation";

const PACKS: FictionPack[] = [PLAIN_OPERATION_PACK, BIO_CONTAINMENT_PACK];

const BY_KEY = new Map<string, FictionPack>(
  PACKS.map(pack => [`${pack.id}@${pack.version}`, pack])
);

export function listFictionPacks(): FictionPack[] {
  return [...PACKS];
}

/** Null when the pack/version a run was frozen against is no longer shipped. */
export function getFictionPack(
  id: string,
  version: number
): FictionPack | null {
  return BY_KEY.get(`${id}@${version}`) ?? null;
}

export function getLatestFictionPack(id: string): FictionPack | null {
  const matching = PACKS.filter(pack => pack.id === id);
  if (matching.length === 0) return null;
  return matching.reduce((best, pack) =>
    pack.version > best.version ? pack : best
  );
}
