import { Container, Graphics, Sprite, Texture, type Renderer } from "pixi.js";
import type { Vec } from "./holdTheLine";

/**
 * Small, pooled world-space particles: splinters, dust, sparks, embers, smoke,
 * wind streaks. One Graphics-baked texture per kind; no per-frame allocation.
 */
export type ParticleKind = "dust" | "spark" | "splinter" | "smoke" | "ember" | "streak" | "glint";

type Particle = {
  sprite: Sprite;
  kind: ParticleKind;
  life: number;
  age: number;
  vx: number;
  vy: number;
  spin: number;
  gravity: number;
  drag: number;
  grow: number;
  fade: number;
  baseAlpha: number;
  baseScale: number;
};

export class Particles {
  readonly view = new Container();
  private readonly textures = new Map<ParticleKind, Texture>();
  private readonly live: Particle[] = [];
  private readonly pool: Sprite[] = [];
  private readonly max: number;

  constructor(renderer: Renderer, max = 260) {
    this.max = max;
    const bake = (kind: ParticleKind, draw: (g: Graphics) => void) => {
      const g = new Graphics();
      draw(g);
      this.textures.set(kind, renderer.generateTexture({ target: g, resolution: 2 }));
      g.destroy();
    };
    bake("dust", g => {
      for (let i = 12; i >= 1; i -= 1) g.circle(0, 0, i * 1.6).fill({ color: 0xd8c3a4, alpha: 0.07 });
    });
    bake("spark", g => g.rect(-7, -1.4, 14, 2.8).fill({ color: 0xfff1b8 }).rect(-3, -0.8, 6, 1.6).fill({ color: 0xffffff }));
    bake("splinter", g => g.poly([-9, -2, 8, -3, 10, 1, -7, 3]).fill({ color: 0x6b4a2c }).poly([-6, -1, 6, -2, 7, 0]).fill({ color: 0x9c7147 }));
    bake("smoke", g => {
      for (let i = 12; i >= 1; i -= 1) g.circle(0, 0, i * 1.7).fill({ color: 0x55585e, alpha: 0.075 });
    });
    bake("ember", g => g.circle(0, 0, 3.2).fill({ color: 0xffc85a }).circle(0, 0, 7).fill({ color: 0xffa42a, alpha: 0.25 }));
    bake("streak", g => g.rect(-40, -0.9, 80, 1.8).fill({ color: 0xf6efd8, alpha: 0.55 }));
    bake("glint", g => g.poly([0, -12, 2, -2, 12, 0, 2, 2, 0, 12, -2, 2, -12, 0, -2, -2]).fill({ color: 0xfff4c4 }));
  }

  emit(kind: ParticleKind, at: Vec, options: Partial<{ count: number; speed: number; spread: number; angle: number; life: number; gravity: number; scale: number; spin: number; drag: number; grow: number; alpha: number; tint: number; jitter: number }> = {}) {
    const count = options.count ?? 8;
    for (let i = 0; i < count; i += 1) {
      if (this.live.length >= this.max) this.recycle(this.live[0]!);
      const sprite = this.pool.pop() ?? new Sprite();
      sprite.texture = this.textures.get(kind)!;
      sprite.anchor.set(0.5);
      sprite.tint = options.tint ?? 0xffffff;
      const angle = (options.angle ?? -Math.PI / 2) + (Math.random() - 0.5) * (options.spread ?? Math.PI * 2);
      const speed = (options.speed ?? 120) * (0.45 + Math.random() * 0.75);
      const jitter = options.jitter ?? 6;
      sprite.position.set(at.x + (Math.random() - 0.5) * jitter, at.y + (Math.random() - 0.5) * jitter);
      const scale = (options.scale ?? 1) * (0.7 + Math.random() * 0.6);
      sprite.scale.set(scale);
      sprite.rotation = kind === "streak" || kind === "spark" ? angle : Math.random() * Math.PI * 2;
      sprite.alpha = options.alpha ?? 1;
      this.view.addChild(sprite);
      this.live.push({
        sprite,
        kind,
        life: (options.life ?? 0.7) * (0.7 + Math.random() * 0.6),
        age: 0,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        spin: (options.spin ?? (kind === "splinter" ? 9 : 0)) * (Math.random() - 0.5),
        gravity: options.gravity ?? (kind === "splinter" ? 900 : kind === "spark" ? 520 : kind === "smoke" ? -40 : 60),
        drag: options.drag ?? (kind === "dust" || kind === "smoke" ? 2.2 : 0.4),
        grow: options.grow ?? (kind === "dust" ? 1.2 : kind === "smoke" ? 1.4 : 0),
        fade: 1,
        baseAlpha: options.alpha ?? 1,
        baseScale: scale,
      });
    }
  }

  update(dt: number) {
    for (let i = this.live.length - 1; i >= 0; i -= 1) {
      const p = this.live[i]!;
      p.age += dt;
      if (p.age >= p.life) {
        this.recycle(p);
        continue;
      }
      const k = Math.max(0, 1 - p.drag * dt);
      p.vx *= k;
      p.vy = p.vy * k + p.gravity * dt;
      p.sprite.x += p.vx * dt;
      p.sprite.y += p.vy * dt;
      p.sprite.rotation += p.spin * dt;
      const f = p.age / p.life;
      p.sprite.alpha = p.baseAlpha * (1 - f * f);
      if (p.grow) p.sprite.scale.set(p.baseScale * (1 + p.grow * f));
      if (p.kind === "spark") p.sprite.rotation = Math.atan2(p.vy, p.vx);
    }
  }

  private recycle(p: Particle) {
    const index = this.live.indexOf(p);
    if (index >= 0) this.live.splice(index, 1);
    p.sprite.removeFromParent();
    this.pool.push(p.sprite);
  }

  clear() {
    while (this.live.length) this.recycle(this.live[0]!);
  }
}

/** Screen-space shake from accumulated trauma (squared, so small hits stay small). */
export class Shake {
  private trauma = 0;
  private t = 0;
  add(amount: number) {
    this.trauma = Math.min(1, this.trauma + amount);
  }
  update(dt: number, reducedMotion: boolean): Vec & { rotation: number } {
    this.t += dt;
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    if (reducedMotion) return { x: 0, y: 0, rotation: 0 };
    const s = this.trauma * this.trauma;
    return {
      x: s * 22 * noise(this.t * 31, 1.3),
      y: s * 18 * noise(this.t * 29, 7.1),
      rotation: s * 0.022 * noise(this.t * 23, 3.7),
    };
  }
}

function noise(x: number, seed: number) {
  return Math.sin(x + seed) * 0.6 + Math.sin(x * 1.7 + seed * 2.3) * 0.3 + Math.sin(x * 3.1 + seed * 0.7) * 0.1;
}

export function haptic(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Haptics are a courtesy.
  }
}
