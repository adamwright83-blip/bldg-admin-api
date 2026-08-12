/**
 * The set of corridors this build knows about, and which one is the entry
 * world.
 *
 * This is deliberately a small static list rather than a directory scan:
 * knowing a corridor EXISTS must never imply loading it. Nothing here fetches
 * a manifest, touches an asset, or warms a cache — boot cost stays exactly
 * one corridor no matter how many are eventually authored.
 */

export type CorridorRegistryEntry = {
  id: string;
  /**
   * Human-readable label for tooling/diagnostics. Not player-facing copy —
   * the player learns where they are from real mission context, never from a
   * corridor's internal name.
   */
  label: string;
  /**
   * False while a corridor is still being authored. The runtime refuses to
   * project onto it; validation tooling still can.
   */
  playable: boolean;
};

/**
 * corridor_01 is the shipped world. corridor_02 is registered as NOT playable
 * because its engineering contract exists while its final art does not —
 * registering it keeps the contract honest and testable without ever letting
 * an unfinished corridor become the live world.
 */
export const CORRIDOR_REGISTRY: readonly CorridorRegistryEntry[] = [
  { id: "corridor_01", label: "Approach corridor", playable: true },
  { id: "corridor_02", label: "Second corridor (authoring)", playable: false },
] as const;

/** The corridor the player boots into when nothing else is determined. */
export const DEFAULT_CORRIDOR_ID = "corridor_01";

export function corridorRegistryEntry(
  corridorId: string
): CorridorRegistryEntry | null {
  return CORRIDOR_REGISTRY.find(entry => entry.id === corridorId) ?? null;
}

export function isKnownCorridor(corridorId: string): boolean {
  return corridorRegistryEntry(corridorId) !== null;
}

/** Ids the runtime is permitted to serve as the live world. */
export function playableCorridorIds(): string[] {
  return CORRIDOR_REGISTRY.filter(entry => entry.playable).map(entry => entry.id);
}

export function isPlayableCorridor(corridorId: string): boolean {
  return corridorRegistryEntry(corridorId)?.playable === true;
}
