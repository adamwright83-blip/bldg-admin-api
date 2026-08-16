/**
 * Linehook target ontology and deterministic selection.
 *
 * This module is a STRUCTURAL SAFETY BOUNDARY, not a runtime guard. The
 * Linehook may only ever engage fictional hostiles and interactive
 * environment objects. It may never engage a civilian from
 * PopulationSystem, and it may never engage the world embodiment of a real
 * order or a real business person.
 *
 * That is enforced by types, not by `if (entity.isCivilian) return`.
 * `selectLineTarget` accepts `readonly LineTarget[]` and nothing else, and
 * `LineTarget` is a closed union of two branded shapes that only fictional
 * entities construct. A civilian or an order marker is not merely rejected
 * at runtime — it fails to typecheck at the call site. See
 * `lineTargets.test.ts`, which proves the negative case both structurally
 * and behaviourally.
 *
 * Selection is fully deterministic: no Math.random(), and ties resolve by
 * stable id ordering so the same world state always yields the same lock.
 */

/**
 * Brand prevents a structurally-similar business/civilian object from
 * being assignable to a target type by accident. Only the constructors in
 * this module mint the brand.
 */
declare const LineTargetBrand: unique symbol;

type Branded = { readonly [LineTargetBrand]: true };

export type LineTargetKind = "hostile" | "environment";

type LineTargetBase = Branded & {
  /** Stable across frames; used for lock persistence and tie-breaking. */
  readonly id: string;
  /** World-space position, same space as Trailblazer. */
  readonly x: number;
  readonly y: number;
  /**
   * False for a defeated hostile or an already-triggered hazard. Inactive
   * targets are never selectable but may remain in the world for render.
   */
  readonly active: boolean;
  /**
   * False while the entity is off-screen, fading in, or occluded behind a
   * foreground layer. An unreadable target must never attract the lock —
   * §30's "no prompt may claim an object exists unless the player can
   * actually perceive and reach it", applied to targeting.
   */
  readonly readable: boolean;
};

export type HostileLineTarget = LineTargetBase & {
  readonly kind: "hostile";
  readonly hostile: "hunter" | "slinger" | "shieldbearer";
  /**
   * Shieldbearer only: the facing its guard covers, in radians. The Line
   * exposes it from any angle; the basic lash does not.
   */
  readonly guardFacing: number | null;
};

export type EnvironmentLineTarget = LineTargetBase & {
  readonly kind: "environment";
  /**
   * `architecture` is grapple-able (traversal). `hazard` is manipulable
   * (§30's one visible environmental hazard).
   */
  readonly environment: "architecture" | "hazard";
};

export type LineTarget = HostileLineTarget | EnvironmentLineTarget;

export function hostileTarget(
  input: Omit<HostileLineTarget, "kind" | typeof LineTargetBrand> &
    Partial<Pick<HostileLineTarget, "guardFacing">>
): HostileLineTarget {
  return {
    ...input,
    guardFacing: input.guardFacing ?? null,
    kind: "hostile",
  } as HostileLineTarget;
}

export function environmentTarget(
  input: Omit<EnvironmentLineTarget, "kind" | typeof LineTargetBrand>
): EnvironmentLineTarget {
  return { ...input, kind: "environment" } as EnvironmentLineTarget;
}

/**
 * §14 initial tuning targets. Expressed in CSS pixels at the primary
 * 393x852 viewport and converted by the caller — never assumed to be
 * physical device pixels.
 */
export const AIM_CONE_TOTAL_RADIANS = (60 * Math.PI) / 180;
export const AIM_MAX_RADIUS_CSS_PX = 300;

/**
 * Angular error dominates distance: the player is pointing, and a target
 * they are clearly pointing at should win over a closer one they are not.
 */
const ANGULAR_WEIGHT = 1;
const DISTANCE_WEIGHT = 0.45;

/**
 * The incumbent lock gets a score discount so small thumb tremor does not
 * flicker the highlight between two comparable targets. A challenger must
 * be meaningfully better, not marginally better, to steal the lock.
 */
const LOCK_HYSTERESIS = 0.12;

export type AimQuery = {
  /** Origin of the aim, world space — Trailblazer's hand. */
  readonly originX: number;
  readonly originY: number;
  /** Aim direction in radians. */
  readonly aimRadians: number;
  /** Effective max radius in the same world units as positions. */
  readonly maxRadius: number;
  readonly coneRadians?: number;
  /** Id of the currently locked target, for hysteresis. */
  readonly lockedId?: string | null;
  /**
   * Optional reachability rule (§15.6). Returning false rejects the
   * candidate — e.g. a target behind solid architecture. Omitted means
   * everything in range is reachable.
   */
  readonly isReachable?: (target: LineTarget) => boolean;
};

export type LineTargetCandidate = {
  readonly target: LineTarget;
  readonly score: number;
  readonly distance: number;
  readonly angularError: number;
};

/** Smallest signed angle between two headings, in [-PI, PI]. */
export function angleDelta(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * Ranks every legal candidate, best first. Exposed for tests and for the
 * aim overlay, which dims near-misses rather than hiding them.
 */
export function rankLineTargets(
  targets: readonly LineTarget[],
  query: AimQuery
): LineTargetCandidate[] {
  const halfCone = (query.coneRadians ?? AIM_CONE_TOTAL_RADIANS) / 2;
  const maxRadius = query.maxRadius;

  const candidates: LineTargetCandidate[] = [];

  for (const target of targets) {
    if (!target.active) continue;
    if (!target.readable) continue;

    const dx = target.x - query.originX;
    const dy = target.y - query.originY;
    const distance = Math.hypot(dx, dy);
    if (distance > maxRadius) continue;
    // A target exactly at the origin has no meaningful bearing; refusing
    // it avoids an atan2(0,0) lock that the player cannot aim away from.
    if (distance === 0) continue;

    const angularError = Math.abs(
      angleDelta(Math.atan2(dy, dx), query.aimRadians)
    );
    if (angularError > halfCone) continue;

    if (query.isReachable && !query.isReachable(target)) continue;

    const normalizedAngle = angularError / halfCone;
    const normalizedDistance = distance / maxRadius;
    let score =
      ANGULAR_WEIGHT * normalizedAngle + DISTANCE_WEIGHT * normalizedDistance;

    if (query.lockedId && target.id === query.lockedId) {
      score -= LOCK_HYSTERESIS;
    }

    candidates.push({ target, score, distance, angularError });
  }

  // Deterministic ordering: better score first, then stable id. Never
  // Math.random(), and never raw array order, so identical world state
  // always produces an identical lock.
  candidates.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    return a.target.id < b.target.id ? -1 : a.target.id > b.target.id ? 1 : 0;
  });

  return candidates;
}

/**
 * The single selection entry point. Returns null when nothing legal is in
 * the cone — the caller must then return cleanly to movement rather than
 * converting the release into an accidental dodge (§16).
 */
export function selectLineTarget(
  targets: readonly LineTarget[],
  query: AimQuery
): LineTarget | null {
  return rankLineTargets(targets, query)[0]?.target ?? null;
}
