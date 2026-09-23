import { Container, FillGradient, Graphics, MeshRope, Point, Sprite, Texture } from "pixi.js";
import {
  ROLL,
  SPAN,
  boomCrate,
  clamp,
  lerp,
  obstructionsAt,
  onRolledDeck,
  riggingLines,
  ringPosition,
  shipRoll,
  smoothstep,
  type Obstruction,
  type ShipRoll,
  type Vec,
} from "./holdTheLine";
import { SPAN_LAYOUT, spanPartUrl, PLATES, type SpanPartId } from "./waywardAssets";
import { isWalkable } from "../overworld/navigation";
import { ANCHOR_BOLLARD, CITY_WALK, CLAMP_POINT, SHIP_WALK, SHIP_WALK_BROKEN } from "./waywardGeometry";
import { CITY_STAGE_MAP, SHIP_END_BROKEN_MAP, SHIP_END_MAP } from "./waywardMaps";

export { ANCHOR_BOLLARD, CITY_WALK, CLAMP_POINT, SHIP_WALK, SHIP_WALK_BROKEN };

/**
 * The broken span, seen side-on: the Wayward's broken end on the left, the
 * tether ring over the gap, Mooring City's mooring stage on the right. Built
 * only from the approved painting's own pixels, cut into live parts.
 */
export type SpanSide = "ship" | "city";

type Cargo = { sprite: Sprite; home: Vec; x: number; y: number; vx: number; state: "resting" | "sliding" | "falling" | "gone"; fall: number; spin: number };

export class SpanScene {
  readonly root = new Container();
  readonly backdrop = new Container();
  readonly shipEnd = new Container();
  readonly cityEnd = new Container();
  readonly fxBack = new Container();
  readonly fxFront = new Container();
  readonly hookLine = new Graphics();
  readonly aimLine = new Graphics();
  private readonly ring: Sprite;
  private readonly crate: Sprite;
  private readonly edgeChunks: Sprite[] = [];
  private readonly cityChunks: Sprite[] = [];
  private readonly ropes: { mesh: MeshRope; points: Point[] }[] = [];
  private readonly riggingBlocks: Graphics[] = [];
  private readonly cargo: Cargo[] = [];
  private readonly fogs: { sprite: Sprite; speed: number; base: Vec; parallax: number }[] = [];
  private readonly skyLayers: { view: Container; parallax: number; base: Vec }[] = [];
  edgeBroken = false;
  /** 0..1 as the Wayward pulls away after cast-off. */
  departure = 0;
  collapse = 0;
  calm = false;
  t = 0;
  roll: ShipRoll = { angle: 0, telegraph: 0, heavy: false, cycle: -1 };
  ringAt: Vec = { ...SPAN.ringRest };
  /** Extra displacement of the whole ship end (cast-off). */
  shipShift: Vec = { x: 0, y: 0 };
  shipTurn = 0;
  private lastHeavyCycle = -1;
  onHeavyRoll: ((cycle: number) => void) | null = null;
  onCargoFall: ((at: Vec) => void) | null = null;

  constructor(textures: Map<string, Texture>, private readonly reducedMotion: boolean) {
    const tex = (id: SpanPartId) => textures.get(spanPartUrl(id))!;
    // --- sky, far to near
    const sky = new Graphics();
    const gradient = new FillGradient({
      type: "linear",
      start: { x: 0, y: 0 },
      end: { x: 0, y: 1 },
      colorStops: [
        { offset: 0, color: 0x28476d },
        { offset: 0.42, color: 0x8fa7c0 },
        { offset: 0.6, color: 0xf2cf98 },
        { offset: 0.78, color: 0xe7c9a4 },
        { offset: 1, color: 0x8e9fb4 },
      ],
      textureSpace: "local",
    });
    sky.rect(-2600, -1700, 6800, 4200).fill(gradient);
    this.addSky(sky, 0.02, { x: 0, y: 0 });
    const openSky = new Sprite(textures.get(PLATES.openSky)!);
    openSky.anchor.set(0.5, 0.5);
    openSky.scale.set(1.9);
    openSky.alpha = 0.92;
    this.addSky(openSky, 0.1, { x: 820, y: 420 });
    const city = new Sprite(textures.get(PLATES.mooringCity)!);
    city.anchor.set(0.5, 0);
    city.scale.set(1.25);
    city.alpha = 0.9;
    city.tint = 0xdfe6ee;
    this.addSky(city, 0.22, { x: 1640, y: -470 });
    const sun = new Graphics();
    for (let i = 10; i >= 1; i -= 1) sun.circle(0, 0, i * 42).fill({ color: 0xffe2a8, alpha: 0.035 });
    sun.circle(0, 0, 34).fill({ color: 0xfff6dd, alpha: 0.9 });
    this.addSky(sun, 0.05, { x: -180, y: -420 });

    // --- drifting cloud banks below the planks
    const fogTexture = textures.get(PLATES.fog)!;
    const fogSpecs = [
      { base: { x: 300, y: 700 }, scale: 1.4, speed: 9, parallax: 0.55, alpha: 0.7 },
      { base: { x: 1300, y: 760 }, scale: 1.7, speed: 13, parallax: 0.7, alpha: 0.75 },
      { base: { x: 760, y: 900 }, scale: 2.2, speed: 6, parallax: 0.85, alpha: 0.85 },
    ];
    for (const spec of fogSpecs) {
      const sprite = new Sprite(fogTexture);
      sprite.anchor.set(0.5);
      sprite.scale.set(spec.scale);
      sprite.alpha = spec.alpha;
      this.backdrop.addChild(sprite);
      this.fogs.push({ sprite, speed: spec.speed, base: spec.base, parallax: spec.parallax });
    }
    this.root.addChild(this.backdrop);

    // --- the city's mooring stage (right), in chunks so it can come apart
    this.cityEnd.sortableChildren = true;
    for (const id of ["span-right-5", "span-right-4", "span-right-3", "span-right-2", "span-right-1"] as const) {
      const box = SPAN_LAYOUT[id];
      const sprite = new Sprite(tex(id));
      sprite.anchor.set(0.5);
      sprite.position.set(box.x + box.w / 2, box.y + box.h / 2);
      sprite.zIndex = 0;
      sprite.label = id;
      this.cityEnd.addChild(sprite);
      this.cityChunks.push(sprite);
    }
    const hanging = new Sprite(tex("span-crate"));
    const hb = SPAN_LAYOUT["span-crate"];
    hanging.anchor.set(0.5);
    hanging.position.set(hb.x + hb.w / 2, hb.y + hb.h / 2);
    hanging.label = "hanging-crate";
    this.cityEnd.addChild(hanging);
    this.cityChunks.push(hanging);
    this.root.addChild(this.cityEnd);

    // --- tether ropes, ring, loose rigging and the boom crate live in the gap
    this.root.addChild(this.fxBack);
    const ropeTexture = tex("span-rope");
    // Ropes tile the painted strand along their length; that needs a repeating source.
    ropeTexture.source.style.addressMode = "repeat";
    const addRope = (count: number, width: number) => {
      const points = Array.from({ length: count }, () => new Point(0, 0));
      const mesh = new MeshRope({ texture: ropeTexture, points, width, textureScale: 1 });
      this.root.addChild(mesh);
      this.ropes.push({ mesh, points });
      return this.ropes.length - 1;
    };
    // 0,1 left tether strands; 2,3 right tether strands; 4 boom line; 5,6 rigging
    addRope(10, 13);
    addRope(10, 11);
    addRope(10, 13);
    addRope(10, 11);
    addRope(12, 9);
    addRope(7, 8);
    addRope(7, 8);
    this.ring = new Sprite(tex("span-ring"));
    const rb = SPAN_LAYOUT["span-ring"];
    this.ring.anchor.set((SPAN.ringRest.x - rb.x) / rb.w, (SPAN.ringRest.y - rb.y) / rb.h);
    this.root.addChild(this.ring);
    for (let i = 0; i < 2; i += 1) {
      const block = new Graphics()
        .roundRect(-11, -4, 22, 30, 5).fill({ color: 0x3b2716 }).stroke({ color: 0x8a6036, width: 2 })
        .circle(0, 8, 6).fill({ color: 0x9b7440 }).circle(0, 8, 2.5).fill({ color: 0x2a1c10 });
      this.root.addChild(block);
      this.riggingBlocks.push(block);
    }
    this.crate = new Sprite(tex("span-crate"));
    this.crate.anchor.set(0.43, 0.06);
    this.crate.scale.set(SPAN.crateScale);
    this.root.addChild(this.crate);

    // --- the Wayward's broken end (left), rolling about a point inside the hull
    this.shipEnd.sortableChildren = true;
    this.shipEnd.pivot.set(SPAN.rollPivot.x, SPAN.rollPivot.y);
    this.shipEnd.position.set(SPAN.rollPivot.x, SPAN.rollPivot.y);
    const left = new Sprite(tex("span-left"));
    left.position.set(0, 0);
    left.zIndex = 0;
    this.shipEnd.addChild(left);
    for (const id of ["span-left-edge-1", "span-left-edge-2", "span-left-edge-3"] as const) {
      const box = SPAN_LAYOUT[id];
      const sprite = new Sprite(tex(id));
      sprite.anchor.set(0.5);
      sprite.position.set(box.x + box.w / 2, box.y + box.h / 2);
      sprite.zIndex = 1;
      this.shipEnd.addChild(sprite);
      this.edgeChunks.push(sprite);
    }
    const barrel = tex("span-barrel");
    const cargoSpecs: { texture: Texture; home: Vec; scale: number }[] = [
      { texture: barrel, home: { x: 352, y: 404 }, scale: 0.6 },
      { texture: tex("span-crate"), home: { x: 356, y: 448 }, scale: 0.4 },
      { texture: barrel, home: { x: 344, y: 424 }, scale: 0.54 },
    ];
    for (const spec of cargoSpecs) {
      const sprite = new Sprite(spec.texture);
      sprite.anchor.set(0.5, 0.92);
      sprite.scale.set(spec.scale);
      this.shipEnd.addChild(sprite);
      this.cargo.push({ sprite, home: spec.home, x: spec.home.x, y: spec.home.y, vx: 0, state: "resting", fall: 0, spin: 0 });
    }
    this.root.addChild(this.shipEnd);
    this.root.addChild(this.aimLine, this.hookLine, this.fxFront);
    this.update(0, 0);
  }

  private addSky(view: Container, parallax: number, base: Vec) {
    this.backdrop.addChild(view);
    this.skyLayers.push({ view, parallax, base });
    view.position.set(base.x, base.y);
  }

  /** Keep far layers far: they move a fraction of the camera's travel. */
  setCamera(center: Vec) {
    for (const layer of this.skyLayers) {
      layer.view.position.set(layer.base.x + (center.x - 760) * (1 - layer.parallax), layer.base.y + (center.y - 330) * (1 - layer.parallax));
    }
    for (const fog of this.fogs) {
      const drift = (this.t * fog.speed) % 2400;
      const x = fog.base.x + drift - 1200;
      fog.sprite.position.set(x + (center.x - 760) * (1 - fog.parallax), fog.base.y + (center.y - 330) * (1 - fog.parallax));
    }
  }

  obstructions(time = this.t): Obstruction[] {
    if (this.departure > 0) return [];
    return obstructionsAt(time);
  }

  ringAtTime(time: number): Vec {
    return ringPosition(time, shipRoll(time, this.calm).angle);
  }

  /** Ship-local (painting) point → where it is drawn after roll and cast-off drift. */
  shipToWorld(p: Vec): Vec {
    const rolled = onRolledDeck(p, this.roll.angle + this.shipTurn);
    return { x: rolled.x + this.shipShift.x, y: rolled.y + this.shipShift.y };
  }

  walkable(side: SpanSide, p: Vec): boolean {
    if (side === "ship") return isWalkable(this.edgeBroken ? SHIP_END_BROKEN_MAP : SHIP_END_MAP, p);
    return isWalkable(CITY_STAGE_MAP, p);
  }

  /** Perspective across the thin plank band: a touch smaller at the back. */
  depthScale(y: number): number {
    return lerp(0.93, 1, smoothstep(396, 470, y));
  }

  /**
   * Where the planks end at this depth: the broken ends are staggered, so the
   * drop is wherever the walkable planks stop on the gap side, lane by lane.
   */
  dropX(side: SpanSide, y: number): number {
    if (side === "ship") {
      let x = 340;
      while (x < 720 && this.walkable("ship", { x: x + 4, y })) x += 4;
      return x;
    }
    let x = 1200;
    while (x > 900 && this.walkable("city", { x: x - 4, y })) x -= 4;
    return x;
  }

  /** How far past the drop a point is (positive = over open sky). */
  pastShipEdge(p: Vec): number {
    return p.x - this.dropX("ship", clamp(p.y, 392, 458));
  }

  pastCityEdge(p: Vec): number {
    return this.dropX("city", clamp(p.y, 400, 476)) - p.x;
  }

  update(t: number, dt: number) {
    this.t = t;
    const roll = shipRoll(t, this.calm);
    this.roll = this.departure > 0 ? { ...roll, angle: roll.angle * (1 - this.departure) } : roll;
    if (roll.heavy && roll.cycle !== this.lastHeavyCycle && !this.calm && this.departure === 0) {
      this.lastHeavyCycle = roll.cycle;
      this.onHeavyRoll?.(roll.cycle);
    }
    this.shipEnd.rotation = this.roll.angle + this.shipTurn;
    this.shipEnd.position.set(SPAN.rollPivot.x + this.shipShift.x, SPAN.rollPivot.y + this.shipShift.y);

    // Ring rides the tether; after cast-off it is towed along with the ship.
    const ring = ringPosition(t, this.roll.angle);
    this.ringAt = this.departure > 0
      ? { x: ring.x + this.shipShift.x * 0.92, y: ring.y + this.shipShift.y * 0.9 + this.departure * 30 }
      : ring;
    this.ring.position.set(this.ringAt.x, this.ringAt.y);
    this.ring.rotation = Math.sin(t * 1.83) * 0.05 + (this.ringAt.y - SPAN.ringRest.y) * 0.002;

    const leftPulley = this.shipToWorld(SPAN.leftPulley);
    const leftStrap = { x: this.ringAt.x - 170, y: this.ringAt.y - 31 };
    const rightStrap = { x: this.ringAt.x + 182, y: this.ringAt.y - 51 };
    const rightPulley = this.cityToWorld(SPAN.rightPulley);
    this.sagRope(0, leftPulley, leftStrap, 10);
    this.sagRope(1, { x: leftPulley.x + 2, y: leftPulley.y + 22 }, { x: leftStrap.x + 4, y: leftStrap.y + 6 }, 16);
    const rightSnapped = this.departure > 0.18;
    if (rightSnapped) {
      // The city-side strands are gone: they whip down and trail from the ring.
      const whip = Math.min(1, (this.departure - 0.18) * 3);
      this.sagRope(2, rightStrap, { x: rightStrap.x + 150 - whip * 90, y: rightStrap.y + 200 * whip + 40 }, 30);
      this.sagRope(3, rightPulley, { x: rightPulley.x - 40, y: rightPulley.y + 170 * whip + 30 }, 20);
    } else {
      const strain = this.departure > 0 ? -this.departure * 60 : 0;
      this.sagRope(2, rightStrap, rightPulley, 8 + strain * 0.1);
      this.sagRope(3, { x: rightStrap.x + 2, y: rightStrap.y + 12 }, { x: rightPulley.x + 6, y: rightPulley.y + 20 }, 13 + strain * 0.1);
    }

    // The boom crate and loose rigging hang from the Wayward's own yards: they leave with her.
    const shift = this.shipShift;
    const crate = boomCrate(t);
    const swing = this.departure > 0 ? Math.sin(t * 2.1) * 0.35 * this.departure : 0;
    const crateEnd = {
      x: crate.pivot.x + shift.x - Math.sin(crate.angle + swing) * SPAN.boom.length,
      y: crate.pivot.y + shift.y + Math.cos(crate.angle + swing) * SPAN.boom.length,
    };
    this.setRope(4, [{ x: crate.pivot.x + shift.x, y: crate.pivot.y + shift.y }, crateEnd], 0);
    this.crate.position.set(crateEnd.x, crateEnd.y);
    this.crate.rotation = -(crate.angle + swing) * 0.5 + Math.sin(t * 3.3) * 0.03;
    const lines = riggingLines(t);
    lines.forEach((line, index) => {
      const rope = this.ropes[5 + index]!;
      const moved = line.points.map(p => ({ x: p.x + shift.x, y: p.y + shift.y }));
      this.setRope(5 + index, moved, 0);
      line.points = moved;
      const end = line.points[line.points.length - 1]!;
      this.riggingBlocks[index]!.position.set(end.x, end.y);
      this.riggingBlocks[index]!.rotation = Math.atan2(end.x - line.points[line.points.length - 2]!.x, -(end.y - line.points[line.points.length - 2]!.y)) * -0.6;
    });

    this.updateCargo(dt);
    this.updateCollapse(dt);
  }

  cityToWorld(p: Vec): Vec {
    return p;
  }

  private sagRope(index: number, a: Vec, b: Vec, sag: number) {
    const rope = this.ropes[index]!;
    const n = rope.points.length;
    for (let i = 0; i < n; i += 1) {
      const f = i / (n - 1);
      rope.points[i]!.set(lerp(a.x, b.x, f), lerp(a.y, b.y, f) + Math.sin(f * Math.PI) * sag);
    }
  }

  private setRope(index: number, pts: Vec[], sag: number) {
    const rope = this.ropes[index]!;
    const n = rope.points.length;
    for (let i = 0; i < n; i += 1) {
      const f = (i / (n - 1)) * (pts.length - 1);
      const k = Math.min(pts.length - 2, Math.floor(f));
      const u = f - k;
      const a = pts[k]!;
      const b = pts[k + 1]!;
      rope.points[i]!.set(lerp(a.x, b.x, u), lerp(a.y, b.y, u) + Math.sin((i / (n - 1)) * Math.PI) * sag);
    }
  }

  /** On each heavy roll, the next loose piece of cargo goes for the edge. */
  launchCargo(): Cargo | null {
    const next = this.cargo.find(item => item.state === "resting");
    if (!next) return null;
    next.state = "sliding";
    next.vx = 30;
    return next;
  }

  /** Loose cargo in her lane, for knockback: returns the one that would hit. */
  cargoNear(p: Vec, radius: number): { x: number; y: number; vx: number } | null {
    for (const item of this.cargo) {
      if (item.state !== "sliding") continue;
      if (Math.abs(item.y - p.y) < 22 && Math.abs(item.x - p.x) < radius) return item;
    }
    return null;
  }

  private updateCargo(dt: number) {
    for (const item of this.cargo) {
      if (item.state === "sliding") {
        const pull = Math.sin(this.roll.angle) * 2400;
        item.vx = clamp(item.vx + (pull + 60) * dt, 20, 520);
        item.x += item.vx * dt;
        item.spin += item.vx * dt * 0.02;
        if (item.x > this.pastEdgeX(item.y)) {
          item.state = "falling";
          item.fall = 0;
          this.onCargoFall?.(this.shipToWorld({ x: item.x, y: item.y }));
        }
      } else if (item.state === "falling") {
        item.fall += dt;
        item.x += item.vx * dt * 0.6;
        item.y += (180 + item.fall * 900) * dt;
        item.spin += dt * 4;
        if (item.fall > 1.6) item.state = "gone";
      }
      item.sprite.visible = item.state !== "gone";
      item.sprite.position.set(item.x, item.y);
      item.sprite.rotation = item.state === "resting" ? Math.sin(this.t * 30) * 0.02 * this.roll.telegraph : item.spin * (item.state === "falling" ? 1 : 0.15);
      item.sprite.zIndex = 10 + item.y;
      item.sprite.alpha = item.state === "falling" ? Math.max(0, 1 - item.fall / 1.5) : 1;
    }
  }

  private pastEdgeX(y: number) {
    return (this.edgeBroken ? 492 : SPAN.leftEdgeX) + (y > 440 ? -18 : 0) + 20;
  }

  /** The Line bites: the planks she stood on give way behind her. */
  breakEdge(onChunk?: (at: Vec) => void) {
    if (this.edgeBroken) return;
    this.edgeBroken = true;
    this.edgeChunks.forEach((chunk, index) => {
      const vx = 30 + index * 25;
      let vy = -40 - index * 30;
      let spin = (index % 2 ? 1 : -1) * (1.4 + index * 0.6);
      let age = -index * 0.09;
      const tick = (dt: number) => {
        age += dt;
        if (age < 0) return false;
        vy += 980 * dt;
        chunk.x += vx * dt;
        chunk.y += vy * dt;
        chunk.rotation += spin * dt;
        spin *= 0.995;
        chunk.alpha = Math.max(0, 1 - Math.max(0, age - 0.9) / 0.6);
        if (age > 0 && age < dt * 1.5) onChunk?.(this.shipToWorld({ x: chunk.x, y: chunk.y }));
        return age > 1.6;
      };
      this.fallers.push(tick);
    });
  }

  private readonly fallers: Array<(dt: number) => boolean> = [];

  /** After cast-off: the city side comes apart, chunk by chunk, and drops away. */
  beginCollapse() {
    this.collapse = 0.0001;
  }

  private updateCollapse(dt: number) {
    for (let i = this.fallers.length - 1; i >= 0; i -= 1) if (this.fallers[i]!(dt)) this.fallers.splice(i, 1);
    if (this.collapse <= 0) return;
    this.collapse += dt;
    const c = this.collapse;
    // Right-1 (the edge) tips first, then the post, then the rest drops together.
    const specs = [
      { index: 4, start: 3.2, pivot: { x: 1070, y: 470 }, spin: 0.9, drop: 1 },
      { index: 3, start: 4.6, pivot: { x: 1180, y: 560 }, spin: -0.5, drop: 0.9 },
      { index: 2, start: 5.2, pivot: { x: 1390, y: 640 }, spin: 0.35, drop: 0.8 },
      { index: 1, start: 4.8, pivot: { x: 1150, y: 150 }, spin: -0.7, drop: 1 },
      { index: 0, start: 5.0, pivot: { x: 1030, y: 150 }, spin: 0.8, drop: 1 },
      { index: 5, start: 0.4, pivot: { x: 1020, y: 480 }, spin: 1.3, drop: 1.2 },
    ];
    for (const spec of specs) {
      const chunk = this.cityChunks[spec.index];
      if (!chunk) continue;
      const k = Math.max(0, c - spec.start);
      const base = chunk.label === "hanging-crate" ? SPAN_LAYOUT["span-crate"] : SPAN_LAYOUT[chunk.label as keyof typeof SPAN_LAYOUT];
      const home = { x: base.x + base.w / 2, y: base.y + base.h / 2 };
      const tip = Math.min(1, k * 0.9);
      chunk.rotation = spec.spin * tip * tip * 0.9 + spec.spin * Math.max(0, k - 1) * 0.6;
      chunk.position.set(home.x + spec.spin * 40 * k, home.y + 0.5 * 700 * spec.drop * k * k);
      chunk.alpha = Math.max(0, 1 - Math.max(0, k - 1.4) / 1.2);
    }
  }

  /** Where the city stage has sagged to at x (for actors still standing on it). */
  citySag(x: number): number {
    if (this.collapse <= 0) return 0;
    const k = this.collapse;
    const nearEdge = 1 - smoothstep(960, 1300, x);
    // A lurch and a creaking settle first; the edge only goes after ~3.5s.
    const settle = Math.min(1, k * 1.4) * 14;
    const go = Math.max(0, k - 3.2);
    return nearEdge * (settle + go * go * 55) + Math.max(0, k - 4.6) ** 2 * 60;
  }

  destroy() {
    this.root.destroy({ children: true });
  }
}

export { ROLL };
