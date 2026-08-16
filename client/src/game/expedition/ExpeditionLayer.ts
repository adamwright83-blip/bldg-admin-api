/**
 * Expedition rendering and simulation layer.
 *
 * Owns the fictional half of the Pickup Expedition: Ruinbound guardians,
 * projectiles, the Linehook cable, the aim cone, the hazard, and the relic
 * plinths. It plugs into the existing Pixi runtime through a projection
 * function rather than duplicating camera, parallax, or corridor geometry —
 * §59's "reuse the substrate, don't build around it".
 *
 * ART NOTE (§22). This repository has no hostile sprite assets, so the
 * Ruinbound are drawn procedurally inside the existing Mediterranean
 * language: white limestone bodies, oxidised-brass fittings, and the Gold
 * Line's own fracture colour for their animated cracks. Each of the three
 * has a deliberately different silhouette so role is readable at a glance
 * on a 393px-wide screen:
 *
 *   HUNTER       tall, narrow, forward-raked wedge — reads as "coming at you"
 *   SLINGER      low, wide, asymmetric with a raised throwing arm
 *   SHIELDBEARER squat and massive behind a full-height slab shield
 *
 * They are not debug circles. They are also not painted art, and that
 * limitation is reported honestly rather than self-certified.
 */
import { Container, Graphics } from "pixi.js";
import { ExpeditionClock, AIM_TIME_SCALE } from "./expeditionClock";
import { LineCandidateRegistry } from "./lineCandidateRegistry";
import {
  AIM_CONE_TOTAL_RADIANS,
  AIM_MAX_RADIUS_CSS_PX,
  type LineTarget,
} from "./lineTargets";
import { Linehook, type PlayerBody } from "./linehook";
import {
  Hunter,
  Ruinbound,
  Shieldbearer,
  Slinger,
  stepProjectiles,
  RUINBOUND_TUNING,
  type Projectile,
} from "./ruinbound";
import {
  activeEnvironment,
  activeHostiles,
  type PickupExpeditionPlan,
} from "./expeditionPlan";
import { ExpeditionRun, EXPEDITION } from "./expeditionState";

/** Goldline's existing palette, reused rather than reinvented. */
const PALETTE = {
  limestone: 0xf2ece0,
  limestoneShade: 0xcfc4b2,
  brass: 0xb98a34,
  brassDark: 0x6d4f1c,
  lineGold: 0xffd166,
  lineFracture: 0xffb84d,
  hazardRope: 0x8a6b3d,
  danger: 0xe4572e,
  shadow: 0x2a2118,
} as const;

export type ScreenProjection = (
  progress: number,
  lateral: number
) => { x: number; y: number; scale: number };

export type ExpeditionCallbacks = {
  onPlayerDamaged?: (amount: number, hpRemaining: number) => void;
  onGuardAbsorbed?: () => void;
  onHostileDefeated?: (kind: string) => void;
  onLineLatched?: (target: LineTarget) => void;
  onHazardTriggered?: () => void;
  onDefeated?: () => void;
  onHitStop?: (ms: number) => void;
  onCameraShake?: (magnitude: number, dirX: number, dirY: number) => void;
};

type EnvNode = {
  id: string;
  kind: "architecture" | "hazard";
  progress: number;
  lateral: number;
  armed: boolean;
};

export class ExpeditionLayer {
  readonly container = new Container();
  readonly clock = new ExpeditionClock();
  readonly registry = new LineCandidateRegistry();
  readonly linehook = new Linehook();
  readonly run = new ExpeditionRun();

  private hostiles: Ruinbound[] = [];
  private env: EnvNode[] = [];
  private projectiles: Projectile[] = [];

  private gHostiles = new Graphics();
  private gProjectiles = new Graphics();
  private gCable = new Graphics();
  private gAim = new Graphics();
  private gEnv = new Graphics();

  private aiming = false;
  private aimRadians = 0;
  private lockedTargetId: string | null = null;
  /** Player body in SCREEN space; the corridor owns progress/lateral. */
  private body: PlayerBody = { x: 0, y: 0, vx: 0, vy: 0 };
  private reducedMotion = false;
  /**
   * Target the cable is currently travelling toward. Held from fire() until
   * the latch frame so resolution happens exactly once, then cleared.
   */
  private pendingLatchTargetId: string | null = null;
  /**
   * Screen-space movement the fiction wants to contribute THIS frame.
   * GoldlineGame consumes it and applies it to the real corridor position —
   * this layer never owns a second player position.
   */
  private pendingImpulseX = 0;
  private pendingImpulseY = 0;
  /**
   * Speed handed back to ordinary locomotion at the instant the tether lets
   * go. Captured on the release frame — not after residual decay — so the
   * player keeps the momentum they actually earned from the swing.
   */
  private handoffSpeed = 0;
  /** True during a dodge's i-frames — a well-timed evade is real mastery. */
  private playerInvulnerable = false;
  private plan: PickupExpeditionPlan | null = null;
  private route: "unchosen" | "safe" | "upper" | "scarred" = "unchosen";
  private hitFlash = new Map<string, number>();

  constructor(private readonly callbacks: ExpeditionCallbacks = {}) {
    // Environment sits behind guardians; cable and aim read above both.
    this.container.addChild(this.gEnv);
    this.container.addChild(this.gHostiles);
    this.container.addChild(this.gProjectiles);
    this.container.addChild(this.gCable);
    this.container.addChild(this.gAim);
  }

  /** Dodge i-frames, owned by the runtime that owns movement. */
  setPlayerInvulnerable(invulnerable: boolean) {
    this.playerInvulnerable = invulnerable;
  }

  setReducedMotion(reduced: boolean) {
    this.reducedMotion = reduced;
  }

  /** Builds the fictional world for one real order. */
  load(plan: PickupExpeditionPlan, route: typeof this.route = "unchosen") {
    this.plan = plan;
    this.route = route;
    this.hostiles = [];
    this.env = [];
    this.projectiles = [];
    this.registry.clear();

    for (const spawn of activeHostiles(plan, route)) {
      const at = { x: spawn.progress, y: spawn.lateral };
      const hostile =
        spawn.kind === "hunter"
          ? new Hunter(spawn.id, at)
          : spawn.kind === "slinger"
            ? new Slinger(spawn.id, at)
            : new Shieldbearer(spawn.id, at);
      this.hostiles.push(hostile);
    }

    for (const spawn of activeEnvironment(plan, route)) {
      this.env.push({
        id: spawn.id,
        kind: spawn.kind,
        progress: spawn.progress,
        lateral: spawn.lateral,
        armed: true,
      });
    }
  }

  setRoute(route: typeof this.route) {
    if (this.route === route) return;
    this.route = route;
    if (this.plan) {
      // Rebuild only the branch-specific content, preserving run state.
      const keepHp = this.run.hp;
      const keepMomentum = this.run.momentum;
      this.load(this.plan, route);
      this.run.hp = keepHp;
      this.run.momentum = keepMomentum;
    }
  }

  beginAim() {
    this.aiming = true;
    this.clock.setTimeScale(AIM_TIME_SCALE);
  }

  endAim() {
    this.aiming = false;
    this.lockedTargetId = null;
    this.clock.setTimeScale(1);
  }

  setAimRadians(radians: number) {
    this.aimRadians = radians;
  }

  isAiming() {
    return this.aiming;
  }

  getLockedTargetId() {
    return this.lockedTargetId;
  }

  /** Fires the Line at the currently locked target. */
  fireLine(project: ScreenProjection): boolean {
    const target = this.currentTarget(project);
    if (!target) return false;
    const at = project(
      this.progressOf(target.id) ?? 0,
      this.lateralOf(target.id) ?? 0
    );
    // Firing always ends the aim. Leaving dilation to a separate endAim()
    // call means any caller that misses it strands the whole fictional
    // simulation at 0.2x — so the aim is closed here, at the source.
    this.endAim();
    this.pendingLatchTargetId = target.id;
    this.linehook.fire(this.body, {
      id: target.id,
      x: at.x,
      y: at.y,
      pulls: target.kind === "environment" && target.environment === "architecture",
    });
    return true;
  }

  private progressOf(id: string): number | null {
    const h = this.hostiles.find(x => x.id === id);
    if (h) return h.x;
    return this.env.find(e => e.id === id)?.progress ?? null;
  }

  private lateralOf(id: string): number | null {
    const h = this.hostiles.find(x => x.id === id);
    if (h) return h.y;
    return this.env.find(e => e.id === id)?.lateral ?? null;
  }

  private currentTarget(project: ScreenProjection): LineTarget | null {
    const maxRadius = AIM_MAX_RADIUS_CSS_PX;
    return this.registry.select({
      originX: this.body.x,
      originY: this.body.y,
      aimRadians: this.aimRadians,
      maxRadius,
      coneRadians: AIM_CONE_TOTAL_RADIANS,
      lockedId: this.lockedTargetId,
    });
  }

  /**
   * One frame. `realDeltaSeconds` is real time; everything fictional is
   * integrated through the expedition clock so aim dilation and hit-stop
   * cannot leak into business timing.
   */
  update(
    realDeltaSeconds: number,
    playerProgress: number,
    playerLateral: number,
    project: ScreenProjection,
    viewportWidth: number
  ) {
    const dt = this.clock.advance(realDeltaSeconds);

    // SINGLE MOVEMENT TRUTH. The body's POSITION is always re-derived from
    // the real corridor position that GoldlineGame owns; only its VELOCITY
    // persists here. The tether reads that position, writes velocity, and
    // the velocity is handed back as an impulse below. There is deliberately
    // no second integrated player position anywhere in this layer.
    const playerAt = project(playerProgress, playerLateral);
    this.body.x = playerAt.x;
    this.body.y = playerAt.y;

    this.pendingImpulseX = 0;
    this.pendingImpulseY = 0;

    if (dt > 0) {
      this.run.step(dt);
      this.stepHostiles(dt, playerProgress, playerLateral);
      this.stepProjectilesAndDamage(dt, project);

      const wasPulling = this.linehook.phase === "latched";
      const result = this.linehook.update(dt, this.body);

      // Resolve on the EXACT frame the cable connects, exactly once.
      if (result.latched && this.pendingLatchTargetId) {
        const targetId = this.pendingLatchTargetId;
        this.pendingLatchTargetId = null;
        const target = this.registry
          .targets()
          .find(t => t.id === targetId);
        if (target) this.callbacks.onLineLatched?.(target);
        this.resolveLatch(targetId);
      }
      if (result.arrived) this.pendingLatchTargetId = null;

      const pullingNow = this.linehook.phase === "latched";

      // Only a taut tether contributes movement. Once it lets go the
      // momentum is handed to ordinary locomotion in one clean transfer,
      // rather than this layer continuing to nudge the player around.
      this.pendingImpulseX = pullingNow ? this.body.vx * dt : 0;
      this.pendingImpulseY = pullingNow ? this.body.vy * dt : 0;

      if (wasPulling && !pullingNow) {
        this.handoffSpeed = Math.hypot(this.body.vx, this.body.vy);
        this.body.vx = 0;
        this.body.vy = 0;
      }
    }

    this.syncRegistry(project, viewportWidth);
    if (this.aiming) {
      this.lockedTargetId = this.currentTarget(project)?.id ?? null;
    }

    this.draw(project, viewportWidth);
  }

  private stepHostiles(dt: number, playerProgress: number, playerLateral: number) {
    const player = { x: playerProgress, y: playerLateral };
    for (const hostile of this.hostiles) {
      if (!hostile.alive) continue;
      hostile.update(dt, player, this.projectiles);

      const hit = hostile.consumePendingHit();
      if (hit) {
        if (this.playerInvulnerable) {
          this.run.addMomentum(EXPEDITION.momentum.goodEvade);
          continue;
        }
        const taken = this.run.takeDamage(hit.damage);
        if (this.run.guardAbsorbedThisFrame) {
          this.callbacks.onGuardAbsorbed?.();
          this.callbacks.onHitStop?.(70);
        } else if (taken > 0) {
          this.callbacks.onPlayerDamaged?.(taken, this.run.hp);
          this.callbacks.onHitStop?.(90);
          this.callbacks.onCameraShake?.(1, hit.knockbackX, hit.knockbackY);
          if (this.run.outcome === "down") this.callbacks.onDefeated?.();
        }
      }
    }
  }

  private stepProjectilesAndDamage(dt: number, _project: ScreenProjection) {
    // Projectiles live in corridor space so they read against the world.
    const { hit } = stepProjectiles(
      this.projectiles,
      dt,
      { x: this.playerProgress, y: this.playerLateral },
      0.03
    );
    if (hit) {
      if (this.playerInvulnerable) {
        this.run.addMomentum(EXPEDITION.momentum.goodEvade);
        return;
      }
      const taken = this.run.takeDamage(hit.damage);
      if (this.run.guardAbsorbedThisFrame) {
        this.callbacks.onGuardAbsorbed?.();
      } else if (taken > 0) {
        this.callbacks.onPlayerDamaged?.(taken, this.run.hp);
        this.callbacks.onHitStop?.(60);
        if (this.run.outcome === "down") this.callbacks.onDefeated?.();
      }
    }
    this.projectiles = this.projectiles.filter(p => p.active);
  }

  private playerProgress = 0;
  private playerLateral = 0;

  /**
   * Rebuilds the candidate registry from THIS frame's fictional instances.
   * Note what is absent: no PopulationSystem entity, no order embodiment,
   * no business person. Candidates come only from `this.hostiles` and
   * `this.env`, both of which this layer constructed itself.
   */
  private syncRegistry(project: ScreenProjection, viewportWidth: number) {
    this.registry.clear();

    for (const hostile of this.hostiles) {
      const at = project(hostile.x, hostile.y);
      this.registry.registerHostile({
        id: hostile.id,
        hostile: hostile.kind,
        x: at.x,
        y: at.y,
        alive: hostile.alive,
        onScreen: at.x > -80 && at.x < viewportWidth + 80,
        guardFacing:
          hostile instanceof Shieldbearer ? hostile.facing : null,
      });
    }

    for (const node of this.env) {
      const at = project(node.progress, node.lateral);
      this.registry.registerEnvironment({
        id: node.id,
        environment: node.kind,
        x: at.x,
        y: at.y,
        armed: node.armed,
        onScreen: at.x > -80 && at.x < viewportWidth + 80,
      });
    }
  }

  /** Applies a Line latch to whatever it connected with. */
  resolveLatch(targetId: string) {
    const hostile = this.hostiles.find(h => h.id === targetId);
    if (hostile) {
      hostile.onLinehookLatch({ x: this.playerProgress, y: this.playerLateral });
      const result = hostile.applyHit(1, { x: this.playerProgress, y: this.playerLateral }, true);
      this.hitFlash.set(hostile.id, 0.18);
      this.run.addMomentum(EXPEDITION.momentum.lineLatch);
      this.callbacks.onHitStop?.(55);
      if (result.defeated) {
        this.run.addMomentum(EXPEDITION.momentum.hostileDefeated);
        this.callbacks.onHostileDefeated?.(hostile.kind);
      }
      return;
    }

    const node = this.env.find(e => e.id === targetId);
    if (node && node.kind === "hazard" && node.armed) {
      node.armed = false;
      this.callbacks.onHazardTriggered?.();
      this.callbacks.onHitStop?.(110);
      this.callbacks.onCameraShake?.(1.4, 0, 1);
      // The falling cargo crushes any guardian standing beneath it.
      for (const hostile of this.hostiles) {
        if (!hostile.alive) continue;
        if (Math.abs(hostile.x - node.progress) < 0.05) {
          const result = hostile.applyHit(99, { x: node.progress, y: node.lateral }, true);
          if (result.defeated) {
            this.run.addMomentum(EXPEDITION.momentum.hostileDefeated);
            this.callbacks.onHostileDefeated?.(hostile.kind);
          }
        }
      }
    }
  }

  /** Contextual basic lash (§18): stationary, valid hostile in range. */
  tryBasicLash(playerProgress: number, playerLateral: number, moving: boolean): boolean {
    if (moving) return false;
    let nearest: Ruinbound | null = null;
    let nearestDist = Infinity;
    for (const hostile of this.hostiles) {
      if (!hostile.alive) continue;
      const d = Math.hypot(hostile.x - playerProgress, (hostile.y - playerLateral) / 400);
      if (d < 0.06 && d < nearestDist) {
        nearest = hostile;
        nearestDist = d;
      }
    }
    if (!nearest) return false;

    const result = nearest.applyHit(1, { x: playerProgress, y: playerLateral }, false);
    this.hitFlash.set(nearest.id, 0.14);
    if (result.guarded) {
      this.callbacks.onHitStop?.(40);
      return true;
    }
    this.callbacks.onHitStop?.(50);
    if (result.defeated) {
      this.run.addMomentum(EXPEDITION.momentum.hostileDefeated);
      this.callbacks.onHostileDefeated?.(nearest.kind);
    }
    return true;
  }

  /**
   * Screen-space movement the fiction contributed this frame. GoldlineGame
   * converts it into corridor progress/lateral — it is never applied here.
   */
  consumeMovementImpulse(): { dx: number; dy: number } {
    const dx = this.pendingImpulseX;
    const dy = this.pendingImpulseY;
    this.pendingImpulseX = 0;
    this.pendingImpulseY = 0;
    return { dx, dy };
  }

  /** True only while a taut tether is actually driving the player. */
  isDrivingMovement(): boolean {
    return this.linehook.phase === "latched";
  }

  /**
   * Speed to hand to ordinary locomotion, taken exactly once on the frame
   * the tether released. Zero at any other time.
   */
  consumeHandoffSpeed(): number {
    const speed = this.handoffSpeed;
    this.handoffSpeed = 0;
    return speed;
  }

  setPlayerCorridor(progress: number, lateral: number) {
    this.playerProgress = progress;
    this.playerLateral = lateral;
  }

  // ---------------------------------------------------------------- render

  private draw(project: ScreenProjection, viewportWidth: number) {
    for (const [id, remaining] of Array.from(this.hitFlash.entries())) {
      const next = remaining - 1 / 60;
      if (next <= 0) this.hitFlash.delete(id);
      else this.hitFlash.set(id, next);
    }

    this.drawEnvironment(project);
    this.drawHostiles(project);
    this.drawProjectiles(project);
    this.drawCable();
    this.drawAim(project, viewportWidth);
  }

  private drawEnvironment(project: ScreenProjection) {
    const g = this.gEnv;
    g.clear();
    for (const node of this.env) {
      const at = project(node.progress, node.lateral);
      const s = at.scale;

      if (node.kind === "architecture") {
        // A brass ring set into a limestone corbel — an unmistakable,
        // pre-existing latch point rather than an invisible affordance.
        g.circle(at.x, at.y, 13 * s).stroke({ width: 3.5 * s, color: PALETTE.brass });
        g.circle(at.x, at.y, 6 * s).fill({ color: PALETTE.lineGold, alpha: 0.55 });
        g.rect(at.x - 15 * s, at.y - 26 * s, 30 * s, 14 * s)
          .fill({ color: PALETTE.limestone })
          .stroke({ width: 1.5 * s, color: PALETTE.limestoneShade });
      } else {
        // §30: the hazard is visible in the world BEFORE anything
        // references it — weathered cargo on a fraying brass cable.
        const swing = node.armed
          ? Math.sin(this.clock.fictionalElapsedSeconds() * 1.1) * 5 * s
          : 0;
        const cx = at.x + swing;
        g.moveTo(at.x, at.y - 120 * s)
          .lineTo(cx, at.y - 34 * s)
          .stroke({ width: 2.5 * s, color: PALETTE.hazardRope });
        g.rect(cx - 26 * s, at.y - 34 * s, 52 * s, 40 * s)
          .fill({ color: node.armed ? PALETTE.limestone : PALETTE.limestoneShade })
          .stroke({ width: 2 * s, color: PALETTE.brassDark });
        // Brass banding so it reads as heavy cargo, not a floating box.
        g.rect(cx - 26 * s, at.y - 20 * s, 52 * s, 4 * s).fill({ color: PALETTE.brass });
        if (node.armed) {
          g.circle(cx, at.y - 36 * s, 5 * s).fill({ color: PALETTE.lineFracture, alpha: 0.9 });
        }
      }
    }
  }

  private drawHostiles(project: ScreenProjection) {
    const g = this.gHostiles;
    g.clear();

    for (const hostile of this.hostiles) {
      if (!hostile.alive) continue;
      const at = project(hostile.x, hostile.y);
      const s = at.scale;
      const flash = this.hitFlash.get(hostile.id) ?? 0;
      const recoil = hostile.recoilSeconds > 0 ? hostile.recoilX * 6 * s : 0;
      const x = at.x + recoil;
      const y = at.y;
      const bodyColor = flash > 0 ? 0xffffff : PALETTE.limestone;

      // Grounding: every guardian gets a contact shadow so it stands IN
      // the world rather than floating on top of the painted plate.
      g.ellipse(at.x, y + 2 * s, 26 * s, 7 * s).fill({
        color: PALETTE.shadow,
        alpha: 0.28,
      });

      const telegraph = hostile.telegraphProgress();
      if (telegraph > 0) {
        // Wind-up ring: grows and reddens so the tell is unmissable.
        g.circle(x, y - 30 * s, (16 + telegraph * 26) * s).stroke({
          width: 3 * s,
          color: PALETTE.danger,
          alpha: 0.35 + telegraph * 0.5,
        });
      }

      if (hostile.kind === "hunter") this.drawHunter(g, x, y, s, bodyColor, hostile);
      else if (hostile.kind === "slinger") this.drawSlinger(g, x, y, s, bodyColor, hostile);
      else this.drawShieldbearer(g, x, y, s, bodyColor, hostile as Shieldbearer);
    }
  }

  /** Tall, narrow, forward-raked — reads as pursuit at a glance. */
  private drawHunter(
    g: Graphics,
    x: number,
    y: number,
    s: number,
    color: number,
    hostile: Ruinbound
  ) {
    const lean = Math.cos(hostile.facing) >= 0 ? 1 : -1;
    g.moveTo(x - 11 * s, y)
      .lineTo(x - 6 * s, y - 46 * s)
      .lineTo(x + lean * 9 * s, y - 62 * s)
      .lineTo(x + lean * 14 * s, y - 40 * s)
      .lineTo(x + 10 * s, y)
      .closePath()
      .fill({ color })
      .stroke({ width: 2 * s, color: PALETTE.limestoneShade });
    // Bronze mask.
    g.moveTo(x + lean * 2 * s, y - 62 * s)
      .lineTo(x + lean * 15 * s, y - 55 * s)
      .lineTo(x + lean * 6 * s, y - 46 * s)
      .closePath()
      .fill({ color: PALETTE.brass });
    // Line fracture down the torso.
    g.moveTo(x - 3 * s, y - 44 * s)
      .lineTo(x + 2 * s, y - 22 * s)
      .lineTo(x - 2 * s, y - 8 * s)
      .stroke({ width: 2 * s, color: PALETTE.lineFracture, alpha: 0.85 });
  }

  /** Low and wide with a raised throwing arm — unmistakably ranged. */
  private drawSlinger(
    g: Graphics,
    x: number,
    y: number,
    s: number,
    color: number,
    hostile: Ruinbound
  ) {
    const face = Math.cos(hostile.facing) >= 0 ? 1 : -1;
    g.moveTo(x - 20 * s, y)
      .lineTo(x - 15 * s, y - 30 * s)
      .lineTo(x + 15 * s, y - 34 * s)
      .lineTo(x + 20 * s, y)
      .closePath()
      .fill({ color })
      .stroke({ width: 2 * s, color: PALETTE.limestoneShade });
    // Hunched head, low between the shoulders.
    g.circle(x + face * 6 * s, y - 40 * s, 9 * s).fill({ color: PALETTE.brass });
    // Raised sling arm — the readable ranged silhouette.
    const wind = hostile.telegraphProgress();
    g.moveTo(x + face * 12 * s, y - 30 * s)
      .lineTo(x + face * (26 + wind * 8) * s, y - (46 + wind * 14) * s)
      .stroke({ width: 5 * s, color: PALETTE.limestoneShade });
    if (wind > 0) {
      g.circle(
        x + face * (26 + wind * 8) * s,
        y - (46 + wind * 14) * s,
        (4 + wind * 5) * s
      ).fill({ color: PALETTE.lineFracture, alpha: 0.6 + wind * 0.4 });
    }
  }

  /** Squat and massive behind a full-height slab — the guard IS the read. */
  private drawShieldbearer(
    g: Graphics,
    x: number,
    y: number,
    s: number,
    color: number,
    hostile: Shieldbearer
  ) {
    const face = Math.cos(hostile.facing) >= 0 ? 1 : -1;
    g.moveTo(x - 22 * s, y)
      .lineTo(x - 18 * s, y - 52 * s)
      .lineTo(x + 18 * s, y - 52 * s)
      .lineTo(x + 22 * s, y)
      .closePath()
      .fill({ color })
      .stroke({ width: 2.5 * s, color: PALETTE.limestoneShade });
    g.circle(x, y - 60 * s, 11 * s).fill({ color: PALETTE.brass });

    if (hostile.exposed) {
      // Guard hauled aside: the shield swings wide and the body is open.
      g.rect(x + face * 34 * s, y - 60 * s, 10 * s, 56 * s)
        .fill({ color: PALETTE.brassDark })
        .stroke({ width: 2 * s, color: PALETTE.brass });
      g.circle(x, y - 30 * s, 22 * s).stroke({
        width: 3 * s,
        color: PALETTE.lineFracture,
        alpha: 0.9,
      });
    } else {
      // Full-height slab across the front — visibly not worth lashing.
      g.rect(x + face * 16 * s, y - 66 * s, 13 * s, 68 * s)
        .fill({ color: PALETTE.brass })
        .stroke({ width: 2.5 * s, color: PALETTE.brassDark });
      g.rect(x + face * 18 * s, y - 44 * s, 9 * s, 5 * s).fill({
        color: PALETTE.lineGold,
        alpha: 0.7,
      });
    }
  }

  private drawProjectiles(project: ScreenProjection) {
    const g = this.gProjectiles;
    g.clear();
    for (const p of this.projectiles) {
      if (!p.active) continue;
      const at = project(p.x, p.y);
      const s = at.scale;
      // Bright core plus a dark rim so it never vanishes into the sunlit
      // limestone background — §53 rejects projectiles lost in the plate.
      g.circle(at.x, at.y - 30 * s, 9 * s).fill({ color: PALETTE.danger, alpha: 0.28 });
      g.circle(at.x, at.y - 30 * s, 5.5 * s)
        .fill({ color: PALETTE.lineFracture })
        .stroke({ width: 1.5 * s, color: PALETTE.brassDark });
    }
  }

  private drawCable() {
    const g = this.gCable;
    g.clear();
    if (!this.linehook.isEngaged()) return;

    const from = { x: this.body.x, y: this.body.y - 40 };
    const to = { x: this.linehook.tipX, y: this.linehook.tipY };
    // Slack sags when loose and flattens under tension — the cable reads
    // as a weighted physical object rather than a straight debug line.
    const sag = (1 - this.linehook.tension) * 26 + 6;
    const midX = (from.x + to.x) / 2;
    const midY = (from.y + to.y) / 2 + sag;

    g.moveTo(from.x, from.y)
      .quadraticCurveTo(midX, midY, to.x, to.y)
      .stroke({ width: 5, color: PALETTE.brassDark, alpha: 0.9 });
    g.moveTo(from.x, from.y)
      .quadraticCurveTo(midX, midY, to.x, to.y)
      .stroke({ width: 2.5, color: PALETTE.lineGold, alpha: 0.75 + this.linehook.tension * 0.25 });
    g.circle(to.x, to.y, 7).fill({ color: PALETTE.lineGold, alpha: 0.85 });
  }

  private drawAim(project: ScreenProjection, _viewportWidth: number) {
    const g = this.gAim;
    g.clear();
    if (!this.aiming) return;

    const half = AIM_CONE_TOTAL_RADIANS / 2;
    const r = AIM_MAX_RADIUS_CSS_PX;
    const ox = this.body.x;
    const oy = this.body.y - 40;

    // The cone is a soft wedge, not an opaque overlay — it must never
    // cover Trailblazer (§53).
    g.moveTo(ox, oy)
      .arc(ox, oy, r, this.aimRadians - half, this.aimRadians + half)
      .closePath()
      .fill({ color: PALETTE.lineGold, alpha: this.reducedMotion ? 0.1 : 0.14 });
    g.moveTo(ox, oy)
      .arc(ox, oy, r, this.aimRadians - half, this.aimRadians + half)
      .closePath()
      .stroke({ width: 1.5, color: PALETTE.lineGold, alpha: 0.5 });

    if (!this.lockedTargetId) return;
    const p = this.progressOf(this.lockedTargetId);
    const l = this.lateralOf(this.lockedTargetId);
    if (p == null || l == null) return;
    const at = project(p, l);

    // Lock reticle: heavy, high-contrast, unmistakable against the plate.
    g.circle(at.x, at.y - 30 * at.scale, 30 * at.scale).stroke({
      width: 4,
      color: PALETTE.lineGold,
    });
    g.circle(at.x, at.y - 30 * at.scale, 38 * at.scale).stroke({
      width: 1.5,
      color: PALETTE.lineGold,
      alpha: 0.6,
    });
  }

  destroy() {
    this.registry.clear();
    this.hostiles = [];
    this.env = [];
    this.projectiles = [];
    this.container.destroy({ children: true });
  }
}
