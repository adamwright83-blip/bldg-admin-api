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
import { Assets, Container, Graphics, Sprite, Texture } from "pixi.js";
import hunterUrl from "../../assets/goldline/heartbeat/ruinbound_hunter.png";
import slingerUrl from "../../assets/goldline/heartbeat/ruinbound_slinger.png";
import shieldbearerUrl from "../../assets/goldline/heartbeat/ruinbound_shieldbearer.png";
import grappleRingUrl from "../../assets/goldline/heartbeat/linehook_grapple_ring.png";
import cargoHazardUrl from "../../assets/goldline/heartbeat/suspended_cargo_hazard.png";
import pickupCacheUrl from "../../assets/goldline/heartbeat/pickup_cache_objective.png";

/**
 * Feet sit at ~0.98 of texture height for the guardians (measured from the
 * shipped alpha), so anchoring there plants them on the stone instead of
 * floating above it.
 */
const GUARDIAN_FEET_ANCHOR = 0.98;
const HOSTILE_TEXTURE_URLS: Record<string, string> = {
  hunter: hunterUrl,
  slinger: slingerUrl,
  shieldbearer: shieldbearerUrl,
};
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
  EXPEDITION_START_PROGRESS,
  activeEnvironment,
  activeHostiles,
  planInCorridorSpace,
  waystoneFor,
  type EnvironmentSpawn,
  type HostileSpawn,
  type PickupExpeditionPlan,
} from "./expeditionPlan";
import { ExpeditionRun, EXPEDITION, type ExpeditionSnapshot } from "./expeditionState";
import { TRAVERSAL_Z, worldActorZ } from "../world/worldActorDepth";

/** Goldline's existing palette, reused rather than reinvented. */
const PALETTE = {
  /**
   * Ruinbound read DARK against Goldline's sunlit plate. The first pass
   * drew them in near-white limestone, which annihilated their silhouettes
   * against bright turquoise and pale stone — they looked like blank paper
   * cut-outs. Weathered basalt with a limestone rim-light keeps the world's
   * material language while giving the guardians a shape you can actually
   * read at 393px.
   */
  stone: 0x453a30,
  stoneDeep: 0x281f19,
  stoneRim: 0xd8cdb8,
  brass: 0xc9942e,
  brassDark: 0x5a4212,
  lineGold: 0xffd166,
  lineFracture: 0xffd98a,
  limestone: 0xe8dcc6,
  limestoneShade: 0xb3a486,
  hazardRope: 0x6b5330,
  danger: 0xf4633a,
  shadow: 0x1a140f,
} as const;

export type ScreenProjection = (
  progress: number,
  lateral: number
) => { x: number; y: number; scale: number };

/**
 * One guardian's world presence. Its root is a DIRECT sibling of civilians
 * and Trailblazer under the shared sortable parent, which is the only way a
 * single guardian can render behind one civilian and in front of another.
 * Body lean and recoil go on the child sprite so they never disturb the
 * root's world position, which is what the depth sort reads.
 */
type HostileVisual = {
  root: Container;
  shadow: Graphics;
  body: Sprite;
};

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
  private gSeal = new Graphics();
  /**
   * World-actor host, supplied by GoldlineGame. Guardian and prop roots are
   * added here, NOT to this layer's own container — the container is now
   * gameplay overlays only.
   */
  private actorHost: Container | null = null;
  private hostileVisuals = new Map<string, HostileVisual>();
  private propVisuals = new Map<string, HostileVisual>();
  private textures = new Map<string, Texture>();

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
  /** Authored, expedition-space. Never fed back into load(). */
  private rawPlan: PickupExpeditionPlan | null = null;
  /** Corridor-space projection of rawPlan. The only plan the runtime reads. */
  private plan: PickupExpeditionPlan | null = null;
  private hitFlash = new Map<string, number>();
  /** Depth scale at Trailblazer's current position — keeps lineOrigin's
   *  vertical offset consistent across corridor perspective. */
  private bodyScale = 1;
  /**
   * Screen position from the previous frame, used ONLY to derive the
   * player's incoming velocity before a fresh latch — cleared on any
   * discontinuity (load/redeploy/pressOn/terminal settle/destroy) so a
   * teleport can never masquerade as real momentum.
   */
  private previousPlayerScreen: { x: number; y: number } | null = null;

  setActorHost(host: Container) {
    this.actorHost = host;
  }

  private hostFor(): Container {
    return this.actorHost ?? this.container;
  }

  constructor(private readonly callbacks: ExpeditionCallbacks = {}) {
    // Environment sits behind guardians; cable and aim read above both.
    // This container is GAMEPLAY OVERLAYS ONLY: telegraphs, projectiles,
    // cable, aim cone, target highlight. Bodies live in the world actor
    // host so they can sort against civilians. Combat readability must
    // survive a civilian standing in front of a guardian, which is exactly
    // why the telegraph rings stay up here.
    this.container.zIndex = TRAVERSAL_Z.GAMEPLAY_OVERLAY;
    this.container.addChild(this.gEnv);
    this.container.addChild(this.gSeal);
    this.container.addChild(this.gHostiles);
    this.container.addChild(this.gProjectiles);
    this.container.addChild(this.gCable);
    this.container.addChild(this.gAim);
  }

  /** Dodge i-frames, owned by the runtime that owns movement. */
  setPlayerInvulnerable(invulnerable: boolean) {
    this.playerInvulnerable = invulnerable;
  }

  /**
   * Loads the prototype art. Failure is non-fatal: the procedural fallback
   * still draws, so a missing texture degrades the look rather than
   * breaking the expedition.
   */
  async loadArt(): Promise<void> {
    const entries: Array<[string, string]> = [
      ["hunter", hunterUrl],
      ["slinger", slingerUrl],
      ["shieldbearer", shieldbearerUrl],
      ["grapple_ring", grappleRingUrl],
      ["cargo_hazard", cargoHazardUrl],
      ["pickup_cache", pickupCacheUrl],
    ];
    await Promise.all(
      entries.map(async ([key, url]) => {
        try {
          this.textures.set(key, await Assets.load(url));
        } catch {
          /* procedural fallback remains */
        }
      })
    );
  }

  hasArt(): boolean {
    return this.textures.size > 0;
  }

  setReducedMotion(reduced: boolean) {
    this.reducedMotion = reduced;
  }

  /**
   * Builds the fictional world for one real order.
   *
   * The incoming plan authors its beats in normalised expedition space; it
   * is projected into corridor space exactly once, here, so every system
   * downstream works in the single space the runtime actually moves in.
   */
  load(rawPlan: PickupExpeditionPlan) {
    // Keep BOTH forms. `load` used to be re-entered from setRoute with an
    // already-mapped plan, so planInCorridorSpace ran a second time and
    // dragged every guardian and prop back toward the start of the corridor
    // the first time the player chose Safe or Upper. Holding the raw plan
    // separately makes that impossible to repeat.
    this.rawPlan = rawPlan;
    this.plan = planInCorridorSpace(rawPlan);
    this.previousPlayerScreen = null;
    this.rebuildRouteContent();

    // Waystones must come from the MAPPED plan; a raw expedition-space
    // waystone would redeploy the player to the wrong corridor position.
    const threshold = waystoneFor(this.plan, EXPEDITION_START_PROGRESS);
    if (threshold) this.run.setWaystone(threshold);
  }

  /** Adds one hostile instance if it is not already present (idempotent). */
  private spawnHostile(spawn: HostileSpawn) {
    if (this.hostiles.some(h => h.id === spawn.id)) return;
    const at = { x: spawn.progress, y: spawn.lateral };
    const hostile =
      spawn.kind === "hunter"
        ? new Hunter(spawn.id, at)
        : spawn.kind === "slinger"
          ? new Slinger(spawn.id, at)
          : new Shieldbearer(spawn.id, at);
    this.hostiles.push(hostile);
  }

  /** Adds one environment node if it is not already present (idempotent). */
  private spawnEnvironment(spawn: EnvironmentSpawn) {
    if (this.env.some(e => e.id === spawn.id)) return;
    this.env.push({
      id: spawn.id,
      kind: spawn.kind,
      progress: spawn.progress,
      lateral: spawn.lateral,
      armed: true,
    });
  }

  /** Destroys every hostile visual whose backing hostile no longer exists. */
  private destroyOrphanedVisuals() {
    for (const [id, visual] of Array.from(this.hostileVisuals.entries())) {
      if (!this.hostiles.some(h => h.id === id)) {
        visual.root.destroy({ children: true });
        this.hostileVisuals.delete(id);
      }
    }
  }

  /**
   * Full rebuild from the mapped plan for the current route. Used only at
   * initial load (route is still "unchosen", so this yields `route:"both"`
   * content only) and for Scarred, which is a one-way transition to zero
   * hostiles — nothing already defeated can be resurrected by emptying the
   * hostile list.
   *
   * NEVER called from setRoute. A full rebuild there would reconstruct
   * every `route:"both"` hostile again, resurrecting anything the player
   * had already defeated on the approach to the fork.
   */
  private rebuildRouteContent() {
    const plan = this.plan;
    if (!plan) return;

    for (const visual of Array.from(this.hostileVisuals.values())) {
      visual.root.destroy({ children: true });
    }
    this.hostileVisuals.clear();
    for (const visual of Array.from(this.propVisuals.values())) {
      visual.root.destroy({ children: true });
    }
    this.propVisuals.clear();

    this.hostiles = [];
    this.env = [];
    this.projectiles = [];
    this.registry.clear();

    const route = this.run.route;
    for (const spawn of activeHostiles(plan, route)) this.spawnHostile(spawn);
    for (const spawn of activeEnvironment(plan, route)) {
      this.spawnEnvironment(spawn);
    }
  }

  /**
   * Adds ONLY the branch-specific content for a chosen route, on top of
   * whatever `route:"both"` content already exists — including whichever of
   * it the player has already resolved. This is what setRoute calls: it
   * must never rebuild, or a defeated hunter on the approach to the fork
   * would reappear the instant the player committed to a side.
   */
  private addChosenRouteContent(route: "safe" | "upper") {
    if (!this.plan) return;
    for (const spawn of this.plan.hostiles) {
      if (spawn.route === route) this.spawnHostile(spawn);
    }
    for (const spawn of this.plan.environment) {
      if (spawn.route === route) this.spawnEnvironment(spawn);
    }
  }

  /** Physical route commitment. Additive only — never rebuilds. */
  setRoute(route: "safe" | "upper"): boolean {
    if (this.run.route !== "unchosen" || this.run.scarred) return false;
    this.run.chooseRoute(route);
    this.addChosenRouteContent(route);
    return true;
  }

  /**
   * Fork commitment gate. Called every frame by GoldlineGame while an
   * expedition is active, instead of the ordinary corridor's
   * branchForLateralPosition — the two have different semantics, and the
   * ordinary one must not fire before the authored fork or with the wrong
   * meaning for "left/right".
   */
  tryChooseRoute(
    playerProgress: number,
    normalizedLateral: number
  ): "safe" | "upper" | null {
    if (!this.plan) return null;
    if (this.run.route !== "unchosen") return null;
    if (
      playerProgress < this.plan.fork.start ||
      playerProgress > this.plan.fork.end
    ) {
      return null;
    }
    if (normalizedLateral <= -0.28) {
      this.setRoute("upper");
      return "upper";
    }
    if (normalizedLateral >= 0.28) {
      this.setRoute("safe");
      return "safe";
    }
    return null;
  }

  /**
   * §34 Scarred Route. A one-way transition to zero mandatory hostiles, so
   * a full rebuild is safe here — there is nothing to accidentally
   * resurrect once the target state has none.
   */
  pressOn() {
    this.run.pressOn();
    this.settleNonRunningStateForTransition();

    // Remove fictional hostile pressure only. rebuildRouteContent() would
    // reconstruct this.env from the plan with armed:true and Scarred
    // filtering, which re-arms an already-triggered hazard, can drop the
    // Upper route's grapple architecture out from under the player, and
    // visibly rewrites already-traversed world state. Physical scenery the
    // player has already crossed must stay exactly as it is — Press On is
    // a compromise on combat, not a scene reset.
    for (const visual of Array.from(this.hostileVisuals.values())) {
      visual.root.destroy({ children: true });
    }
    this.hostileVisuals.clear();
    this.hostiles = [];
    this.projectiles = [];
    // this.env is deliberately left untouched — spent hazard state and
    // already-instantiated route architecture survive.
    this.registry.clear();
  }

  /**
   * §33 Redeploy. Resets encounter content AT OR AHEAD of the restored
   * Waystone only — fights already resolved behind the checkpoint stay
   * resolved. A full expedition-start rebuild would have respawned every
   * hostile the player fought to reach that point, turning a checkpoint
   * into a full restart.
   */
  redeploy(): number {
    const { restoredProgress } = this.run.redeploy();
    this.settleNonRunningStateForTransition();
    this.resetFromWaystone(restoredProgress);
    return restoredProgress;
  }

  private resetFromWaystone(progress: number) {
    const plan = this.plan;
    if (!plan) return;

    // Preserve armed/spent state for hazards at or behind the checkpoint —
    // a hazard the player already triggered stays triggered.
    const envArmed = new Map(this.env.map(node => [node.id, node.armed]));

    for (const visual of Array.from(this.hostileVisuals.values())) {
      visual.root.destroy({ children: true });
    }
    this.hostileVisuals.clear();
    this.hostiles = [];

    for (const spawn of activeHostiles(plan, this.run.route)) {
      if (spawn.progress >= progress - 0.01) this.spawnHostile(spawn);
    }

    this.env = activeEnvironment(plan, this.run.route).map(spawn => ({
      id: spawn.id,
      kind: spawn.kind,
      progress: spawn.progress,
      lateral: spawn.lateral,
      armed:
        spawn.progress >= progress - 0.01
          ? true
          : (envArmed.get(spawn.id) ?? false),
    }));

    this.projectiles = [];
    this.registry.clear();
  }

  /** Fictional run state for the HUD. Carries no business data. */
  getSnapshot(): ExpeditionSnapshot {
    return {
      hp: this.run.hp,
      momentum: this.run.momentum,
      outcome: this.run.outcome,
      route: this.run.route,
      relic: this.run.relic?.id ?? null,
    };
  }

  /** Corridor progress of the expedition's authored destination, mapped. */
  getDestinationProgress(): number | null {
    return this.plan?.destination ?? null;
  }

  /**
   * ONE state source for the Shieldbearer climax barrier. Previously
   * getGameplayForwardCeiling checked plan+scarred+shield-alive+barrier-
   * fixture-exists, while isClimaxBarrierUp only checked scarred+shield-
   * alive — two different predicates that happened to usually agree, but
   * a plan missing the arch_climax_span fixture would have shown a visible
   * seal with no actual movement clamp behind it, or the reverse. Both the
   * renderer and the ceiling now read this single function.
   */
  private activeClimaxBarrier(): EnvironmentSpawn | null {
    if (!this.plan) return null;
    if (this.run.scarred) return null;
    const barrier =
      this.plan.environment.find(e => e.id === "arch_climax_span") ?? null;
    if (!barrier) return null;
    const shieldAlive = this.hostiles.some(
      h => h.id === "shieldbearer_climax" && h.alive
    );
    return shieldAlive ? barrier : null;
  }

  /**
   * Forward movement ceiling contributed by the Shieldbearer climax. While
   * the guardian is alive, the barrier at arch_climax_span blocks further
   * progress — sprinting past the elite and touching the cache is not a
   * valid way to finish the expedition. Scarred Route bypasses it, matching
   * §34's "largely reduce/bypass remaining mandatory combat".
   */
  getGameplayForwardCeiling(baseCeiling: number): number {
    const barrier = this.activeClimaxBarrier();
    return barrier ? Math.min(baseCeiling, barrier.progress - 0.012) : baseCeiling;
  }

  /** True while the climax barrier is still up — for rendering the seal. */
  isClimaxBarrierUp(): boolean {
    return this.activeClimaxBarrier() !== null;
  }

  /**
   * Reaching the mapped destination settles the expedition into "arrived"
   * only once the climax is genuinely cleared — physically sprinting past
   * an alive Shieldbearer must not count, which mirrors the movement
   * ceiling in getGameplayForwardCeiling. Scarred Route bypasses the gate.
   */
  private maybeArrive(playerProgress: number) {
    if (!this.plan) return;
    if (this.run.outcome !== "running") return;
    const shieldAlive = this.hostiles.some(
      h => h.id === "shieldbearer_climax" && h.alive
    );
    if (playerProgress < this.plan.destination - 0.008) return;
    if (!this.run.scarred && shieldAlive) return;
    this.run.arrive();
  }

  private settleNonRunningStateForTransition() {
    this.projectiles = [];
    this.pendingLatchTargetId = null;
    if (this.aiming) this.endAim();
    this.linehook.reset();
    this.body.vx = 0;
    this.body.vy = 0;
    this.pendingImpulseX = 0;
    this.pendingImpulseY = 0;
    this.handoffSpeed = 0;
    // Covers the down/arrived terminal settle, pressOn and redeploy (all
    // call this): a discontinuity in the player's position must never be
    // read as a velocity spike on the next update.
    this.previousPlayerScreen = null;
  }

  beginAim() {
    // A downed or arrived player cannot enter aim — combat is over either
    // way, and the destination cache is not a Line target.
    if (this.run.outcome !== "running") return;
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
    if (this.run.outcome !== "running") return false;
    const target = this.currentTarget(project);
    if (!target) return false;
    const at = this.lineTargetScreenPoint(target.id, project) ?? {
      x: target.x,
      y: target.y,
    };
    // Firing always ends the aim. Leaving dilation to a separate endAim()
    // call means any caller that misses it strands the whole fictional
    // simulation at 0.2x — so the aim is closed here, at the source.
    this.endAim();
    this.pendingLatchTargetId = target.id;
    this.linehook.fire(
      this.body,
      {
        id: target.id,
        x: at.x,
        y: at.y,
        pulls: target.kind === "environment" && target.environment === "architecture",
      },
      this.lineOrigin()
    );
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

  /**
   * The physical point the Line springs from — Trailblazer's hand/chest,
   * not her feet. Targeting selection, the aim cone, and the visible cable
   * origin previously used three different points (body feet for
   * targeting, body.y-40 for rendering), so the cone the player SAW and the
   * cone the math USED disagreed by 40px. This is now the only definition.
   */
  private lineOrigin(): { x: number; y: number } {
    return { x: this.body.x, y: this.body.y - 40 * this.bodyScale };
  }

  /**
   * The single point the Line treats a target as being AT — the anatomical
   * point players actually perceive (a guardian's torso, a ring's mount,
   * an eye on suspended cargo), not the ground/feet coordinate the world
   * position tracks internally.
   *
   * Before this, the registry registered a target at its FEET, fireLine
   * anchored the tether there too, but drawAim's reticle rendered ~30px
   * above it — so the visible lock and the physical latch point disagreed.
   * This is now the one definition every consumer (registry, fire,
   * reticle, latch spark) reads, rather than each recomputing its own
   * offset.
   */
  private lineTargetScreenPoint(
    id: string,
    project: ScreenProjection
  ): { x: number; y: number } | null {
    const hostile = this.hostiles.find(h => h.id === id);
    if (hostile) {
      const at = project(hostile.x, hostile.y);
      const s = at.scale * (0.62 + (1 - hostile.x) * 0.5);
      const offset =
        hostile.kind === "hunter" ? 62 : hostile.kind === "slinger" ? 44 : 52;
      // Follows the same single recoil the visible body actually applies,
      // so the reticle/cable target the player sees tracks the torso they
      // see rather than the un-recoiled world root.
      const recoil = hostile.recoilSeconds > 0 ? hostile.recoilX * 7 * s : 0;
      return { x: at.x + recoil, y: at.y - offset * s };
    }
    const env = this.env.find(e => e.id === id);
    if (env) {
      const at = project(env.progress, env.lateral);
      const s = at.scale * (0.62 + (1 - env.progress) * 0.5);
      return {
        x: at.x,
        y: at.y - (env.kind === "architecture" ? 40 : 48) * s,
      };
    }
    return null;
  }

  private currentTarget(project: ScreenProjection): LineTarget | null {
    const maxRadius = AIM_MAX_RADIUS_CSS_PX;
    const origin = this.lineOrigin();
    return this.registry.select({
      originX: origin.x,
      originY: origin.y,
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

    // Before overwriting position, capture the player's REAL incoming
    // screen-space velocity from the last frame — this is what "swing,
    // don't zip" actually depends on. Without it a lateral approach into a
    // latch started from zero tangential energy no matter how fast the
    // player was actually moving. Never overwritten while latched: the
    // tether's own physics own velocity once it has hold of the player.
    if (
      dt > 0 &&
      this.previousPlayerScreen &&
      this.linehook.phase !== "latched"
    ) {
      this.body.vx = (playerAt.x - this.previousPlayerScreen.x) / dt;
      this.body.vy = (playerAt.y - this.previousPlayerScreen.y) / dt;
    }

    this.body.x = playerAt.x;
    this.body.y = playerAt.y;
    this.bodyScale = playerAt.scale;
    this.previousPlayerScreen = { x: playerAt.x, y: playerAt.y };

    this.pendingImpulseX = 0;
    this.pendingImpulseY = 0;

    if (dt > 0) {
      this.run.step(dt);

      // Advance the checkpoint as the player passes each authored waystone.
      // setWaystone itself is monotonic, so a player who backtracks cannot
      // downgrade an already-reached checkpoint.
      if (this.plan) {
        const stone = waystoneFor(this.plan, playerProgress);
        if (stone) this.run.setWaystone(stone);
      }

      if (this.run.outcome === "running") {
        this.stepHostiles(dt, playerProgress, playerLateral);

        // A melee hit resolved above can already have reduced HP to zero
        // this frame. Re-checking before projectiles and the tether means a
        // projectile cannot also land on the same dead-but-not-yet-settled
        // frame, and the tether cannot keep pulling a downed player.
        if (this.run.outcome === "running") {
          this.stepProjectilesAndDamage(dt, project);
        }

        if (this.run.outcome === "running") {
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
          this.pendingImpulseX = pullingNow ? this.body.vx * dt : 0;
          this.pendingImpulseY = pullingNow ? this.body.vy * dt : 0;

          if (wasPulling && !pullingNow) {
            this.handoffSpeed = Math.hypot(this.body.vx, this.body.vy);
            this.body.vx = 0;
            this.body.vy = 0;
          }
        }

        this.maybeArrive(playerProgress);
      }

      if (this.run.outcome !== "running") {
        this.settleNonRunningStateForTransition();
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
      const groundAt = project(hostile.x, hostile.y);
      const targetAt = this.lineTargetScreenPoint(hostile.id, project) ?? groundAt;
      this.registry.registerHostile({
        id: hostile.id,
        hostile: hostile.kind,
        x: targetAt.x,
        y: targetAt.y,
        alive: hostile.alive,
        onScreen: groundAt.x > -80 && groundAt.x < viewportWidth + 80,
        guardFacing:
          hostile instanceof Shieldbearer ? hostile.facing : null,
      });
    }

    for (const node of this.env) {
      const groundAt = project(node.progress, node.lateral);
      const targetAt = this.lineTargetScreenPoint(node.id, project) ?? groundAt;
      this.registry.registerEnvironment({
        id: node.id,
        environment: node.kind,
        x: targetAt.x,
        y: targetAt.y,
        armed: node.armed,
        onScreen: groundAt.x > -80 && groundAt.x < viewportWidth + 80,
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
    if (this.run.outcome !== "running") return false;
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

    this.reapSprites();
    this.drawEnvironment(project);
    this.drawClimaxSeal(project);
    this.drawHostiles(project);
    this.drawProjectiles(project);
    this.drawCable();
    this.drawAim(project, viewportWidth);
  }

  /**
   * Places a world prop sprite. Props are PHYSICAL OBJECTS first: they sit
   * in the world at their authored anchor with a contact shadow, and their
   * interaction affordance only intensifies when the Line can actually
   * reach them. That ordering is what stops them reading as HUD icons.
   */
  private updatePropSprite(
    id: string,
    texture: Texture,
    at: { x: number; y: number },
    groundY: number,
    s: number,
    height: number,
    anchorY: number,
    highlight: number
  ) {
    let visual = this.propVisuals.get(id);
    if (!visual) {
      const root = new Container();
      root.label = `prop:${id}`;
      const shadow = new Graphics();
      const body = new Sprite(texture);
      body.anchor.set(0.5, anchorY);
      root.addChild(shadow, body);
      this.hostFor().addChild(root);
      visual = { root, shadow, body };
      this.propVisuals.set(id, visual);
    }

    // PHYSICAL PROP sorts in the world; its INTERACTION GLOW lives in the
    // overlay layer, so an affordance can never be hidden behind a civilian
    // while the object it belongs to stays visible.
    visual.root.x = at.x;
    visual.root.y = at.y;
    visual.root.zIndex = worldActorZ(groundY, `prop:${id}`);

    const body = visual.body;
    body.height = height * s;
    body.width = body.height * (texture.width / texture.height);
    body.alpha = 0.82 + highlight * 0.18;
    body.tint = highlight > 0.6 ? 0xffe9b8 : 0xffffff;
    return visual;
  }

  /** 0..1 relevance of a prop: how close the Line is to being able to take it. */
  private propHighlight(id: string): number {
    if (this.lockedTargetId === id) return 1;
    if (this.aiming) return 0.55;
    return 0;
  }

  /**
   * The Shieldbearer's forward barrier, rendered as an actual physical
   * object spanning Trailblazer's route — not merely a numeric movement
   * clamp. Visibility is driven by the EXACT SAME predicate
   * (isClimaxBarrierUp) that getGameplayForwardCeiling uses to cap
   * movement, so the visible seal and the invisible-if-it-weren't-drawn
   * wall can never disagree.
   */
  private drawClimaxSeal(project: ScreenProjection) {
    const g = this.gSeal;
    g.clear();
    // Reads the SAME activeClimaxBarrier() the ceiling calls, rather than
    // separately looking up the fixture and separately checking the
    // shield's state — that duplication is exactly what let the visual
    // and the clamp drift out of agreement.
    const barrier = this.activeClimaxBarrier();
    if (!barrier) return;

    // Centered on the actual playable lane, not the environment spawn's own
    // authored lateral (which is an interaction fixture position, not the
    // seal's span) — the wall must visibly cross where the player walks.
    const left = project(barrier.progress, -110);
    const right = project(barrier.progress, 110);
    const s = (left.scale + right.scale) / 2;
    const t = this.clock.fictionalElapsedSeconds();
    const tension = 0.55 + Math.sin(t * 2.4) * 0.25;

    // Two limestone/brass anchor posts.
    for (const post of [left, right]) {
      g.rect(post.x - 7 * s, post.y - 96 * s, 14 * s, 96 * s)
        .fill({ color: PALETTE.limestone })
        .stroke({ width: 2 * s, color: PALETTE.brassDark });
      g.rect(post.x - 9 * s, post.y - 96 * s, 18 * s, 10 * s).fill({
        color: PALETTE.brass,
      });
    }

    // The energy span itself, between the posts.
    const midY = (left.y + right.y) / 2 - 60 * s;
    g.moveTo(left.x, left.y - 60 * s)
      .lineTo(right.x, right.y - 60 * s)
      .stroke({ width: 6 * s, color: PALETTE.brassDark, alpha: 0.9 });
    g.moveTo(left.x, left.y - 60 * s)
      .lineTo(right.x, right.y - 60 * s)
      .stroke({ width: 3 * s, color: PALETTE.lineGold, alpha: tension });
    g.circle((left.x + right.x) / 2, midY, 6 * s).fill({
      color: PALETTE.lineFracture,
      alpha: tension,
    });
  }

  private drawEnvironment(project: ScreenProjection) {
    const g = this.gEnv;
    g.clear();
    const t = this.clock.fictionalElapsedSeconds();

    for (const node of this.env) {
      const at = project(node.progress, node.lateral);
      const s = at.scale * (0.62 + (1 - node.progress) * 0.5);

      const ringTexture = this.textures.get("grapple_ring");
      const hazardTexture = this.textures.get("cargo_hazard");
      if (node.kind === "architecture" && ringTexture) {
        const ring = this.updatePropSprite(
          node.id,
          ringTexture,
          { x: at.x, y: at.y - 44 * s },
          at.y,
          s,
          78,
          0.5,
          this.propHighlight(node.id)
        );
        // Shadow sits at the mount point so the ring reads as fixed to
        // stone rather than hovering in front of it.
        ring.shadow.clear();
        ring.shadow
          .ellipse(0, 44 * s, 16 * s, 5 * s)
          .fill({ color: PALETTE.shadow, alpha: 0.22 });
        continue;
      }
      if (node.kind === "hazard" && hazardTexture) {
        const swing = node.armed ? Math.sin(t * 1.05) * 6 * s : 0;
        const cargo = this.updatePropSprite(
          node.id,
          hazardTexture,
          { x: at.x + swing, y: at.y - 30 * s },
          at.y,
          s,
          132,
          0.82,
          node.armed ? this.propHighlight(node.id) : 0
        );
        // Ground shadow under the suspended load — tells the player it hangs
        // over something, which is the entire point of the hazard.
        cargo.shadow.clear();
        cargo.shadow
          .ellipse(-swing, 32 * s, 26 * s, 7 * s)
          .fill({ color: PALETTE.shadow, alpha: node.armed ? 0.3 : 0.12 });
        cargo.body.alpha = node.armed ? cargo.body.alpha : 0.55;
        cargo.body.rotation = node.armed ? Math.sin(t * 1.05) * 0.05 : 0.34;
        continue;
      }

      if (node.kind === "architecture") {
        // A chunky carved corbel with a heavy brass mooring ring. The first
        // pass drew a thin circle, which read as a debug overlay; this is
        // built as masonry so it belongs to the building it hangs off.
        const cx = at.x;
        const cy = at.y - 54 * s;

        // A SHORT dark bracket, not a big pale slab. The first attempt drew
        // a wide limestone trapezoid that floated unattached in mid-air and
        // read as a white rectangle pasted on the painting; keeping it small
        // and in shadow tones lets the brass ring carry the read instead.
        g.moveTo(cx - 11 * s, cy - 14 * s)
          .lineTo(cx + 11 * s, cy - 14 * s)
          .lineTo(cx + 7 * s, cy + 2 * s)
          .lineTo(cx - 7 * s, cy + 2 * s)
          .closePath()
          .fill({ color: PALETTE.stone })
          .stroke({ width: 1.6 * s, color: PALETTE.stoneDeep });
        g.moveTo(cx - 11 * s, cy - 14 * s)
          .lineTo(cx + 11 * s, cy - 14 * s)
          .stroke({ width: 1.8 * s, color: PALETTE.stoneRim, alpha: 0.65 });

        // The ring itself: thick brass, double-struck, with a Line-lit core
        // that pulses so it advertises itself as a latch point.
        const glow = 0.5 + Math.sin(t * 2 + node.progress * 9) * 0.22;
        g.circle(cx, cy + 14 * s, 19 * s).stroke({
          width: 6.5 * s,
          color: PALETTE.brassDark,
        });
        g.circle(cx, cy + 14 * s, 19 * s).stroke({
          width: 3.4 * s,
          color: PALETTE.brass,
        });
        g.circle(cx, cy + 14 * s, 11 * s).fill({
          color: PALETTE.lineGold,
          alpha: glow * 0.5,
        });
        g.circle(cx, cy + 14 * s, 5 * s).fill({
          color: PALETTE.lineFracture,
          alpha: glow,
        });
      } else {
        // §30: the hazard is visible in the world BEFORE anything references
        // it — weathered cargo swinging on a fraying brass cable.
        const swing = node.armed ? Math.sin(t * 1.05) * 7 * s : 0;
        const cx = at.x + swing;
        const topY = at.y - 150 * s;
        const boxY = at.y - 44 * s;

        g.moveTo(at.x, topY)
          .lineTo(cx, boxY)
          .stroke({ width: 3.4 * s, color: PALETTE.hazardRope });
        g.moveTo(at.x, topY)
          .lineTo(cx, boxY)
          .stroke({ width: 1.4 * s, color: PALETTE.brass, alpha: 0.55 });

        if (node.armed) {
          // Ground shadow under the suspended load — tells the player it is
          // hanging over something, which is the whole point of it.
          g.ellipse(at.x, at.y + 2 * s, 30 * s, 8 * s).fill({
            color: PALETTE.shadow,
            alpha: 0.3,
          });
        }

        const w = 30 * s;
        const h = 42 * s;
        g.rect(cx - w, boxY, w * 2, h)
          .fill({ color: node.armed ? PALETTE.limestone : PALETTE.limestoneShade })
          .stroke({ width: 2.4 * s, color: PALETTE.brassDark });
        // Brass banding and corner straps.
        g.rect(cx - w, boxY + h * 0.42, w * 2, 5 * s).fill({ color: PALETTE.brass });
        g.rect(cx - w, boxY, 5 * s, h).fill({ color: PALETTE.brass, alpha: 0.85 });
        g.rect(cx + w - 5 * s, boxY, 5 * s, h).fill({
          color: PALETTE.brass,
          alpha: 0.85,
        });

        if (node.armed) {
          // The mooring eye is the actual Line target; make it obvious.
          const glow = 0.55 + Math.sin(t * 2.6) * 0.25;
          g.circle(cx, boxY - 4 * s, 8.5 * s).stroke({
            width: 3.4 * s,
            color: PALETTE.brass,
          });
          g.circle(cx, boxY - 4 * s, 4 * s).fill({
            color: PALETTE.lineFracture,
            alpha: glow,
          });
        }
      }
    }
  }

  private drawHostiles(project: ScreenProjection) {
    const g = this.gHostiles;
    g.clear();
    const t = this.clock.fictionalElapsedSeconds();

    for (const hostile of this.hostiles) {
      if (!hostile.alive) continue;
      const at = project(hostile.x, hostile.y);
      // Depth: guardians further up the corridor genuinely shrink, so they
      // sit in the painted perspective instead of floating on top of it.
      const s = at.scale * (0.62 + (1 - hostile.x) * 0.5);
      const flash = this.hitFlash.get(hostile.id) ?? 0;
      const y = at.y;

      const telegraph = hostile.telegraphProgress();
      if (telegraph > 0) {
        // A filled ground tell, not a thin ring: it reads at a glance and
        // it reads on a bright background.
        g.ellipse(at.x, y + 2 * s, (26 + telegraph * 30) * s, (9 + telegraph * 9) * s)
          .fill({ color: PALETTE.danger, alpha: 0.12 + telegraph * 0.3 });
        g.ellipse(at.x, y + 2 * s, (26 + telegraph * 30) * s, (9 + telegraph * 9) * s)
          .stroke({ width: 2.5 * s, color: PALETTE.danger, alpha: 0.5 + telegraph * 0.45 });
      }

      const texture = this.textures.get(hostile.kind);
      if (texture) {
        // World ROOT stays at the true, un-recoiled world position — recoil
        // is applied ONCE, locally, on the child body inside
        // updateHostileSprite. Previously this call site pre-offset x by
        // the recoil amount AND updateHostileSprite applied its own local
        // offset on top, doubling the visible kick and desyncing the
        // guardian's actual world/depth position from where it was drawn.
        //
        // The sprite-backed HostileVisual root also draws its own LOCAL
        // contact shadow that travels with the actor and sorts at its
        // depth, so no ground shadow is drawn here.
        this.updateHostileSprite(hostile, texture, at.x, y, s, flash, t);
      } else {
        // Procedural fallback has no sprite root, so it owns its own
        // (single) recoil offset and its own grounding here.
        const recoil = hostile.recoilSeconds > 0 ? hostile.recoilX * 7 * s : 0;
        const x = at.x + recoil;
        g.ellipse(at.x, y + 3 * s, 30 * s, 9 * s).fill({
          color: PALETTE.shadow,
          alpha: 0.3,
        });
        g.ellipse(at.x, y + 1 * s, 15 * s, 4.5 * s).fill({
          color: PALETTE.shadow,
          alpha: 0.5,
        });
        if (hostile.kind === "hunter") this.drawHunter(g, x, y, s, flash, hostile, t);
        else if (hostile.kind === "slinger") this.drawSlinger(g, x, y, s, flash, hostile, t);
        else this.drawShieldbearer(g, x, y, s, flash, hostile as Shieldbearer, t);
      }
    }
  }

  /**
   * Places and animates a guardian's sprite body.
   *
   * A static PNG is not an animation sheet, so the reactions the fight
   * depends on are driven at runtime: telegraph lean and scale-up, recoil
   * offset, hit flash, facing mirror, corridor depth scale and the
   * Shieldbearer's exposed stagger.
   */
  private updateHostileSprite(
    hostile: Ruinbound,
    texture: Texture,
    x: number,
    y: number,
    s: number,
    flash: number,
    t: number
  ) {
    let visual = this.hostileVisuals.get(hostile.id);
    if (!visual) {
      const root = new Container();
      root.label = `ruinbound:${hostile.id}`;
      const shadow = new Graphics();
      const body = new Sprite(texture);
      body.anchor.set(0.5, GUARDIAN_FEET_ANCHOR);
      root.addChild(shadow, body);
      this.hostFor().addChild(root);
      visual = { root, shadow, body };
      this.hostileVisuals.set(hostile.id, visual);
    }

    // Root carries WORLD position and depth; the body carries reaction.
    visual.root.x = x;
    visual.root.y = y;
    visual.root.zIndex = worldActorZ(y, `ruinbound:${hostile.id}`);

    // Contact shadow drawn local to the root, so it travels with the actor
    // and cannot be occluded independently of the body it belongs to.
    visual.shadow.clear();
    visual.shadow
      .ellipse(0, 2 * s, 30 * s, 9 * s)
      .fill({ color: PALETTE.shadow, alpha: 0.3 });
    visual.shadow
      .ellipse(0, 1 * s, 15 * s, 4.5 * s)
      .fill({ color: PALETTE.shadow, alpha: 0.5 });

    const body = visual.body;
    const targetHeight = 150 * s;
    body.height = targetHeight;
    body.width = targetHeight * (texture.width / texture.height);
    body.x = 0;
    body.y = 0;

    const telegraph = hostile.telegraphProgress();
    const facingRight = Math.cos(hostile.facing) >= 0;
    body.scale.x = Math.abs(body.scale.x) * (facingRight ? 1 : -1);

    // Recoil is a local body offset, never a world move — moving the root
    // would make a hit visibly change the actor's depth.
    body.x = hostile.recoilSeconds > 0 ? hostile.recoilX * 7 * s : 0;

    const lean = telegraph * 0.18 * (facingRight ? 1 : -1);
    body.rotation =
      lean + (hostile.recoilSeconds > 0 ? -hostile.recoilX * 0.09 : 0);
    if (telegraph > 0) {
      body.scale.y = Math.abs(body.scale.y) * (1 + telegraph * 0.06);
    }

    const exposed = hostile instanceof Shieldbearer && hostile.exposed;
    body.tint = flash > 0 ? 0xffffff : exposed ? 0xffd9a0 : 0xffffff;
    body.alpha = flash > 0 ? 0.85 : 1;
    if (exposed) body.rotation += Math.sin(t * 12) * 0.05 + 0.12;
  }

  /** Removes sprites for guardians and props that are gone, so nothing leaks. */
  private reapSprites() {
    for (const [id, visual] of Array.from(this.propVisuals.entries())) {
      if (!this.env.some(e => e.id === id)) {
        visual.root.destroy({ children: true });
        this.propVisuals.delete(id);
      }
    }
    for (const [id, visual] of Array.from(this.hostileVisuals.entries())) {
      const hostile = this.hostiles.find(h => h.id === id);
      if (!hostile || !hostile.alive) {
        visual.root.destroy({ children: true });
        this.hostileVisuals.delete(id);
      }
    }
  }

  /** Hot fracture light that pulses along a guardian's cracks. */
  private fractureAlpha(t: number, offset: number): number {
    return 0.55 + Math.sin(t * 2.4 + offset) * 0.3;
  }

  private bodyColor(flash: number): number {
    return flash > 0 ? PALETTE.stoneRim : PALETTE.stone;
  }

  /**
   * HUNTER — tall, narrow, forward-raked, with a long trailing leg. The
   * whole silhouette leans at you; that lean IS the read.
   */
  private drawHunter(
    g: Graphics,
    x: number,
    y: number,
    s: number,
    flash: number,
    hostile: Ruinbound,
    t: number
  ) {
    const lean = Math.cos(hostile.facing) >= 0 ? 1 : -1;
    const color = this.bodyColor(flash);

    // Trailing leg, planted back — gives the lean something to push from.
    g.moveTo(x - lean * 14 * s, y)
      .lineTo(x - lean * 6 * s, y - 34 * s)
      .lineTo(x - lean * 1 * s, y - 30 * s)
      .lineTo(x - lean * 6 * s, y)
      .closePath()
      .fill({ color: PALETTE.stoneDeep });

    // Raked torso wedge.
    g.moveTo(x - lean * 9 * s, y - 2 * s)
      .lineTo(x - lean * 4 * s, y - 44 * s)
      .lineTo(x + lean * 12 * s, y - 66 * s)
      .lineTo(x + lean * 20 * s, y - 52 * s)
      .lineTo(x + lean * 9 * s, y - 28 * s)
      .lineTo(x + lean * 7 * s, y - 2 * s)
      .closePath()
      .fill({ color });

    // Sunward rim light along the leading edge — sells it as carved stone.
    g.moveTo(x - lean * 4 * s, y - 44 * s)
      .lineTo(x + lean * 12 * s, y - 66 * s)
      .lineTo(x + lean * 20 * s, y - 52 * s)
      .stroke({ width: 2.2 * s, color: PALETTE.stoneRim, alpha: 0.75 });

    // Brass mask, angled forward.
    g.moveTo(x + lean * 8 * s, y - 64 * s)
      .lineTo(x + lean * 22 * s, y - 56 * s)
      .lineTo(x + lean * 13 * s, y - 46 * s)
      .closePath()
      .fill({ color: PALETTE.brass })
      .stroke({ width: 1.4 * s, color: PALETTE.brassDark });
    // Single eye-slit of Line light.
    g.moveTo(x + lean * 12 * s, y - 58 * s)
      .lineTo(x + lean * 19 * s, y - 55 * s)
      .stroke({ width: 2 * s, color: PALETTE.lineFracture, alpha: 0.95 });

    // Animated fracture down the torso.
    g.moveTo(x + lean * 2 * s, y - 46 * s)
      .lineTo(x - lean * 1 * s, y - 30 * s)
      .lineTo(x + lean * 3 * s, y - 16 * s)
      .stroke({
        width: 2.4 * s,
        color: PALETTE.lineFracture,
        alpha: this.fractureAlpha(t, 0),
      });
  }

  /**
   * SLINGER — low, wide and squat, with one long raised throwing arm. Reads
   * as ranged from its outline alone, never confusable with the Hunter.
   */
  private drawSlinger(
    g: Graphics,
    x: number,
    y: number,
    s: number,
    flash: number,
    hostile: Ruinbound,
    t: number
  ) {
    const face = Math.cos(hostile.facing) >= 0 ? 1 : -1;
    const color = this.bodyColor(flash);

    // Broad planted base.
    g.moveTo(x - 24 * s, y)
      .lineTo(x - 19 * s, y - 26 * s)
      .lineTo(x + 19 * s, y - 30 * s)
      .lineTo(x + 24 * s, y)
      .closePath()
      .fill({ color });
    g.moveTo(x - 19 * s, y - 26 * s)
      .lineTo(x + 19 * s, y - 30 * s)
      .stroke({ width: 2 * s, color: PALETTE.stoneRim, alpha: 0.7 });

    // Hunched shoulders swallowing the head.
    g.ellipse(x + face * 3 * s, y - 34 * s, 16 * s, 10 * s).fill({ color });
    g.circle(x + face * 7 * s, y - 40 * s, 8.5 * s)
      .fill({ color: PALETTE.brass })
      .stroke({ width: 1.4 * s, color: PALETTE.brassDark });

    // Long throwing arm, winding further back as the tell builds.
    const wind = hostile.telegraphProgress();
    const handX = x + face * (24 + wind * 12) * s;
    const handY = y - (44 + wind * 18) * s;
    g.moveTo(x + face * 13 * s, y - 28 * s)
      .lineTo(handX, handY)
      .stroke({ width: 6 * s, color: PALETTE.stoneDeep });
    g.moveTo(x + face * 13 * s, y - 28 * s)
      .lineTo(handX, handY)
      .stroke({ width: 2.5 * s, color: PALETTE.stoneRim, alpha: 0.5 });

    if (wind > 0) {
      // Gathering projectile: glow grows with the wind-up so the throw is
      // never a surprise.
      g.circle(handX, handY, (7 + wind * 8) * s).fill({
        color: PALETTE.danger,
        alpha: 0.2 + wind * 0.25,
      });
      g.circle(handX, handY, (3.5 + wind * 5) * s).fill({
        color: PALETTE.lineFracture,
        alpha: 0.7 + wind * 0.3,
      });
    }

    g.moveTo(x - 8 * s, y - 24 * s)
      .lineTo(x - 3 * s, y - 10 * s)
      .stroke({
        width: 2.2 * s,
        color: PALETTE.lineFracture,
        alpha: this.fractureAlpha(t, 1.7),
      });
  }

  /**
   * SHIELDBEARER — massive, squat, and mostly SHIELD. The slab is the
   * silhouette, so "do not lash this from the front" is legible before any
   * text explains it.
   */
  private drawShieldbearer(
    g: Graphics,
    x: number,
    y: number,
    s: number,
    flash: number,
    hostile: Shieldbearer,
    t: number
  ) {
    const face = Math.cos(hostile.facing) >= 0 ? 1 : -1;
    const color = this.bodyColor(flash);

    // Heavy body.
    g.moveTo(x - 25 * s, y)
      .lineTo(x - 21 * s, y - 50 * s)
      .lineTo(x + 21 * s, y - 50 * s)
      .lineTo(x + 25 * s, y)
      .closePath()
      .fill({ color });
    g.moveTo(x - 21 * s, y - 50 * s)
      .lineTo(x + 21 * s, y - 50 * s)
      .stroke({ width: 2.4 * s, color: PALETTE.stoneRim, alpha: 0.7 });
    g.circle(x, y - 60 * s, 12 * s)
      .fill({ color: PALETTE.brass })
      .stroke({ width: 1.6 * s, color: PALETTE.brassDark });

    if (hostile.exposed) {
      // Guard hauled aside by the Line: the slab swings wide and the whole
      // body opens up. The vulnerability is unmistakable.
      const swing = face * 40 * s;
      g.moveTo(x + swing, y - 62 * s)
        .lineTo(x + swing + face * 16 * s, y - 54 * s)
        .lineTo(x + swing + face * 16 * s, y - 4 * s)
        .lineTo(x + swing, y - 2 * s)
        .closePath()
        .fill({ color: PALETTE.brassDark })
        .stroke({ width: 2 * s, color: PALETTE.brass });
      // Exposed core, pulsing hot.
      g.circle(x, y - 28 * s, 20 * s).fill({
        color: PALETTE.lineFracture,
        alpha: 0.22 + Math.sin(t * 9) * 0.1,
      });
      g.circle(x, y - 28 * s, 13 * s).fill({
        color: PALETTE.lineGold,
        alpha: 0.55,
      });
    } else {
      // Full-height slab across the front, with a brass boss and banding so
      // it reads as forged metal rather than a grey box.
      const sx = x + face * 15 * s;
      g.moveTo(sx, y - 72 * s)
        .lineTo(sx + face * 19 * s, y - 64 * s)
        .lineTo(sx + face * 19 * s, y - 2 * s)
        .lineTo(sx, y + 2 * s)
        .closePath()
        .fill({ color: PALETTE.brass })
        .stroke({ width: 2.4 * s, color: PALETTE.brassDark });
      g.moveTo(sx + face * 3 * s, y - 62 * s)
        .lineTo(sx + face * 3 * s, y - 8 * s)
        .stroke({ width: 2 * s, color: PALETTE.brassDark, alpha: 0.8 });
      g.circle(sx + face * 10 * s, y - 34 * s, 7 * s)
        .fill({ color: PALETTE.lineGold, alpha: 0.85 })
        .stroke({ width: 1.6 * s, color: PALETTE.brassDark });
    }

    g.moveTo(x - 10 * s, y - 44 * s)
      .lineTo(x - 5 * s, y - 24 * s)
      .lineTo(x - 11 * s, y - 8 * s)
      .stroke({
        width: 2.6 * s,
        color: PALETTE.lineFracture,
        alpha: this.fractureAlpha(t, 3.1),
      });
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

    const from = this.lineOrigin();
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
    const origin = this.lineOrigin();
    const ox = origin.x;
    const oy = origin.y;

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
    const at = this.lineTargetScreenPoint(this.lockedTargetId, project);
    if (!at) return;

    // Lock reticle: heavy, high-contrast, unmistakable against the plate,
    // and now at the SAME point the registry selected and fireLine anchors
    // to — the reticle the player sees is the point the Line actually goes.
    g.circle(at.x, at.y, 30).stroke({
      width: 4,
      color: PALETTE.lineGold,
    });
    g.circle(at.x, at.y, 38).stroke({
      width: 1.5,
      color: PALETTE.lineGold,
      alpha: 0.6,
    });
  }

  destroy() {
    // Destroys only the displays this layer created — never the host.
    for (const v of Array.from(this.hostileVisuals.values())) {
      v.root.destroy({ children: true });
    }
    this.hostileVisuals.clear();
    for (const v of Array.from(this.propVisuals.values())) {
      v.root.destroy({ children: true });
    }
    this.propVisuals.clear();
    this.registry.clear();
    this.hostiles = [];
    this.env = [];
    this.projectiles = [];
    this.previousPlayerScreen = null;
    this.container.destroy({ children: true });
  }
}
