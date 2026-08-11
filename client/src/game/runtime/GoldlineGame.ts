import {
  Application,
  Assets,
  Container,
  Graphics,
  Sprite,
  Texture,
} from "pixi.js";
import { AvatarStateMachine } from "../avatar/AvatarStateMachine";
import type { AvatarState } from "../state/GameState";
import {
  branchForLateralPosition,
  pendingTrigger,
} from "../world/RouteCorridor";
import {
  anchorDistance,
  loadCorridorAnchors,
  pointInZone,
  type CorridorAnchor,
  type OcclusionZone,
} from "../world/corridorAnchors";
import type {
  CorridorAction,
  CorridorBranch,
} from "../state/GameState";
import type { WorldMissionState } from "../../../../shared/driverGameWorld";
import { CameraController } from "./CameraController";
import { branchPaceFor, stepVelocity, targetSpeedForMagnitude } from "./movementFeel";
import { lateralForProgress, loadGoldRoute, type GoldRoutePoint } from "../world/goldRoute";
import { AdaptiveQualityMonitor, type QualityTier } from "./adaptiveQuality";

export type LandmarkArchetype = "ANCHOR" | "GATEKEEPER" | "GHOST" | "STALLER";

type GoldlineGameCallbacks = {
  onActionAvailable: (action: CorridorAction | null, label: string | null) => void;
  onBranchChange: (branch: CorridorBranch) => void;
  onProgress: (progress: number) => void;
  onInteract: () => void;
  onError: (error: Error) => void;
  /** Fires as the player approaches/leaves a world portal (e.g. Cold Call). */
  onPortalProximity?: (
    anchorId: string,
    state: "hidden" | "label" | "engage"
  ) => void;
  /** Fires once per successfully triggered traversal move — analytics only, never gameplay-authoritative. */
  onTraversalAction?: (action: "JUMP" | "CLIMB" | "VAULT") => void;
  /** Fires only when measured rolling frame time crosses a real degrade/recover threshold. */
  onQualityChange?: (tier: QualityTier, avgFrameMs: number) => void;
};

/**
 * `worldUrl`/`operatorUrl` remain the required Run-1 fallback pair. Every
 * other field is optional so a corridor can still boot with only the two
 * originally-approved assets — the corridor_01 art pack upgrades the scene
 * when present but is never a hard dependency.
 */
type GameAssets = {
  worldUrl: string;
  operatorUrl: string;
  anchorsBasePath?: string;
  farUrl?: string;
  midUrl?: string;
  foregroundUrl?: string;
  effectsUrl?: string;
  portalUrl?: string;
  strongholdUrl?: string;
  characterBasePath?: string;
};

const CHARACTER_POSE_FILES: Record<string, string> = {
  idle: "idle.webp",
  run_01: "run_01.webp",
  run_02: "run_02.webp",
  run_03: "run_03.webp",
  run_04: "run_04.webp",
  run_05: "run_05.webp",
  jump_start: "jump_start.webp",
  jump_air: "jump_air.webp",
  vault: "vault.webp",
  climb_a: "climb_a.webp",
  climb_b: "climb_b.webp",
  land: "land.webp",
};

/**
 * State -> pose mapping. Run is genuine 5-frame sequential animation; every
 * other state is a single authored pose swap, not interpolated motion. See
 * client/public/assets/goldline/characters/trailblazer/README.md for which
 * states are which.
 */
function poseForState(state: AvatarState, runFrame: number): string {
  switch (state) {
    case "run":
      return `run_0${(runFrame % 5) + 1}`;
    case "walk":
      return `run_0${(runFrame % 5) + 1}`; // same cycle, driven slower by caller
    case "jump_start":
      return "jump_start";
    case "jump_air":
      return "jump_air";
    case "land":
      return "land";
    case "vault":
      return "vault";
    case "climb":
      return runFrame % 2 === 0 ? "climb_a" : "climb_b";
    default:
      return "idle";
  }
}


export class GoldlineGame {
  private app: Application | null = null;
  private world = new Container();

  // L0-L4 layer containers.
  private layerFar = new Container(); // L0
  private layerMid = new Container(); // L1
  private layerTraversal = new Container(); // L2 — route, portals, avatar
  private layerForeground = new Container(); // L3 — occlusion
  private layerEffects = new Container(); // L4

  private camera = new CameraController(this.world);
  private avatar: Sprite | null = null;
  /** Holds the outgoing pose during a crossfade so state changes don't pop. */
  private avatarCrossfade: Sprite | null = null;
  private crossfadeStartedAt = 0;
  private avatarShadow = new Graphics();
  private corridor = new Graphics();
  private fortress = new Graphics();
  private recoveryPath = new Graphics();
  private portals = new Container();
  private strongholdSprite: Sprite | null = null;
  private effectsSprite: Sprite | null = null;
  private farSprite: Sprite | null = null;
  private foregroundOccluders: Sprite[] = [];
  private poseTextures = new Map<string, Texture>();
  private currentPoseKey = "idle";
  private lastAvatarStateForImpulse: AvatarState = "idle";
  private runFrameTimer = 0;
  private particles = new Container();
  private input = { x: 0, y: 0 };
  private progress = 0.06;
  private lateral = 0;
  private velocity = 0; // eased locomotion speed, not applied 1:1 from input
  private lastDirectionSign = 0;
  private completedTriggers = new Set<string>();
  private availableAction: CorridorAction | null = null;
  private availableLabel: string | null = null;
  private branch: CorridorBranch = "intel";
  private avatarState = new AvatarStateMachine();
  private actionUntil = 0;
  private lastReportedProgress = -1;
  private worldState: WorldMissionState = "available";
  private anchors: CorridorAnchor[] = [];
  private goldRoutePoints: GoldRoutePoint[] = [];
  private landmarkArchetype: LandmarkArchetype | null = null;
  private landmark = new Graphics();
  private occlusionZones: OcclusionZone[] = [];
  private portalProximityState = new Map<string, "hidden" | "label" | "engage">();
  private qualityMonitor = new AdaptiveQualityMonitor();
  private qualityTier: QualityTier = "premium";
  private hidden = false;
  private visibilityHandler = () => {
    this.hidden = document.hidden;
    if (this.hidden) this.app?.ticker.stop();
    else this.app?.ticker.start();
  };
  private pageHideHandler = () => {
    this.hidden = true;
    this.app?.ticker.stop();
  };

  constructor(
    private readonly host: HTMLDivElement,
    private readonly callbacks: GoldlineGameCallbacks
  ) {}

  async start(assets: GameAssets) {
    try {
      const app = new Application();
      await app.init({
        resizeTo: this.host,
        antialias: true,
        autoDensity: true,
        resolution: Math.min(window.devicePixelRatio || 1, 1.25),
        backgroundColor: 0x071119,
        powerPreference: "high-performance",
      });
      this.app = app;
      app.canvas.className = "goldline-game-canvas";
      app.canvas.setAttribute("aria-label", "Playable Goldline jungle corridor");
      this.host.appendChild(app.canvas);

      const characterBase = assets.characterBasePath ?? "/assets/goldline/characters/trailblazer";
      const optionalLoads: Array<[string, string]> = [
        ...(assets.farUrl ? [["far", assets.farUrl] as [string, string]] : []),
        ...(assets.foregroundUrl ? [["foreground", assets.foregroundUrl] as [string, string]] : []),
        ...(assets.effectsUrl ? [["effects", assets.effectsUrl] as [string, string]] : []),
        ...(assets.portalUrl ? [["portal", assets.portalUrl] as [string, string]] : []),
        ...(assets.strongholdUrl ? [["stronghold", assets.strongholdUrl] as [string, string]] : []),
      ];
      const poseEntries = Object.entries(CHARACTER_POSE_FILES);

      const [worldTexture, operatorTexture, midTexture, ...rest] = await Promise.all([
        Assets.load<Texture>(assets.worldUrl),
        Assets.load<Texture>(assets.operatorUrl),
        assets.midUrl ? Assets.load<Texture>(assets.midUrl).catch(() => null) : Promise.resolve(null),
        ...optionalLoads.map(([, url]) => Assets.load<Texture>(url).catch(() => null)),
        ...poseEntries.map(([, file]) =>
          Assets.load<Texture>(`${characterBase}/${file}`).catch(() => null)
        ),
      ]);

      const optionalTextures = new Map<string, Texture | null>();
      optionalLoads.forEach(([key], index) => optionalTextures.set(key, rest[index] as Texture | null));
      poseEntries.forEach(([key], index) => {
        const texture = rest[optionalLoads.length + index] as Texture | null;
        if (texture) this.poseTextures.set(key, texture);
      });

      // L1 mid: prefer the richer corridor_01 mid plate; fall back to the
      // original Run-1 background if it failed to load or was not supplied.
      const background = new Sprite(midTexture ?? worldTexture);
      background.label = midTexture ? "corridor_01-mid" : "approved-world-art";
      this.layerMid.addChild(background);

      // L0 far: optional. Rendered behind everything with slow parallax.
      const farTexture = optionalTextures.get("far");
      if (farTexture) {
        this.farSprite = new Sprite(farTexture);
        this.farSprite.alpha = 0.9;
        this.layerFar.addChild(this.farSprite);
      }

      this.layerTraversal.addChild(
        this.corridor,
        this.recoveryPath,
        this.fortress,
        this.landmark,
        this.portals
      );

      // Stronghold: a real landmark sprite behind the existing state-colored
      // vector gate. The vector stays on top — its color already carries a
      // load-bearing business-truth signal (captured/contested/closed) that
      // a static image cannot reproduce, so it is never removed.
      const strongholdTexture = optionalTextures.get("stronghold");
      if (strongholdTexture) {
        this.strongholdSprite = new Sprite(strongholdTexture);
        this.strongholdSprite.anchor.set(0.5, 1);
        this.layerTraversal.addChildAt(this.strongholdSprite, this.layerTraversal.getChildIndex(this.fortress));
      }

      const characterTexture = this.poseTextures.get("idle") ?? operatorTexture;
      this.avatar = new Sprite(characterTexture);
      this.avatar.anchor.set(0.5, 1);
      this.avatar.label = "trailblazer-operator";
      this.avatarCrossfade = new Sprite(characterTexture);
      this.avatarCrossfade.anchor.set(0.5, 1);
      this.avatarCrossfade.visible = false;
      this.layerTraversal.addChild(
        this.avatarShadow,
        this.avatarCrossfade,
        this.avatar,
        this.particles
      );

      // L3 foreground occlusion sprites, placed at the two authored zones
      // from occlusion.json once anchors load. Created lazily below.
      const foregroundTexture = optionalTextures.get("foreground");
      if (foregroundTexture) {
        for (let i = 0; i < 2; i += 1) {
          const occluder = new Sprite(foregroundTexture);
          occluder.anchor.set(0.5, 0.5);
          occluder.visible = false;
          this.foregroundOccluders.push(occluder);
          this.layerForeground.addChild(occluder);
        }
      }

      // L4 effects: the supplied god-ray/mist plate replaces the vector ray
      // when present, kept restrained (single overlay, low alpha).
      const effectsTexture = optionalTextures.get("effects");
      if (effectsTexture) {
        this.effectsSprite = new Sprite(effectsTexture);
        this.effectsSprite.alpha = 0.4;
        this.layerEffects.addChild(this.effectsSprite);
      }

      const portalTexture = optionalTextures.get("portal");
      if (portalTexture) this.poseTextures.set("__portal_texture__", portalTexture);

      this.world.addChild(
        this.layerFar,
        this.layerMid,
        this.layerTraversal,
        this.layerForeground,
        this.layerEffects
      );
      app.stage.addChild(this.world);

      app.ticker.add(ticker => {
        const changedTier = this.qualityMonitor.sample(ticker.deltaMS);
        if (changedTier) {
          this.qualityTier = changedTier;
          this.applyQualityTier();
          this.callbacks.onQualityChange?.(changedTier, this.qualityMonitor.averageFrameMs());
        }
        this.update(ticker.deltaMS / 1000, background);
      });
      document.addEventListener("visibilitychange", this.visibilityHandler);
      window.addEventListener("pagehide", this.pageHideHandler);
      this.renderWorldState();

      const anchorsBasePath = assets.anchorsBasePath ?? "/assets/goldline/corridor_01";
      void loadCorridorAnchors(anchorsBasePath).then(result => {
        this.anchors = result.anchors;
        this.occlusionZones = result.zones;
      });
      void loadGoldRoute(anchorsBasePath).then(points => {
        this.goldRoutePoints = points;
      });

      return true;
    } catch (error) {
      this.callbacks.onError(
        error instanceof Error ? error : new Error("Goldline canvas failed")
      );
      return false;
    }
  }

  setInput(x: number, y: number) {
    this.input = { x, y };
  }

  setWorldState(state: WorldMissionState) {
    const previous = this.worldState;
    this.worldState = state;
    if (state === "recovery_active") this.camera.focusRecoveryPath();
    else this.camera.focusMainGate();
    // REKINDLE: a real, authoritative transition into an active recovery —
    // the world briefly acknowledges it. Never fires from arcade state.
    if (state === "recovery_active" && previous !== "recovery_active") {
      this.camera.impulse(-8);
    }
    this.renderWorldState();
  }

  /**
   * Sets which archetype-specific landmark shape renders at the gate. Null
   * (no legitimate mission approached yet) draws nothing — never a fake
   * destination. See drawLandmark() for the shape/color per archetype.
   */
  setLandmarkArchetype(archetype: LandmarkArchetype | null) {
    this.landmarkArchetype = archetype;
  }

  performAction(action: CorridorAction) {
    const trigger = pendingTrigger(this.progress, this.completedTriggers);
    if (!trigger || trigger.action !== action) return false;
    if (action === "INTERACT") {
      this.avatarState.lockEncounter();
      this.callbacks.onInteract();
      return true;
    }
    this.completedTriggers.add(trigger.id);
    const now = performance.now();
    this.avatarState.beginAction(action, now);
    this.actionUntil = now + this.avatarState.actionDurationMs(action);
    this.progress = Math.min(0.78, trigger.at + 0.075);
    this.spawnTrail(action === "VAULT" ? 0xffc34e : 0x5feaff);
    if (action === "JUMP" || action === "CLIMB" || action === "VAULT") {
      this.callbacks.onTraversalAction?.(action);
    }
    return true;
  }

  private update(deltaSeconds: number, background: Sprite) {
    if (!this.app || !this.avatar || this.hidden) return;
    const width = this.app.screen.width;
    const height = this.app.screen.height;
    this.fitCover(background, width, height);
    if (this.farSprite) this.fitCover(this.farSprite, width, height);
    if (this.effectsSprite) this.fitCover(this.effectsSprite, width, height);
    this.drawWorld(width, height);

    const now = performance.now();
    this.drawLandmark(width, height, now);
    this.avatarState.tick(now);
    if (this.actionUntil && now >= this.actionUntil) {
      this.actionUntil = 0;
      this.avatarState.release();
    }
    const trigger = pendingTrigger(this.progress, this.completedTriggers);
    const blocked = Boolean(trigger && this.progress >= trigger.at - 0.012);
    const magnitude = Math.hypot(this.input.x, this.input.y);
    this.avatarState.setLocomotion(magnitude);
    if (!this.actionUntil && this.avatarState.state !== "encounter_locked") {
      const branchPace = branchPaceFor(this.branch);
      const targetSpeed = targetSpeedForMagnitude(magnitude, branchPace);
      const forward = Math.max(0, -this.input.y);
      const backward = Math.max(0, this.input.y);
      const directional = forward > 0 ? 1 : backward > 0 ? -0.65 : 0;
      const directionSign = Math.sign(directional);
      const isReversing =
        directionSign !== 0 &&
        this.lastDirectionSign !== 0 &&
        directionSign !== this.lastDirectionSign;
      if (directionSign !== 0) this.lastDirectionSign = directionSign;
      this.velocity = stepVelocity({
        currentVelocity: this.velocity,
        targetSpeed,
        deltaSeconds,
        isReversing,
      });

      const next = this.progress + this.velocity * directional * deltaSeconds;
      const ceiling = trigger ? trigger.at : 0.82;
      this.progress = Math.max(0.035, Math.min(blocked ? ceiling : 0.82, next));
      this.lateral = Math.max(
        -0.72,
        Math.min(0.72, this.lateral + this.input.x * 0.72 * deltaSeconds)
      );
    }

    const nextBranch = branchForLateralPosition(this.lateral);
    if (nextBranch !== this.branch) {
      this.branch = nextBranch;
      this.callbacks.onBranchChange(nextBranch);
    }

    // Authored route centerline (traced from mid.webp's painted gold inlay)
    // replaces the constant 0.5 — the player's free joystick deviation is
    // still added on top, exactly as it was against the old fixed center.
    const routeCenter = lateralForProgress(this.goldRoutePoints, this.progress);
    const avatarX = width * (routeCenter + this.lateral * 0.22);
    const groundY = height * (0.88 - this.progress * 0.61);
    const baseHeight = Math.max(134, Math.min(232, height * (0.25 - this.progress * 0.08)));
    const jumpFactor = this.avatarState.jumpHeightFactor(now);
    const jumpLift = jumpFactor * baseHeight * 0.42;

    this.updateAvatarPose(now, magnitude);
    const aspect = this.avatar.texture.width / this.avatar.texture.height;
    this.avatar.height = baseHeight;
    this.avatar.width = Math.abs(baseHeight * aspect);
    const facingLeft = this.input.x < -0.05;
    this.avatar.scale.x = Math.abs(this.avatar.scale.x) * (facingLeft ? -1 : 1);
    this.avatar.x = avatarX;
    this.avatar.y =
      groundY -
      jumpLift +
      (this.avatarState.state === "run" ? Math.sin(now / 72) * 3 : 0);
    this.avatar.rotation = this.input.x * 0.035;
    this.avatar.alpha = this.avatarState.state === "encounter_locked" ? 0.72 : 1;

    this.syncCrossfadeTransform();
    this.drawContactShadow(avatarX, groundY, baseHeight, jumpFactor);
    this.applyOcclusion(avatarX, groundY, width, height);
    this.updateStronghold(width, height);
    this.updatePortals(width, height);
    this.updateCameraLookahead();
    this.updateParallax();

    const current = pendingTrigger(this.progress, this.completedTriggers);
    const action = current && this.progress >= current.at - 0.04 ? current.action : null;
    const label = action ? current!.label : null;
    if (action !== this.availableAction || label !== this.availableLabel) {
      this.availableAction = action;
      this.availableLabel = label;
      this.callbacks.onActionAvailable(action, label);
    }
    const reportedProgress = Math.round(this.progress * 100);
    if (reportedProgress !== this.lastReportedProgress) {
      this.lastReportedProgress = reportedProgress;
      this.callbacks.onProgress(this.progress);
    }
    this.camera.update(deltaSeconds);
  }

  private fitCover(sprite: Sprite, width: number, height: number) {
    const textureRatio = sprite.texture.width / sprite.texture.height;
    const viewRatio = width / height;
    if (viewRatio > textureRatio) {
      sprite.width = width;
      sprite.height = width / textureRatio;
    } else {
      sprite.height = height;
      sprite.width = height * textureRatio;
    }
    sprite.x = (width - sprite.width) / 2;
    sprite.y = (height - sprite.height) / 2;
  }

  /** L0 parallax: the far plate drifts a fraction of lateral/progress motion. */
  private updateParallax() {
    if (!this.farSprite) return;
    const parallaxFactor = 0.1; // within the documented 0.05-0.15 L0 range
    this.farSprite.x = -this.lateral * 60 * parallaxFactor * 10;
  }

  private updateAvatarPose(now: number, magnitude: number) {
    const state = this.avatarState.state;
    // A brief, one-shot camera acknowledgement on takeoff and landing — never
    // a shake loop, decays to zero on its own (see CameraController.impulse).
    if (state !== this.lastAvatarStateForImpulse) {
      if (state === "jump_start") this.camera.impulse(-3);
      if (state === "land") this.camera.impulse(4);
      this.lastAvatarStateForImpulse = state;
    }

    if (this.poseTextures.size === 0 || !this.avatar) return;
    if (state === "run" || state === "walk") {
      this.runFrameTimer += (state === "run" ? 11 : 6) * (magnitude > 0 ? 1 : 0);
    }
    const frame = Math.floor(this.runFrameTimer / 6);
    const key = poseForState(state, frame);
    if (key !== this.currentPoseKey) {
      const texture = this.poseTextures.get(key);
      if (texture) {
        // Run-cycle frame steps (run_01 -> run_02 -> ...) are deliberately
        // NOT crossfaded — that is the animation, and blending consecutive
        // frames would read as motion blur rather than a run. Every other
        // state change (idle<->run, run->jump_start, jump_air->land,
        // climb_a<->climb_b, ...) gets a brief crossfade so it never pops.
        const isRunFrameStep = key.startsWith("run_0") && this.currentPoseKey.startsWith("run_0");
        if (!isRunFrameStep && this.avatarCrossfade) {
          this.avatarCrossfade.texture = this.avatar.texture;
          this.avatarCrossfade.visible = true;
          this.avatarCrossfade.alpha = 1;
          this.crossfadeStartedAt = now;
        }
        this.avatar.texture = texture;
        this.currentPoseKey = key;
      }
    }

    if (this.avatarCrossfade?.visible) {
      const CROSSFADE_MS = 90;
      const elapsed = now - this.crossfadeStartedAt;
      this.avatarCrossfade.alpha = Math.max(0, 1 - elapsed / CROSSFADE_MS);
      if (elapsed >= CROSSFADE_MS) this.avatarCrossfade.visible = false;
    }
  }

  /** Keeps the crossfade ghost sprite pinned to the live avatar's transform. */
  private syncCrossfadeTransform() {
    if (!this.avatar || !this.avatarCrossfade?.visible) return;
    this.avatarCrossfade.x = this.avatar.x;
    this.avatarCrossfade.y = this.avatar.y;
    this.avatarCrossfade.height = Math.abs(this.avatar.height);
    this.avatarCrossfade.width = Math.abs(this.avatar.width);
    this.avatarCrossfade.scale.x = Math.abs(this.avatarCrossfade.scale.x) * Math.sign(this.avatar.scale.x || 1);
    this.avatarCrossfade.rotation = this.avatar.rotation;
  }

  private applyOcclusion(avatarX: number, groundY: number, width: number, height: number) {
    const activeZone = this.occlusionZones.find(zone =>
      pointInZone(zone, this.progress, this.lateral)
    );
    if (!this.avatar) return;
    const fortressIndex = this.layerTraversal.getChildIndex(this.fortress);
    const avatarIndex = this.layerTraversal.getChildIndex(this.avatar);
    if (activeZone && avatarIndex > fortressIndex) {
      this.layerTraversal.setChildIndex(this.avatar, fortressIndex);
      this.layerTraversal.setChildIndex(this.avatarShadow, fortressIndex);
    } else if (!activeZone && avatarIndex < this.layerTraversal.children.length - 1) {
      this.layerTraversal.setChildIndex(this.avatar, this.layerTraversal.children.length - 1);
      this.layerTraversal.setChildIndex(
        this.avatarShadow,
        Math.max(0, this.layerTraversal.children.length - 2)
      );
    }

    // Real L3 foreground occlusion sprites: positioned over each authored
    // zone so the avatar visually passes behind actual foliage/stonework,
    // not just an invisible z-order swap.
    this.occlusionZones.forEach((zone, index) => {
      const sprite = this.foregroundOccluders[index];
      if (!sprite) return;
      const zoneLateralMid = (zone.bounds.lateralMin + zone.bounds.lateralMax) / 2;
      const zoneProgressMid = (zone.bounds.progressMin + zone.bounds.progressMax) / 2;
      const near = Math.abs(this.progress - zoneProgressMid) < 0.09;
      sprite.visible = near;
      if (!near) return;
      sprite.x = width * (0.5 + zoneLateralMid * 0.22);
      sprite.y = height * (0.88 - zoneProgressMid * 0.61) - 40;
      sprite.height = height * 0.34;
      sprite.width = sprite.height * (sprite.texture.width / sprite.texture.height);
      sprite.alpha = 0.94;
    });
  }

  private drawContactShadow(
    avatarX: number,
    groundY: number,
    baseHeight: number,
    jumpFactor: number
  ) {
    this.avatarShadow.clear();
    const width = baseHeight * 0.42 * (1 - jumpFactor * 0.35);
    const alpha = 0.32 * (1 - jumpFactor * 0.55);
    this.avatarShadow
      .ellipse(avatarX, groundY + 2, width, width * 0.28)
      .fill({ color: 0x02060a, alpha });
  }

  private updateStronghold(width: number, height: number) {
    if (!this.strongholdSprite) return;
    const gateX = width * 0.525;
    const gateY = height * 0.19;
    this.strongholdSprite.x = gateX;
    this.strongholdSprite.y = gateY;
    this.strongholdSprite.height = height * 0.24;
    this.strongholdSprite.width =
      this.strongholdSprite.height *
      (this.strongholdSprite.texture.width / this.strongholdSprite.texture.height);
    // Dim toward closed, settle brighter on a verified capture, otherwise
    // the steady baseline — bright tropical direction preserved throughout,
    // never a dark villain-fortress treatment.
    this.strongholdSprite.alpha =
      this.worldState === "closed" ? 0.5 : this.worldState === "captured" ? 1 : 0.92;
  }

  /**
   * Archetype-specific landmark shape, placed beside the gate so it never
   * competes with the Stronghold art. ANCHOR keeps its existing Stronghold
   * treatment untouched (already the biggest/heaviest/purple landmark) — this
   * only draws the three archetypes that previously had no physical world
   * representation at all. Vector-only, deliberately restrained: shape,
   * color, and motion are the read, not a label.
   */
  private drawLandmark(width: number, height: number, now: number) {
    this.landmark.clear();
    if (!this.landmarkArchetype || this.landmarkArchetype === "ANCHOR") return;
    if (this.worldState === "captured" || this.worldState === "closed") return;

    const x = width * 0.2;
    const y = height * 0.14;

    if (this.landmarkArchetype === "GATEKEEPER") {
      // Checkpoint: a barrier bar across a narrow gate — the read is ACCESS,
      // not a villain. No portrayal of a person.
      this.landmark
        .roundRect(x - 34, y - 6, 68, 12, 4)
        .fill({ color: 0x0c1c26, alpha: 0.75 })
        .stroke({ color: 0x78c8ff, width: 2, alpha: 0.85 });
      this.landmark.circle(x - 34, y, 4).fill({ color: 0x78c8ff, alpha: 0.9 });
      this.landmark.circle(x + 34, y, 4).fill({ color: 0x78c8ff, alpha: 0.9 });
      return;
    }

    if (this.landmarkArchetype === "GHOST") {
      // Signal beacon: a slow breathing pulse — reads as "trying to reach
      // someone", never as "they replied".
      const pulse = 0.5 + Math.sin(now / 900) * 0.5;
      const radius = 10 + pulse * 6;
      this.landmark.circle(x, y, radius + 8).fill({ color: 0xa082ff, alpha: 0.06 + pulse * 0.08 });
      this.landmark.circle(x, y, radius).stroke({ color: 0xcbb8ff, width: 2, alpha: 0.4 + pulse * 0.4 });
      this.landmark.circle(x, y, 4).fill({ color: 0xe6dcff, alpha: 0.7 + pulse * 0.3 });
      return;
    }

    if (this.landmarkArchetype === "STALLER") {
      // Frozen mechanism: a clockwork ring that ticks in small discrete
      // steps rather than spinning freely — "delayed", not "broken".
      const tickAngle = Math.floor(now / 700) * (Math.PI / 6);
      this.landmark.circle(x, y, 16).stroke({ color: 0xffc46b, width: 2, alpha: 0.55 });
      for (let i = 0; i < 6; i += 1) {
        const angle = tickAngle + (i * Math.PI) / 3;
        const gx = x + Math.cos(angle) * 16;
        const gy = y + Math.sin(angle) * 16;
        this.landmark.circle(gx, gy, 2).fill({ color: 0xffd68f, alpha: 0.8 });
      }
      this.landmark
        .moveTo(x, y)
        .lineTo(x + Math.cos(tickAngle) * 11, y + Math.sin(tickAngle) * 11)
        .stroke({ color: 0xffe6b8, width: 2, alpha: 0.9 });
    }
  }

  private updatePortals(width: number, height: number) {
    this.portals.removeChildren();
    const portalTexture = this.poseTextures.get("__portal_texture__");
    for (const anchor of this.anchors) {
      const distance = anchorDistance(anchor, this.progress, this.lateral);
      const state: "hidden" | "label" | "engage" =
        distance <= anchor.interactionRadius
          ? "engage"
          : distance <= anchor.labelRadius
            ? "label"
            : "hidden";
      const previous = this.portalProximityState.get(anchor.id);
      if (previous !== state) {
        this.portalProximityState.set(anchor.id, state);
        this.callbacks.onPortalProximity?.(anchor.id, state);
      }
      if (state === "hidden") continue;

      const px = width * (0.5 + anchor.position.lateral * 0.22);
      const py =
        height * (0.88 - anchor.position.progress * 0.61) -
        baseHeightAt(height, anchor.position.progress) * 0.5;
      const dominance = 1 - Math.min(1, distance / anchor.labelRadius);

      if (portalTexture && anchor.type === "comms_portal") {
        const sprite = new Sprite(portalTexture);
        sprite.anchor.set(0.5, 1);
        const targetHeight = height * (0.14 + dominance * 0.1);
        sprite.height = targetHeight;
        sprite.width = targetHeight * (portalTexture.width / portalTexture.height);
        sprite.x = px;
        sprite.y = py + targetHeight * 0.5;
        sprite.alpha = 0.55 + dominance * 0.45;
        this.portals.addChild(sprite);
        continue;
      }

      // Fallback when a portal texture is unavailable, or for non-comms
      // anchors: a restrained glow only — never a drawn card/icon.
      const color = anchor.type === "comms_portal" ? 0x36e8e7 : 0x8b5fe0;
      const portal = new Graphics();
      const radius = 34 + dominance * 22;
      portal.circle(px, py, radius).fill({ color, alpha: 0.05 + dominance * 0.1 });
      portal.circle(px, py, radius * 0.45).fill({ color, alpha: 0.08 + dominance * 0.14 });
      this.portals.addChild(portal);
    }
  }

  private updateCameraLookahead() {
    const upcoming = this.anchors
      .map(anchor => ({ anchor, distance: anchorDistance(anchor, this.progress, this.lateral) }))
      .filter(entry => entry.anchor.position.progress >= this.progress)
      .sort((a, b) => a.distance - b.distance)[0];
    if (!upcoming) {
      this.camera.clearLookahead();
      return;
    }
    const proximity = 1 - Math.min(1, upcoming.distance / 0.3);
    this.camera.setLookahead(upcoming.anchor.position.lateral, proximity);
  }

  private drawWorld(width: number, height: number) {
    this.corridor.clear();
    // Authored route: sampled from the same lateralForProgress the avatar
    // itself walks on, so the drawn line and the character's actual path
    // are the same curve by construction — never two independently-tuned
    // lines that can drift apart. Falls back to the prior generic bezier
    // shape when the route JSON hasn't loaded yet (lateralForProgress
    // returns 0.5 with no authored points).
    const SAMPLES = 24;
    const routeScreenPoint = (t: number) => {
      const p = 0.02 + t * 0.8; // matches the playable progress range
      const lateral = lateralForProgress(this.goldRoutePoints, p);
      return { x: width * lateral, y: height * (0.88 - p * 0.61) };
    };
    const drawRoute = (strokeWidth: number, color: number, alpha: number) => {
      const start = routeScreenPoint(0);
      this.corridor.moveTo(start.x, start.y);
      for (let i = 1; i <= SAMPLES; i += 1) {
        const point = routeScreenPoint(i / SAMPLES);
        this.corridor.lineTo(point.x, point.y);
      }
      this.corridor.stroke({ width: strokeWidth, color, alpha });
    };
    // The main route dims once a recovery branch is the legitimate path —
    // it does not disappear (the account isn't closed), but visual priority
    // shifts to the recovery path drawn below.
    const mainRouteDim =
      this.worldState === "contested" || this.worldState === "recovery_active" ? 0.4 : 1;
    drawRoute(14, 0xf4bd48, 0.15 * mainRouteDim);
    drawRoute(3, 0xffdf77, 0.86 * mainRouteDim);

    this.fortress.clear();
    const gateX = width * 0.37;
    const gateY = height * 0.11;
    const gateW = width * 0.31;
    const gateH = height * 0.19;
    const fortressColor =
      this.worldState === "captured"
        ? 0xd9a936
        : this.worldState === "closed"
          ? 0x34383a
          : this.worldState === "contested" ||
              this.worldState === "recovery_active"
            ? 0xd47a26
            : 0x62438f;
    // When the stronghold art is present, the vector shrinks to a thin
    // state-color accent frame rather than a filled box — the art carries
    // the visual weight, the vector carries the business-truth color.
    if (this.strongholdSprite) {
      this.fortress
        .roundRect(gateX, gateY, gateW, gateH, 8)
        .stroke({ color: fortressColor, width: 3, alpha: 0.8 });
    } else {
      this.fortress
        .roundRect(gateX, gateY, gateW, gateH, 8)
        .fill({ color: 0x0a1119, alpha: 0.72 })
        .stroke({ color: fortressColor, width: 4, alpha: 0.9 });
      this.fortress
        .poly([
          width * 0.525,
          height * 0.145,
          width * 0.59,
          height * 0.2,
          width * 0.525,
          height * 0.255,
          width * 0.46,
          height * 0.2,
        ])
        .fill({ color: fortressColor, alpha: 0.72 })
        .stroke({ color: 0x83eaff, width: 2, alpha: 0.85 });
    }

    this.recoveryPath.clear();
    if (
      this.worldState === "contested" ||
      this.worldState === "recovery_active"
    ) {
      this.recoveryPath
        .moveTo(width * 0.32, height * 0.62)
        .bezierCurveTo(
          width * 0.06,
          height * 0.52,
          width * 0.2,
          height * 0.34,
          width * 0.35,
          height * 0.22
        )
        .stroke({ width: 18, color: 0xffb83e, alpha: 0.14 });
      this.recoveryPath
        .moveTo(width * 0.32, height * 0.62)
        .bezierCurveTo(
          width * 0.06,
          height * 0.52,
          width * 0.2,
          height * 0.34,
          width * 0.35,
          height * 0.22
        )
        .stroke({ width: 3, color: 0xffd875, alpha: 0.95 });
      this.recoveryPath
        .circle(width * 0.32, height * 0.62, 5)
        .fill({ color: 0xffe6a8, alpha: 0.9 });
    }
  }

  /**
   * Reduced tier turns off the ambient effects layer and thins particle
   * trails — cheap wins that don't touch character/world readability, per
   * the Visual Quality Gate (character/contact/scale must stay coherent
   * even when degraded). Never fakes a higher tier than measured.
   */
  private applyQualityTier() {
    if (this.effectsSprite) this.effectsSprite.visible = this.qualityTier === "premium";
  }

  private spawnTrail(color: number) {
    if (!this.avatar) return;
    const particleCount = this.qualityTier === "premium" ? 8 : 3;
    for (let index = 0; index < particleCount; index += 1) {
      const particle = new Graphics()
        .circle(0, 0, 2 + Math.random() * 4)
        .fill({ color, alpha: 0.85 });
      particle.x = this.avatar.x + (Math.random() - 0.5) * 70;
      particle.y = this.avatar.y - Math.random() * 80;
      this.particles.addChild(particle);
      const started = performance.now();
      const animate = () => {
        const elapsed = performance.now() - started;
        particle.y -= 1.5;
        particle.alpha = Math.max(0, 1 - elapsed / 650);
        if (elapsed < 650 && particle.parent) requestAnimationFrame(animate);
        else particle.destroy();
      };
      requestAnimationFrame(animate);
    }
  }

  private renderWorldState() {
    if (!this.app) return;
    if (this.worldState === "recovery_active") this.camera.focusRecoveryPath();
    else this.camera.focusMainGate();
  }

  destroy() {
    document.removeEventListener("visibilitychange", this.visibilityHandler);
    window.removeEventListener("pagehide", this.pageHideHandler);
    this.app?.destroy(true, { children: true });
    this.app = null;
    this.host.replaceChildren();
  }
}

function baseHeightAt(viewportHeight: number, progress: number): number {
  return Math.max(134, Math.min(232, viewportHeight * (0.25 - progress * 0.08)));
}
