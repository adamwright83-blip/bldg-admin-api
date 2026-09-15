/**
 * A stable per-lantern animation offset, in seconds.
 *
 * Deterministic from the cluster key so the same location always breathes on
 * the same beat — a reload must not reshuffle the city's rhythm, and two
 * lanterns must not drift into lockstep. Presentation only; nothing here
 * touches customer state.
 */
export function lanternPhaseSeconds(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) % 100000;
  }
  // Spread across the breathing cycle rather than a fixed set of buckets.
  return (hash % 700) / 100;
}
