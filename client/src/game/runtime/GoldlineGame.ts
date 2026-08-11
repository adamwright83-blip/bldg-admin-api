import {
  Application,
  Assets,
  Container,
  Graphics,
  Sprite,
  Texture,
} from "pixi.js";
import { AvatarStateMachine } from "../avatar/AvatarStateMachine";
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
};

type GameAssets = { worldUrl: string; operatorUrl: string; anchorsBasePath?: string };

/** Acceleration/deceleration rates for locomotion — not a linear 1:1 with input. */
const ACCEL_UNITS_PER_SECOND = 2.6;
const DECEL_UNITS_PER_SECOND = 4.2;

export class GoldlineGame {
  private app: Application | null = null;
  private world = new Container();

  // L0-L4 layer containers. L0/L3/L4 art is intentionally absent — see
  // client/public/assets/goldline/corridor_01/README.md for exactly what is
  // still required. The containers are real and parallax-driven regardless,
  // so dropping in art later requires no further engineering.
  private layerFar = new Container(); // L0 — no art yet
  private layerMid = new Container(); // L1 — existing approved background
  private layerTraversal = new Container(); // L2 — route, portals, avatar
  private layerForeground = new Container(); // L3 — occlusion, empty until foreground.webp exists
  private layerEffects = new Container(); // L4 — one restrained god-ray, gold motes

  private camera = new CameraController(this.world);
  private avatar: Sprite | null = null;
  private avatarShadow = new Graphics();
  private corridor = new Graphics();
  private fortress = new Graphics();
  private recoveryPath = new Graphics();
  private portals = new Container();
  private godRay = new Graphics();
  private particles = new Container();
  private input = { x: 0, y: 0 };
  private progress = 0.06;
  private lateral = 0;
  private velocity = 0; // eased locomotion speed, not applied 1:1 from input
  private completedTriggers = new Set<string>();
  private availableAction: CorridorAction | null = null;
  private availableLabel: string | null = null;
  private branch: CorridorBranch = "intel";
  private avatarState = new AvatarStateMachine();
  private actionUntil = 0;
  private lastReportedProgress = -1;
  private worldState: WorldMissionState = "available";
  private anchors: CorridorAnchor[] = [];
  private occlusionZones: OcclusionZone[] = [];
  private portalProximityState = new Map<string, "hidden" | "label" | "engage">();
  private hidden = false;
  private visibilityHandler = () => {
    this.hidden = document.hidden;
    if (this.hidden) this.app?.ticker.stop();
    else this.app?.ticker.start();
  };
  // pagehide fires reliably on mobile app-switch/tab-discard paths that do
  // not always precede a visibilitychange event; stopping the ticker here is
  // defense-in-depth, never a replacement for the visibilitychange listener.
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

      const [worldTexture, operatorTexture] = await Promise.all([
        Assets.load<Texture>(assets.worldUrl),
        Assets.load<Texture>(assets.operatorUrl),
      ]);
      const background = new Sprite(worldTexture);
      background.label = "approved-world-art";
      this.layerMid.addChild(background);

      this.layerTraversal.addChild(
        this.corridor,
        this.recoveryPath,
        this.fortress,
        this.portals
      );
      this.avatar = new Sprite(operatorTexture);
      this.avatar.anchor.set(0.5, 1);
      this.avatar.label = "trailblazer-operator";
      this.layerTraversal.addChild(this.avatarShadow, this.avatar, this.particles);

      this.layerEffects.addChild(this.godRay);

      // z-order: far behind mid behind traversal behind foreground behind effects.
      this.world.addChild(
        this.layerFar,
        this.layerMid,
        this.layerTraversal,
        this.layerForeground,
        this.layerEffects
      );
      app.stage.addChild(this.world);

      app.ticker.add(ticker => this.update(ticker.deltaMS / 1000, background));
      document.addEventListener("visibilitychange", this.visibilityHandler);
      window.addEventListener("pagehide", this.pageHideHandler);
      this.renderWorldState();

      void loadCorridorAnchors(
        assets.anchorsBasePath ?? "/assets/goldline/corridor_01"
      ).then(result => {
        this.anchors = result.anchors;
        this.occlusionZones = result.zones;
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
    this.worldState = state;
    if (state === "recovery_active") this.camera.focusRecoveryPath();
    else this.camera.focusMainGate();
    this.renderWorldState();
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
    return true;
  }

  private update(deltaSeconds: number, background: Sprite) {
    if (!this.app || !this.avatar || this.hidden) return;
    const width = this.app.screen.width;
    const height = this.app.screen.height;
    const textureRatio = background.texture.width / background.texture.height;
    const viewRatio = width / height;
    if (viewRatio > textureRatio) {
      background.width = width;
      background.height = width / textureRatio;
    } else {
      background.height = height;
      background.width = height * textureRatio;
    }
    background.x = (width - background.width) / 2;
    background.y = (height - background.height) / 2;
    this.drawWorld(width, height);
    this.drawGodRay(width, height);

    const now = performance.now();
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
      // Eased acceleration/deceleration: velocity ramps toward the target
      // speed rather than snapping to it, so starting/stopping reads as
      // weighted movement instead of an instant on/off toggle.
      const branchPace =
        this.branch === "safe" ? 0.82 : this.branch === "upper" ? 1.08 : 1;
      const targetSpeed = (magnitude > 0.62 ? 0.13 : magnitude > 0.08 ? 0.075 : 0) * branchPace;
      const rampRate = targetSpeed > this.velocity ? ACCEL_UNITS_PER_SECOND : DECEL_UNITS_PER_SECOND;
      const maxStep = rampRate * deltaSeconds * 0.13;
      this.velocity +=
        Math.sign(targetSpeed - this.velocity) * Math.min(maxStep, Math.abs(targetSpeed - this.velocity));

      const forward = Math.max(0, -this.input.y);
      const backward = Math.max(0, this.input.y);
      const directional = forward > 0 ? 1 : backward > 0 ? -0.65 : 0;
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

    const avatarX = width * (0.5 + this.lateral * 0.22);
    const groundY = height * (0.88 - this.progress * 0.61);
    const baseHeight = Math.max(134, Math.min(232, height * (0.25 - this.progress * 0.08)));
    const jumpFactor = this.avatarState.jumpHeightFactor(now);
    const jumpLift = jumpFactor * baseHeight * 0.42;

    this.avatar.height = baseHeight;
    this.avatar.width = Math.abs(this.avatar.height * (1024 / 1536));
    this.avatar.scale.x = Math.abs(this.avatar.scale.x) * (this.input.x < -0.05 ? -1 : 1);
    this.avatar.x = avatarX;
    this.avatar.y =
      groundY -
      jumpLift +
      (this.avatarState.state === "run" ? Math.sin(now / 72) * 3 : 0);
    this.avatar.rotation = this.input.x * 0.035;
    this.avatar.alpha = this.avatarState.state === "encounter_locked" ? 0.72 : 1;

    // Contact shadow stays on the ground plane regardless of jump height —
    // that separation from the airborne sprite is what sells the jump, not
    // any deformation of the character itself.
    this.drawContactShadow(avatarX, groundY, baseHeight, jumpFactor);
    this.applyOcclusion(avatarX, groundY);
    this.updatePortals(width, height);
    this.updateCameraLookahead();

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

  /** L3 occlusion mechanism: swap the fortress silhouette above the avatar
   * when the avatar's world position enters an authored zone. Real z-order
   * behavior today; final depth still needs the missing foreground art —
   * see corridor_01/README.md. */
  private applyOcclusion(_avatarX: number, _groundY: number) {
    const inZone = this.occlusionZones.some(zone =>
      pointInZone(zone, this.progress, this.lateral)
    );
    if (!this.avatar) return;
    // fortress sits later in layerTraversal's child order than the avatar by
    // default (avatar added after corridor/fortress/portals); when occluded,
    // move the avatar behind the fortress graphic instead.
    const fortressIndex = this.layerTraversal.getChildIndex(this.fortress);
    const avatarIndex = this.layerTraversal.getChildIndex(this.avatar);
    if (inZone && avatarIndex > fortressIndex) {
      this.layerTraversal.setChildIndex(this.avatar, fortressIndex);
      this.layerTraversal.setChildIndex(this.avatarShadow, fortressIndex);
    } else if (!inZone && avatarIndex < this.layerTraversal.children.length - 1) {
      this.layerTraversal.setChildIndex(this.avatar, this.layerTraversal.children.length - 1);
      this.layerTraversal.setChildIndex(
        this.avatarShadow,
        Math.max(0, this.layerTraversal.children.length - 2)
      );
    }
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

  private updatePortals(width: number, height: number) {
    this.portals.removeChildren();
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
      const py = height * (0.88 - anchor.position.progress * 0.61) - baseHeightAt(height, anchor.position.progress);
      const dominance = 1 - Math.min(1, distance / anchor.labelRadius);
      const color = anchor.type === "comms_portal" ? 0x36e8e7 : 0x8b5fe0;
      // A soft glow only — the approved background art already paints in
      // portal-like structures (a lit platform, a chained archway). A drawn
      // card/icon on top of that reads as a debug placeholder, not a portal.
      // See corridor_01/README.md: true bespoke portal geometry is still an
      // art requirement, not something a Graphics primitive should fake.
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

  private drawGodRay(width: number, height: number) {
    // One restrained god ray — the brief is explicit that one good effect
    // beats ten cheap ones. No fog/sparkle layer exists yet (L4 art missing).
    this.godRay.clear();
    this.godRay
      .poly([width * 0.42, 0, width * 0.62, 0, width * 0.5, height * 0.55])
      .fill({ color: 0xfff3c4, alpha: 0.05 });
  }

  private drawWorld(width: number, height: number) {
    this.corridor.clear();
    this.corridor
      .moveTo(width * 0.32, height * 0.91)
      .bezierCurveTo(
        width * 0.72,
        height * 0.72,
        width * 0.33,
        height * 0.49,
        width * 0.52,
        height * 0.25
      )
      .stroke({ width: 14, color: 0xf4bd48, alpha: 0.15 });
    this.corridor
      .moveTo(width * 0.32, height * 0.91)
      .bezierCurveTo(
        width * 0.72,
        height * 0.72,
        width * 0.33,
        height * 0.49,
        width * 0.52,
        height * 0.25
      )
      .stroke({ width: 3, color: 0xffdf77, alpha: 0.86 });

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

    this.recoveryPath.clear();
    if (
      this.worldState === "contested" ||
      this.worldState === "recovery_active"
    ) {
      // Diversion: the recovery path forks visibly away from the main gold
      // route rather than simply appearing as a second unrelated line.
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

  private spawnTrail(color: number) {
    if (!this.avatar) return;
    for (let index = 0; index < 8; index += 1) {
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
