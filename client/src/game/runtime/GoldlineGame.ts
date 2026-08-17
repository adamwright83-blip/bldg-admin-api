import {
  Application,
  Assets,
  Container,
  Graphics,
  Sprite,
  Texture,
} from "pixi.js";
import { AvatarStateMachine } from "../avatar/AvatarStateMachine";
import { facingForInput, type TrailblazerFacing } from "../avatar/facing";
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
import type { CorridorAction, CorridorBranch } from "../state/GameState";
import type { WorldMissionState } from "../../../../shared/driverGameWorld";
import type { MissionAffordanceProjection } from "../encounters/missionAffordance";
import type { CorridorPopulation } from "../../../../shared/corridorManifest";
import type {
  AgentWorldPresence,
  OrderPropTextures,
  PopulationSystem,
} from "../world/PopulationSystem";
import type {
  AuthoritativeMissionForEmbodiment,
  AuthoritativeOrderForEmbodiment,
} from "../world/populationProjection";
import { isMissionApproachable, isOrderApproachable } from "../world/populationProjection";
import { CameraController } from "./CameraController";
import {
  branchPaceFor,
  stepVelocity,
  targetSpeedForMagnitude,
} from "./movementFeel";
import {
  lateralForProgress,
  loadGoldRoute,
  type GoldRoutePoint,
} from "../world/goldRoute";
import { AdaptiveQualityMonitor, type QualityTier } from "./adaptiveQuality";
import { reportGoldlineLifecycleDelta } from "../testSupport/lifecycleProbe";
import { ExpeditionLayer, type ExpeditionCallbacks } from "../expedition/ExpeditionLayer";
import {
  EXPEDITION_CORRIDOR_END,
  EXPEDITION_START_PROGRESS,
  type PickupExpeditionPlan,
} from "../expedition/expeditionPlan";
import type { ExpeditionSnapshot } from "../expedition/expeditionState";
import {
  clampCorridorProgress,
  forwardProgressLimit,
} from "../expedition/movementLimit";
import {
  DODGE,
  beginDodge,
  createDodgeState,
  dodgeIsInvulnerable,
  stepDodge,
} from "../expedition/actionPad";
import {
  portalPresentationFor,
  portalGlowAlpha,
  corridorGateVisibleDuring,
} from "../expedition/portalPresentation";
import {
  corridorDeltaFromScreenImpulse,
  projectCorridorPoint,
  projectNormalizedCorridorPoint,
  PROGRESS_SPAN_FRACTION,
} from "../expedition/corridorCoupling";
import { TRAVERSAL_Z, worldActorZ } from "../world/worldActorDepth";
import {
  STRONGHOLD_LANTERN_COUNT,
  type StrongholdRestoration,
} from "../expedition/strongholdRestoration";

/**
 * The Stronghold gate's rectangle, as fractions of the viewport.
 *
 * Extracted because the restoration lanterns have to sit on the SAME
 * threshold the gate is drawn on. When the two carried their own literals
 * they disagreed, and the payoff rendered as a bar floating in the sky
 * above the building it was supposed to be mounted on.
 */
const GATE_RECT = {
  left: 0.37,
  right: 0.68,
  topY: 0.11,
  baseY: 0.3,
} as const;

export type LandmarkArchetype = "ANCHOR" | "GATEKEEPER" | "GHOST" | "STALLER";

type GoldlineGameCallbacks = {
  onActionAvailable: (
    action: CorridorAction | null,
    label: string | null
  ) => void;
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
  /** Fires (throttled, ~1/s) only while the avatar is idle/walk/run — a genuinely safe resume point. */
  onCheckpointSafe?: (
    progress: number,
    lateral: number,
    branch: CorridorBranch
  ) => void;
  /** Presentation boundary only; mission truth was already projected by React. */
  onMissionProximity?: (
    missionId: number,
    state: "hidden" | "visible" | "engage"
  ) => void;
  /** Same boundary as onMissionProximity, for a genuine pickup/delivery order. */
  onOrderProximity?: (
    orderKey: string,
    kind: "pickup" | "delivery",
    state: "hidden" | "visible" | "engage"
  ) => void;
  /** Physical corridor exit zone; caller decides if a legitimate destination exists. */
  onCorridorExitProximity?: (near: boolean) => void;
  /**
   * Fires only while a genuine mission/order objective exists and its
   * authored anchor is currently outside the visible viewport — never a
   * fabricated GPS distance, purely "is the real objective's world
   * position on screen right now." `null` when it's onscreen or no
   * objective exists.
   */
  onObjectiveOffscreen?: (direction: "ahead" | null) => void;
  onPopulationReady?: (
    ambientCount: number,
    assetStage: CorridorPopulation["assetStage"]
  ) => void;
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
  /**
   * L0 parallax factor from the corridor manifest. Defaults to corridor_01's
   * long-standing 0.1 so a caller that supplies no manifest is unchanged.
   */
  parallaxFar?: number;
  /**
   * Restores a previously-saved safe checkpoint (see checkpointStorage.ts).
   * Only position/branch are restorable — avatar animation state always
   * starts fresh at "idle" regardless, so a restore can never resume mid-jump.
   */
  initialProgress?: number;
  initialLateral?: number;
  initialBranch?: CorridorBranch;
  population?: CorridorPopulation;
};

export type PreparedCorridorAssets = {
  assets: GameAssets;
  midTexture: Texture;
  optionalTextures: Map<string, Texture | null>;
  anchors: CorridorAnchor[];
  occlusionZones: OcclusionZone[];
  goldRoutePoints: GoldRoutePoint[];
  populationSystem: PopulationSystem;
};

/**
 * Illustrated pickup/delivery marker art. Universal across every corridor
 * (a pickup or a delivery reads the same way regardless of which corridor
 * it's embodied in) so these are fixed paths, not per-corridor manifest
 * entries — the same convention CHARACTER_POSE_FILES already uses for
 * Trailblazer. See client/public/assets/goldline/orders/README.md.
 */
const ORDER_PROP_FILES: Record<keyof OrderPropTextures, string> = {
  pickupIdle: "/assets/goldline/orders/pickup-idle.webp",
  pickupActive: "/assets/goldline/orders/pickup-active.webp",
  deliveryIdle: "/assets/goldline/orders/delivery-idle.webp",
  deliveryActive: "/assets/goldline/orders/delivery-active.webp",
  deliveryBlocked: "/assets/goldline/orders/delivery-blocked.webp",
};
const ORDER_PROP_ENTRIES = Object.entries(ORDER_PROP_FILES) as Array<
  [keyof OrderPropTextures, string]
>;

/**
 * True foreground-occlusion accents (bougainvillea/palm/lantern/awning
 * clusters with genuine transparent gaps — see
 * client/public/assets/goldline/corridor_01/occlusion-accents/README.md).
 * Corridor_01-specific: extracted from art authored against that
 * corridor's exact canal-market composition, so it's gated on
 * anchorsBasePath rather than loaded unconditionally like the universal
 * order-prop/character assets above. Additive to the existing
 * foreground.webp (which keeps covering the full canvas as before) — these
 * are pinned to the top corners, not a replacement.
 */
const FOREGROUND_ACCENT_FILES: Record<string, string> = {
  occlusionLeftFrame:
    "/assets/goldline/corridor_01/occlusion-accents/left-frame.webp",
  occlusionRightFrame:
    "/assets/goldline/corridor_01/occlusion-accents/right-frame.webp",
};
const FOREGROUND_ACCENT_ENTRIES = Object.entries(FOREGROUND_ACCENT_FILES);

function orderPropTexturesFrom(
  optionalTextures: Map<string, Texture | null>
): OrderPropTextures {
  const textures: OrderPropTextures = {};
  for (const [key] of ORDER_PROP_ENTRIES) {
    textures[key] = optionalTextures.get(key) ?? null;
  }
  return textures;
}

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
 * Directional idle/walk variants (see
 * client/public/assets/goldline/characters/trailblazer/directional/README.md
 * for provenance and forensic findings). Genuinely optional — jump/climb/
 * vault/land keep using the single canonical CHARACTER_POSE_FILES frame
 * above regardless of facing, since the source art never claimed directional
 * coverage for those actions and the existing choreography is stronger.
 * Loaded the same way as CHARACTER_POSE_FILES; a missing file degrades to
 * the non-directional base pose (see resolveDirectionalPoseKey).
 */
export const DIRECTIONAL_POSE_FILES: Record<string, string> = {
  "idle-front": "directional/idle-front.webp",
  "idle-back": "directional/idle-back.webp",
  "idle-left": "directional/idle-left.webp",
  "idle-right": "directional/idle-right.webp",
  "walk-front-01": "directional/walk-front-01.webp",
  "walk-front-02": "directional/walk-front-02.webp",
  "walk-front-03": "directional/walk-front-03.webp",
  "walk-front-04": "directional/walk-front-04.webp",
  "walk-front-05": "directional/walk-front-05.webp",
  "walk-back-01": "directional/walk-back-01.webp",
  "walk-back-02": "directional/walk-back-02.webp",
  "walk-back-03": "directional/walk-back-03.webp",
  "walk-back-04": "directional/walk-back-04.webp",
  "walk-back-05": "directional/walk-back-05.webp",
  "walk-left-01": "directional/walk-left-01.webp",
  "walk-left-02": "directional/walk-left-02.webp",
  "walk-left-03": "directional/walk-left-03.webp",
  "walk-left-04": "directional/walk-left-04.webp",
  "walk-left-05": "directional/walk-left-05.webp",
  "walk-right-01": "directional/walk-right-01.webp",
  "walk-right-02": "directional/walk-right-02.webp",
  "walk-right-03": "directional/walk-right-03.webp",
  "walk-right-04": "directional/walk-right-04.webp",
  "walk-right-05": "directional/walk-right-05.webp",
};

/**
 * Resolves the facing-specific texture key for idle/walk/run, falling back
 * to the plain non-directional key when no directional texture was loaded
 * (missing asset, or a test environment with no textures at all) — a load
 * failure can never break movement or leave the avatar untextured.
 */
export function resolveDirectionalPoseKey(
  baseKey: string,
  state: AvatarState,
  facing: TrailblazerFacing,
  runFrame: number,
  poseTextures: ReadonlyMap<string, Texture>
): string {
  if (state !== "idle" && state !== "walk" && state !== "run") return baseKey;
  const dirKey =
    state === "idle"
      ? `idle-${facing}`
      : `walk-${facing}-0${(runFrame % 5) + 1}`;
  return poseTextures.has(dirKey) ? dirKey : baseKey;
}

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
  // Sortable so world actors — Trailblazer, civilians, guardians, props —
  // interleave individually by screen depth rather than by container.
  private layerTraversal = new Container(); // L2 — route, portals, avatar
  private layerForeground = new Container(); // L3 — occlusion
  private layerEffects = new Container(); // L4
  private populationSystem: PopulationSystem | null = null;
  private pendingMissionEmbodiment: AuthoritativeMissionForEmbodiment | null =
    null;
  private pendingOrderEmbodiment: AuthoritativeOrderForEmbodiment | null =
    null;
  private pendingAgentPresence: readonly AgentWorldPresence[] = [];

  private camera = new CameraController(this.world);
  private traversalSortInitialised = false;
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
  /**
   * Six lanterns and the brass Gold-Line conduit along the Stronghold
   * threshold. This is the PERSISTENT physical payoff, and it is drawn
   * purely from a StrongholdRestoration that React projects out of real
   * collected-order evidence. Nothing here is stored, and nothing here is a
   * counter this class increments — which is exactly why a reload
   * reproduces the same lit threshold from the same order truth.
   */
  private strongholdRestoration: StrongholdRestoration | null = null;
  private gRestoration = new Graphics();
  /** Seconds remaining in the ONE confirmation pulse for a real delta. */
  private restorationPulse = 0;
  private effectsSprite: Sprite | null = null;
  private effectsTargetAlpha = 0.4;
  private backgroundSprite: Sprite | null = null;
  private farSprite: Sprite | null = null;
  private foregroundSprite: Sprite | null = null;
  /** Corner-pinned occlusion accents, additive to foregroundSprite above —
   * see FOREGROUND_ACCENT_FILES. */
  private occlusionLeftFrame: Sprite | null = null;
  private occlusionRightFrame: Sprite | null = null;
  private poseTextures = new Map<string, Texture>();
  private currentPoseKey = "idle";
  private lastAvatarStateForImpulse: AvatarState = "idle";
  /** Presentation-only, derived each frame from raw joystick input — see
   * facingForInput. Defaults to "front" to match the existing non-directional
   * idle.webp, which is authored front-facing (the run cycle, by contrast,
   * is authored back-facing — walking away up the path — which is what the
   * player will see as soon as they push the joystick forward). */
  private facing: TrailblazerFacing = "front";
  private usingDirectionalPose = false;
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
  /** Overridden per corridor from the manifest; corridor_01's authored value. */
  private parallaxFar = 0.1;
  private anchors: CorridorAnchor[] = [];
  private goldRoutePoints: GoldRoutePoint[] = [];
  private landmarkArchetype: LandmarkArchetype | null = null;
  private worldSignal: MissionAffordanceProjection["worldSignal"] = "none";
  private landmark = new Graphics();
  private occlusionZones: OcclusionZone[] = [];
  private portalProximityState = new Map<
    string,
    "hidden" | "label" | "engage"
  >();
  private missionProximityState: "hidden" | "visible" | "engage" = "hidden";
  private orderProximityState: "hidden" | "visible" | "engage" = "hidden";
  private objectiveOffscreenState: "ahead" | null = null;
  private corridorExitNear = false;
  /**
   * Fictional expedition layer. Null until a real pickup objective starts
   * an expedition — the corridor is fully playable without it.
   */
  private expedition: ExpeditionLayer | null = null;
  /**
   * The callbacks `startExpedition` was given, kept for verbs that never
   * route through ExpeditionLayer (dodge is decided here, not there) but
   * still need to report a genuine success to the same caller.
   */
  private expeditionCallbacks: ExpeditionCallbacks = {};
  /**
   * True while the tether (or its residual momentum) is driving Trailblazer.
   * Joystick locomotion stands down so the two do not fight for the same
   * corridor position — there is one movement truth, and during a grapple
   * the fiction is contributing to it.
   */
  private expeditionDrivingMovement = false;
  private dodgeState = createDodgeState();
  /** Fictional seconds until the contextual basic lash may fire again. */
  private lashCooldown = 0;
  /**
   * Non-expedition corridor position, saved on entry and restored on exit.
   * Fictional state only — it never touches order state, route timestamps
   * or any business record.
   */
  private preExpeditionCorridor: {
    progress: number;
    lateral: number;
    velocity: number;
    branch: CorridorBranch;
  } | null = null;
  private lastWidth = 0;
  private lastHeight = 0;
  private qualityMonitor = new AdaptiveQualityMonitor();
  private qualityTier: QualityTier = "premium";
  private lastCheckpointReportAt = 0;
  private hidden = false;
  private reducedMotion = false;
  private tickerProbeActive = false;
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
      if (assets.initialProgress != null) {
        this.progress = Math.min(0.78, Math.max(0.02, assets.initialProgress));
      }
      if (assets.initialLateral != null) {
        this.lateral = Math.min(0.72, Math.max(-0.72, assets.initialLateral));
      }
      if (assets.initialBranch != null) this.branch = assets.initialBranch;
      if (assets.parallaxFar != null) this.parallaxFar = assets.parallaxFar;
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
      app.canvas.setAttribute(
        "aria-label",
        "Playable Goldline jungle corridor"
      );
      this.host.appendChild(app.canvas);

      const characterBase =
        assets.characterBasePath ?? "/assets/goldline/characters/trailblazer";
      const optionalLoads: Array<[string, string]> = [
        ...(assets.farUrl ? [["far", assets.farUrl] as [string, string]] : []),
        ...(assets.foregroundUrl
          ? [["foreground", assets.foregroundUrl] as [string, string]]
          : []),
        ...(assets.effectsUrl
          ? [["effects", assets.effectsUrl] as [string, string]]
          : []),
        ...(assets.portalUrl
          ? [["portal", assets.portalUrl] as [string, string]]
          : []),
        ...(assets.strongholdUrl
          ? [["stronghold", assets.strongholdUrl] as [string, string]]
          : []),
        ...(assets.population?.atlas
          ? [["populationAtlas", assets.population.atlas] as [string, string]]
          : []),
        ...ORDER_PROP_ENTRIES,
        ...((assets.anchorsBasePath ?? "/assets/goldline/corridor_01").includes(
          "corridor_01"
        )
          ? FOREGROUND_ACCENT_ENTRIES
          : []),
      ];
      const poseEntries = Object.entries(CHARACTER_POSE_FILES);
      const directionalPoseEntries = Object.entries(DIRECTIONAL_POSE_FILES);

      const [worldTexture, operatorTexture, midTexture, ...rest] =
        await Promise.all([
          Assets.load<Texture>(assets.worldUrl),
          Assets.load<Texture>(assets.operatorUrl),
          assets.midUrl
            ? Assets.load<Texture>(assets.midUrl).catch(() => null)
            : Promise.resolve(null),
          ...optionalLoads.map(([, url]) =>
            Assets.load<Texture>(url).catch(() => null)
          ),
          ...poseEntries.map(([, file]) =>
            Assets.load<Texture>(`${characterBase}/${file}`).catch(() => null)
          ),
          ...directionalPoseEntries.map(([, file]) =>
            Assets.load<Texture>(`${characterBase}/${file}`).catch(() => null)
          ),
        ]);

      const optionalTextures = new Map<string, Texture | null>();
      optionalLoads.forEach(([key], index) =>
        optionalTextures.set(key, rest[index] as Texture | null)
      );
      poseEntries.forEach(([key], index) => {
        const texture = rest[optionalLoads.length + index] as Texture | null;
        if (texture) this.poseTextures.set(key, texture);
      });
      directionalPoseEntries.forEach(([key], index) => {
        const texture = rest[
          optionalLoads.length + poseEntries.length + index
        ] as Texture | null;
        if (texture) this.poseTextures.set(key, texture);
      });

      // L1 mid: prefer the richer corridor_01 mid plate; fall back to the
      // original Run-1 background if it failed to load or was not supplied.
      const background = new Sprite(midTexture ?? worldTexture);
      this.backgroundSprite = background;
      background.label = midTexture ? "corridor-mid" : "approved-world-art";
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
        this.layerTraversal.addChildAt(
          this.strongholdSprite,
          this.layerTraversal.getChildIndex(this.fortress)
        );
      }
      // Restoration light reads ON the gate, so it sits in the Stronghold
      // band directly above the sprite and below every world actor.
      this.gRestoration.label = "stronghold-restoration";
      // Above the gate's own vector frame so the lit threshold is not cut by
      // it, but still far below WORLD_ACTOR_BASE — Trailblazer and the crowd
      // walk in front of the Stronghold, as they must.
      this.gRestoration.zIndex = TRAVERSAL_Z.FORTRESS + 1;
      this.layerTraversal.addChild(this.gRestoration);

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

      // L3 foreground occlusion plate. It stays registered to L1 at full
      // scene scale so its authored alpha silhouettes provide the actual
      // columns/foliage/railings the player passes behind. occlusion.json
      // separately controls avatar/fortress traversal z-order at those places.
      const foregroundTexture = optionalTextures.get("foreground");
      if (foregroundTexture) {
        this.foregroundSprite = new Sprite(foregroundTexture);
        this.foregroundSprite.alpha = 0.94;
        this.layerForeground.addChild(this.foregroundSprite);
      }

      // Corner occlusion accents (bougainvillea/palm/lantern clusters, real
      // transparent gaps) — additive to foregroundSprite above, pinned to
      // the top corners rather than stretched over the full canvas. See
      // FOREGROUND_ACCENT_FILES.
      const leftFrameTexture = optionalTextures.get("occlusionLeftFrame");
      if (leftFrameTexture) {
        this.occlusionLeftFrame = new Sprite(leftFrameTexture);
        this.occlusionLeftFrame.anchor.set(0, 0);
        this.layerForeground.addChild(this.occlusionLeftFrame);
      }
      const rightFrameTexture = optionalTextures.get("occlusionRightFrame");
      if (rightFrameTexture) {
        this.occlusionRightFrame = new Sprite(rightFrameTexture);
        this.occlusionRightFrame.anchor.set(1, 0);
        this.layerForeground.addChild(this.occlusionRightFrame);
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
      if (portalTexture)
        this.poseTextures.set("__portal_texture__", portalTexture);

      this.world.addChild(
        this.layerFar,
        this.layerMid,
        this.layerTraversal,
        this.layerForeground,
        this.layerEffects
      );
      // Population JS is a gameplay-runtime chunk, not part of the initial
      // route shell. It loads with the active corridor only; future corridors
      // are not warmed at boot.
      const { PopulationSystem: PopulationRuntime } = await import(
        "../world/PopulationSystem"
      );
      this.populationSystem = new PopulationRuntime(
        assets.population ?? {
          assetStage: "engineering_placeholder",
          atlas: null,
          ambient: [],
          missionAnchorPoints: [],
        },
        optionalTextures.get("populationAtlas") ?? null,
        orderPropTexturesFrom(optionalTextures)
      );
      this.populationSystem.setMission(this.pendingMissionEmbodiment);
      this.populationSystem.setOrder(this.pendingOrderEmbodiment);
      this.populationSystem.setAgentPresence(this.pendingAgentPresence);
      this.callbacks.onPopulationReady?.(
        this.populationSystem.authoredAmbientCount,
        this.populationSystem.assetStage
      );
      // Humans share L2 with the Trailblazer and architecture. The population
      // system itself is a compact Pixi container updated by this ticker — no
      // per-frame React state and no second animation loop.
      this.layerTraversal.addChildAt(
        this.populationSystem.container,
        Math.max(0, this.layerTraversal.getChildIndex(this.avatarShadow))
      );
      app.stage.addChild(this.world);

      app.ticker.add(ticker => {
        const changedTier = this.qualityMonitor.sample(ticker.deltaMS);
        if (changedTier) {
          this.qualityTier = changedTier;
          this.applyQualityTier();
          this.callbacks.onQualityChange?.(
            changedTier,
            this.qualityMonitor.averageFrameMs()
          );
        }
        this.update(ticker.deltaMS / 1000, background);
      });
      this.tickerProbeActive = true;
      reportGoldlineLifecycleDelta("pixiTicker", 1);
      document.addEventListener("visibilitychange", this.visibilityHandler);
      window.addEventListener("pagehide", this.pageHideHandler);
      this.renderWorldState();

      const anchorsBasePath =
        assets.anchorsBasePath ?? "/assets/goldline/corridor_01";
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
    if (state === "recovery_active" || state === "recovery_available")
      this.camera.focusRecoveryPath();
    else this.camera.focusMainGate();
    // REKINDLE: a real, authoritative transition into an active recovery —
    // the world briefly acknowledges it. Never fires from arcade state.
    if (state === "recovery_active" && previous !== "recovery_active") {
      this.camera.impulse(-8);
    }
    if (
      state !== previous &&
      ["captured", "contested", "closed", "recovery_active"].includes(state)
    ) {
      // Called only from authoritative mission projection. Animation reacts
      // to truth; it can never create the outcome it acknowledges.
      this.avatarState.acknowledgeAuthoritativeOutcome(performance.now());
    }
    this.renderWorldState();
  }

  /**
   * Projects the current authoritative affordance into the route itself.
   * This is presentation-only: it never changes mission or business state.
   */
  setWorldSignal(signal: MissionAffordanceProjection["worldSignal"]) {
    this.worldSignal = signal;
  }

  /**
   * Sets which archetype-specific landmark shape renders at the gate. Null
   * (no legitimate mission approached yet) draws nothing — never a fake
   * destination. See drawLandmark() for the shape/color per archetype.
   */
  setLandmarkArchetype(archetype: LandmarkArchetype | null) {
    this.landmarkArchetype = archetype;
  }

  setMissionEmbodiment(mission: AuthoritativeMissionForEmbodiment | null) {
    this.pendingMissionEmbodiment = mission;
    this.populationSystem?.setMission(mission);
    // Re-evaluate proximity on the next frame whenever the authoritative
    // embodiment changes. A new corridor can bind the same mission id to a
    // different authored anchor; retaining the prior corridor's `engage`
    // state would suppress the new transition callback and leave stale UI.
    this.missionProximityState = "hidden";
    this.objectiveOffscreenState = null;
  }

  /** Same contract as setMissionEmbodiment, for a genuine pickup/delivery order. */
  setOrderEmbodiment(order: AuthoritativeOrderForEmbodiment | null) {
    this.pendingOrderEmbodiment = order;
    this.populationSystem?.setOrder(order);
    this.orderProximityState = "hidden";
    this.objectiveOffscreenState = null;
  }

  setAgentPresence(presence: readonly AgentWorldPresence[]) {
    this.pendingAgentPresence = [...presence];
    this.populationSystem?.setAgentPresence(presence);
  }

  getPopulationDiagnostics() {
    return {
      assetStage: this.populationSystem?.assetStage ?? null,
      visibleAmbient: this.populationSystem?.visibleAmbientCount ?? 0,
      missionId: this.populationSystem?.missionEmbodiment?.missionId ?? null,
    };
  }

  /**
   * Physical encounter staging: the player does NOT leave the world to open an
   * encounter. The camera lifts and biases toward the landmark being engaged
   * so both it and Trailblazer stay visible above the encounter rail, and the
   * renderer keeps running the whole time.
   *
   * Frames the nearest authored anchor when there is one, so the framing is
   * driven by real corridor data rather than a guessed screen position.
   */
  stageEncounter() {
    const missionAnchor = this.populationSystem?.missionEmbodiment?.anchor;
    if (missionAnchor) {
      this.camera.stageEncounter(missionAnchor.cameraBias);
      return;
    }
    const nearest = this.anchors.reduce<CorridorAnchor | null>(
      (closest, anchor) => {
        if (!closest) return anchor;
        return anchorDistance(anchor, this.progress, this.lateral) <
          anchorDistance(closest, this.progress, this.lateral)
          ? anchor
          : closest;
      },
      null
    );
    this.camera.stageEncounter(nearest?.position.lateral ?? this.lateral);
  }

  /** Returns the camera to ordinary traversal framing. */
  exitEncounterStaging() {
    this.camera.clearEncounterStaging();
    if (this.avatarState.state === "encounter_locked") {
      this.avatarState.release();
    }
  }

  /** True while the world is held in an encounter frame. */
  isStagingEncounter(): boolean {
    return this.camera.isStagingEncounter();
  }

  /** Mirrors the player's OS reduced-motion preference into camera behaviour. */

  /**
   * Begins the fictional expedition for a real pickup objective. The plan
   * carries the order id as IDENTITY only — nothing in the expedition layer
   * can read or mutate business state, and the corridor remains fully
   * playable if this is never called (see §46's operational fallback).
   */
  /**
   * Forces the base objective proximity/action signals to "hidden" the
   * instant an expedition starts. Without this, React could retain a stale
   * missionSpatialState/orderSpatialState of "engage" from just before
   * entry — the expedition-aware proximity code (see the mission/order
   * nulling in update()) stops COMPUTING new values, but never emitted a
   * final "hidden" for whatever was already showing "engage".
   */
  private suspendBaseObjectiveSignalsForExpedition() {
    const mission = this.populationSystem?.missionEmbodiment ?? null;
    if (mission && this.missionProximityState !== "hidden") {
      this.callbacks.onMissionProximity?.(mission.missionId, "hidden");
    }
    const order = this.populationSystem?.orderEmbodiment ?? null;
    if (order && this.orderProximityState !== "hidden") {
      this.callbacks.onOrderProximity?.(order.orderKey, order.kind, "hidden");
    }
    if (this.objectiveOffscreenState !== null) {
      this.callbacks.onObjectiveOffscreen?.(null);
    }
    this.missionProximityState = "hidden";
    this.orderProximityState = "hidden";
    this.objectiveOffscreenState = null;
    this.availableAction = null;
    this.availableLabel = null;
    this.callbacks.onActionAvailable(null, null);
  }

  startExpedition(plan: PickupExpeditionPlan, callbacks: ExpeditionCallbacks = {}) {
    this.endExpedition();
    this.expeditionCallbacks = callbacks;
    this.suspendBaseObjectiveSignalsForExpedition();

    // Entering must not inherit whatever corridor position the player
    // happened to be at. The authored plan assumes an expedition beginning
    // at its threshold, so inheriting progress 0.78 put every guardian,
    // fork and destination in the wrong place and rendered Trailblazer at
    // the wrong scale. Snapshot, then place her at the threshold.
    this.preExpeditionCorridor = {
      progress: this.progress,
      lateral: this.lateral,
      velocity: this.velocity,
      branch: this.branch,
    };
    this.progress = EXPEDITION_START_PROGRESS;
    this.lateral = 0;
    this.velocity = 0;
    this.dodgeState = createDodgeState();
    this.lashCooldown = 0;
    this.expeditionDrivingMovement = false;
    // Neutral base branch while the expedition owns route semantics —
    // ordinary branchForLateralPosition must not run during an expedition
    // (see the locomotion block below), so this is a presentation default,
    // not a live selection.
    this.branch = "intel";
    this.callbacks.onBranchChange(this.branch);
    // Duplicate presentation only; the authoritative mission/order objects
    // remain intact underneath.
    this.populationSystem?.setExpeditionPresentation(true);
    const layer = new ExpeditionLayer({
      ...callbacks,
      // Hit-stop freezes the FICTIONAL clock only — business time is
      // structurally unreachable from here (see expeditionClock.ts).
      onHitStop: ms => {
        this.expedition?.clock.hitStop(ms);
        callbacks.onHitStop?.(ms);
      },
      // Reuses the existing camera rather than adding a second one.
      onCameraShake: (magnitude, dirX, dirY) => {
        this.camera.impulse(Math.min(1.6, magnitude));
        const horizontal = Math.abs(dirX) > Math.abs(dirY);
        if (horizontal) this.camera.setLookahead(Math.sign(dirX), 0.5);
        callbacks.onCameraShake?.(magnitude, dirX, dirY);
      },
      // §PR77 no-dead-press: every tap gets a visible Trailblazer reaction,
      // whether or not it connected with a hostile.
      onStrikeAttempt: () => {
        this.avatarState.noteReversal();
        callbacks.onStrikeAttempt?.();
      },
    });
    layer.setReducedMotion(this.reducedMotion);
    // Guardians and props join the SHARED world-actor space so they sort
    // against civilians and Trailblazer individually.
    layer.setActorHost(this.layerTraversal);
    layer.load(plan);
    // Art loads asynchronously; the procedural fallback renders until it
    // arrives, so entry is never blocked on a texture fetch.
    void layer.loadArt();
    // Sits in the traversal layer so the painted foreground occludes
    // guardians exactly as it occludes Trailblazer.
    this.layerTraversal.addChild(layer.container);
    this.expedition = layer;
  }

  /** Voluntary exit: restores exactly where the player left off. */
  endExpedition() {
    if (!this.expedition) return;
    this.teardownExpedition();

    const saved = this.preExpeditionCorridor;
    this.preExpeditionCorridor = null;
    if (saved) {
      this.progress = saved.progress;
      this.lateral = saved.lateral;
      this.velocity = saved.velocity;
      this.branch = saved.branch;
      this.callbacks.onBranchChange(this.branch);
    }
  }

  /**
   * Successful completion. Unlike endExpedition, this does NOT restore the
   * pre-expedition corridor position — resuming at some earlier random spot
   * after finishing the pickup would be incoherent. Places Trailblazer at
   * the Stronghold/expedition threshold instead. Authoritative business
   * state is untouched either way.
   */
  finishExpeditionAtStronghold() {
    if (!this.expedition) return;
    this.teardownExpedition();
    this.preExpeditionCorridor = null;

    this.progress = EXPEDITION_START_PROGRESS;
    this.lateral = 0;
    this.velocity = 0;
    this.branch = "intel";
    this.callbacks.onBranchChange(this.branch);
  }

  private teardownExpedition() {
    if (!this.expedition) return;
    this.layerTraversal.removeChild(this.expedition.container);
    this.expedition.destroy();
    this.expedition = null;
    this.expeditionCallbacks = {};
    this.expeditionDrivingMovement = false;
    this.populationSystem?.setExpeditionPresentation(false);
  }

  /** True while an expedition owns the corridor. */
  isExpeditionActive(): boolean {
    return this.expedition !== null;
  }

  getExpedition(): ExpeditionLayer | null {
    return this.expedition;
  }

  /**
   * Development-only scene-graph probe.
   *
   * Reports every visible display object whose global bounds intersect a
   * screen rectangle, so an unidentified on-canvas object can be traced to
   * its owner in one pass instead of guessed at. Two hypotheses for the
   * purple card (the comms_portal sprite, then the Stronghold gate sprite)
   * were each disproven only after being implemented, which is exactly the
   * cost this avoids.
   *
   * Gated behind the test-harness flag so it carries no production cost.
   */
  probeSceneRegion(rect: { x: number; y: number; width: number; height: number }) {
    if (import.meta.env.VITE_GOLDLINE_TEST_HARNESS !== "1") return [];
    const hits: Array<Record<string, unknown>> = [];
    const named = new Map<unknown, string>([
      [this.world, "world"],
      [this.layerFar, "layerFar"],
      [this.layerMid, "layerMid"],
      [this.layerTraversal, "layerTraversal"],
      [this.layerForeground, "layerForeground"],
      [this.layerEffects, "layerEffects"],
      [this.portals, "portals"],
      [this.landmark, "landmark"],
      [this.corridor, "corridor"],
      [this.fortress, "fortress"],
      [this.recoveryPath, "recoveryPath"],
      [this.particles, "particles"],
      [this.avatar, "avatar"],
      [this.strongholdSprite, "strongholdSprite"],
      [this.effectsSprite, "effectsSprite"],
      [this.backgroundSprite, "backgroundSprite"],
      [this.farSprite, "farSprite"],
      [this.foregroundSprite, "foregroundSprite"],
    ]);

    const walk = (node: Container, path: string, depth: number) => {
      if (depth > 8 || !node.visible || node.alpha <= 0.01) return;
      let bounds: { x: number; y: number; width: number; height: number };
      try {
        bounds = node.getBounds();
      } catch {
        return;
      }
      const overlaps =
        bounds.x < rect.x + rect.width &&
        bounds.x + bounds.width > rect.x &&
        bounds.y < rect.y + rect.height &&
        bounds.y + bounds.height > rect.y;
      const label = named.get(node) ?? node.label ?? node.constructor?.name ?? "?";
      const here = `${path}/${label}`;
      const children = (node.children ?? []) as Container[];
      if (overlaps && children.length === 0) {
        hits.push({
          path: here,
          type: node.constructor?.name,
          alpha: Number(node.alpha.toFixed(3)),
          renderable: node.renderable,
          bounds: {
            x: Math.round(bounds.x),
            y: Math.round(bounds.y),
            w: Math.round(bounds.width),
            h: Math.round(bounds.height),
          },
        });
      }
      for (const child of children) walk(child, here, depth + 1);
    };

    if (this.app) walk(this.app.stage as Container, "", 0);
    return hits;
  }

  /** Dev-only: toggle a probed node by its reported path. */
  setSceneNodeRenderable(path: string, renderable: boolean): boolean {
    if (import.meta.env.VITE_GOLDLINE_TEST_HARNESS !== "1") return false;
    let found = false;
    const walk = (node: Container, current: string, depth: number) => {
      if (depth > 8) return;
      const label = node.label ?? node.constructor?.name ?? "?";
      const here = `${current}/${label}`;
      if (here === path) {
        node.renderable = renderable;
        found = true;
      }
      for (const child of (node.children ?? []) as Container[]) {
        walk(child, here, depth + 1);
      }
    };
    if (this.app) walk(this.app.stage as Container, "", 0);
    return found;
  }

  /**
   * Projector for actors in normalised runtime lateral — Trailblazer and
   * every PopulationSystem actor. Same formula as the plan-unit projector.
   */
  private projectNormalizedCorridor(
    progress: number,
    lateral: number,
    width: number,
    height: number
  ) {
    return projectNormalizedCorridorPoint({
      progress,
      lateral,
      routeCenter: lateralForProgress(this.goldRoutePoints, progress),
      width,
      height,
    });
  }

  /** Screen projection for one corridor position, mirroring the avatar. */
  private projectCorridor(progress: number, lateral: number, width: number, height: number) {
    return projectCorridorPoint({
      progress,
      lateral,
      routeCenter: lateralForProgress(this.goldRoutePoints, progress),
      width,
      height,
    });
  }

  /** True only while the expedition is actively playable. */
  private expeditionCanAct(): boolean {
    if (!this.expedition) return false;
    return this.expedition.getSnapshot().outcome === "running";
  }

  /** Action pad: hold crossed the threshold — enter Line aim. */
  expeditionBeginAim(radians: number) {
    if (!this.expeditionCanAct()) return;
    this.expedition!.beginAim();
    this.expedition!.setAimRadians(radians);
  }

  expeditionUpdateAim(radians: number) {
    if (!this.expeditionCanAct()) return;
    this.expedition!.setAimRadians(radians);
  }

  expeditionCancelAim() {
    this.expedition?.endAim();
  }

  /**
   * Action pad release with a lock. Returns false if nothing was hit — e.g.
   * the locked hostile died or left range in the frame between lock and
   * release. `ExpeditionLayer.fireLine` ends aim unconditionally on both
   * the hit and miss paths, so a miss here still visibly and mechanically
   * returns to normal (§PR77 no dead press).
   */
  expeditionFire(): boolean {
    if (!this.expeditionCanAct()) return false;
    return this.expedition!.fireLine((progress, lateral) =>
      this.projectCorridor(progress, lateral, this.lastWidth, this.lastHeight)
    );
  }

  expeditionLockedTargetId(): string | null {
    return this.expedition?.getLockedTargetId() ?? null;
  }

  /** Action pad flick. Burst along the flick/movement direction, else current facing. */
  expeditionDodge(): boolean {
    if (!this.expeditionCanAct()) return false;
    const facingX = this.input.x !== 0 ? this.input.x : this.lastDirectionSign || 0;
    const facingY = this.input.y !== 0 ? this.input.y : -1;
    const began = beginDodge(this.dodgeState, this.input, facingX, facingY);
    // §PR77 Part 4 "first evade" — reported only when the dodge genuinely
    // started, not when a flick was declined for being on cooldown. Dodge
    // never routes through ExpeditionLayer, so this is reported directly
    // from the callbacks startExpedition was given.
    if (began) this.expeditionCallbacks.onDodgeBegan?.();
    return began;
  }

  /**
   * Action pad tap — the player's deliberate, primary offensive verb
   * (§PR77 Part 1). Returns true whenever the tap was acknowledged by live
   * gameplay, even if nothing was in range to hit: `ExpeditionLayer.tryStrike`
   * always fires `onStrikeAttempt` for a visible whiff, so a `false` here
   * means only "gameplay wasn't active to receive the tap at all," not
   * "nothing happened."
   */
  expeditionStrike(): boolean {
    if (!this.expeditionCanAct()) return false;
    this.expedition!.tryStrike(this.progress, this.lateral * 140);
    return true;
  }

  isDodging(): boolean {
    return this.dodgeState.active;
  }

  getExpeditionSnapshot(): ExpeditionSnapshot | null {
    return this.expedition?.getSnapshot() ?? null;
  }

  /** §33 Redeploy — returns to the last Waystone. No business mutation. */
  expeditionRedeploy(): boolean {
    if (!this.expedition) return false;
    if (this.expedition.getSnapshot().outcome !== "down") return false;
    const restored = this.expedition.redeploy();
    this.progress = restored;
    this.lateral = 0;
    this.velocity = 0;
    this.dodgeState = createDodgeState();
    this.expeditionDrivingMovement = false;
    return true;
  }

  /** §34 Press On — Scarred Route. Never moves the player. */
  expeditionPressOn(): boolean {
    if (!this.expedition) return false;
    if (this.expedition.getSnapshot().outcome !== "down") return false;
    const progressBefore = this.progress;
    this.expedition.pressOn();
    this.velocity = 0;
    this.dodgeState = createDodgeState();
    this.expeditionDrivingMovement = false;
    this.branch = "intel";
    this.callbacks.onBranchChange(this.branch);
    if (this.progress !== progressBefore) {
      // Structural guarantee, not a soft warning: Press On is defined by
      // "no teleport". If something upstream ever mutated progress here,
      // that contract is broken and must fail loudly rather than silently
      // relocate the player.
      throw new Error("PRESS ON must never move the player");
    }
    return true;
  }

  /**
   * The forward limit for Trailblazer this frame.
   *
   * During an expedition the ceiling is the expedition's own end, which sits
   * below the ordinary corridor-exit threshold by design. Without this the
   * player could walk past the exit trigger inside an expedition — the
   * authored beats stopping short of it was a coincidence of authoring, not
   * a guarantee. All three movement paths (joystick, dodge, tether impulse)
   * share this single ceiling.
   */
  private forwardCeiling(): number {
    if (!this.expedition) return 0.82;
    const outcome = this.expedition.getSnapshot().outcome;
    if (outcome !== "running") return this.progress;
    return this.expedition.getGameplayForwardCeiling(EXPEDITION_CORRIDOR_END);
  }

  setReducedMotion(reduced: boolean) {
    this.reducedMotion = reduced;
    this.camera.setReducedMotion(reduced);
    this.populationSystem?.setReducedMotion(reduced);
    this.expedition?.setReducedMotion(reduced);
  }

  /**
   * Loads every destination resource while the current corridor remains fully
   * rendered. The returned bundle is inert until `revealCorridor` applies it,
   * so a failed or superseded load cannot partially replace the live world.
   */
  async preloadCorridor(
    assets: GameAssets,
    signal: AbortSignal
  ): Promise<PreparedCorridorAssets> {
    const anchorsBasePath =
      assets.anchorsBasePath ?? "/assets/goldline/corridor_01";
    const optionalLoads: Array<[string, string]> = [
      ...(assets.farUrl ? [["far", assets.farUrl] as [string, string]] : []),
      ...(assets.foregroundUrl
        ? [["foreground", assets.foregroundUrl] as [string, string]]
        : []),
      ...(assets.effectsUrl
        ? [["effects", assets.effectsUrl] as [string, string]]
        : []),
      ...(assets.portalUrl
        ? [["portal", assets.portalUrl] as [string, string]]
        : []),
      ...(assets.strongholdUrl
        ? [["stronghold", assets.strongholdUrl] as [string, string]]
        : []),
      ...(assets.population?.atlas
        ? [["populationAtlas", assets.population.atlas] as [string, string]]
        : []),
      ...ORDER_PROP_ENTRIES,
      ...(anchorsBasePath.includes("corridor_01")
        ? FOREGROUND_ACCENT_ENTRIES
        : []),
    ];
    const [midTexture, optionalResults, authored, goldRoutePoints] =
      await Promise.all([
        // MID is a playable corridor's only critical visual plate. Refuse the
        // transition if it cannot load rather than revealing fallback art.
        Assets.load<Texture>(assets.midUrl ?? assets.worldUrl),
        Promise.all(
          optionalLoads.map(([, url]) =>
            Assets.load<Texture>(url).catch(() => null)
          )
        ),
        loadCorridorAnchors(anchorsBasePath),
        loadGoldRoute(anchorsBasePath),
      ]);
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const optionalTextures = new Map<string, Texture | null>();
    optionalLoads.forEach(([key], index) => {
      optionalTextures.set(key, optionalResults[index] ?? null);
    });
    const { PopulationSystem: PopulationRuntime } = await import(
      "../world/PopulationSystem"
    );
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const populationSystem = new PopulationRuntime(
      assets.population ?? {
        assetStage: "engineering_placeholder",
        atlas: null,
        ambient: [],
        missionAnchorPoints: [],
      },
      optionalTextures.get("populationAtlas") ?? null,
      orderPropTexturesFrom(optionalTextures)
    );
    populationSystem.setMission(this.pendingMissionEmbodiment);
    populationSystem.setOrder(this.pendingOrderEmbodiment);
    populationSystem.setAgentPresence(this.pendingAgentPresence);
    populationSystem.setReducedMotion(this.reducedMotion);
    return {
      assets,
      midTexture,
      optionalTextures,
      anchors: authored.anchors,
      occlusionZones: authored.zones,
      goldRoutePoints,
      populationSystem,
    };
  }

  discardPreparedCorridor(prepared: PreparedCorridorAssets): void {
    if (prepared.populationSystem !== this.populationSystem) {
      prepared.populationSystem.destroy();
    }
  }

  /** Atomically reveals a fully-preloaded corridor on the existing canvas. */
  revealCorridor(prepared: PreparedCorridorAssets): void {
    if (!this.app || !this.backgroundSprite || !this.avatar) {
      throw new Error("Goldline runtime is not ready for corridor reveal");
    }
    const { assets, optionalTextures, populationSystem } = prepared;

    this.backgroundSprite.texture = prepared.midTexture;
    this.backgroundSprite.label = "corridor-mid";

    this.farSprite?.destroy();
    this.farSprite = null;
    const farTexture = optionalTextures.get("far");
    if (farTexture) {
      this.farSprite = new Sprite(farTexture);
      this.farSprite.alpha = 0.9;
      this.layerFar.addChild(this.farSprite);
    }

    this.foregroundSprite?.destroy();
    this.foregroundSprite = null;
    const foregroundTexture = optionalTextures.get("foreground");
    if (foregroundTexture) {
      this.foregroundSprite = new Sprite(foregroundTexture);
      this.foregroundSprite.alpha = 0.94;
      this.layerForeground.addChild(this.foregroundSprite);
    }

    this.occlusionLeftFrame?.destroy();
    this.occlusionLeftFrame = null;
    const leftFrameTexture = optionalTextures.get("occlusionLeftFrame");
    if (leftFrameTexture) {
      this.occlusionLeftFrame = new Sprite(leftFrameTexture);
      this.occlusionLeftFrame.anchor.set(0, 0);
      this.layerForeground.addChild(this.occlusionLeftFrame);
    }
    this.occlusionRightFrame?.destroy();
    this.occlusionRightFrame = null;
    const rightFrameTexture = optionalTextures.get("occlusionRightFrame");
    if (rightFrameTexture) {
      this.occlusionRightFrame = new Sprite(rightFrameTexture);
      this.occlusionRightFrame.anchor.set(1, 0);
      this.layerForeground.addChild(this.occlusionRightFrame);
    }

    this.effectsSprite?.destroy();
    this.effectsSprite = null;
    const effectsTexture = optionalTextures.get("effects");
    if (effectsTexture) {
      this.effectsSprite = new Sprite(effectsTexture);
      this.effectsSprite.alpha = this.effectsTargetAlpha;
      this.layerEffects.addChild(this.effectsSprite);
    }

    this.strongholdSprite?.destroy();
    this.strongholdSprite = null;
    const strongholdTexture = optionalTextures.get("stronghold");
    if (strongholdTexture) {
      this.strongholdSprite = new Sprite(strongholdTexture);
      this.strongholdSprite.anchor.set(0.5, 1);
      this.layerTraversal.addChildAt(
        this.strongholdSprite,
        this.layerTraversal.getChildIndex(this.fortress)
      );
    }
    this.poseTextures.delete("__portal_texture__");
    const portalTexture = optionalTextures.get("portal");
    if (portalTexture)
      this.poseTextures.set("__portal_texture__", portalTexture);

    this.populationSystem?.destroy();
    this.populationSystem = populationSystem;
    // A revealed corridor brings its own PopulationSystem. Attach it to the
    // shared world-actor host now, and only now — attaching while the
    // preload was still inert would have shown the next corridor's civilians
    // before the reveal.
    if (this.traversalSortInitialised) {
      populationSystem.attachActorHost(this.layerTraversal);
    }
    this.layerTraversal.addChildAt(
      this.populationSystem.container,
      Math.max(0, this.layerTraversal.getChildIndex(this.avatarShadow))
    );

    this.anchors = prepared.anchors;
    this.occlusionZones = prepared.occlusionZones;
    this.goldRoutePoints = prepared.goldRoutePoints;
    this.parallaxFar = assets.parallaxFar ?? 0.1;
    this.progress = 0.06;
    this.lateral = 0;
    this.velocity = 0;
    this.branch = "intel";
    this.completedTriggers.clear();
    this.portalProximityState.clear();
    this.missionProximityState = "hidden";
    this.orderProximityState = "hidden";
    this.objectiveOffscreenState = null;
    this.corridorExitNear = false;
    this.availableAction = null;
    this.availableLabel = null;
    this.lastReportedProgress = -1;
    this.lastCheckpointReportAt = 0;
    this.camera.clearEncounterStaging();
    this.callbacks.onActionAvailable(null, null);
    this.callbacks.onBranchChange(this.branch);
    this.callbacks.onProgress(this.progress);
    this.callbacks.onCorridorExitProximity?.(false);
    const revealedMissionId =
      this.populationSystem.missionEmbodiment?.missionId;
    if (revealedMissionId != null) {
      this.callbacks.onMissionProximity?.(revealedMissionId, "hidden");
    }
    this.callbacks.onPopulationReady?.(
      this.populationSystem.authoredAmbientCount,
      this.populationSystem.assetStage
    );
    this.renderWorldState();
  }

  performAction(action: CorridorAction) {
    // Expedition ACT has its own API (expeditionBeginAim/Fire/Dodge) and
    // never calls this. Ordinary corridor interaction is a second hidden
    // path into the same world during an expedition unless blocked here.
    if (this.expedition) return false;
    if (action === "INTERACT") {
      if (
        isMissionApproachable(
          this.populationSystem?.missionEmbodiment ?? null,
          this.progress,
          this.lateral
        )
      ) {
        this.avatarState.lockEncounter();
        this.callbacks.onInteract();
        return true;
      }
      // A genuine pickup/delivery is a lighter-weight stationary action (no
      // full mission-encounter overlay), so it does not lock the avatar the
      // way a mission encounter does.
      if (
        isOrderApproachable(
          this.populationSystem?.orderEmbodiment ?? null,
          this.progress,
          this.lateral
        )
      ) {
        this.callbacks.onInteract();
        return true;
      }
    }
    const rawTrigger = pendingTrigger(this.progress, this.completedTriggers);
    const trigger =
      rawTrigger?.action === "INTERACT" && this.populationSystem
        ? null
        : rawTrigger;
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
    // Traversal actions move the player too, so they obey the same ceiling.
    // This previously hardcoded 0.78 and was a second way to walk past the
    // expedition limit — found by auditing every path that mutates progress
    // rather than only the ones already under suspicion.
    this.progress = clampCorridorProgress(
      trigger.at + 0.075,
      Math.min(0.78, this.forwardCeiling())
    );
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
    if (this.foregroundSprite) {
      this.fitCover(this.foregroundSprite, width, height);
    }
    this.positionOcclusionAccent(this.occlusionLeftFrame, width, 0);
    this.positionOcclusionAccent(this.occlusionRightFrame, width, width);
    if (this.effectsSprite) {
      this.fitCover(this.effectsSprite, width, height);
      const alphaEase = Math.min(1, deltaSeconds * 3);
      this.effectsSprite.alpha +=
        (this.effectsTargetAlpha - this.effectsSprite.alpha) * alphaEase;
    }
    this.drawWorld(width, height);

    const now = performance.now();
    if (!this.traversalSortInitialised) {
      this.traversalSortInitialised = true;
      this.layerTraversal.sortableChildren = true;
      this.corridor.zIndex = TRAVERSAL_Z.STATIC_WORLD;
      this.recoveryPath.zIndex = TRAVERSAL_Z.STATIC_WORLD + 1;
      this.landmark.zIndex = TRAVERSAL_Z.STATIC_WORLD + 2;
      this.portals.zIndex = TRAVERSAL_Z.STRONGHOLD;
      this.fortress.zIndex = TRAVERSAL_Z.FORTRESS;
      this.particles.zIndex = TRAVERSAL_Z.PARTICLES;
      this.populationSystem?.attachActorHost(this.layerTraversal);
    }

    this.populationSystem?.update({
      now,
      width,
      height,
      playerProgress: this.progress,
      playerLateral: this.lateral,
      project: (progress, lateral) =>
        this.projectNormalizedCorridor(progress, lateral, width, height),
    });
    this.drawLandmark(width, height, now);
    this.avatarState.tick(now);
    if (this.actionUntil && now >= this.actionUntil) {
      this.actionUntil = 0;
      this.avatarState.release();
    }
    const rawTrigger = pendingTrigger(this.progress, this.completedTriggers);
    const trigger =
      rawTrigger?.action === "INTERACT" && this.populationSystem
        ? null
        : rawTrigger;
    const blocked = Boolean(trigger && this.progress >= trigger.at - 0.012);

    // Aim mode dilates the FICTIONAL clock to 0.2x, but ordinary Trailblazer
    // locomotion below used the raw real deltaSeconds — so holding ACT could
    // slow every Ruinbound to a crawl while Trailblazer herself kept walking
    // at full speed, an exploit and a violation of the two-clock rule.
    // gameplayDelta is what FICTIONAL movement (locomotion, dodge, lash
    // cadence) integrates against while an expedition is active; the real
    // business clock this.expedition?.clock.authoritativeNowMs() reads is
    // never touched by this scale.
    const expeditionTimeScale = this.expedition?.clock.getTimeScale() ?? 1;
    const gameplayDelta = this.expedition
      ? deltaSeconds * expeditionTimeScale
      : deltaSeconds;

    // Down or arrived must freeze the REAL Trailblazer, not merely stop
    // combat inside ExpeditionLayer. forwardCeiling() returning the current
    // position only capped further FORWARD progress — it did nothing about
    // backward movement, lateral movement, locomotion animation, or an
    // already-active dodge continuing to carry her. This is the actual
    // movement gate.
    const expeditionSnapshot = this.expedition?.getSnapshot() ?? null;
    const expeditionCanMove =
      !this.expedition || expeditionSnapshot?.outcome === "running";
    if (!expeditionCanMove) {
      this.velocity = 0;
      this.expeditionDrivingMovement = false;
      this.dodgeState = createDodgeState();
    }

    // Every purely VISUAL movement reaction — facing, locomotion pose,
    // avatar rotation — must react to zero, not to stale/live joystick
    // input, once terminal. Position being frozen said nothing about
    // whether Trailblazer kept visually jogging in place, turning, or
    // leaning from whatever direction the thumb still happened to hold.
    const effectiveInput = expeditionCanMove
      ? this.input
      : { x: 0, y: 0 };

    const magnitude = Math.hypot(effectiveInput.x, effectiveInput.y);
    this.facing = facingForInput(effectiveInput.x, effectiveInput.y, this.facing);
    this.avatarState.setLocomotion(magnitude);
    if (
      expeditionCanMove &&
      !this.actionUntil &&
      this.avatarState.state !== "encounter_locked" &&
      !this.expeditionDrivingMovement
    ) {
      // Ordinary branchPaceFor encodes legacy corridor semantics (SAFE
      // 0.82x, UPPER 1.08x) that would otherwise leak into combat the
      // instant the expedition set `this.branch` to its own route choice.
      // Any expedition route speed difference must be an explicit authored
      // mechanic, not an inherited side effect of reusing the branch field.
      const branchPace = this.expedition ? 1 : branchPaceFor(this.branch);
      const targetSpeed = targetSpeedForMagnitude(magnitude, branchPace);
      const forward = Math.max(0, -effectiveInput.y);
      const backward = Math.max(0, effectiveInput.y);
      const directional = forward > 0 ? 1 : backward > 0 ? -0.65 : 0;
      const directionSign = Math.sign(directional);
      const isReversing =
        directionSign !== 0 &&
        this.lastDirectionSign !== 0 &&
        directionSign !== this.lastDirectionSign;
      if (directionSign !== 0) this.lastDirectionSign = directionSign;
      if (isReversing) this.avatarState.noteReversal();
      this.velocity = stepVelocity({
        currentVelocity: this.velocity,
        targetSpeed,
        deltaSeconds: gameplayDelta,
        isReversing,
      });

      const next = this.progress + this.velocity * directional * gameplayDelta;
      // The mode ceiling always applies; a traversal trigger may only make
      // the limit tighter. Previously an unblocked step clamped to the raw
      // 0.82 and walked straight through the expedition ceiling.
      this.progress = clampCorridorProgress(
        next,
        forwardProgressLimit({
          modeCeiling: this.forwardCeiling(),
          triggerAt: trigger ? trigger.at : null,
          blocked,
        })
      );
      this.lateral = Math.max(
        -0.72,
        Math.min(0.72, this.lateral + effectiveInput.x * 0.72 * gameplayDelta)
      );
    }

    if (this.expedition) {
      // ExpeditionLayer owns route commitment during a pickup expedition —
      // the ordinary corridor branch system uses different semantics
      // (safe/intel/upper as ambient lane choice, not an authored Safe/
      // Upper fork) and must not fire before the mapped fork window.
      const chosen = this.expedition.tryChooseRoute(this.progress, this.lateral);
      if (chosen) {
        this.branch = chosen;
        this.callbacks.onBranchChange(chosen);
      }
    } else {
      const nextBranch = branchForLateralPosition(this.lateral);
      if (nextBranch !== this.branch) {
        this.branch = nextBranch;
        this.callbacks.onBranchChange(nextBranch);
      }
    }

    // Authored route centerline (traced from mid.webp's painted gold inlay)
    // replaces the constant 0.5 — the player's free joystick deviation is
    // still added on top, exactly as it was against the old fixed center.
    // Trailblazer is projected by the SAME function as civilians and
    // guardians, so all three agree about where the painted lane runs.
    const playerProjection = this.projectNormalizedCorridor(
      this.progress,
      this.lateral,
      width,
      height
    );
    const avatarX = playerProjection.x;
    const groundY = playerProjection.y;
    const baseHeight = Math.max(
      134,
      Math.min(232, height * (0.25 - this.progress * 0.08))
    );
    const jumpFactor = this.avatarState.jumpHeightFactor(now);
    const jumpLift = jumpFactor * baseHeight * 0.42;

    this.updateAvatarPose(now, magnitude);
    const aspect = this.avatar.texture.width / this.avatar.texture.height;
    this.avatar.height = baseHeight;
    this.avatar.width = Math.abs(baseHeight * aspect);
    if (this.usingDirectionalPose) {
      // A genuine directional texture is already facing the correct way —
      // mirroring it here would reverse the satchel/thigh-strap/compass
      // side, which is exactly the "mirror cheating" real directional art
      // exists to avoid.
      this.avatar.scale.x = Math.abs(this.avatar.scale.x);
    } else {
      const facingLeft = this.input.x < -0.05;
      this.avatar.scale.x =
        Math.abs(this.avatar.scale.x) * (facingLeft ? -1 : 1);
    }
    this.avatar.x = avatarX;
    this.avatar.y =
      groundY -
      jumpLift +
      (this.avatarState.state === "run" ? Math.sin(now / 72) * 3 : 0);
    this.avatar.rotation = effectiveInput.x * 0.035;
    this.avatar.alpha =
      this.avatarState.state === "encounter_locked" ? 0.72 : 1;

    // Trailblazer sorts by the same rule as every other world actor.
    const actorZ = worldActorZ(groundY, "trailblazer");
    this.avatar.zIndex = actorZ;
    if (this.avatarCrossfade) this.avatarCrossfade.zIndex = actorZ - 0.01;
    this.avatarShadow.zIndex = actorZ - 0.02;

    this.syncCrossfadeTransform();
    this.drawContactShadow(avatarX, groundY, baseHeight, jumpFactor);
    this.applyOcclusion(avatarX, groundY, width, height);
    // The confirmation pulse is a fixed, short decay. It intentionally does
    // not loop: a persistent payoff should be steady, and only the moment it
    // changes gets a flourish.
    if (this.restorationPulse > 0) {
      this.restorationPulse = Math.max(0, this.restorationPulse - deltaSeconds / 1.1);
    }
    this.updateStronghold(width, height);
    this.updatePortals(width, height);
    this.updateCameraLookahead();
    this.updateParallax();

    if (this.expedition) {
      this.lastWidth = width;
      this.lastHeight = height;

      // Dodge is a real corridor burst, applied through the same
      // progress/lateral the joystick uses — not a separate position.
      // Gated explicitly on expeditionCanMove rather than relying only on
      // dodgeState already having been force-reset above: this is the
      // block a reader would check first, and it should say plainly that
      // terminal state disables it.
      if (expeditionCanMove) stepDodge(this.dodgeState, gameplayDelta);
      if (expeditionCanMove && this.dodgeState.active) {
        const burst = DODGE.speed * gameplayDelta;
        this.progress = clampCorridorProgress(
          this.progress +
            (-this.dodgeState.dirY * burst) / (height * PROGRESS_SPAN_FRACTION),
          this.forwardCeiling()
        );
        this.lateral = Math.max(
          -0.72,
          Math.min(0.72, this.lateral + (this.dodgeState.dirX * burst) / (width * 0.22))
        );
      }

      // Contextual basic lash (§18): only while genuinely stationary, only
      // against a real hostile in range, and on a cadence so it never
      // machine-guns or steals control from the player. Gated on
      // expeditionCanMove — ExpeditionLayer.tryBasicLash already rejects
      // while terminal, but this keeps the cooldown from silently ticking
      // down for a player who cannot act anyway.
      if (this.lashCooldown > 0) {
        this.lashCooldown = Math.max(0, this.lashCooldown - gameplayDelta);
      }
      const stationary = Math.hypot(effectiveInput.x, effectiveInput.y) < 0.18;
      if (
        expeditionCanMove &&
        stationary &&
        !this.dodgeState.active &&
        !this.expedition.isAiming() &&
        !this.expedition.linehook.isEngaged() &&
        this.lashCooldown === 0
      ) {
        if (this.expedition.tryBasicLash(this.progress, this.lateral * 140, false)) {
          this.lashCooldown = 0.55;
          this.avatarState.noteReversal();
        }
      }

      this.expedition.setPlayerInvulnerable(dodgeIsInvulnerable(this.dodgeState));

      // Fictional simulation only. `deltaSeconds` is real frame time; the
      // expedition clock is what applies aim dilation and hit-stop, so no
      // business timestamp can ever be reached from here.
      this.expedition.setPlayerCorridor(this.progress, this.lateral * 140);
      this.expedition.update(
        deltaSeconds,
        this.progress,
        this.lateral * 140,
        (progress, lateral) => this.projectCorridor(progress, lateral, width, height),
        width
      );

      // The fiction contributes movement in SCREEN space; convert it back
      // through the exact inverse of projectCorridor so a swing moves the
      // REAL Trailblazer along the real corridor. GoldlineGame remains the
      // only owner of progress/lateral.
      const impulse = this.expedition.consumeMovementImpulse();
      if (impulse.dx !== 0 || impulse.dy !== 0) {
        const { deltaProgress, deltaLateral } = corridorDeltaFromScreenImpulse({
          dx: impulse.dx,
          dy: impulse.dy,
          width,
          height,
        });
        this.progress = clampCorridorProgress(
          this.progress + deltaProgress,
          this.forwardCeiling()
        );
        this.lateral = Math.max(
          -0.72,
          Math.min(0.72, this.lateral + deltaLateral)
        );
      }

      // Handing control back: seed eased locomotion from the momentum the
      // player actually carried out of the swing, so the joystick resumes
      // from real speed rather than a dead stop.
      const handoff = this.expedition.consumeHandoffSpeed();
      if (handoff > 0) {
        this.velocity = Math.min(0.22, handoff / (height * PROGRESS_SPAN_FRACTION));
      }
      this.expeditionDrivingMovement = this.expedition.isDrivingMovement();
    }

    // Ordinary corridor exit must not arm while the expedition owns the
    // world: revealing corridor_02 mid-combat would drop ExpeditionLayer,
    // reset progress and replace the population underneath the player.
    const exitNear = this.expedition === null && this.progress >= 0.77;
    if (exitNear !== this.corridorExitNear) {
      this.corridorExitNear = exitNear;
      this.callbacks.onCorridorExitProximity?.(exitNear);
    }

    const rawCurrent = pendingTrigger(this.progress, this.completedTriggers);
    const current =
      rawCurrent?.action === "INTERACT" && this.populationSystem
        ? null
        : rawCurrent;
    // The expedition destination is the ONLY pickup interaction surface
    // while a pickup expedition is active — a second live proximity path
    // to the same underlying business object would be a second completion
    // route into the same world.
    const mission = this.expedition
      ? null
      : (this.populationSystem?.missionEmbodiment ?? null);
    const missionDistance = mission
      ? Math.hypot(
          mission.anchor.position.progress - this.progress,
          (mission.anchor.position.lateral - this.lateral) * 0.35
        )
      : Number.POSITIVE_INFINITY;
    const missionProximity: "hidden" | "visible" | "engage" = !mission
      ? "hidden"
      : missionDistance <= mission.anchor.stagingRadius
        ? "engage"
        : missionDistance <= 0.22
          ? "visible"
          : "hidden";
    if (mission && missionProximity !== this.missionProximityState) {
      this.missionProximityState = missionProximity;
      this.callbacks.onMissionProximity?.(mission.missionId, missionProximity);
    }

    const order = this.expedition
      ? null
      : (this.populationSystem?.orderEmbodiment ?? null);
    const orderDistance = order
      ? Math.hypot(
          order.anchor.position.progress - this.progress,
          (order.anchor.position.lateral - this.lateral) * 0.35
        )
      : Number.POSITIVE_INFINITY;
    const orderProximity: "hidden" | "visible" | "engage" = !order
      ? "hidden"
      : orderDistance <= order.anchor.stagingRadius
        ? "engage"
        : orderDistance <= 0.22
          ? "visible"
          : "hidden";
    if (order && orderProximity !== this.orderProximityState) {
      this.orderProximityState = orderProximity;
      this.callbacks.onOrderProximity?.(
        order.orderKey,
        order.kind,
        orderProximity
      );
    }

    // Offscreen guidance: reuses the exact same proximity math that already
    // drives the mission/order marker's own visibility ("hidden" below the
    // 0.22 visible-radius threshold — see missionProximity/orderProximity
    // above) so "is the objective visible yet" is answered from the same
    // single geometry the marker itself uses, never a second, independently
    // -tuned distance. Purely game-space ("ahead, not yet close enough to
    // see"), never a fabricated real-world GPS distance.
    const objectiveEmbodiment = mission ?? order;
    const objectiveHidden = mission
      ? missionProximity === "hidden"
      : orderProximity === "hidden";
    const objectiveOffscreen: "ahead" | null =
      objectiveEmbodiment &&
      objectiveHidden &&
      objectiveEmbodiment.anchor.position.progress > this.progress
        ? "ahead"
        : null;
    if (objectiveOffscreen !== this.objectiveOffscreenState) {
      this.objectiveOffscreenState = objectiveOffscreen;
      this.callbacks.onObjectiveOffscreen?.(objectiveOffscreen);
    }

    const missionAction = missionProximity === "engage" ? "INTERACT" : null;
    const orderAction = orderProximity === "engage" ? "INTERACT" : null;
    const action =
      missionAction ??
      orderAction ??
      (current && this.progress >= current.at - 0.04 ? current.action : null);
    const label = missionAction
      ? "approach human scene"
      : orderAction
        ? order?.kind === "delivery"
          ? "approach handoff point"
          : "approach retrieval point"
        : action
          ? current!.label
          : null;
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
    this.reportCheckpointIfSafe();
    this.camera.update(deltaSeconds);
  }

  /**
   * Only ever reports position while the avatar is idle/walking/running —
   * never mid-jump, mid-vault, mid-climb, or encounter-locked — so a
   * restored session can never resume inside an unresolved animation.
   * Throttled to roughly once per second to avoid write-spamming storage.
   */
  private reportCheckpointIfSafe() {
    // Expedition state is deliberately not persisted in this slice — saving
    // an expedition coordinate into the normal corridor checkpoint would
    // resume the player mid-combat at a position the ordinary corridor
    // doesn't understand.
    if (this.expedition) return;
    const safeStates: AvatarState[] = ["idle", "walk", "run"];
    if (!safeStates.includes(this.avatarState.state)) return;
    const now = performance.now();
    if (now - this.lastCheckpointReportAt < 1000) return;
    this.lastCheckpointReportAt = now;
    this.callbacks.onCheckpointSafe?.(this.progress, this.lateral, this.branch);
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

  /**
   * Pins a corner occlusion accent (see FOREGROUND_ACCENT_FILES) hanging
   * down from the top corner — never stretched to fill the canvas. Scaled
   * to a target VISIBLE height (not width): the left-frame source is a
   * tall ~1:2 cluster and the right-frame source is closer to square, so
   * scaling both by width alone left the right one almost entirely hidden
   * behind the FIELD LINK header bar (confirmed by direct in-browser
   * verification, not assumed) — a shared target height keeps both
   * genuinely visible below the header regardless of source aspect. Width
   * is separately capped at 42% of viewport width so the joystick, bottom
   * nav, and the bulk of the playable world stay clear even for the
   * squarer source.
   */
  private positionOcclusionAccent(
    sprite: Sprite | null,
    viewportWidth: number,
    anchorX: number
  ) {
    if (!sprite) return;
    const targetHeight = 300;
    const maxWidth = viewportWidth * 0.42;
    let scale = targetHeight / sprite.texture.height;
    if (sprite.texture.width * scale > maxWidth) {
      scale = maxWidth / sprite.texture.width;
    }
    sprite.width = sprite.texture.width * scale;
    sprite.height = sprite.texture.height * scale;
    sprite.x = anchorX;
    sprite.y = 0;
  }

  /**
   * L0 parallax: the far plate drifts a fraction of lateral/progress motion.
   * The factor comes from the corridor's own manifest (`parallax.far`, schema-
   * clamped to the documented 0.05-0.15 range) so a corridor's depth is
   * authored content rather than a renderer constant.
   */
  private updateParallax() {
    if (!this.farSprite) return;
    this.farSprite.x = -this.lateral * 60 * this.parallaxFar * 10;
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
      this.runFrameTimer +=
        (state === "run" ? 11 : 6) * (magnitude > 0 ? 1 : 0);
    }
    const frame = Math.floor(this.runFrameTimer / 6);
    const baseKey = poseForState(state, frame);
    const key = resolveDirectionalPoseKey(
      baseKey,
      state,
      this.facing,
      frame,
      this.poseTextures
    );
    this.usingDirectionalPose = key !== baseKey;
    if (key !== this.currentPoseKey) {
      const texture = this.poseTextures.get(key);
      if (texture) {
        // Run-cycle frame steps (run_01 -> run_02 -> ..., or their
        // directional walk-<facing>-0N equivalents) are deliberately NOT
        // crossfaded — that is the animation, and blending consecutive
        // frames would read as motion blur rather than a run. Every other
        // state change (idle<->run, run->jump_start, jump_air->land,
        // climb_a<->climb_b, a facing change mid-stride, ...) gets a brief
        // crossfade so it never pops.
        const isRunFrameStep =
          (key.startsWith("run_0") &&
            this.currentPoseKey.startsWith("run_0")) ||
          (key.startsWith("walk-") &&
            this.currentPoseKey.startsWith("walk-") &&
            key.slice(0, key.lastIndexOf("-")) ===
              this.currentPoseKey.slice(
                0,
                this.currentPoseKey.lastIndexOf("-")
              ));
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
    this.avatarCrossfade.scale.x =
      Math.abs(this.avatarCrossfade.scale.x) *
      Math.sign(this.avatar.scale.x || 1);
    this.avatarCrossfade.rotation = this.avatar.rotation;
  }

  private applyOcclusion(
    avatarX: number,
    groundY: number,
    width: number,
    height: number
  ) {
    const activeZone = this.occlusionZones.find(zone =>
      pointInZone(zone, this.progress, this.lateral)
    );
    if (!this.avatar) return;

    // Authored fortress occlusion, expressed as depth rather than child
    // index. setChildIndex fights sortableChildren — the sort would simply
    // undo it on the next frame — so the zone now pushes Trailblazer just
    // behind the fortress band instead. Outside a zone she keeps the normal
    // world-actor depth assigned during update, so she interleaves with
    // civilians and guardians as any other actor does.
    if (activeZone) {
      this.avatar.zIndex = TRAVERSAL_Z.FORTRESS - 0.01;
      if (this.avatarCrossfade) {
        this.avatarCrossfade.zIndex = TRAVERSAL_Z.FORTRESS - 0.02;
      }
      this.avatarShadow.zIndex = TRAVERSAL_Z.FORTRESS - 0.03;
    }

    // The registered full-scene L3 plate supplies pixel-accurate occlusion.
    // Keeping that plate stable avoids duplicated/shrunken edge art while the
    // authored zones above continue to govern avatar/fortress z-order.
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
    const gateX = width * 0.525;
    const gateY = height * 0.19;
    if (this.strongholdSprite) {
      this.strongholdSprite.x = gateX;
      this.strongholdSprite.y = gateY;
      this.strongholdSprite.height = height * 0.24;
      this.strongholdSprite.width =
        this.strongholdSprite.height *
        (this.strongholdSprite.texture.width /
          this.strongholdSprite.texture.height);
      // Dim toward closed, settle brighter on a verified capture, otherwise
      // the steady baseline — bright tropical direction preserved throughout,
      // never a dark villain-fortress treatment.
      this.strongholdSprite.alpha =
        this.worldState === "closed"
          ? 0.5
          : this.worldState === "captured"
            ? 1
            : 0.92;
    }
    this.drawStrongholdRestoration(width, height);
  }

  /**
   * The persistent Stronghold payoff: six lanterns along the threshold and
   * the brass Gold-Line conduit beneath them.
   *
   * Every value drawn here comes from `this.strongholdRestoration`, which
   * React derives from authoritative collected-order evidence. There is no
   * local counter, no stored progress and no animation state that outlives
   * the projection — so reloading the app and re-reading the same orders
   * reproduces exactly this threshold, which is the entire point of
   * deriving the payoff from real truth instead of celebrating a mutation.
   */
  private drawStrongholdRestoration(width: number, height: number) {
    const g = this.gRestoration;
    g.clear();
    const restoration = this.strongholdRestoration;
    if (!restoration) return;

    const now = performance.now();
    // ONE brief confirmation pulse, driven by a real before/after delta.
    const pulse = this.restorationPulse > 0 ? this.restorationPulse : 0;

    // Along the gate's THRESHOLD — the base of the Stronghold, spanning its
    // real width. The first placement used the gate's vertical midpoint and
    // measured the horizontal span in units of HEIGHT, which put the row in
    // the middle of the sky and made the payoff read as a floating HUD bar
    // rather than lanterns mounted on a building.
    const gateLeft = width * GATE_RECT.left;
    const gateRight = width * GATE_RECT.right;
    const gateX = (gateLeft + gateRight) / 2;
    const span = (gateRight - gateLeft) / 2;
    const y = height * GATE_RECT.baseY;
    const lanternR = Math.max(3, height * 0.0065);

    // The conduit: a brass channel under the lanterns whose lit fraction is
    // the real conduitCharge. Dormant stretch first, charged stretch over it.
    const conduitY = y + lanternR * 2.6;
    g.moveTo(gateX - span, conduitY)
      .lineTo(gateX + span, conduitY)
      .stroke({ width: lanternR * 1.5, color: 0x5a4212, alpha: 0.75 });
    if (restoration.conduitCharge > 0) {
      const chargedTo =
        gateX - span + span * 2 * Math.min(1, restoration.conduitCharge);
      g.moveTo(gateX - span, conduitY)
        .lineTo(chargedTo, conduitY)
        .stroke({
          width: lanternR * 1.5,
          color: 0xc9942e,
          alpha: 0.9,
        });
      g.moveTo(gateX - span, conduitY)
        .lineTo(chargedTo, conduitY)
        .stroke({
          width: lanternR * 0.6,
          color: 0xffd166,
          alpha: 0.75 + pulse * 0.25,
        });
    }

    // Six lanterns. An unlit lantern is still physically THERE — a dark
    // bracket on the threshold — so the player can see how much of the
    // Stronghold is still waiting rather than only what is already done.
    for (let i = 0; i < STRONGHOLD_LANTERN_COUNT; i += 1) {
      const t = i / (STRONGHOLD_LANTERN_COUNT - 1);
      const x = gateX - span + span * 2 * t;
      const lit = i < restoration.lanternsLit;

      // Bracket.
      g.rect(x - lanternR * 0.35, y, lanternR * 0.7, lanternR * 2.4).fill({
        color: 0x5a4212,
        alpha: 0.85,
      });

      if (!lit) {
        g.circle(x, y, lanternR)
          .fill({ color: 0x281f19, alpha: 0.55 })
          .stroke({ width: 1.2, color: 0x5a4212, alpha: 0.8 });
        continue;
      }

      // A lit lantern breathes; the newest one breathes harder during the
      // single confirmation pulse.
      const newest = i === restoration.lanternsLit - 1;
      const breath =
        0.75 + Math.sin(now / 620 + i * 0.9) * 0.18 + (newest ? pulse * 0.4 : 0);
      g.circle(x, y, lanternR * (2.2 + (newest ? pulse * 1.4 : 0))).fill({
        color: 0xffd166,
        alpha: 0.16 * breath,
      });
      g.circle(x, y, lanternR * 1.35).fill({
        color: 0xffd166,
        alpha: 0.42 * breath,
      });
      g.circle(x, y, lanternR)
        .fill({ color: 0xffd98a, alpha: Math.min(1, breath) })
        .stroke({ width: 1.4, color: 0xc9942e, alpha: 0.95 });
    }
  }

  /**
   * The authoritative Stronghold reading. Called by React whenever real
   * collected-order evidence changes — including when it changes because
   * somebody else collected the order.
   */
  setStrongholdRestoration(restoration: StrongholdRestoration | null) {
    this.strongholdRestoration = restoration;
  }

  /**
   * ONE brief confirmation pulse for a genuine before/after delta. Callers
   * must pass a delta computed from two real evidence readings — this
   * deliberately has no way to celebrate a change that did not happen.
   */
  pulseStrongholdRestoration(delta: { changed: boolean }) {
    if (!delta.changed) return;
    this.restorationPulse = 1;
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
    // Unrelated commercial-mission landmark presentation must not compete
    // with the expedition world.
    if (this.expedition) return;
    if (this.worldSignal === "dormant") {
      const breath = 0.5 + Math.sin(now / 1_300) * 0.5;
      this.landmark
        .circle(width * 0.2, height * 0.14, 22 + breath * 4)
        .stroke({ color: 0xd9bd78, width: 2, alpha: 0.12 + breath * 0.16 });
    }
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
      this.landmark
        .circle(x, y, radius + 8)
        .fill({ color: 0xa082ff, alpha: 0.06 + pulse * 0.08 });
      this.landmark
        .circle(x, y, radius)
        .stroke({ color: 0xcbb8ff, width: 2, alpha: 0.4 + pulse * 0.4 });
      this.landmark
        .circle(x, y, 4)
        .fill({ color: 0xe6dcff, alpha: 0.7 + pulse * 0.3 });
      return;
    }

    if (this.landmarkArchetype === "STALLER") {
      // Frozen mechanism: a clockwork ring that ticks in small discrete
      // steps rather than spinning freely — "delayed", not "broken".
      const tickAngle = Math.floor(now / 700) * (Math.PI / 6);
      this.landmark
        .circle(x, y, 16)
        .stroke({ color: 0xffc46b, width: 2, alpha: 0.55 });
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
    // Base corridor portal/card/glow presentation is redundant and visually
    // competes with the expedition — it has its own authored destination.
    if (this.expedition) return;
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

      // Presentation only — proximity callbacks above already fired.
      const expeditionActive = this.expedition !== null;
      const presentation = portalPresentationFor({
        expeditionActive,
        anchorType: anchor.type,
        hasCardTexture: Boolean(portalTexture),
      });

      if (presentation === "card" && portalTexture) {
        const sprite = new Sprite(portalTexture);
        sprite.anchor.set(0.5, 1);
        const targetHeight = height * (0.14 + dominance * 0.1);
        sprite.height = targetHeight;
        sprite.width =
          targetHeight * (portalTexture.width / portalTexture.height);
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
      const glow = portalGlowAlpha({ expeditionActive, dominance });
      portal.circle(px, py, radius).fill({ color, alpha: glow.outer });
      portal.circle(px, py, radius * 0.45).fill({ color, alpha: glow.inner });
      this.portals.addChild(portal);
    }
  }

  private updateCameraLookahead() {
    if (this.expedition) {
      this.camera.clearLookahead();
      return;
    }
    const upcoming = this.anchors
      .map(anchor => ({
        anchor,
        distance: anchorDistance(anchor, this.progress, this.lateral),
      }))
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
    // The expedition owns an adventure-only Gold Line treatment. Without
    // this, an unrelated commercial mission's worldState (CLOSED,
    // CONTESTED, a recovery branch, a dormant signal) leaked into the
    // Line's color and brightness during an active pickup expedition,
    // making the route visibly grey or orange for reasons that have
    // nothing to do with the expedition itself.
    const expeditionActive = this.expedition !== null;
    // The main route dims once a recovery branch is the legitimate path —
    // it does not disappear (the account isn't closed), but visual priority
    // shifts to the recovery path drawn below.
    const mainRouteDim = expeditionActive
      ? 1
      : this.worldState === "recovery_active" ||
          this.worldState === "recovery_available"
        ? 0.4
        : this.worldState === "contested"
          ? 0.65
          : this.worldSignal === "dormant"
            ? 0.48
            : 1;
    const routeColor = expeditionActive
      ? 0xf4bd48
      : this.worldState === "closed"
        ? 0x677168
        : this.worldState === "contested"
          ? 0xc98545
          : 0xf4bd48;
    const routeHighlight = expeditionActive
      ? 0xffdf77
      : this.worldState === "closed"
        ? 0x879087
        : this.worldState === "contested"
          ? 0xe1a05b
          : 0xffdf77;
    // Three-pass treatment reads as light embedded in the physical world
    // (a brass inlay catching daylight) rather than a flat UI line: a wide
    // soft bloom, the crisp core stroke, and a short brighter segment that
    // slowly travels the route's length — "energy moving through the
    // route" — all pure vector math on the existing authored polyline, no
    // new art asset.
    drawRoute(22, routeColor, 0.08 * mainRouteDim);
    drawRoute(14, routeColor, 0.15 * mainRouteDim);
    drawRoute(3, routeHighlight, 0.86 * mainRouteDim);
    // Real navigation guidance, not ambient decoration: when a genuine
    // mission or order objective is embodied, the shimmer travels
    // specifically from Trailblazer's current position toward that
    // objective's real anchor — "energy flowing toward the real next
    // thing to do" — rather than looping the whole route with no meaning.
    // With no genuine objective, it stays a slow full-route ambient
    // shimmer that points at nothing (never implies a destination that
    // doesn't exist).
    const objectiveProgress =
      this.expedition?.getDestinationProgress() ??
      this.populationSystem?.missionEmbodiment?.anchor.position.progress ??
      this.populationSystem?.orderEmbodiment?.anchor.position.progress ??
      null;
    if (!this.reducedMotion && mainRouteDim > 0.5) {
      const toT = (p: number) => Math.max(0, Math.min(1, (p - 0.02) / 0.8));
      const tStart = objectiveProgress != null ? toT(this.progress) : 0;
      const tEnd = objectiveProgress != null ? toT(objectiveProgress) : 1;
      const span = Math.max(0.03, tEnd - tStart);
      const period = objectiveProgress != null ? 2600 : 6500;
      const shimmerSpan = objectiveProgress != null ? span * 0.35 : 0.05;
      const shimmerT =
        tStart + ((performance.now() / period) % 1) * (span - shimmerSpan);
      const shimmerStart = routeScreenPoint(Math.max(0, shimmerT));
      this.corridor.moveTo(shimmerStart.x, shimmerStart.y);
      for (let i = 1; i <= 6; i += 1) {
        const t = Math.max(
          0,
          Math.min(1, shimmerT + (i / 6) * shimmerSpan)
        );
        const point = routeScreenPoint(t);
        this.corridor.lineTo(point.x, point.y);
      }
      this.corridor.stroke({
        width: objectiveProgress != null ? 6 : 5,
        color: 0xfff3cf,
        alpha: objectiveProgress != null ? 0.75 : 0.5,
      });
    }

    this.fortress.clear();
    // The corridor gate panel sits over the middle of the lane and reads as
    // a floating card during play. The expedition has its own authored
    // destination, so the gate is redundant while it owns the world.
    this.fortress.renderable = corridorGateVisibleDuring({
      expeditionActive: this.expedition !== null,
    });
    const gateX = width * GATE_RECT.left;
    const gateY = height * GATE_RECT.topY;
    const gateW = width * (GATE_RECT.right - GATE_RECT.left);
    const gateH = height * (GATE_RECT.baseY - GATE_RECT.topY);
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
    if (this.worldState === "closed") {
      // Dormant overgrowth is presentation of authoritative CLOSED only.
      for (let index = 0; index < 7; index += 1) {
        const offset = index / 6;
        this.fortress
          .ellipse(
            gateX + gateW * offset,
            gateY + gateH * (0.72 + (index % 2) * 0.1),
            8,
            4
          )
          .fill({ color: 0x61764b, alpha: 0.58 });
      }
    }

    this.recoveryPath.clear();
    if (
      !this.expedition &&
      (this.worldState === "recovery_active" ||
        this.worldState === "recovery_available")
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
        .stroke({ width: 18, color: 0x9b72cf, alpha: 0.2 });
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
      // A repaired route keeps its purple fracture visible; recovery does not
      // erase the history that made it necessary.
      this.recoveryPath
        .moveTo(width * 0.19, height * 0.48)
        .lineTo(width * 0.23, height * 0.44)
        .lineTo(width * 0.2, height * 0.4)
        .lineTo(width * 0.27, height * 0.35)
        .stroke({ width: 2, color: 0xc3a2ee, alpha: 0.85 });
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
    // Eased in update(), not an instant visibility flip — reduced quality
    // should read as an intentional step down, not a pop/glitch.
    this.effectsTargetAlpha = this.qualityTier === "premium" ? 0.4 : 0;
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
    if (
      this.worldState === "recovery_active" ||
      this.worldState === "recovery_available"
    )
      this.camera.focusRecoveryPath();
    else this.camera.focusMainGate();
  }

  destroy() {
    this.endExpedition();
    document.removeEventListener("visibilitychange", this.visibilityHandler);
    window.removeEventListener("pagehide", this.pageHideHandler);
    if (this.tickerProbeActive) {
      this.tickerProbeActive = false;
      reportGoldlineLifecycleDelta("pixiTicker", -1);
    }
    this.populationSystem?.destroy();
    this.populationSystem = null;
    this.app?.destroy(true, { children: true });
    this.app = null;
    this.backgroundSprite = null;
    this.host.replaceChildren();
  }
}

function baseHeightAt(viewportHeight: number, progress: number): number {
  return Math.max(
    134,
    Math.min(232, viewportHeight * (0.25 - progress * 0.08))
  );
}
