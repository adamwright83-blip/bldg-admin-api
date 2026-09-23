import { Container, FillGradient, Graphics, Sprite, Texture } from "pixi.js";
import { clamp, lerp, smoothstep, type Vec } from "./holdTheLine";
import { pointInPolygon } from "../overworld/navigation";
import { PLATES, subTexture } from "./waywardAssets";
import { GUARDIAN } from "./deckScene";

/**
 * CAST OFF. The deck she walked in on, seen from the same place — and then it
 * wakes up around her: the Gold Line seam lights under her feet and races for
 * the bow, masts rise, canvas drops and fills, and Mooring City falls away
 * behind the turn until there is nothing ahead but open sky and the Line.
 *
 * `awaken` (0..1) drives the ship coming alive; `leaving` (0..1) drives the
 * world moving past it. Neither is a fade over a static picture: every layer
 * that changes is a real layer moving.
 */
function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
}

export const SAIL_WALK: Vec[] = [
  { x: 300, y: 646 }, { x: 1236, y: 646 }, { x: 1060, y: 470 }, { x: 488, y: 470 },
];
export const BOW_POINT: Vec = { x: 772, y: 478 };
export const SAIL_SPAWN: Vec = { x: 742, y: 590 };

/** The awakening-deck plate lines up with the bridge plate 105px higher (futureStages.ts). */
const AWAKE_OFFSET_Y = -105;
const VANISH: Vec = { x: 790, y: 360 };

export class SailScene {
  readonly root = new Container();
  readonly actors = new Container();
  private readonly skyFill = new Graphics();
  private readonly openSky: Sprite;
  private readonly brokenRing = new Graphics();
  private readonly world: Sprite;
  private readonly deckStrip: Sprite;
  private readonly fogs: { sprite: Sprite; speed: number; y: number; scale: number; alpha: number; phase: number }[] = [];
  private readonly skyLine = new Graphics();
  private readonly ship = new Container();
  private readonly awake: Sprite;
  private readonly seam = new Graphics();
  private readonly foreground: Sprite;
  private readonly guardian: Sprite;
  private readonly guardianGlow = new Graphics();
  t = 0;
  /** 0..1: the ship coming alive (seam, masts, canvas). */
  awaken = 0;
  /** 0..1: how far the seam's light has run from her feet to the bow. */
  seamRun = 0;
  /** 0..1: how far the Gold Line has run out past the bow into the sky. */
  lineRun = 0;
  /** 0..1: Mooring City falling away behind the turn. */
  leaving = 0;
  speed = 0;

  constructor(textures: Map<string, Texture>) {
    this.skyFill.rect(-1200, -900, 3900, 2400).fill(new FillGradient({
      type: "linear",
      start: { x: 0, y: 0 },
      end: { x: 0, y: 1 },
      colorStops: [{ offset: 0, color: 0x3e6ea3 }, { offset: 0.45, color: 0xa9c3da }, { offset: 0.6, color: 0xf3d9a8 }, { offset: 1, color: 0xf6e6c8 }],
      textureSpace: "local",
    }));
    this.root.addChild(this.skyFill);
    this.openSky = new Sprite(textures.get(PLATES.openSky)!);
    this.openSky.anchor.set(0.5, 0.5);
    this.root.addChild(this.openSky);
    this.root.addChild(this.brokenRing);

    const plate = textures.get(PLATES.bridge)!;
    this.world = new Sprite(plate);
    this.world.anchor.set(VANISH.x / 1536, VANISH.y / 658);
    this.world.position.set(VANISH.x, VANISH.y);
    this.root.addChild(this.world);
    const fog = textures.get(PLATES.fog)!;
    for (let i = 0; i < 5; i += 1) {
      const sprite = new Sprite(fog);
      sprite.anchor.set(0.5);
      sprite.alpha = 0;
      this.root.addChild(sprite);
      this.fogs.push({ sprite, speed: 0.12 + i * 0.045, y: 300 + i * 70, scale: 1.2 + i * 0.35, alpha: 0.5 + i * 0.08, phase: i * 0.37 });
    }
    this.root.addChild(this.skyLine);

    // The near deck never leaves: it is the ship.
    this.deckStrip = new Sprite(subTexture(plate, 0, 520, 1536, 138));
    this.deckStrip.position.set(0, 520);
    this.ship.addChild(this.deckStrip);
    this.awake = new Sprite(textures.get(PLATES.awakeDeck)!);
    this.awake.position.set(0, AWAKE_OFFSET_Y);
    this.awake.alpha = 0;
    this.ship.addChild(this.awake);
    this.ship.addChild(this.seam);
    this.actors.sortableChildren = true;
    // The Tether Guardian is still on deck. It served the rope law; it keeps watch now.
    this.guardian = new Sprite(textures.get(PLATES.guardian)!);
    this.guardian.anchor.set(0.46, 0.97);
    this.guardian.position.set(GUARDIAN.x, GUARDIAN.y);
    this.guardian.scale.set(250 / 900);
    this.guardian.zIndex = GUARDIAN.y;
    this.actors.addChild(this.guardian);
    this.guardianGlow.blendMode = "add";
    this.guardianGlow.position.set(GUARDIAN.x, GUARDIAN.y);
    this.ship.addChild(this.actors);
    this.ship.addChild(this.guardianGlow);
    this.foreground = new Sprite(textures.get(PLATES.deckForeground)!);
    this.ship.addChild(this.foreground);
    this.ship.pivot.set(768, 658);
    this.ship.position.set(768, 658);
    this.root.addChild(this.ship);
  }

  walkable(p: Vec): boolean {
    const gx = (p.x - GUARDIAN.x) / 74;
    const gy = (p.y - GUARDIAN.y - 4) / 20;
    if (gx * gx + gy * gy < 1) return false;
    return pointInPolygon(p, SAIL_WALK);
  }

  depthScale(y: number): number {
    return lerp(0.6, 1.05, smoothstep(470, 646, y));
  }

  update(t: number, dt: number, camera: Vec) {
    this.t = t;
    void dt;
    const a = this.awaken;
    const leave = smoothstep(0, 1, this.leaving);
    // The ship rolls on the air once she is free; the sky is what moves.
    this.ship.rotation = (Math.sin(t * 0.52) * 0.012 + Math.sin(t * 1.3) * 0.003) * smoothstep(0.2, 1, a);

    // Masts rise and canvas drops: the awake plate lifts into place as it appears.
    this.awake.alpha = smoothstep(0.1, 0.55, a);
    this.awake.y = AWAKE_OFFSET_Y + (1 - smoothstep(0.1, 0.7, a)) * 46;

    // Mooring City and the bridge fall away behind the turn: away (smaller), and aside.
    const s = lerp(1, 0.42, leave);
    this.world.scale.set(s);
    this.world.position.set(VANISH.x + lerp(0, -760, leave * leave) + (camera.x - 768) * 0.1 * leave, VANISH.y + lerp(0, -40, leave));
    this.world.rotation = lerp(0, -0.05, leave);
    this.world.alpha = 1 - smoothstep(0.7, 1, leave);
    this.openSky.alpha = smoothstep(0.05, 0.6, leave);
    this.openSky.scale.set(1.3);
    this.openSky.position.set(820 + (camera.x - 768) * 0.9 + lerp(420, 0, leave), 250 + (camera.y - 329) * 0.92);

    for (const f of this.fogs) {
      const k = ((t * f.speed * (0.4 + this.speed) + f.phase) % 1 + 1) % 1;
      f.sprite.position.set(lerp(2000, -600, k) + (camera.x - 768) * 0.4, f.y + Math.sin(t * 0.3 + f.phase * 7) * 12);
      f.sprite.scale.set(f.scale * (0.9 + k * 0.4));
      f.sprite.alpha = f.alpha * Math.sin(k * Math.PI) * smoothstep(0.1, 0.5, leave);
    }

    // The broken ring over everything, one segment warming as the Line reaches for it.
    const r = this.brokenRing.clear();
    const ringVis = smoothstep(0.35, 0.9, leave);
    if (ringVis > 0) {
      const cx = 1100 + (camera.x - 768) * 0.93;
      const cy = -120 + (camera.y - 329) * 0.95;
      const segments = [[-2.75, -2.25], [-2.1, -1.4], [-1.15, -0.6], [-0.35, 0.15], [0.4, 0.85]];
      segments.forEach(([from, to], index) => {
        const lit = index === 3 ? this.lineRun : 0;
        r.arc(cx, cy, 560, from!, to!).stroke({ color: 0xf6c86a, width: 9, alpha: (0.14 + 0.3 * lit) * ringVis });
        r.arc(cx, cy, 560, from!, to!).stroke({ color: 0xfff1c2, width: 2.2, alpha: (0.2 + 0.6 * lit) * ringVis });
      });
    }

    // The seam in the planks: from under her feet to the bow, then off the bow into the sky.
    const g = this.seam.clear();
    const pulse = 0.8 + Math.sin(t * 7) * 0.2;
    const seamFrom = { x: 772, y: 646 };
    const seamTo = { x: 790, y: 452 };
    const dormant = 0.25 + 0.12 * Math.sin(t * 5);
    g.moveTo(seamFrom.x, seamFrom.y).lineTo(seamTo.x, seamTo.y).stroke({ color: 0xffd36b, width: 1.4, alpha: dormant * (1 - this.seamRun) });
    if (this.seamRun > 0) {
      const head = { x: lerp(seamFrom.x, seamTo.x, this.seamRun), y: lerp(seamFrom.y, seamTo.y, this.seamRun) };
      g.moveTo(seamFrom.x, seamFrom.y).lineTo(head.x, head.y).stroke({ color: 0xffb640, width: 14, alpha: 0.16 * pulse });
      g.moveTo(seamFrom.x, seamFrom.y).lineTo(head.x, head.y).stroke({ color: 0xffe08a, width: 4, alpha: 0.9 });
      g.moveTo(seamFrom.x, seamFrom.y).lineTo(head.x, head.y).stroke({ color: 0xffffff, width: 1.3, alpha: 0.9 });
      if (this.seamRun < 1) g.circle(head.x, head.y, 7 + Math.sin(t * 30) * 2).fill({ color: 0xfff6d8, alpha: 0.95 });
    }
    const sl = this.skyLine.clear();
    if (this.lineRun > 0) {
      const from = { x: 790, y: 452 + AWAKE_OFFSET_Y * 0 };
      const island = { x: this.openSky.x + (1180 - 768) * this.openSky.scale.x, y: this.openSky.y + (300 - 512) * this.openSky.scale.y };
      const to = { x: lerp(from.x, island.x, this.lineRun), y: lerp(from.y, island.y + 30, this.lineRun) };
      const ctrl = { x: lerp(from.x, to.x, 0.45), y: Math.min(from.y, to.y) + 40 };
      for (const [width, color, alpha] of [[18, 0xffb640, 0.12], [5, 0xffe08a, 0.75], [1.4, 0xffffff, 0.9]] as const) {
        sl.moveTo(from.x, from.y).quadraticCurveTo(ctrl.x, ctrl.y, to.x, to.y).stroke({ color, width, alpha: alpha * pulse });
      }
      sl.circle(to.x, to.y, 6 + Math.sin(t * 11) * 1.5).fill({ color: 0xfff6d8, alpha: 0.9 });
    }
    this.foreground.position.set((camera.x - 768) * -0.03, 0);

    // Its lights go from rope-law blue to Gold Line gold as the ship wakes.
    const gold = smoothstep(0.2, 0.8, this.awaken);
    this.guardian.tint = lerpColor(0x8d8f95, 0xffffff, gold);
    const glow = this.guardianGlow.clear();
    const k = 250 / 900;
    const color = lerpColor(0x59c7ff, 0xffc450, gold);
    for (const light of [{ x: 282, y: 104, r: 5 }, { x: 262, y: 262, r: 9 }, { x: 590, y: 440, r: 12 }]) {
      const lx = (light.x - 0.46 * 720) * k;
      const ly = (light.y - 0.97 * 900) * k;
      const pulse = 0.6 + 0.4 * Math.sin(t * 2 + light.x);
      for (let i = 3; i >= 1; i -= 1) glow.circle(lx, ly, light.r * k * 3 * i).fill({ color, alpha: 0.06 * pulse * (0.4 + gold) });
      glow.circle(lx, ly, light.r * k * 1.6).fill({ color: 0xfff4d8, alpha: 0.55 * pulse * (0.3 + gold) });
    }
  }

  /** Where the seam's light is now (for sparks). */
  seamHead(): Vec {
    return { x: lerp(772, 790, clamp(this.seamRun, 0, 1)), y: lerp(646, 452, clamp(this.seamRun, 0, 1)) };
  }

  destroy() {
    this.root.destroy({ children: true });
  }
}
