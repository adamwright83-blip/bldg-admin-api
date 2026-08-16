/**
 * Ruinbound — the three fictional hostiles (§21).
 *
 * These are pure, deterministic state machines. They integrate FICTIONAL
 * seconds only (see expeditionClock.ts), contain no Math.random(), touch no
 * business state, and know nothing about orders, customers or revenue.
 * Rendering lives in the Pixi layer; everything decision-shaped lives here
 * so it can be tested without a canvas.
 *
 * Each behaviour exists to teach one thing:
 *
 *   HUNTER       — movement pressure. Closes, telegraphs, strikes.
 *   SLINGER      — spatial pressure. Winds up, throws a readable projectile.
 *   SHIELDBEARER — proves the Linehook changes combat. Frontal guard makes
 *                  the basic lash nearly useless; the Line exposes it.
 *
 * Telegraph phases are exposed with a 0..1 progress so the renderer can
 * draw an unmistakable wind-up rather than a surprise hit. §24's "teach
 * through play" depends entirely on that being legible.
 */

export type HostileKind = "hunter" | "slinger" | "shieldbearer";

export type HunterPhase = "idle" | "pursue" | "telegraph" | "strike" | "recover";
export type SlingerPhase = "idle" | "windup" | "release" | "cooldown";
export type ShieldbearerPhase =
  | "advance"
  | "telegraph"
  | "slam"
  | "exposed"
  | "recover";

/**
 * Lateral is authored in plan units (about +/-140 across the lane) while
 * progress runs 0..1 along the entire corridor. Comparing them raw makes a
 * step sideways read as a vast distance, so lateral is scaled into progress
 * space before any radius or heading test.
 */
export const LATERAL_TO_PROGRESS = 1 / 700;

/**
 * Tuning in CORRIDOR PROGRESS units — not pixels.
 *
 * These were originally written as pixel distances (aggroRadius: 300) but
 * compared against progress, which only ever spans 0..1. Every guardian
 * therefore aggroed from anywhere on the map and landed a hit within a
 * second of entry, destroying the authored safe opening. Radii and speeds
 * now live in the same space the corridor actually uses, which is what
 * makes spatially-bounded activation possible at all.
 */
export const RUINBOUND_TUNING = {
  hunter: {
    maxHp: 3,
    /** Progress per second — a shade faster than a walking player. */
    speed: 0.085,
    /** Short activation window: it cannot reach back into the opening. */
    aggroRadius: 0.085,
    strikeRadius: 0.032,
    /** Long enough to read and react to on a phone. */
    telegraphSeconds: 0.55,
    strikeSeconds: 0.16,
    recoverSeconds: 0.7,
    damage: 12,
    knockback: 0.05,
  },
  slinger: {
    maxHp: 2,
    /** Holds a lane; repositions only to keep range. */
    speed: 0.035,
    aggroRadius: 0.15,
    preferredRange: 0.095,
    windupSeconds: 0.8,
    releaseSeconds: 0.12,
    cooldownSeconds: 1.5,
    projectileSpeed: 0.34,
    damage: 9,
    knockback: 0.03,
  },
  shieldbearer: {
    maxHp: 6,
    speed: 0.048,
    aggroRadius: 0.13,
    slamRadius: 0.042,
    telegraphSeconds: 0.75,
    slamSeconds: 0.2,
    recoverSeconds: 0.9,
    /** The vulnerability window the Line opens. */
    exposedSeconds: 2.2,
    damage: 18,
    knockback: 0.075,
    /** Guard arc half-width: a frontal lash inside this is nearly futile. */
    guardHalfArcRadians: (75 * Math.PI) / 180,
    /** Fraction of lash damage that survives the guard. */
    guardedDamageFactor: 0,
  },
} as const;

export type Vec2 = { x: number; y: number };

export type HostileHitResult = {
  /** Damage actually applied after guard rules. */
  readonly applied: number;
  /** True when the guard absorbed the blow — drives the "clang" feedback. */
  readonly guarded: boolean;
  readonly defeated: boolean;
};

export type Projectile = {
  readonly id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  readonly damage: number;
  /** Fictional seconds remaining before it despawns. */
  ttl: number;
  active: boolean;
};

let projectileSeq = 0;
/** Deterministic id source — a counter, never Math.random(). */
function nextProjectileId(): string {
  projectileSeq += 1;
  return `proj_${projectileSeq}`;
}

/** Test seam so a fresh scenario always produces identical projectile ids. */
export function resetProjectileIds() {
  projectileSeq = 0;
}

export abstract class Ruinbound {
  hp: number;
  x: number;
  y: number;
  /** Facing in radians; drives silhouette flip and guard arc. */
  facing = Math.PI;
  /** Fictional seconds spent in the current phase. */
  protected phaseElapsed = 0;
  /** Non-zero briefly after taking a hit — drives recoil rendering. */
  recoilSeconds = 0;
  recoilX = 0;
  /** Impulse the world should apply to Trailblazer this frame, if any. */
  pendingHit: { damage: number; knockbackX: number; knockbackY: number } | null =
    null;

  constructor(
    readonly id: string,
    readonly kind: HostileKind,
    position: Vec2,
    maxHp: number
  ) {
    this.x = position.x;
    this.y = position.y;
    this.hp = maxHp;
  }

  get alive(): boolean {
    return this.hp > 0;
  }

  /** 0..1 through the current telegraph, for the renderer's wind-up cue. */
  abstract telegraphProgress(): number;
  abstract isTelegraphing(): boolean;
  abstract update(dt: number, player: Vec2, out: Projectile[]): void;

  /**
   * Applies a hit. `fromLine` distinguishes the Linehook from the basic
   * lash — the Shieldbearer's guard only resists the latter.
   */
  applyHit(damage: number, from: Vec2, fromLine: boolean): HostileHitResult {
    if (!this.alive) return { applied: 0, guarded: false, defeated: false };

    const guarded = this.isGuardingAgainst(from, fromLine);
    const applied = guarded
      ? damage * RUINBOUND_TUNING.shieldbearer.guardedDamageFactor
      : damage;

    this.hp = Math.max(0, this.hp - applied);
    if (applied > 0) {
      this.recoilSeconds = 0.18;
      this.recoilX = Math.sign(this.x - from.x) || 1;
    }
    this.onHit(applied, from, fromLine, guarded);
    return { applied, guarded, defeated: !this.alive };
  }

  protected isGuardingAgainst(_from: Vec2, _fromLine: boolean): boolean {
    return false;
  }

  protected onHit(
    _applied: number,
    _from: Vec2,
    _fromLine: boolean,
    _guarded: boolean
  ) {}

  /** The Line's control effect. Only the Shieldbearer meaningfully reacts. */
  onLinehookLatch(_from: Vec2) {}

  protected tickCommon(dt: number) {
    this.phaseElapsed += dt;
    if (this.recoilSeconds > 0) this.recoilSeconds = Math.max(0, this.recoilSeconds - dt);
  }

  protected faceToward(player: Vec2) {
    this.facing = Math.atan2(
      (player.y - this.y) * LATERAL_TO_PROGRESS,
      player.x - this.x
    );
  }

  protected distanceTo(p: Vec2): number {
    return Math.hypot(p.x - this.x, (p.y - this.y) * LATERAL_TO_PROGRESS);
  }

  /** Steps toward (or away from) the player in correctly-scaled space. */
  protected stepToward(player: Vec2, speed: number, dt: number, sign = 1) {
    const dx = player.x - this.x;
    const dy = (player.y - this.y) * LATERAL_TO_PROGRESS;
    const len = Math.hypot(dx, dy) || 1;
    this.x += (dx / len) * speed * dt * sign;
    this.y += ((dy / len) * speed * dt * sign) / LATERAL_TO_PROGRESS;
  }

  protected strikePlayer(damage: number, player: Vec2, knockback: number) {
    const dx = player.x - this.x;
    const dy = (player.y - this.y) * LATERAL_TO_PROGRESS;
    const len = Math.hypot(dx, dy) || 1;
    this.pendingHit = {
      damage,
      knockbackX: (dx / len) * knockback,
      knockbackY: (dy / len) * knockback,
    };
  }

  consumePendingHit() {
    const hit = this.pendingHit;
    this.pendingHit = null;
    return hit;
  }
}

export class Hunter extends Ruinbound {
  phase: HunterPhase = "idle";
  private readonly t = RUINBOUND_TUNING.hunter;

  constructor(id: string, position: Vec2) {
    super(id, "hunter", position, RUINBOUND_TUNING.hunter.maxHp);
  }

  isTelegraphing() {
    return this.phase === "telegraph";
  }

  telegraphProgress() {
    return this.phase === "telegraph"
      ? Math.min(1, this.phaseElapsed / this.t.telegraphSeconds)
      : 0;
  }

  private to(phase: HunterPhase) {
    this.phase = phase;
    this.phaseElapsed = 0;
  }

  update(dt: number, player: Vec2) {
    if (!this.alive) return;
    this.tickCommon(dt);
    const dist = this.distanceTo(player);

    switch (this.phase) {
      case "idle":
        if (dist <= this.t.aggroRadius) this.to("pursue");
        break;

      case "pursue": {
        this.faceToward(player);
        if (dist <= this.t.strikeRadius) {
          this.to("telegraph");
          break;
        }
        // Closes the gap. Movement pressure is the Hunter's whole job.
        this.stepToward(player, this.t.speed, dt);
        break;
      }

      case "telegraph":
        // Committed: it does NOT track the player through the wind-up, so
        // moving out of the way is a real, learnable counter-play.
        if (this.phaseElapsed >= this.t.telegraphSeconds) this.to("strike");
        break;

      case "strike":
        if (this.phaseElapsed === dt || this.pendingHit === null) {
          if (this.distanceTo(player) <= this.t.strikeRadius * 1.35) {
            this.strikePlayer(this.t.damage, player, this.t.knockback);
          }
        }
        if (this.phaseElapsed >= this.t.strikeSeconds) this.to("recover");
        break;

      case "recover":
        if (this.phaseElapsed >= this.t.recoverSeconds) this.to("pursue");
        break;
    }
  }
}

export class Slinger extends Ruinbound {
  phase: SlingerPhase = "idle";
  private readonly t = RUINBOUND_TUNING.slinger;

  constructor(id: string, position: Vec2) {
    super(id, "slinger", position, RUINBOUND_TUNING.slinger.maxHp);
  }

  isTelegraphing() {
    return this.phase === "windup";
  }

  telegraphProgress() {
    return this.phase === "windup"
      ? Math.min(1, this.phaseElapsed / this.t.windupSeconds)
      : 0;
  }

  private to(phase: SlingerPhase) {
    this.phase = phase;
    this.phaseElapsed = 0;
  }

  update(dt: number, player: Vec2, out: Projectile[]) {
    if (!this.alive) return;
    this.tickCommon(dt);
    const dist = this.distanceTo(player);
    this.faceToward(player);

    // Holds its preferred range in every phase except the commit frames,
    // so it keeps applying spatial pressure instead of being walked over.
    if (this.phase === "idle" || this.phase === "cooldown") {
      const drift = dist < this.t.preferredRange * 0.75 ? -1 : dist > this.t.preferredRange * 1.25 ? 1 : 0;
      if (drift !== 0) this.stepToward(player, this.t.speed, dt, drift);
    }

    switch (this.phase) {
      case "idle":
        if (dist <= this.t.aggroRadius) this.to("windup");
        break;

      case "windup":
        if (this.phaseElapsed >= this.t.windupSeconds) this.to("release");
        break;

      case "release": {
        if (out.every(p => p.id !== this.lastProjectileId)) {
          const dx = player.x - this.x;
          const dy = (player.y - this.y) * LATERAL_TO_PROGRESS;
          const len = Math.hypot(dx, dy) || 1;
          const id = nextProjectileId();
          this.lastProjectileId = id;
          out.push({
            id,
            x: this.x,
            y: this.y,
            vx: (dx / len) * this.t.projectileSpeed,
            vy: (dy / len) * this.t.projectileSpeed,
            damage: this.t.damage,
            ttl: 4,
            active: true,
          });
        }
        if (this.phaseElapsed >= this.t.releaseSeconds) this.to("cooldown");
        break;
      }

      case "cooldown":
        if (this.phaseElapsed >= this.t.cooldownSeconds) {
          this.to(dist <= this.t.aggroRadius ? "windup" : "idle");
        }
        break;
    }
  }

  private lastProjectileId: string | null = null;
}

export class Shieldbearer extends Ruinbound {
  phase: ShieldbearerPhase = "advance";
  private readonly t = RUINBOUND_TUNING.shieldbearer;

  constructor(id: string, position: Vec2) {
    super(id, "shieldbearer", position, RUINBOUND_TUNING.shieldbearer.maxHp);
  }

  isTelegraphing() {
    return this.phase === "telegraph";
  }

  telegraphProgress() {
    return this.phase === "telegraph"
      ? Math.min(1, this.phaseElapsed / this.t.telegraphSeconds)
      : 0;
  }

  get exposed(): boolean {
    return this.phase === "exposed";
  }

  /** Remaining vulnerability window, for the renderer's urgency cue. */
  exposedRemaining(): number {
    return this.phase === "exposed"
      ? Math.max(0, this.t.exposedSeconds - this.phaseElapsed)
      : 0;
  }

  private to(phase: ShieldbearerPhase) {
    this.phase = phase;
    this.phaseElapsed = 0;
  }

  /**
   * The guard only resists the BASIC LASH, and only within its frontal
   * arc, and only while not already exposed. The Linehook always bypasses
   * it — that asymmetry is the entire reason this enemy exists (§21).
   */
  protected isGuardingAgainst(from: Vec2, fromLine: boolean): boolean {
    if (fromLine) return false;
    if (this.phase === "exposed") return false;
    const incoming = Math.atan2(from.y - this.y, from.x - this.x);
    let delta = (incoming - this.facing) % (Math.PI * 2);
    if (delta > Math.PI) delta -= Math.PI * 2;
    if (delta < -Math.PI) delta += Math.PI * 2;
    return Math.abs(delta) <= this.t.guardHalfArcRadians;
  }

  /** The Line latches the shield and hauls it aside. */
  onLinehookLatch(_from: Vec2) {
    if (!this.alive) return;
    if (this.phase === "exposed") {
      // Re-latching refreshes rather than extends indefinitely.
      this.phaseElapsed = 0;
      return;
    }
    this.to("exposed");
  }

  update(dt: number, player: Vec2) {
    if (!this.alive) return;
    this.tickCommon(dt);
    const dist = this.distanceTo(player);

    switch (this.phase) {
      case "advance": {
        this.faceToward(player);
        if (dist <= this.t.slamRadius) {
          this.to("telegraph");
          break;
        }
        if (dist <= this.t.aggroRadius) this.stepToward(player, this.t.speed, dt);
        break;
      }

      case "telegraph":
        if (this.phaseElapsed >= this.t.telegraphSeconds) this.to("slam");
        break;

      case "slam":
        if (this.pendingHit === null && this.phaseElapsed < dt * 2) {
          if (this.distanceTo(player) <= this.t.slamRadius * 1.3) {
            this.strikePlayer(this.t.damage, player, this.t.knockback);
          }
        }
        if (this.phaseElapsed >= this.t.slamSeconds) this.to("recover");
        break;

      case "exposed":
        // Guard hauled aside: it cannot act, and every hit lands clean.
        if (this.phaseElapsed >= this.t.exposedSeconds) this.to("recover");
        break;

      case "recover":
        if (this.phaseElapsed >= this.t.recoverSeconds) this.to("advance");
        break;
    }
  }
}

/** Advances projectiles and resolves the one that hits Trailblazer. */
export function stepProjectiles(
  projectiles: Projectile[],
  dt: number,
  player: Vec2,
  playerRadius: number
): { hit: Projectile | null } {
  let hit: Projectile | null = null;
  for (const p of projectiles) {
    if (!p.active) continue;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.ttl -= dt;
    if (p.ttl <= 0) {
      p.active = false;
      continue;
    }
    if (
      !hit &&
      Math.hypot(player.x - p.x, (player.y - p.y) * LATERAL_TO_PROGRESS) <=
        playerRadius
    ) {
      p.active = false;
      hit = p;
    }
  }
  return { hit };
}
