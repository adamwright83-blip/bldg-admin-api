import { Container, FillGradient, Graphics, MeshRope, Point, Sprite, Texture } from "pixi.js";
import cacheUrl from "@/assets/goldline/heartbeat/pickup_cache_objective.png";
import { lerp, smoothstep, type Vec } from "./holdTheLine";
import { PLATES, SPAN_LAYOUT, spanPartUrl } from "./waywardAssets";
import { CACHE_REACH, DECK_SPAWN, DECK_WALK, GUARDIAN, GUARDIAN_HEIGHT, GUARDIAN_LIGHTS, HULL_CACHE, SPAN_TRIGGER } from "./waywardGeometry";
import { isWalkable } from "../overworld/navigation";
import { DECK_MAP } from "./waywardMaps";

export { CACHE_REACH, DECK_SPAWN, DECK_WALK, GUARDIAN, HULL_CACHE, SPAN_TRIGGER };

export const HULL_CACHE_URL = cacheUrl;

/**
 * The Wayward's deck, seen from behind Trailblazer: the approved bridge plate,
 * with Mooring City ahead and the broken span waiting at the far end of the
 * deck. The plate is the stage; everything that moves is a live layer on it.
 */
const LANTERNS: Vec[] = [
  { x: 270, y: 590 }, { x: 486, y: 512 }, { x: 983, y: 506 }, { x: 1120, y: 596 }, { x: 1270, y: 432 },
];

export class DeckScene {
  readonly root = new Container();
  readonly actors = new Container();
  private readonly foreground: Sprite;
  private readonly lanternGlows: Graphics[] = [];
  private readonly ringHint: Sprite;
  private readonly hintRopes: { mesh: MeshRope; points: Point[] }[] = [];
  private readonly danglers: { mesh: MeshRope; points: Point[]; pivot: Vec; length: number; phase: number }[] = [];
  readonly cache: Sprite;
  private readonly cacheGlow = new Graphics();
  readonly seam = new Graphics();
  cacheTaken = false;
  private readonly guardian: Sprite;
  private readonly guardianEyes = new Graphics();
  /** 0..1: how close Trailblazer is to the sleeping guardian. */
  guardianNotice = 0;
  t = 0;
  /** 0..1: the dormant Gold Line seam brightens as she nears the span. */
  seamWarmth = 0;

  constructor(textures: Map<string, Texture>) {
    const sky = new Graphics();
    sky.rect(-400, -700, 2400, 760).fill(new FillGradient({
      type: "linear",
      start: { x: 0, y: 0 },
      end: { x: 0, y: 1 },
      colorStops: [{ offset: 0, color: 0x3a5c84 }, { offset: 1, color: 0xb9c5cf }],
      textureSpace: "local",
    }));
    this.root.addChild(sky);
    const plate = new Sprite(textures.get(PLATES.bridge)!);
    this.root.addChild(plate);

    for (let i = 0; i < 2; i += 1) {
      const points = Array.from({ length: 6 }, () => new Point(0, 0));
      const mesh = new MeshRope({ texture: textures.get(spanPartUrl("span-rope"))!, points, width: 2.5, textureScale: 1 });
      mesh.visible = false;
      this.root.addChild(mesh);
      this.hintRopes.push({ mesh, points });
    }
    this.ringHint = new Sprite(textures.get(spanPartUrl("span-ring"))!);
    const rb = SPAN_LAYOUT["span-ring"];
    this.ringHint.anchor.set((770 - rb.x) / rb.w, (297 - rb.y) / rb.h);
    this.ringHint.scale.set(0.13);
    this.ringHint.visible = false;
    this.root.addChild(this.ringHint);

    // A hair-thin Gold Line seam in the planks: dormant, until she comes close.
    this.root.addChild(this.seam);

    for (const at of LANTERNS) {
      const glow = new Graphics();
      for (let i = 5; i >= 1; i -= 1) glow.circle(0, 0, i * 9).fill({ color: 0xffb851, alpha: 0.06 });
      glow.position.set(at.x, at.y);
      glow.blendMode = "add";
      this.root.addChild(glow);
      this.lanternGlows.push(glow);
    }

    this.cacheGlow.position.set(HULL_CACHE.x, HULL_CACHE.y - 30);
    this.cacheGlow.blendMode = "add";
    this.root.addChild(this.cacheGlow);
    this.cache = new Sprite(Texture.from(cacheUrl));
    this.cache.anchor.set(0.5, 0.9);
    this.cache.position.set(HULL_CACHE.x, HULL_CACHE.y);
    this.cache.scale.set(88 / Math.max(1, this.cache.texture.height || 256));
    this.root.addChild(this.cache);

    // The Tether Guardian: stone, bronze and generations of rope law, asleep at the head of the deck.
    this.guardian = new Sprite(textures.get(PLATES.guardian)!);
    this.guardian.anchor.set(0.46, 0.97);
    this.guardian.position.set(GUARDIAN.x, GUARDIAN.y);
    this.guardian.scale.set(GUARDIAN_HEIGHT / 900);
    this.guardian.tint = 0x8d8f95;
    this.guardian.zIndex = GUARDIAN.y;
    this.guardianEyes.blendMode = "add";
    this.guardianEyes.position.set(GUARDIAN.x, GUARDIAN.y);
    this.actors.sortableChildren = true;
    this.actors.addChild(this.guardian);
    this.root.addChild(this.actors);
    this.root.addChild(this.guardianEyes);

    // Loose rigging hanging into the frame, moving in the wind.
    const rope = textures.get(spanPartUrl("span-rope"))!;
    rope.source.style.addressMode = "repeat";
    const specs = [
      { pivot: { x: 520, y: -40 }, length: 330, phase: 0.3 },
      { pivot: { x: 1010, y: -60 }, length: 390, phase: 1.9 },
      { pivot: { x: 1180, y: -30 }, length: 300, phase: 3.1 },
    ];
    for (const spec of specs) {
      const points = Array.from({ length: 8 }, () => new Point(0, 0));
      const mesh = new MeshRope({ texture: rope, points, width: 5, textureScale: 1 });
      mesh.tint = 0x7d5d3c;
      this.root.addChild(mesh);
      this.danglers.push({ mesh, points, pivot: spec.pivot, length: spec.length, phase: spec.phase });
    }

    this.foreground = new Sprite(textures.get(PLATES.deckForeground)!);
    this.root.addChild(this.foreground);
  }

  walkable(p: Vec): boolean {
    return isWalkable(DECK_MAP, p);
  }

  /** The plate's perspective: a person at the far end of the deck is ~60% of one up close. */
  depthScale(y: number): number {
    return lerp(0.6, 1.05, smoothstep(456, 640, y));
  }

  update(t: number, camera: Vec, windGust: number) {
    this.t = t;
    const ring = { x: 808 + Math.sin(t * 1.83) * 3, y: 414 + Math.sin(t * 2.4) * 1.5 };
    this.ringHint.position.set(ring.x, ring.y);
    this.ringHint.rotation = Math.sin(t * 1.83) * 0.05;
    const anchors = [{ x: 760, y: 360 }, { x: 858, y: 356 }];
    this.hintRopes.forEach((rope, index) => {
      const a = anchors[index]!;
      const b = { x: ring.x + (index ? 18 : -18), y: ring.y - 3 };
      rope.points.forEach((p, i) => {
        const f = i / (rope.points.length - 1);
        p.set(lerp(a.x, b.x, f), lerp(a.y, b.y, f) + Math.sin(f * Math.PI) * 5);
      });
    });
    for (const d of this.danglers) {
      const angle = Math.sin(t * 0.9 + d.phase) * 0.07 + windGust * 0.08;
      d.points.forEach((p, i) => {
        const f = i / (d.points.length - 1);
        const a = angle * (0.5 + f * 0.8) + Math.sin(t * 2.2 + d.phase + f * 2) * 0.012 * f;
        p.set(d.pivot.x - Math.sin(a) * d.length * f, d.pivot.y + Math.cos(a) * d.length * f);
      });
    }
    this.lanternGlows.forEach((glow, i) => {
      glow.alpha = 0.75 + Math.sin(t * 9 + i * 1.7) * 0.12 + Math.sin(t * 23 + i) * 0.08;
    });
    this.foreground.position.set((camera.x - 768) * -0.03, 0);

    // The guardian does not wake. It notices.
    const n = this.guardianNotice;
    this.guardian.rotation = Math.sin(t * 0.4) * 0.004 + n * -0.018;
    const eyes = this.guardianEyes.clear();
    const k = GUARDIAN_HEIGHT / 900;
    for (const light of GUARDIAN_LIGHTS) {
      const lx = (light.x - 0.46 * 720) * k;
      const ly = (light.y - 0.97 * 900) * k;
      const glow = 0.25 + 0.2 * Math.sin(t * 1.3 + light.x) + n * 0.55;
      for (let i = 3; i >= 1; i -= 1) eyes.circle(lx, ly, light.r * k * 3 * i).fill({ color: 0x59c7ff, alpha: 0.05 * glow });
      eyes.circle(lx, ly, light.r * k * 1.6).fill({ color: 0xc8f0ff, alpha: 0.5 * glow });
    }
    this.cache.visible = !this.cacheTaken;
    this.cacheGlow.clear();
    if (!this.cacheTaken) {
      const pulse = 0.5 + Math.sin(t * 2.6) * 0.5;
      for (let i = 4; i >= 1; i -= 1) this.cacheGlow.circle(0, 0, 14 + i * 9 + pulse * 6).fill({ color: 0xffd36b, alpha: 0.05 });
    }

    // Dormant seam: a hair of gold running up the deck toward the span.
    const seam = this.seam.clear();
    const warmth = this.seamWarmth;
    const flicker = 0.25 + 0.15 * Math.sin(t * 5.3) + warmth * 0.6;
    seam.moveTo(772, 646).lineTo(774, 560).lineTo(771, 500).lineTo(773, 458);
    seam.stroke({ color: 0xffd36b, width: 1.4 + warmth * 1.4, alpha: Math.min(0.9, flicker) });
    if (warmth > 0.2) {
      seam.moveTo(772, 646).lineTo(774, 560).lineTo(771, 500).lineTo(773, 458);
      seam.stroke({ color: 0xffb040, width: 6 + warmth * 6, alpha: 0.08 * warmth });
    }
  }

  destroy() {
    this.root.destroy({ children: true });
  }
}
