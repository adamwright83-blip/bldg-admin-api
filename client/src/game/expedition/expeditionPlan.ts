/**
 * Deterministic authored expedition composition (§25/§26/§49).
 *
 * NOT an adaptive Director. There is no dynamic difficulty, no AI spawner,
 * and no Math.random() anywhere in this file. The same real order always
 * produces the same expedition, so when a run feels wrong we can tell what
 * caused it.
 *
 * The plan's INPUTS may include real authoritative facts (the stable order
 * id, the objective kind, the corridor). Its OUTPUTS are fiction only —
 * where guardians stand, where the route forks, where the hazard hangs.
 * Nothing here can read or write business truth.
 *
 * Layout follows §26's grammar along corridor progress 0..1:
 *
 *   threshold -> traversal -> hunter/slinger pressure -> relic ->
 *   FORK(safe|upper) -> traversal + hazard -> shieldbearer -> destination
 */
import type { HostileKind } from "./ruinbound";

export type BeatId = string;

export type HostileSpawn = {
  readonly id: BeatId;
  readonly kind: HostileKind;
  /** Corridor progress at which this guardian stands. */
  readonly progress: number;
  /** Lateral offset in world units; negative is toward the upper terrace. */
  readonly lateral: number;
  /** Only present on the branch the player physically took. */
  readonly route: "both" | "safe" | "upper";
};

export type EnvironmentSpawn = {
  readonly id: BeatId;
  readonly kind: "architecture" | "hazard";
  readonly progress: number;
  readonly lateral: number;
  readonly route: "both" | "safe" | "upper";
};

export type WaystoneSpawn = {
  readonly id: BeatId;
  readonly progress: number;
};

export type PickupExpeditionPlan = {
  /** The real order this expedition serves. Identity only — never mutated. */
  readonly orderId: number;
  readonly hostiles: readonly HostileSpawn[];
  readonly environment: readonly EnvironmentSpawn[];
  readonly waystones: readonly WaystoneSpawn[];
  /** Where the physical Safe/Upper fork opens and rejoins. */
  readonly fork: { readonly start: number; readonly end: number };
  /** Where the three relic plinths stand. */
  readonly relicPlinths: number;
  /** Destination — the real pickup. Arrival does NOT complete it. */
  readonly destination: number;
};

/**
 * Small deterministic hash of the order id. Used ONLY to vary fictional
 * dressing (which side a guardian stands on), never to decide difficulty,
 * rewards, or anything a player could feel as unfairness.
 */
function stableVariant(orderId: number, salt: number): number {
  const x = Math.abs(Math.imul(orderId + salt * 2654435761, 2246822519));
  return (x % 1000) / 1000;
}

/**
 * EXPEDITION SPACE vs CORRIDOR SPACE.
 *
 * The plan below authors its beats in normalised EXPEDITION space, 0..1,
 * because that is the readable way to describe an adventure: tutorial at
 * 0.10, first Hunter at 0.18, fork at 0.46, climax at 0.86, destination at
 * 0.96. Those numbers are fiction and carry no runtime meaning on their own.
 *
 * The runtime moves Trailblazer in CORRIDOR space, which GoldlineGame owns
 * and clamps to roughly 0.035..0.82, with ordinary corridor-exit logic
 * arming at 0.77. Authored beats past that ceiling — the Shieldbearer at
 * 0.86, the destination at 0.96 — were simply unreachable: the player could
 * never physically arrive at the climax or the pickup.
 *
 * So expedition space is mapped deterministically onto the genuinely
 * playable corridor span. The end is deliberately 0.78 rather than 0.82:
 * that keeps every beat below the ordinary exit trigger, so reachability
 * does not depend on transition suppression also being correct. Two
 * independent guarantees, not one.
 *
 * This is a pure coordinate mapping. It creates no second movement truth —
 * GoldlineGame remains the sole owner of Trailblazer's position, and the
 * plan owns fictional beat placement only. It cannot touch business state.
 */
export const EXPEDITION_CORRIDOR_START = 0.06;

/**
 * Where ordinary corridor-exit logic arms in GoldlineGame. The expedition's
 * entire reachable span must finish before this, with margin.
 */
export const CORRIDOR_EXIT_THRESHOLD = 0.77;
/** Safety margin so the ceiling can never drift up against the threshold. */
export const EXPEDITION_EXIT_MARGIN = 0.03;

/**
 * The furthest an expedition can carry the player.
 *
 * This was previously 0.78 — ABOVE the 0.77 exit threshold. The authored
 * beats happened to land below it, so the tests passed, but the reachable
 * span itself crossed the line and the player could physically walk past
 * the exit trigger. The invariant claimed ("max reachable < exit
 * threshold") was therefore false; it only looked true because the last
 * authored beat happened to be at T=0.96 rather than T=1.
 *
 * Derived from the threshold now, so the relationship is structural rather
 * than a coincidence of authoring.
 */
export const EXPEDITION_CORRIDOR_END =
  CORRIDOR_EXIT_THRESHOLD - EXPEDITION_EXIT_MARGIN;

/** Normalised expedition T (0..1) -> playable corridor progress. */
export function expeditionToCorridor(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return (
    EXPEDITION_CORRIDOR_START +
    clamped * (EXPEDITION_CORRIDOR_END - EXPEDITION_CORRIDOR_START)
  );
}

/** Inverse, for reporting how far through the expedition the player is. */
export function corridorToExpedition(progress: number): number {
  const span = EXPEDITION_CORRIDOR_END - EXPEDITION_CORRIDOR_START;
  return Math.max(0, Math.min(1, (progress - EXPEDITION_CORRIDOR_START) / span));
}

/** Corridor position the expedition begins at. */
export const EXPEDITION_START_PROGRESS = expeditionToCorridor(0);

const FORK_START = 0.52;
const FORK_END = 0.72;

export function planPickupExpedition(input: {
  orderId: number;
}): PickupExpeditionPlan {
  const { orderId } = input;
  const side = stableVariant(orderId, 1) < 0.5 ? -1 : 1;

  return {
    orderId,

    hostiles: [
      // §24: the first threat arrives around 15-30s with an exaggerated,
      // readable telegraph, after the player has had a safe Line target.
      {
        id: "hunter_first",
        kind: "hunter",
        progress: 0.26,
        lateral: 34 * side,
        route: "both",
      },
      // Ranged pressure enters once movement is understood, giving the
      // dodge a reason to exist.
      {
        id: "slinger_first",
        kind: "slinger",
        progress: 0.34,
        lateral: -58 * side,
        route: "both",
      },
      {
        id: "hunter_second",
        kind: "hunter",
        progress: 0.40,
        lateral: -20 * side,
        route: "both",
      },

      // SAFE LINE: lighter pressure, a recovery beat, fewer rewards.
      {
        id: "hunter_safe",
        kind: "hunter",
        progress: 0.58,
        lateral: 30,
        route: "safe",
      },

      // UPPER LINE: more danger, no recovery, but the optional cache.
      {
        id: "slinger_upper",
        kind: "slinger",
        progress: 0.55,
        lateral: -96,
        route: "upper",
      },
      {
        id: "hunter_upper",
        kind: "hunter",
        progress: 0.64,
        lateral: -80,
        route: "upper",
      },

      // Climax. One elite, after the routes rejoin, so both paths face it.
      {
        id: "shieldbearer_climax",
        kind: "shieldbearer",
        progress: 0.86,
        lateral: 0,
        route: "both",
      },
    ],

    environment: [
      // §24's safe, obvious first Line target — before any threat exists.
      {
        id: "arch_threshold_beam",
        kind: "architecture",
        progress: 0.1,
        lateral: -70,
        route: "both",
      },
      {
        id: "arch_traverse_1",
        kind: "architecture",
        progress: 0.4,
        lateral: -84,
        route: "both",
      },
      // The Upper Line is a genuine grapple traversal, not a faster walk.
      {
        id: "arch_upper_1",
        kind: "architecture",
        progress: 0.5,
        lateral: -110,
        route: "upper",
      },
      {
        id: "arch_upper_2",
        kind: "architecture",
        progress: 0.61,
        lateral: -124,
        route: "upper",
      },
      {
        id: "arch_upper_3",
        kind: "architecture",
        progress: 0.69,
        lateral: -102,
        route: "upper",
      },
      // §30: ONE visible hazard, placed before the climax and reachable
      // from both routes so no prompt can ever reference something the
      // player cannot perceive.
      {
        id: "hazard_suspended_cargo",
        kind: "hazard",
        progress: 0.8,
        lateral: -52,
        route: "both",
      },
      {
        id: "arch_climax_span",
        kind: "architecture",
        progress: 0.88,
        lateral: -90,
        route: "both",
      },
    ],

    waystones: [
      { id: "waystone_threshold", progress: 0 },
      { id: "waystone_prefork", progress: 0.50 },
      { id: "waystone_preclimax", progress: 0.78 },
    ],

    fork: { start: FORK_START, end: FORK_END },
    relicPlinths: 0.46,
    destination: 0.96,
  };
}

/**
 * Projects an authored plan from expedition space into corridor space.
 *
 * Done ONCE at load so every downstream system — hostile state machines,
 * the candidate registry, the renderer, proximity checks — works in a
 * single consistent space. Converting per-frame would reintroduce exactly
 * the kind of dual-space confusion that made the Ruinbound tuning bug
 * possible.
 */
export function planInCorridorSpace(
  plan: PickupExpeditionPlan
): PickupExpeditionPlan {
  return {
    ...plan,
    hostiles: plan.hostiles.map(h => ({
      ...h,
      progress: expeditionToCorridor(h.progress),
    })),
    environment: plan.environment.map(e => ({
      ...e,
      progress: expeditionToCorridor(e.progress),
    })),
    waystones: plan.waystones.map(w => ({
      ...w,
      progress: expeditionToCorridor(w.progress),
    })),
    fork: {
      start: expeditionToCorridor(plan.fork.start),
      end: expeditionToCorridor(plan.fork.end),
    },
    relicPlinths: expeditionToCorridor(plan.relicPlinths),
    destination: expeditionToCorridor(plan.destination),
  };
}

/** Spawns active on the branch the player physically took. */
export function activeHostiles(
  plan: PickupExpeditionPlan,
  route: "unchosen" | "safe" | "upper" | "scarred"
): readonly HostileSpawn[] {
  // §34: the Scarred Route bypasses mandatory combat pressure but still
  // requires physical traversal. It is a compromise, never a teleport.
  if (route === "scarred") return [];
  return plan.hostiles.filter(
    h => h.route === "both" || h.route === route
  );
}

export function activeEnvironment(
  plan: PickupExpeditionPlan,
  route: "unchosen" | "safe" | "upper" | "scarred"
): readonly EnvironmentSpawn[] {
  if (route === "scarred") {
    // Traversal architecture and the hazard remain — the world is still
    // physically crossed.
    return plan.environment.filter(e => e.route === "both");
  }
  return plan.environment.filter(
    e => e.route === "both" || e.route === route
  );
}

export function isInFork(plan: PickupExpeditionPlan, progress: number): boolean {
  return progress >= plan.fork.start && progress <= plan.fork.end;
}

/** The most recent waystone at or behind the player, for Redeploy. */
export function waystoneFor(
  plan: PickupExpeditionPlan,
  progress: number
): WaystoneSpawn | null {
  let best: WaystoneSpawn | null = null;
  for (const stone of plan.waystones) {
    if (stone.progress <= progress && (!best || stone.progress > best.progress)) {
      best = stone;
    }
  }
  return best;
}
