/**
 * Pure player-vs-hostile collision math, factored out of GoldlineGame's
 * render loop so it can be unit tested without a Pixi Application.
 *
 * Uses the SAME distance metric ExpeditionLayer's nearestMeleeTarget already
 * uses for melee range (`Math.hypot(progressDelta, lateralDelta / 400)`,
 * lateral in the ×140 expedition-corridor space — see
 * GoldlineGame.setPlayerCorridor/tryStrike) rather than an independently
 * tuned screen-pixel radius. An earlier version sampled local screen pixels
 * instead and, at some corridor depths, produced a collision radius LARGER
 * than the 0.06 melee range — physically blocking the player from ever
 * getting close enough to land a STRIKE at all. Tying it to the same
 * metric, at a strictly smaller radius, guarantees a hostile's body can
 * never wall off its own attack range.
 */

/** Strictly under nearestMeleeTarget's 0.06 (ExpeditionLayer.ts). */
export const HOSTILE_COLLISION_RADIUS = 0.035;

export type HostileCollisionTarget = {
  /** Corridor progress, same space as the player's own `progress`. */
  x: number;
  /** Lateral in ExpeditionLayer's ×140 expedition-corridor space. */
  y: number;
};

function collidesWithAny(
  progress: number,
  lateral: number,
  targets: readonly HostileCollisionTarget[],
  broadPhase: number
): boolean {
  for (const target of targets) {
    if (Math.abs(target.x - progress) > broadPhase) continue;
    const d = Math.hypot(target.x - progress, (target.y - lateral * 140) / 400);
    if (d < HOSTILE_COLLISION_RADIUS) return true;
  }
  return false;
}

/**
 * Blocks Trailblazer's own body from passing through a living hostile's.
 * Slides along whichever single axis of the attempted move stays clear
 * instead of a hard stop, so brushing past a guardian's shoulder still
 * reads as movement rather than getting stuck dead.
 */
export function resolveHostileCollision(
  candidateProgress: number,
  candidateLateral: number,
  currentProgress: number,
  currentLateral: number,
  targets: readonly HostileCollisionTarget[]
): { progress: number; lateral: number } {
  if (targets.length === 0) {
    return { progress: candidateProgress, lateral: candidateLateral };
  }
  const broadPhase = HOSTILE_COLLISION_RADIUS * 2;

  if (!collidesWithAny(candidateProgress, candidateLateral, targets, broadPhase)) {
    return { progress: candidateProgress, lateral: candidateLateral };
  }
  if (!collidesWithAny(candidateProgress, currentLateral, targets, broadPhase)) {
    return { progress: candidateProgress, lateral: currentLateral };
  }
  if (!collidesWithAny(currentProgress, candidateLateral, targets, broadPhase)) {
    return { progress: currentProgress, lateral: candidateLateral };
  }
  return { progress: currentProgress, lateral: currentLateral };
}
