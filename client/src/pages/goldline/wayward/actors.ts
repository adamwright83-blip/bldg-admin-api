import { Container, Graphics, Sprite, Texture } from "pixi.js";
import {
  FACINGS,
  ROOK_ANCHOR_Y,
  ROOK_STANDING_PX,
  ROOK_STATES,
  TRAILBLAZER,
  rookFacing,
  rookKey,
  type Facing,
  type RookFrames,
  type RookState,
  type TrailblazerPose,
} from "./waywardAssets";
import type { Vec } from "./holdTheLine";

/**
 * Trailblazer, from her delivered frames only: four-way idle and walk, plus the
 * single authored action poses (reach, hang, crouch-land, lunge, leap). Poses
 * are held, never interpolated, exactly as the art README describes them.
 */
export class TrailblazerActor {
  readonly view = new Container();
  private readonly sprite = new Sprite();
  private readonly shadow = new Graphics();
  position: Vec;
  facing: Facing = "back";
  velocity: Vec = { x: 0, y: 0 };
  moving = false;
  /** Presentation height at depth scale 1. */
  height: number;
  private frameClock = 0;
  private frame = 0;
  private pose: TrailblazerPose | null = null;
  private poseFlip = false;
  private poseRotation = 0;
  private tint = 0xffffff;
  /** Extra draw offset (hanging from a line, being yanked). */
  offset: Vec = { x: 0, y: 0 };
  scale = 1;
  onStep: (() => void) | null = null;

  constructor(private readonly textures: Map<string, Texture>, start: Vec, height: number) {
    this.position = { ...start };
    this.height = height;
    this.shadow.ellipse(0, 0, 30, 9).fill({ color: 0x05070a, alpha: 0.38 });
    this.view.addChild(this.shadow, this.sprite);
  }

  setPose(pose: TrailblazerPose | null, options: { flip?: boolean; rotation?: number } = {}) {
    this.pose = pose;
    this.poseFlip = options.flip ?? false;
    this.poseRotation = options.rotation ?? 0;
  }

  get currentPose() {
    return this.pose;
  }

  setTint(color: number) {
    this.tint = color;
  }

  update(dt: number) {
    if (this.pose) {
      this.frame = 0;
      return;
    }
    if (!this.moving) {
      this.frame = 0;
      this.frameClock = 0;
      return;
    }
    const speed = Math.hypot(this.velocity.x, this.velocity.y);
    const interval = 0.095 * Math.max(0.62, 1.2 - speed / 240);
    this.frameClock += dt;
    if (this.frameClock >= interval) {
      this.frameClock %= interval;
      this.frame = (this.frame + 1) % 5;
      if (this.frame % 2 === 0) this.onStep?.();
    }
  }

  /** depthScale: the stage's perspective scale at her feet. */
  present(depthScale: number, showShadow = true) {
    const s = depthScale * this.scale;
    let texture: Texture | undefined;
    if (this.pose) {
      texture = this.textures.get(TRAILBLAZER.poses[this.pose]);
      if (texture) {
        this.sprite.texture = texture;
        this.sprite.anchor.set(0.5, TRAILBLAZER.poseFeetY);
        const k = (this.height / TRAILBLAZER.poseStandingPx) * s;
        this.sprite.scale.set(this.poseFlip ? -k : k, k);
        this.sprite.rotation = this.poseRotation;
      }
    } else {
      const url = TRAILBLAZER.directional(this.moving ? "walk" : "idle", this.facing, this.frame + 1);
      texture = this.textures.get(url);
      if (texture) {
        this.sprite.texture = texture;
        this.sprite.anchor.set(0.5, 0.97);
        const k = (this.height / Math.max(1, texture.height)) * s;
        this.sprite.scale.set(k);
        this.sprite.rotation = this.moving ? Math.sin(performance.now() / 115) * 0.012 : 0;
      }
    }
    this.sprite.tint = this.tint;
    this.sprite.position.set(this.offset.x, this.offset.y);
    this.shadow.visible = showShadow;
    this.shadow.scale.set(s * Math.max(0.3, 1 - Math.abs(this.offset.y) / 260));
    this.shadow.alpha = Math.max(0.1, 1 - Math.abs(this.offset.y) / 200);
    this.view.position.set(this.position.x, this.position.y);
  }

  /** Where her hand is when she casts, in stage units. */
  handPoint(depthScale: number): Vec {
    const reach = this.facing === "left" ? -18 : this.facing === "right" ? 18 : 6;
    return { x: this.position.x + reach * depthScale, y: this.position.y - this.height * 0.8 * depthScale };
  }
}

/**
 * Rook, from the overworld sheets rendered off his approved model. He walks on
 * his own two feet — the walk cycle is a person's walk — and every gesture is a
 * rendered state, never a transform trick.
 */
export class RookActor {
  readonly view = new Container();
  private readonly sprite = new Sprite();
  private readonly shadow = new Graphics();
  position: Vec;
  facing: Facing = "back";
  state: RookState = "idle";
  private clock = 0;
  private frame = 0;
  private done = false;
  private onDone: (() => void) | null = null;
  /** Presentation height at depth scale 1. */
  height: number;
  offset: Vec = { x: 0, y: 0 };
  rotation = 0;
  visible = true;
  onStep: (() => void) | null = null;
  private walkFps = 14;

  constructor(private readonly frames: RookFrames, start: Vec, height: number) {
    this.position = { ...start };
    this.height = height;
    this.shadow.ellipse(0, 0, 24, 7).fill({ color: 0x05070a, alpha: 0.34 });
    this.sprite.anchor.set(0.5, ROOK_ANCHOR_Y);
    this.view.addChild(this.shadow, this.sprite);
  }

  /** Play a state. One-shots hold their last frame and call `then` once. */
  play(state: RookState, facing: Facing = this.facing, then?: () => void) {
    if (state !== this.state || facing !== this.facing || then) {
      const restart = state !== this.state || Boolean(then);
      this.state = state;
      this.facing = facing;
      if (restart) {
        this.clock = 0;
        this.frame = 0;
        this.done = false;
      }
      this.onDone = then ?? null;
    }
  }

  get isDone() {
    return this.done;
  }

  update(dt: number) {
    const spec = ROOK_STATES.find(item => item.state === this.state)!;
    this.clock += dt;
    const step = 1 / (this.state === "walk" ? this.walkFps : spec.fps);
    while (this.clock >= step) {
      this.clock -= step;
      if (spec.loop) {
        this.frame = (this.frame + 1) % spec.frames;
        if (this.state === "walk" && (this.frame === 2 || this.frame === 7)) this.onStep?.();
      } else if (this.frame < spec.frames - 1) {
        this.frame += 1;
      } else if (!this.done) {
        this.done = true;
        const callback = this.onDone;
        this.onDone = null;
        callback?.();
      }
    }
  }

  /** Walk speed decides cadence: the feet should not skate. */
  setWalkRate(speed: number, depthScale = 1) {
    // One cycle (two steps) covers ~64 units of ground at scale 1.
    this.walkFps = Math.max(8, Math.min(24, (speed / (64 * Math.max(0.3, depthScale))) * 10));
  }

  present(depthScale: number, showShadow = true) {
    this.view.visible = this.visible;
    const facing = rookFacing(this.state, this.facing);
    const textures = this.frames.get(rookKey(this.state, facing)) ?? this.frames.get(rookKey("idle", facing));
    const texture = textures?.[Math.min(this.frame, (textures?.length ?? 1) - 1)];
    if (texture) this.sprite.texture = texture;
    const k = (this.height / ROOK_STANDING_PX) * depthScale;
    this.sprite.scale.set(k);
    this.sprite.rotation = this.rotation;
    this.sprite.position.set(this.offset.x, this.offset.y);
    this.shadow.visible = showShadow;
    this.shadow.scale.set(depthScale * Math.max(0.3, 1 - Math.abs(this.offset.y) / 240));
    this.view.position.set(this.position.x, this.position.y);
  }
}

export { FACINGS };
