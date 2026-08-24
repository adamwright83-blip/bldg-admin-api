import {
  Application,
  Assets,
  Container,
  Graphics,
  Sprite,
  Text,
  Texture,
} from "pixi.js";
import { GOLDLINE_OVERWORLD_MAP } from "./mapDefinition";
import {
  applyCorridorAssist,
  distance,
  isWalkable,
  materialAtPoint,
  moveWithCollision,
  nearestValidPoint,
  surfaceAtPoint,
} from "./navigation";
import { facingForVelocity, remapAnalogInput, stepVelocity } from "./movement";
import type {
  DestinationStateMap,
  OverworldCheckpoint,
  OverworldFacing,
  OverworldPoint,
  OverworldProximity,
  OverworldRuntimeCallbacks,
  OverworldRuntimeContract,
  TraversalNode,
} from "./types";

const MAP = GOLDLINE_OVERWORLD_MAP;
const PLAYER_RADIUS = 11;
const PLAYER_PRESENTATION_HEIGHT = 138;
const CAMERA_ZOOM = 1.45;
const CAMERA_EASE_PER_SECOND = 1000 / 180;
const LOOKAHEAD_SECONDS = 0.12;
const CHECKPOINT_INTERVAL_MS = 1000;
const PLAYER_FRAME_SECONDS = 0.095;
const DIRECTIONAL_BASE = "/assets/goldline/characters/trailblazer/directional";

const facings: OverworldFacing[] = ["front", "back", "left", "right"];
const directionalUrls = facings.flatMap(facing => [
  `${DIRECTIONAL_BASE}/idle-${facing}.webp`,
  ...Array.from(
    { length: 5 },
    (_, index) =>
      `${DIRECTIONAL_BASE}/walk-${facing}-${String(index + 1).padStart(2, "0")}.webp`
  ),
]);

export class GoldlineOverworldRuntime implements OverworldRuntimeContract {
  private app = new Application();
  private world = new Container();
  private player = new Sprite();
  private shadow = new Graphics();
  private footfall = new Graphics();
  private textures = new Map<string, Texture>();
  private markerContainers = new Map<string, Container>();
  private backgroundTexture: Texture | null = null;
  private input = { x: 0, y: 0 };
  private velocity: OverworldPoint = { x: 0, y: 0 };
  private position: OverworldPoint;
  private facing: OverworldFacing;
  private paused = false;
  private destroyed = false;
  private moving = false;
  private firstMoveReported = false;
  private frameClock = 0;
  private frameIndex = 0;
  private footfallClock = 0;
  private checkpointClock = 0;
  private lastFrameAt = performance.now();
  private destinationStates: DestinationStateMap = {};
  private proximity: OverworldProximity = null;
  private activeTraversal: { node: TraversalNode; segment: number } | null =
    null;
  private audioContext: AudioContext | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private resizeFrame = 0;
  private readonly debugNavigation =
    import.meta.env.DEV &&
    new URLSearchParams(window.location.search).has("goldlineNavDebug");
  private reducedMotion =
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  private constructor(
    private readonly host: HTMLElement,
    private readonly backgroundUrl: string,
    checkpoint: OverworldCheckpoint | null,
    private readonly callbacks: OverworldRuntimeCallbacks
  ) {
    const fallback = MAP.spawns[MAP.defaultSpawnId]!;
    const restored = checkpoint
      ? nearestValidPoint(
          MAP,
          { x: checkpoint.x, y: checkpoint.y },
          PLAYER_RADIUS
        )
      : fallback;
    this.position = { x: restored.x, y: restored.y };
    this.facing = checkpoint?.facing ?? "back";
    if (
      checkpoint &&
      (restored.x !== checkpoint.x || restored.y !== checkpoint.y)
    ) {
      callbacks.onRecovered?.();
    }
  }

  static async create(input: {
    host: HTMLElement;
    backgroundUrl: string;
    checkpoint: OverworldCheckpoint | null;
    callbacks: OverworldRuntimeCallbacks;
    destinationStates: DestinationStateMap;
  }) {
    const runtime = new GoldlineOverworldRuntime(
      input.host,
      input.backgroundUrl,
      input.checkpoint,
      input.callbacks
    );
    runtime.destinationStates = input.destinationStates;
    await runtime.initialize();
    return runtime;
  }

  private async initialize() {
    const initialBounds = this.host.getBoundingClientRect();
    await this.app.init({
      width: Math.max(1, Math.round(initialBounds.width)),
      height: Math.max(1, Math.round(initialBounds.height)),
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      preference: "webgl",
    });
    if (this.destroyed) return;
    this.host.appendChild(this.app.canvas);
    this.app.canvas.className = "goldline-overworld-canvas";
    this.world.sortableChildren = true;
    this.app.stage.addChild(this.world);

    const [background] = await Promise.all([
      Assets.load<Texture>(this.backgroundUrl),
      ...directionalUrls.map(url => Assets.load<Texture>(url)),
    ]);
    if (this.destroyed) return;
    this.backgroundTexture = background;
    for (const url of directionalUrls)
      this.textures.set(url, Texture.from(url));

    const backgroundSprite = new Sprite(background);
    backgroundSprite.width = MAP.width;
    backgroundSprite.height = MAP.height;
    backgroundSprite.zIndex = 0;
    this.world.addChild(backgroundSprite);
    if (this.debugNavigation) this.buildNavigationDebug();

    this.shadow.ellipse(0, 0, 21, 7).fill({ color: 0x020507, alpha: 0.42 });
    this.shadow.zIndex = 1990;
    this.world.addChild(this.shadow);

    this.player.anchor.set(0.5, 0.88);
    this.player.zIndex = 2000;
    this.world.addChild(this.player);

    this.footfall.zIndex = 1980;
    this.world.addChild(this.footfall);
    this.buildOccluders(background);
    this.buildDestinationMarkers();
    this.setPlayerTexture();
    this.updatePlayerPresentation();
    this.resize();
    this.resizeObserver = new ResizeObserver(this.queueResize);
    this.resizeObserver.observe(this.host);
    this.app.ticker.add(this.tick);
    window.addEventListener("resize", this.queueResize);
    window.addEventListener("orientationchange", this.queueResize);
    window.visualViewport?.addEventListener("resize", this.queueResize);
    window.visualViewport?.addEventListener("scroll", this.queueResize);
    document.addEventListener("visibilitychange", this.handleVisibility);
    window.addEventListener("pagehide", this.saveNow);
    this.installTestApi();
  }

  private installTestApi() {
    if (
      !import.meta.env.DEV ||
      !new URLSearchParams(window.location.search).has(
        "goldlineOverworldFixture"
      )
    )
      return;
    const testWindow = window as typeof window & {
      __goldlineOverworldTest?: {
        getState: () => unknown;
        runRoute: (points: OverworldPoint[]) => unknown;
        teleport: (point: OverworldPoint) => unknown;
      };
    };
    testWindow.__goldlineOverworldTest = {
      getState: () => ({
        position: { ...this.position },
        surfaceId: surfaceAtPoint(MAP, this.position),
        walkable: isWalkable(MAP, this.position, PLAYER_RADIUS),
        viewport: {
          width: this.app.screen.width,
          height: this.app.screen.height,
        },
      }),
      teleport: point => {
        const recovered = nearestValidPoint(MAP, point, PLAYER_RADIUS);
        this.position = { x: recovered.x, y: recovered.y };
        this.velocity = { x: 0, y: 0 };
        this.updatePlayerPresentation();
        this.updateCamera(1);
        this.updateProximity();
        return { ...this.position, surfaceId: recovered.surfaceId };
      },
      runRoute: points => {
        const reached: OverworldPoint[] = [];
        const failures: Array<{
          target: OverworldPoint;
          position: OverworldPoint;
        }> = [];
        for (const target of points) {
          let frames = 0;
          while (distance(this.position, target) > 5 && frames < 1200) {
            const dx = target.x - this.position.x;
            const dy = target.y - this.position.y;
            const magnitude = Math.hypot(dx, dy) || 1;
            this.input = { x: dx / magnitude, y: dy / magnitude };
            this.stepPlayer(1 / 60);
            frames += 1;
          }
          if (distance(this.position, target) > 7) {
            failures.push({ target, position: { ...this.position } });
            break;
          }
          reached.push(target);
        }
        this.input = { x: 0, y: 0 };
        this.velocity = { x: 0, y: 0 };
        this.moving = false;
        this.updateAnimation(0);
        this.updatePlayerPresentation();
        this.updateCamera(1);
        this.updateProximity();
        this.saveNow();
        return {
          reached: reached.length,
          failures,
          position: { ...this.position },
          surfaceId: surfaceAtPoint(MAP, this.position),
          walkable: isWalkable(MAP, this.position, PLAYER_RADIUS),
        };
      },
    };
  }

  private buildOccluders(texture: Texture) {
    for (const region of MAP.occluders) {
      const overlay = new Sprite(texture);
      overlay.width = MAP.width;
      overlay.height = MAP.height;
      overlay.zIndex = 9000;
      const mask = new Graphics()
        .poly(region.polygon.flatMap(point => [point.x, point.y]))
        .fill({ color: 0xffffff });
      mask.zIndex = 8999;
      overlay.mask = mask;
      this.world.addChild(mask, overlay);
    }
  }

  private buildNavigationDebug() {
    const overlay = new Graphics();
    for (const surface of MAP.surfaces) {
      overlay
        .poly(surface.polygon.flatMap(point => [point.x, point.y]))
        .fill({ color: 0x35e88b, alpha: 0.22 })
        .stroke({ color: 0x72ffb2, alpha: 0.85, width: 3 });
    }
    for (const corridor of MAP.corridors) {
      overlay.moveTo(corridor.points[0]!.x, corridor.points[0]!.y);
      for (const point of corridor.points.slice(1))
        overlay.lineTo(point.x, point.y);
      overlay.stroke({
        color: 0xffd84d,
        alpha: 0.34,
        width: corridor.halfWidth * 2,
      });
      overlay.moveTo(corridor.points[0]!.x, corridor.points[0]!.y);
      for (const point of corridor.points.slice(1))
        overlay.lineTo(point.x, point.y);
      overlay.stroke({ color: 0xfff3a0, alpha: 0.95, width: 2 });
    }
    overlay.zIndex = 15000;
    this.world.addChild(overlay);
  }

  private buildDestinationMarkers() {
    for (const destination of MAP.destinations) {
      const container = new Container();
      const beacon = new Graphics()
        .circle(0, 0, 12)
        .fill({
          color: destination.id === "greystar-6" ? 0xffd86a : 0xb8d8e1,
          alpha: 0.24,
        })
        .circle(0, 0, 4)
        .fill({
          color: destination.id === "greystar-6" ? 0xffe993 : 0xd4eef3,
          alpha: 0.9,
        });
      const label = new Text({
        text: destination.name,
        style: {
          fontFamily: "Cinzel, Georgia, serif",
          fontSize: 13,
          fontWeight: "800",
          fill: 0xfff0b1,
          stroke: { color: 0x061018, width: 4 },
          align: "center",
        },
      });
      label.anchor.set(0.5, 0);
      label.y = 14;
      label.visible =
        (this.destinationStates[destination.id] ?? "locked") === "active";
      label.label = "destination-label";
      container.position.set(destination.point.x, destination.point.y);
      container.zIndex = 11000;
      container.addChild(beacon, label);
      this.markerContainers.set(destination.id, container);
      this.world.addChild(container);
    }
  }

  private tick = () => {
    const now = performance.now();
    const deltaSeconds = Math.min(
      0.04,
      Math.max(0, (now - this.lastFrameAt) / 1000)
    );
    this.lastFrameAt = now;
    if (this.paused || this.destroyed) return;

    if (this.activeTraversal) this.stepTraversal(deltaSeconds);
    else this.stepPlayer(deltaSeconds);
    this.updateAnimation(deltaSeconds);
    this.updatePlayerPresentation();
    this.updateCamera(deltaSeconds);
    this.updateProximity();
    this.updateMarkers(now);

    this.checkpointClock += deltaSeconds * 1000;
    if (this.checkpointClock >= CHECKPOINT_INTERVAL_MS) {
      this.checkpointClock = 0;
      this.saveNow();
    }
  };

  private stepPlayer(deltaSeconds: number) {
    const analog = remapAnalogInput(this.input.x, this.input.y);
    this.velocity = stepVelocity(this.velocity, analog, deltaSeconds);
    const speed = Math.hypot(this.velocity.x, this.velocity.y);
    const next = moveWithCollision(
      MAP,
      this.position,
      { x: this.velocity.x * deltaSeconds, y: this.velocity.y * deltaSeconds },
      PLAYER_RADIUS
    );
    const assisted = applyCorridorAssist(MAP, next, deltaSeconds);
    this.position = moveWithCollision(
      MAP,
      next,
      { x: assisted.x - next.x, y: assisted.y - next.y },
      PLAYER_RADIUS
    );
    this.facing = facingForVelocity(this.velocity, this.facing);
    this.moving = speed >= 8;
    if (this.moving && !this.firstMoveReported) {
      this.firstMoveReported = true;
      this.callbacks.onFirstMove?.();
    }
  }

  private stepTraversal(deltaSeconds: number) {
    const traversal = this.activeTraversal!;
    const nextPoint = traversal.node.path[traversal.segment + 1];
    if (!nextPoint) {
      this.activeTraversal = null;
      this.velocity = { x: 0, y: 0 };
      this.callbacks.onTraversalComplete?.(traversal.node.id);
      return;
    }
    const dx = nextPoint.x - this.position.x;
    const dy = nextPoint.y - this.position.y;
    const remaining = Math.hypot(dx, dy);
    const step = Math.min(remaining, 125 * deltaSeconds);
    this.velocity = {
      x: (dx / (remaining || 1)) * 125,
      y: (dy / (remaining || 1)) * 125,
    };
    this.position = {
      x: this.position.x + (dx / (remaining || 1)) * step,
      y: this.position.y + (dy / (remaining || 1)) * step,
    };
    this.facing = facingForVelocity(this.velocity, this.facing);
    this.moving = true;
    if (remaining <= step + 0.5) traversal.segment += 1;
  }

  private updateAnimation(deltaSeconds: number) {
    if (!this.moving) {
      if (this.frameIndex !== 0) {
        this.frameIndex = 0;
        this.setPlayerTexture();
      }
      return;
    }
    const speed = Math.hypot(this.velocity.x, this.velocity.y);
    const interval = PLAYER_FRAME_SECONDS * Math.max(0.62, 1.2 - speed / 240);
    this.frameClock += deltaSeconds;
    if (this.frameClock >= interval) {
      this.frameClock %= interval;
      this.frameIndex = (this.frameIndex + 1) % 5;
      this.setPlayerTexture();
      this.emitFootfall();
    }
  }

  private setPlayerTexture() {
    const url = this.moving
      ? `${DIRECTIONAL_BASE}/walk-${this.facing}-${String(this.frameIndex + 1).padStart(2, "0")}.webp`
      : `${DIRECTIONAL_BASE}/idle-${this.facing}.webp`;
    const texture = this.textures.get(url);
    if (texture) this.player.texture = texture;
  }

  private emitFootfall() {
    this.footfallClock += 1;
    if (this.footfallClock % 2 !== 0) return;
    const material = materialAtPoint(MAP, this.position);
    const color =
      material === "wood"
        ? 0xc79152
        : material === "crystal"
          ? 0x8be8ff
          : material === "grass"
            ? 0xa9c879
            : 0xd0b995;
    this.footfall
      .clear()
      .circle(this.position.x, this.position.y + 2, 8)
      .stroke({ color, alpha: 0.5, width: 2 });
    this.footfall.alpha = 1;
    this.playFootstep(material);
    if (material === "wood" && this.footfallClock % 4 === 0) {
      navigator.vibrate?.(8);
    }
  }

  private playFootstep(material: ReturnType<typeof materialAtPoint>) {
    const context = this.audioContext;
    if (!context || context.state !== "running") return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const frequencies = {
      wood: 155,
      stone: 105,
      grass: 78,
      crystal: 390,
    } as const;
    oscillator.type = material === "crystal" ? "sine" : "triangle";
    oscillator.frequency.setValueAtTime(
      frequencies[material],
      context.currentTime
    );
    oscillator.frequency.exponentialRampToValueAtTime(
      Math.max(45, frequencies[material] * 0.72),
      context.currentTime + 0.055
    );
    gain.gain.setValueAtTime(0.018, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.07);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.075);
  }

  private updatePlayerPresentation() {
    const perspective = 0.76 + (this.position.y / MAP.height) * 0.25;
    const textureHeight = Math.max(1, this.player.texture.height);
    const spriteScale =
      (PLAYER_PRESENTATION_HEIGHT / textureHeight) * perspective;
    this.player.position.set(this.position.x, this.position.y);
    this.player.scale.set(spriteScale);
    this.player.rotation =
      this.moving && materialAtPoint(MAP, this.position) === "wood"
        ? Math.sin(performance.now() / 115) * 0.014
        : 0;
    this.player.zIndex = 2000 + this.position.y;
    this.shadow.position.set(this.position.x, this.position.y + 1);
    this.shadow.scale.set(perspective);
    this.shadow.zIndex = this.player.zIndex - 2;
    this.footfall.zIndex = this.player.zIndex - 3;
    this.footfall.alpha = Math.max(0, this.footfall.alpha - 0.08);
  }

  private updateCamera(deltaSeconds: number) {
    const viewportWidth = this.app.screen.width;
    const viewportHeight = this.app.screen.height;
    if (this.debugNavigation) {
      const scale =
        Math.min(viewportWidth / MAP.width, viewportHeight / MAP.height) * 0.98;
      this.world.scale.set(scale);
      this.world.x = (viewportWidth - MAP.width * scale) / 2;
      this.world.y = (viewportHeight - MAP.height * scale) / 2;
      return;
    }
    const cover = Math.max(
      viewportWidth / MAP.width,
      viewportHeight / MAP.height
    );
    const scale = cover * CAMERA_ZOOM;
    this.world.scale.set(scale);
    const lookaheadX = this.reducedMotion
      ? 0
      : this.velocity.x * LOOKAHEAD_SECONDS * scale;
    const lookaheadY = this.reducedMotion
      ? 0
      : this.velocity.y * LOOKAHEAD_SECONDS * scale;
    const targetX = viewportWidth / 2 - this.position.x * scale - lookaheadX;
    const targetY = viewportHeight / 2 - this.position.y * scale - lookaheadY;
    const minX = viewportWidth - MAP.width * scale;
    const minY = viewportHeight - MAP.height * scale;
    const boundedX = Math.min(0, Math.max(minX, targetX));
    const boundedY = Math.min(0, Math.max(minY, targetY));
    const easing = this.reducedMotion
      ? 1
      : Math.min(1, deltaSeconds * CAMERA_EASE_PER_SECOND);
    this.world.x += (boundedX - this.world.x) * easing;
    this.world.y += (boundedY - this.world.y) * easing;
  }

  private updateProximity() {
    const nearest = MAP.destinations
      .map(destination => ({
        destination,
        distance: distance(this.position, destination.point),
      }))
      .filter(item => item.distance <= item.destination.approachRadius)
      .sort((a, b) => a.distance - b.distance)[0];
    const next: OverworldProximity = nearest
      ? {
          destination: nearest.destination,
          availability:
            this.destinationStates[nearest.destination.id] ?? "locked",
          canAct: nearest.distance <= nearest.destination.entranceRadius,
        }
      : null;
    const previousKey = this.proximity
      ? `${this.proximity.destination.id}:${this.proximity.availability}:${this.proximity.canAct}`
      : "none";
    const nextKey = next
      ? `${next.destination.id}:${next.availability}:${next.canAct}`
      : "none";
    if (previousKey !== nextKey) {
      this.proximity = next;
      this.callbacks.onProximityChange(next);
    }
  }

  private updateMarkers(now: number) {
    for (const destination of MAP.destinations) {
      const marker = this.markerContainers.get(destination.id);
      if (!marker) continue;
      const availability = this.destinationStates[destination.id] ?? "locked";
      const near =
        distance(this.position, destination.point) <=
        destination.approachRadius * 1.5;
      marker.alpha =
        availability === "active"
          ? 0.78 + Math.sin(now / 330) * 0.18
          : availability === "completed"
            ? 0.75
            : near
              ? 0.55
              : 0.2;
      const label = marker.getChildByLabel("destination-label");
      if (label) label.visible = near || availability === "active";
    }
  }

  setInput(x: number, y: number) {
    if (this.paused || this.activeTraversal) return;
    if ((x !== 0 || y !== 0) && !this.audioContext) {
      const AudioContextClass =
        window.AudioContext ??
        (
          window as typeof window & {
            webkitAudioContext?: typeof AudioContext;
          }
        ).webkitAudioContext;
      if (AudioContextClass) {
        this.audioContext = new AudioContextClass();
        void this.audioContext.resume();
      }
    }
    this.input = { x, y };
  }

  setPaused(paused: boolean) {
    this.paused = paused;
    if (paused) {
      this.input = { x: 0, y: 0 };
      this.velocity = { x: 0, y: 0 };
    }
  }

  setDestinationStates(states: DestinationStateMap) {
    this.destinationStates = states;
    this.updateProximity();
  }

  performContextAction(): "entered" | "locked" | "traversal" | "none" {
    if (!this.proximity?.canAct) return "none";
    if (this.proximity.availability !== "active") return "locked";
    if (this.proximity.destination.action === "enter") {
      this.saveNow();
      return "entered";
    }
    const traversal = MAP.traversals.find(
      item => item.id === this.proximity?.destination.traversalId
    );
    if (traversal) {
      this.activeTraversal = { node: traversal, segment: 0 };
      this.input = { x: 0, y: 0 };
      return "traversal";
    }
    return "locked";
  }

  saveNow = () => {
    const surfaceId = surfaceAtPoint(MAP, this.position);
    if (!surfaceId) return;
    this.callbacks.onCheckpoint({
      mapVersion: MAP.version,
      x: this.position.x,
      y: this.position.y,
      surfaceId,
      facing: this.facing,
      savedAt: new Date().toISOString(),
    });
  };

  private queueResize = () => {
    cancelAnimationFrame(this.resizeFrame);
    this.resizeFrame = requestAnimationFrame(this.resize);
  };

  resize = () => {
    if (!this.app.renderer) return;
    const bounds = this.host.getBoundingClientRect();
    const width = Math.max(1, Math.round(bounds.width));
    const height = Math.max(1, Math.round(bounds.height));
    if (this.app.screen.width !== width || this.app.screen.height !== height) {
      this.app.renderer.resize(width, height);
    }
    this.app.canvas.style.setProperty("width", `${width}px`, "important");
    this.app.canvas.style.setProperty("height", `${height}px`, "important");
    this.updateCamera(1);
  };

  private handleVisibility = () => {
    if (document.hidden) this.saveNow();
    this.setPaused(document.hidden);
  };

  async destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.saveNow();
    cancelAnimationFrame(this.resizeFrame);
    this.resizeObserver?.disconnect();
    window.removeEventListener("resize", this.queueResize);
    window.removeEventListener("orientationchange", this.queueResize);
    window.visualViewport?.removeEventListener("resize", this.queueResize);
    window.visualViewport?.removeEventListener("scroll", this.queueResize);
    window.removeEventListener("pagehide", this.saveNow);
    document.removeEventListener("visibilitychange", this.handleVisibility);
    this.app.ticker.remove(this.tick);
    if (this.audioContext) void this.audioContext.close();
    const testWindow = window as typeof window & {
      __goldlineOverworldTest?: unknown;
    };
    delete testWindow.__goldlineOverworldTest;
    this.app.destroy(true, { children: true });
  }
}
