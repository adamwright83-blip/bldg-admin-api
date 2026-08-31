/**
 * FRESH DAMAGE — today's wounds, above the architecture and above the scars.
 *
 * The layer model, bottom to top:
 *
 *     pristine plate
 *       + settled scars / patina      permanent history (facadeScars.ts)
 *         + FRESH DAMAGE              this module — TODAY only
 *           + weapon overlays, projectile, vfx
 *
 * Until now `chipped` and `cracked` rendered identically to `pristine` — only the two
 * worst states got a radial-gradient wash — so a strike produced almost no readable
 * change. A first-time viewer must be able to see that a giant weapon just hit that
 * building.
 *
 * WHAT IS TRUTH AND WHAT IS PRESENTATION
 *
 * Truth: how many strikes the building has absorbed TODAY. That is the only input.
 * Presentation: where each wound sits and what shape it takes. Placement is hashed
 * from the business date and the wound index, so today's damage is stable across
 * re-renders and reloads, and is distinguishable from any other day's.
 *
 * These wounds are the same marks the nightly settlement converts into permanent
 * scars — the wound literally becomes the memory, rather than two unrelated systems.
 */
import { boundsForBuilding, type FacadeBounds } from "./facadeScars";

/** Severity of a single fresh wound. More strikes today means worse wounds. */
export type WoundKind = "scorch" | "breach" | "rupture" | "collapse";

export type FreshWound = {
  key: string;
  kind: WoundKind;
  /** Percent of the 800x1200 art space. Presentation, not data. */
  xPercent: number;
  yPercent: number;
  rotation: number;
  /** 0..1 — how recently this wound landed. The newest reads hottest. */
  heat: number;
};

/** Wound severity for the Nth strike of the day, worsening as the day compounds. */
export function woundKindFor(strikeIndex: number, totalToday: number): WoundKind {
  if (totalToday >= 4 && strikeIndex >= 3) return "collapse";
  if (totalToday >= 3 && strikeIndex >= 2) return "rupture";
  if (strikeIndex >= 1) return "breach";
  return "scorch";
}

/** MurmurHash3 finalizer — FNV-1a alone clumps on sequential suffixes. */
function mix32(value: number): number {
  let hash = value;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

function stableHash(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return mix32(hash >>> 0);
}

function band(hash: number, min: number, max: number): number {
  return min + ((hash % 1000) / 1000) * (max - min);
}

/**
 * Project today's absorbed strikes into positioned wounds.
 *
 * `incomingToday` is authoritative. The loop cannot run longer than it, so no wound
 * exists that does not correspond to a real strike taken today.
 */
export function projectFreshDamage(input: {
  buildingId: string;
  businessDate: string;
  incomingToday: number;
  bounds?: FacadeBounds;
}): FreshWound[] {
  const total = Math.max(0, Math.floor(input.incomingToday));
  if (total === 0) return [];
  const bounds = input.bounds ?? boundsForBuilding(input.buildingId);
  const last = Math.max(1, total - 1);

  const wounds: FreshWound[] = [];
  for (let index = 0; index < total; index += 1) {
    const seed = `${input.businessDate}:${input.buildingId}:wound:${index}`;
    wounds.push({
      key: seed,
      kind: woundKindFor(index, total),
      xPercent: band(stableHash(seed), bounds.minX, bounds.maxX),
      yPercent: band(stableHash(`${seed}:y`), bounds.minY, bounds.maxY),
      rotation: band(stableHash(`${seed}:r`), -14, 14),
      // The most recent wound is the hottest; earlier ones have begun to cool.
      heat: total === 1 ? 1 : index / last,
    });
  }
  return wounds;
}

/**
 * Wounds visible partway through a replay.
 *
 * Damage at event N must equal business state after event N — never the end-of-day
 * total painted from the first frame.
 */
export function freshDamageAtStrike(
  wounds: readonly FreshWound[],
  strikesSoFar: number
): FreshWound[] {
  return wounds.slice(0, Math.max(0, Math.min(wounds.length, strikesSoFar)));
}
