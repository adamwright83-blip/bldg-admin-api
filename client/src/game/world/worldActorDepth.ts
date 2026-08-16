/**
 * Depth ordering for everything that stands in the world.
 *
 * Trailblazer, civilians, the mission and order actors, the Ruinbound and
 * the physical props are all WORLD ACTORS. They must interleave with each
 * other individually — a guardian further up the lane belongs behind a
 * civilian nearer the camera, and in front of one further still.
 *
 * That is impossible while each system owns its own nested container, which
 * is why the guardians previously rendered as a single slab either wholly in
 * front of or wholly behind the crowd. They now share one sortable parent
 * and sort on screen Y.
 *
 * Screen Y is the primary signal: further up the plate is further away. The
 * stable-id term only breaks exact ties, and is a hash rather than
 * Math.random() so two actors at identical depth never flicker between
 * frames.
 */

/**
 * Band spacing must clear the actor range, which is `groundY * 10` and so
 * scales with screen height. The first cut used 9000/9500 for particles and
 * overlays, which an actor standing near the bottom of an 852px screen
 * already exceeded (1000 + 8520 = 9520) — combat overlays would have sorted
 * BEHIND a near-camera guardian. The bands are now far enough apart that no
 * plausible viewport, including large tablets, can collide with them.
 */
export const TRAVERSAL_Z = {
  STATIC_WORLD: 0,
  STRONGHOLD: 100,
  FORTRESS: 110,
  WORLD_ACTOR_BASE: 1_000,
  PARTICLES: 100_000,
  GAMEPLAY_OVERLAY: 200_000,
} as const;

/** Largest screen height the actor band is guaranteed to accommodate. */
export const MAX_SUPPORTED_GROUND_Y = 9_000;

function stableTie(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return (hash % 100) / 1000;
}

/**
 * @param groundY screen y of the actor's feet — NOT its centre, or tall and
 *   short actors at the same depth would sort inconsistently.
 */
export function worldActorZ(groundY: number, stableId: string): number {
  return TRAVERSAL_Z.WORLD_ACTOR_BASE + groundY * 10 + stableTie(stableId);
}
