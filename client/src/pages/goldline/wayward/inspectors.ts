import { Assets, Container, Graphics, Sprite, type Spritesheet, type Texture } from "pixi.js";
import type { Vec } from "./holdTheLine";

/**
 * Mooring City's rope inspectors (WORLD_BIBLE §17: a civilization built around
 * maintaining a ship that is legally forbidden to sail). Pell, tall, in a
 * teal greatcoat and stovepipe, laughs. Dunmore, short, in oxblood with a
 * peaked cap, does not. Rendered through the same camera and lights as Rook
 * (scripts/assets/blender/inspectors.py) so the parley reads as one world —
 * seen, not heard.
 */
export type InspectorPose = "idle" | "inspect" | "halt" | "listen" | "laugh" | "angry" | "read" | "pocket" | "tip" | "walk";
export type InspectorId = "pell" | "dunmore";

const POSES: Record<InspectorId, InspectorPose[]> = {
  pell: ["idle", "inspect", "halt", "listen", "laugh", "tip", "walk"],
  dunmore: ["idle", "halt", "listen", "angry", "read", "pocket", "walk"],
};
const SPEC: Record<InspectorPose, { fps: number; loop: boolean }> = {
  idle: { fps: 5, loop: true },
  inspect: { fps: 5, loop: true },
  halt: { fps: 12, loop: false },
  listen: { fps: 5, loop: true },
  laugh: { fps: 14, loop: true },
  angry: { fps: 11, loop: true },
  read: { fps: 4, loop: true },
  pocket: { fps: 9, loop: false },
  tip: { fps: 10, loop: false },
  walk: { fps: 13, loop: true },
};
/** In a 288² frame: feet at y=256; Pell's hat-top stands 247px above them. */
const ANCHOR_Y = 256 / 288;
const PELL_STANDING_PX = 247;

export const INSPECTOR_SHEETS = {
  pell: "/assets/goldline/wayward/voyage/inspector-pell.json",
  dunmore: "/assets/goldline/wayward/voyage/inspector-dunmore.json",
} as const;

export type InspectorFrames = Map<string, Texture[]>;

export async function loadInspectorFrames(): Promise<InspectorFrames> {
  const frames: InspectorFrames = new Map();
  for (const url of Object.values(INSPECTOR_SHEETS)) {
    const sheet = await Assets.load<Spritesheet>(url);
    for (const [name, textures] of Object.entries(sheet.animations)) frames.set(name, textures);
  }
  return frames;
}

export class InspectorActor {
  readonly view = new Container();
  private readonly sprite = new Sprite();
  private readonly shadow = new Graphics();
  position: Vec;
  facing: 1 | -1 = 1;
  pose: InspectorPose = "idle";
  private clock = 0;
  private frame = 0;
  walkSpeed = 0;

  /** `height` is Pell's full height with his hat; Dunmore shares the same scale. */
  constructor(private readonly frames: InspectorFrames, readonly who: InspectorId, start: Vec, readonly height: number) {
    this.position = { ...start };
    this.shadow.ellipse(0, 0, 30, 8).fill({ color: 0x05070a, alpha: 0.32 });
    this.sprite.anchor.set(0.5, ANCHOR_Y);
    this.view.addChild(this.shadow, this.sprite);
  }

  setPose(pose: InspectorPose) {
    const next = POSES[this.who].includes(pose) ? pose : "idle";
    if (next !== this.pose) {
      this.pose = next;
      this.clock = 0;
      this.frame = 0;
    }
  }

  update(dt: number) {
    const spec = SPEC[this.pose];
    const textures = this.textures();
    const count = textures?.length ?? 1;
    this.clock += dt;
    const step = 1 / spec.fps;
    while (this.clock >= step) {
      this.clock -= step;
      if (spec.loop) this.frame = (this.frame + 1) % count;
      else this.frame = Math.min(count - 1, this.frame + 1);
    }
  }

  private textures() {
    const side = this.facing < 0 ? "left" : "right";
    return this.frames.get(`${this.who}-${this.pose}-${side}`) ?? this.frames.get(`${this.who}-idle-${side}`);
  }

  present(depthScale: number) {
    const textures = this.textures();
    const texture = textures?.[Math.min(this.frame, textures.length - 1)];
    if (texture) this.sprite.texture = texture;
    this.sprite.scale.set((this.height / PELL_STANDING_PX) * depthScale);
    this.shadow.scale.set(depthScale);
    this.view.position.set(this.position.x, this.position.y);
  }
}
