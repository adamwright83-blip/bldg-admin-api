import type { RallyEvent } from "./rallyEngine";
import { RALLY_CONFIG } from "./rallyConfig";

type ParticleKind = "spark" | "ember" | "ice" | "shard";

type Particle = {
  active: boolean;
  kind: ParticleKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  rotation: number;
  spin: number;
};

const TAU = Math.PI * 2;

export class RallyParticlePool {
  private particles: Particle[];
  private cursor = 0;
  private reducedMotion = false;

  constructor() {
    this.particles = Array.from(
      { length: RALLY_CONFIG.feel.particleCap },
      (): Particle => ({
        active: false,
        kind: "spark",
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        life: 0,
        maxLife: 0,
        size: 0,
        rotation: 0,
        spin: 0,
      })
    );
  }

  setReducedMotion(reducedMotion: boolean) {
    this.reducedMotion = reducedMotion;
    const cap = this.liveCap;
    for (let index = cap; index < this.particles.length; index += 1) {
      this.particles[index].active = false;
    }
  }

  clear() {
    for (const particle of this.particles) particle.active = false;
  }

  handleEvent(event: RallyEvent) {
    if (event.x === undefined || event.y === undefined) return;
    switch (event.type) {
      case "return":
        this.spawn(event, "spark", this.reducedMotion ? 4 : 15, 260, 430);
        break;
      case "wall_bounce":
      case "bumper_bank":
        this.spawn(event, "spark", this.reducedMotion ? 3 : 10, 160, 300);
        break;
      case "breath_loop":
      case "ignite":
        this.spawn(event, "ember", this.reducedMotion ? 2 : 8, 90, 220);
        break;
      case "breath_start":
        this.spawn(event, "ember", this.reducedMotion ? 2 : 12, 70, 190);
        break;
      case "breath_contact":
        this.spawn(event, "ember", this.reducedMotion ? 3 : 14, 130, 360);
        break;
      case "charged_release":
        this.spawn(event, "ember", this.reducedMotion ? 4 : 22, 180, 460);
        break;
      case "breath_exhausted":
        this.spawn(
          event,
          "spark",
          this.reducedMotion ? 2 : RALLY_CONFIG.fire.exhaustedPuffCount,
          30,
          90
        );
        break;
      case "freeze_cast":
      case "freeze_break":
        this.spawn(event, "ice", this.reducedMotion ? 5 : 20, 180, 360);
        break;
      case "gate_score_for":
      case "gate_score_against":
        this.spawn(
          event,
          "shard",
          this.reducedMotion
            ? 8
            : event.banked
              ? RALLY_CONFIG.ceremony.impactParticleMax
              : RALLY_CONFIG.ceremony.impactParticleMin,
          250,
          520
        );
        break;
      default:
        break;
    }
  }

  update(dtMs: number) {
    const dt = Math.min(50, dtMs) / 1000;
    const cap = this.liveCap;
    for (let index = 0; index < cap; index += 1) {
      const particle = this.particles[index];
      if (!particle.active) continue;
      particle.life -= dtMs;
      if (particle.life <= 0) {
        particle.active = false;
        continue;
      }
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vy += (particle.kind === "ember" ? -30 : 180) * dt;
      particle.vx *= 0.985;
      particle.vy *= 0.985;
      particle.rotation += particle.spin * dt;
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    const cap = this.liveCap;
    for (let index = 0; index < cap; index += 1) {
      const particle = this.particles[index];
      if (!particle.active) continue;
      const alpha = Math.max(0, particle.life / particle.maxLife);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(particle.x, particle.y);
      ctx.rotate(particle.rotation);
      if (particle.kind === "ice" || particle.kind === "shard") {
        ctx.fillStyle = particle.kind === "ice" ? "#9cecff" : "#ffd16b";
        ctx.beginPath();
        ctx.moveTo(0, -particle.size);
        ctx.lineTo(particle.size * 0.55, particle.size * 0.7);
        ctx.lineTo(-particle.size * 0.45, particle.size * 0.35);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillStyle = particle.kind === "ember" ? "#ff6a2b" : "#ffd86a";
        ctx.beginPath();
        ctx.ellipse(0, 0, particle.size * 1.6, particle.size * 0.55, 0, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  private get liveCap() {
    return this.reducedMotion
      ? RALLY_CONFIG.feel.reducedMotionParticleCap
      : RALLY_CONFIG.feel.particleCap;
  }

  private spawn(
    event: RallyEvent,
    kind: ParticleKind,
    count: number,
    minSpeed: number,
    maxSpeed: number
  ) {
    const cap = this.liveCap;
    for (let localIndex = 0; localIndex < count; localIndex += 1) {
      const particle = this.particles[this.cursor % cap];
      this.cursor = (this.cursor + 1) % cap;
      const noise = this.noise(event.at + localIndex * 97.13);
      const angle = noise * TAU;
      const speed = minSpeed + this.noise(event.at * 0.71 + localIndex * 13.7) * (maxSpeed - minSpeed);
      particle.active = true;
      particle.kind = kind;
      particle.x = event.x ?? 0;
      particle.y = event.y ?? 0;
      particle.vx = Math.cos(angle) * speed;
      particle.vy = Math.sin(angle) * speed;
      particle.maxLife = 260 + this.noise(event.at + localIndex * 31.1) * 420;
      particle.life = particle.maxLife;
      particle.size = 2.5 + this.noise(event.at + localIndex * 47.7) * 6;
      particle.rotation = angle;
      particle.spin = (this.noise(event.at + localIndex * 61.9) - 0.5) * 8;
    }
  }

  private noise(value: number) {
    const sine = Math.sin(value * 12.9898) * 43758.5453;
    return sine - Math.floor(sine);
  }
}
