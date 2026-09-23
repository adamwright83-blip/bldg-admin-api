import { Assets, Rectangle, Texture, type Spritesheet } from "pixi.js";

/**
 * Every image the Wayward voyage loads. All of it is approved art or cut
 * directly from approved art (scripts/assets/wayward/prep_span.py), plus Rook's
 * overworld sheets rendered from his approved model through the shared rig
 * (scripts/assets/blender/rook_rig.py).
 */
/** Where /assets lives. Empty in the app; "." when the voyage is built as a standalone page. */
export const ASSET_BASE: string = (import.meta.env.VITE_WAYWARD_ASSET_BASE as string | undefined) ?? "";
const W = `${ASSET_BASE}/assets/goldline/wayward`;
const V = `${W}/voyage`;
const TB = `${ASSET_BASE}/assets/goldline/characters/trailblazer`;
const ROOK = `${ASSET_BASE}/assets/goldline/companions/rook/overworld`;

export const PLATES = {
  bridge: `${W}/bridge-to-mooring-city.webp`,
  awakeDeck: `${W}/awakening-ship-deck.webp`,
  deckForeground: `${W}/ship-deck-foreground.webp`,
  guardian: `${W}/tether-guardian.webp`,
  openSky: `${V}/open-sky.webp`,
  mooringCity: `${V}/mooring-city.webp`,
  fog: `${ASSET_BASE}/assets/goldline/procedural-world-v1/08-cloud-fog-overlay.png`,
} as const;

export const SPAN_PARTS = [
  "span-left",
  "span-left-edge-1",
  "span-left-edge-2",
  "span-left-edge-3",
  "span-right-1",
  "span-right-2",
  "span-right-3",
  "span-right-4",
  "span-right-5",
  "span-crate",
  "span-barrel",
  "span-ring",
  "span-rope",
] as const;
export type SpanPartId = (typeof SPAN_PARTS)[number];

/** Painting-space placement of each span part (span-parts.json, inlined so layout never waits on a fetch). */
export const SPAN_LAYOUT: Record<Exclude<SpanPartId, "span-rope">, { x: number; y: number; w: number; h: number }> = {
  "span-left": { x: 0, y: 0, w: 653, h: 658 },
  "span-left-edge-1": { x: 496, y: 337, w: 73, h: 136 },
  "span-left-edge-2": { x: 552, y: 338, w: 66, h: 98 },
  "span-left-edge-3": { x: 604, y: 338, w: 76, h: 92 },
  "span-right-1": { x: 900, y: 150, w: 173, h: 320 },
  "span-right-2": { x: 1040, y: 150, w: 229, h: 411 },
  "span-right-3": { x: 1244, y: 117, w: 292, h: 521 },
  "span-right-4": { x: 1068, y: 0, w: 161, h: 151 },
  "span-right-5": { x: 1003, y: 0, w: 66, h: 151 },
  "span-crate": { x: 929, y: 470, w: 187, h: 164 },
  "span-barrel": { x: 1138, y: 248, w: 99, h: 101 },
  "span-ring": { x: 592, y: 221, w: 377, h: 154 },
};

export const spanPartUrl = (id: SpanPartId) => `${V}/${id}.webp`;

export type Facing = "front" | "back" | "left" | "right";
export const FACINGS: Facing[] = ["front", "back", "left", "right"];

/** Trailblazer's delivered frames. Content bounds measured from the art (x0, y0, x1, y1 in 512² poses). */
export const TRAILBLAZER = {
  directional: (state: "idle" | "walk", facing: Facing, frame = 1) =>
    state === "idle" ? `${TB}/directional/idle-${facing}.webp` : `${TB}/directional/walk-${facing}-${String(frame).padStart(2, "0")}.webp`,
  poses: {
    idle: `${TB}/idle.webp`,
    jump_start: `${TB}/jump_start.webp`,
    jump_air: `${TB}/jump_air.webp`,
    land: `${TB}/land.webp`,
    vault: `${TB}/vault.webp`,
    climb_a: `${TB}/climb_a.webp`,
    climb_b: `${TB}/climb_b.webp`,
    run_01: `${TB}/run_01.webp`,
    run_02: `${TB}/run_02.webp`,
    run_03: `${TB}/run_03.webp`,
    run_04: `${TB}/run_04.webp`,
    run_05: `${TB}/run_05.webp`,
  },
  /** Standing height inside a 512² pose (feet at y≈500). */
  poseStandingPx: 476,
  poseFeetY: 500 / 512,
} as const;
export type TrailblazerPose = keyof typeof TRAILBLAZER.poses;

export type RookState = "idle" | "walk" | "talk" | "confide" | "wait" | "letter" | "dangle" | "shrug" | "brace" | "point";
export const ROOK_STATES: { state: RookState; facings: Facing[]; frames: number; loop: boolean; fps: number }[] = [
  { state: "idle", facings: FACINGS, frames: 12, loop: true, fps: 7 },
  { state: "walk", facings: FACINGS, frames: 10, loop: true, fps: 14 },
  { state: "talk", facings: FACINGS, frames: 10, loop: true, fps: 10 },
  { state: "confide", facings: ["back", "left", "right"], frames: 8, loop: true, fps: 8 },
  { state: "wait", facings: ["front", "left", "right"], frames: 10, loop: false, fps: 12 },
  { state: "letter", facings: ["back", "left", "right"], frames: 12, loop: false, fps: 10 },
  { state: "dangle", facings: ["back", "left", "right"], frames: 6, loop: true, fps: 14 },
  { state: "shrug", facings: ["front", "left", "right"], frames: 8, loop: false, fps: 10 },
  { state: "brace", facings: FACINGS, frames: 6, loop: false, fps: 12 },
  { state: "point", facings: ["back", "left", "right"], frames: 6, loop: false, fps: 12 },
];
/** Rendered frame is 288²; his feet sit at this fraction of its height. */
export const ROOK_ANCHOR_Y = 0.908;
export const ROOK_FRAME = 288;
/** In a 288² frame the standing character is ~214px tall. */
export const ROOK_STANDING_PX = 214;

export type RookFrames = Map<string, Texture[]>;

export async function loadRookFrames(states: RookState[]): Promise<RookFrames> {
  const frames: RookFrames = new Map();
  await Promise.all(
    states.map(async state => {
      const sheet = await Assets.load<Spritesheet>(`${ROOK}/rook-${state}.json`);
      for (const [name, textures] of Object.entries(sheet.animations)) frames.set(name, textures);
    })
  );
  return frames;
}

export function rookKey(state: RookState, facing: Facing): string {
  return `${state}-${facing}`;
}

/** The facing Rook actually has frames for, nearest to the one asked for. */
export function rookFacing(state: RookState, facing: Facing): Facing {
  const spec = ROOK_STATES.find(item => item.state === state)!;
  if (spec.facings.includes(facing)) return facing;
  if (facing === "front") return spec.facings.includes("left") ? "left" : spec.facings[0]!;
  if (facing === "back") return spec.facings.includes("right") ? "right" : spec.facings[0]!;
  return spec.facings[0]!;
}

export async function loadTextures(urls: string[]): Promise<Map<string, Texture>> {
  const map = new Map<string, Texture>();
  const loaded = await Assets.load<Texture>(urls);
  for (const url of urls) map.set(url, (loaded as unknown as Record<string, Texture>)[url]!);
  return map;
}

/** A sub-rectangle of a loaded texture (for cutting sky bands out of a plate). */
export function subTexture(texture: Texture, x: number, y: number, w: number, h: number): Texture {
  return new Texture({ source: texture.source, frame: new Rectangle(x, y, w, h) });
}
