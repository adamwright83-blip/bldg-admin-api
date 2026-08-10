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
};

type GameAssets = { worldUrl: string; operatorUrl: string };

export class GoldlineGame {
  private app: Application | null = null;
  private world = new Container();
  private camera = new CameraController(this.world);
  private avatar: Sprite | null = null;
  private corridor = new Graphics();
  private fortress = new Graphics();
  private recoveryPath = new Graphics();
  private particles = new Container();
  private input = { x: 0, y: 0 };
  private progress = 0.06;
  private lateral = 0;
  private completedTriggers = new Set<string>();
  private availableAction: CorridorAction | null = null;
  private availableLabel: string | null = null;
  private branch: CorridorBranch = "intel";
  private avatarState = new AvatarStateMachine();
  private actionUntil = 0;
  private lastReportedProgress = -1;
  private worldState: WorldMissionState = "available";
  private hidden = false;
  private visibilityHandler = () => {
    this.hidden = document.hidden;
    if (this.hidden) this.app?.ticker.stop();
    else this.app?.ticker.start();
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
      this.world.addChild(background);
      this.world.addChild(this.corridor, this.recoveryPath, this.fortress);
      this.avatar = new Sprite(operatorTexture);
      this.avatar.anchor.set(0.5, 1);
      this.avatar.label = "trailblazer-operator";
      this.world.addChild(this.avatar, this.particles);
      app.stage.addChild(this.world);

      app.ticker.add(ticker => this.update(ticker.deltaMS / 1000, background));
      document.addEventListener("visibilitychange", this.visibilityHandler);
      this.renderWorldState();
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
    this.avatarState.beginAction(action);
    this.actionUntil = performance.now() + 620;
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

    const now = performance.now();
    if (this.actionUntil && now >= this.actionUntil) {
      this.actionUntil = 0;
      this.avatarState.release();
    }
    const trigger = pendingTrigger(this.progress, this.completedTriggers);
    const blocked = Boolean(trigger && this.progress >= trigger.at - 0.012);
    const magnitude = Math.hypot(this.input.x, this.input.y);
    this.avatarState.setLocomotion(magnitude);
    if (!this.actionUntil && this.avatarState.state !== "encounter_locked") {
      const forward = Math.max(0, -this.input.y);
      const backward = Math.max(0, this.input.y);
      const branchPace =
        this.branch === "safe" ? 0.82 : this.branch === "upper" ? 1.08 : 1;
      const speed = (magnitude > 0.62 ? 0.13 : 0.075) * branchPace;
      const next = this.progress + (forward - backward * 0.65) * speed * deltaSeconds;
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
    const avatarY = height * (0.88 - this.progress * 0.61);
    const baseHeight = Math.max(134, Math.min(232, height * (0.25 - this.progress * 0.08)));
    this.avatar.height = baseHeight;
    this.avatar.width = Math.abs(this.avatar.height * (1024 / 1536));
    this.avatar.scale.x = Math.abs(this.avatar.scale.x) * (this.input.x < -0.05 ? -1 : 1);
    this.avatar.x = avatarX;
    this.avatar.y =
      avatarY +
      (this.avatarState.state === "run" ? Math.sin(now / 72) * 3 : 0) -
      (this.actionUntil ? Math.sin(((this.actionUntil - now) / 620) * Math.PI) * 24 : 0);
    this.avatar.rotation = this.input.x * 0.035;
    this.avatar.alpha = this.avatarState.state === "encounter_locked" ? 0.72 : 1;

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
      this.recoveryPath
        .moveTo(width * 0.2, height * 0.64)
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
        .moveTo(width * 0.2, height * 0.64)
        .bezierCurveTo(
          width * 0.06,
          height * 0.52,
          width * 0.2,
          height * 0.34,
          width * 0.35,
          height * 0.22
        )
        .stroke({ width: 3, color: 0xffd875, alpha: 0.95 });
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
    this.app?.destroy(true, { children: true });
    this.app = null;
    this.host.replaceChildren();
  }
}
