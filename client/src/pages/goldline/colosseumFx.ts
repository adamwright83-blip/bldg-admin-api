/**
 * The Colosseum's effects layer: bolts, the Second Hand, Deadline marks and
 * every spark, slash and shockwave, drawn on one canvas in stage units.
 *
 * Presentation only. It reads simulation state after each step and never
 * feeds anything back; deleting this file would make the fight uglier, not
 * different.
 */
import type { ColosseumProjectile } from "./colosseumCombat";
import { FLOOR_FORESHORTENING, type StagePoint } from "./colosseumStage";

type ParticleKind = "spark" | "ring" | "slash" | "shock" | "debris" | "dust" | "glint" | "ember";

type Particle = {
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
  color: string;
  /** Slash only: which way the edge travels, and how wide an arc. */
  from?: number;
  to?: number;
};

export type FxSecondHand = {
  angle: number;
  live: boolean;
  direction: 1 | -1;
};

export type FxDeadline = {
  id: string;
  at: StagePoint;
  fuseMs: number;
  fuseTotalMs: number;
  /** True once the first slam has landed and it is waiting to land again. */
  deferred: boolean;
};

export type FxFrame = {
  origin: StagePoint;
  projectiles: readonly ColosseumProjectile[];
  hologram: boolean;
  handLength: number;
  handHalfWidth: number;
  sweep: FxSecondHand | null;
  /** A preview of the hand's path while he winds up a sweep. */
  sweepTell: { from: number; to: number; progress: number } | null;
  deadlines: readonly FxDeadline[];
  deadlineRadius: number;
  /** While he winds up a Deadline, the floor under her starts to mark. */
  deadlineTell: { at: StagePoint; progress: number } | null;
  /**
   * A length of Gold Line: "taut" snaps her back to the anchor during RECOIL;
   * "grow" runs out from `from` toward `to` (a seal breaking from outside).
   */
  goldLine: { from: StagePoint; to: StagePoint; t: number; mode: "taut" | "grow" } | null;
  /** Where her Lineblade can currently reach his mainspring. */
  reachRing: { at: StagePoint; radius: number; ready: boolean } | null;
};

const GOLD = "#ffd36b";
const HOLO = "#8ff3ff";
const REWIND = "#b9e8ff";

function randomSign(): number {
  return Math.random() < 0.5 ? -1 : 1;
}

export class ColosseumFx {
  private particles: Particle[] = [];
  private handTrail: { angle: number; age: number }[] = [];
  private ambientClock = 0;
  readonly reducedMotion: boolean;

  constructor(reducedMotion: boolean) {
    this.reducedMotion = reducedMotion;
  }

  clear() {
    this.particles = [];
    this.handTrail = [];
  }

  private push(particle: Particle) {
    if (this.particles.length > 360) this.particles.shift();
    this.particles.push(particle);
  }

  sparks(at: StagePoint, count: number, color = GOLD, speed = 38, spread = Math.PI * 2, heading = 0) {
    const n = this.reducedMotion ? Math.ceil(count / 3) : count;
    for (let i = 0; i < n; i += 1) {
      const angle = heading + (Math.random() - 0.5) * spread;
      const velocity = speed * (0.45 + Math.random() * 0.75);
      this.push({
        kind: "spark",
        x: at.x,
        y: at.y,
        vx: Math.cos(angle) * velocity,
        vy: Math.sin(angle) * velocity,
        life: 0,
        maxLife: 240 + Math.random() * 260,
        size: 0.35 + Math.random() * 0.45,
        rotation: angle,
        spin: 0,
        color,
      });
    }
  }

  ring(at: StagePoint, radius: number, color = GOLD, maxLife = 320) {
    this.push({ kind: "ring", x: at.x, y: at.y, vx: 0, vy: 0, life: 0, maxLife, size: radius, rotation: 0, spin: 0, color });
  }

  glint(at: StagePoint, size = 5) {
    this.push({ kind: "glint", x: at.x, y: at.y, vx: 0, vy: 0, life: 0, maxLife: 360, size, rotation: 0, spin: 0.004, color: "#ffffff" });
  }

  /** A luminous edge through space (WORLD_BIBLE §23). Combos alternate direction. */
  slash(at: StagePoint, combo: number, hit: boolean) {
    const reach = combo >= 3 ? 11 : 8.5;
    const [from, to] =
      combo >= 3 ? [-200, 20] : combo % 2 === 0 ? [-40, -160] : [-160, -30];
    this.push({
      kind: "slash",
      x: at.x,
      y: at.y,
      vx: 0,
      vy: 0,
      life: 0,
      maxLife: combo >= 3 ? 300 : 220,
      size: reach,
      rotation: 0,
      spin: 0,
      color: hit ? "#fff6cf" : GOLD,
      from,
      to,
    });
  }

  shockwave(at: StagePoint) {
    this.push({ kind: "shock", x: at.x, y: at.y, vx: 0, vy: 0, life: 0, maxLife: 720, size: 130, rotation: 0, spin: 0, color: GOLD });
    this.ring(at, 26, "#fff7da", 420);
    this.sparks(at, 36, GOLD, 70);
  }

  debris(at: StagePoint, count: number, palette: readonly string[] = ["#e9dfca", "#c89a4a", "#8d5b22"]) {
    const n = this.reducedMotion ? Math.ceil(count / 3) : count;
    for (let i = 0; i < n; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const velocity = 14 + Math.random() * 34;
      this.push({
        kind: "debris",
        x: at.x + (Math.random() - 0.5) * 6,
        y: at.y + (Math.random() - 0.5) * 6,
        vx: Math.cos(angle) * velocity,
        vy: Math.sin(angle) * velocity - 18,
        life: 0,
        maxLife: 900 + Math.random() * 500,
        size: 0.8 + Math.random() * 1.8,
        rotation: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 0.02,
        color: palette[i % palette.length]!,
      });
    }
  }

  dust(at: StagePoint, count = 6, size = 3) {
    const n = this.reducedMotion ? 2 : count;
    for (let i = 0; i < n; i += 1) {
      this.push({
        kind: "dust",
        x: at.x + (Math.random() - 0.5) * size,
        y: at.y + (Math.random() - 0.5) * size * FLOOR_FORESHORTENING,
        vx: randomSign() * (3 + Math.random() * 7),
        vy: -1 - Math.random() * 3,
        life: 0,
        maxLife: 520 + Math.random() * 360,
        size: size * (0.6 + Math.random() * 0.7),
        rotation: 0,
        spin: 0,
        color: "rgba(236, 218, 184, 1)",
      });
    }
  }

  update(dtMs: number) {
    const dt = dtMs / 1000;
    this.ambientClock += dtMs;
    if (!this.reducedMotion && this.ambientClock > 260) {
      this.ambientClock = 0;
      this.push({
        kind: "ember",
        x: 8 + Math.random() * 84,
        y: 150 + Math.random() * 25,
        vx: (Math.random() - 0.5) * 3,
        vy: -6 - Math.random() * 6,
        life: 0,
        maxLife: 4200 + Math.random() * 2400,
        size: 0.22 + Math.random() * 0.28,
        rotation: 0,
        spin: 0,
        color: "rgba(255, 236, 190, 1)",
      });
    }
    const survivors: Particle[] = [];
    for (const particle of this.particles) {
      particle.life += dtMs;
      if (particle.life >= particle.maxLife) continue;
      if (particle.kind === "spark") {
        particle.vx *= Math.pow(0.02, dt);
        particle.vy *= Math.pow(0.02, dt);
      } else if (particle.kind === "debris") {
        particle.vy += 70 * dt;
        particle.vx *= Math.pow(0.4, dt);
      } else if (particle.kind === "dust") {
        particle.vx *= Math.pow(0.1, dt);
      }
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.rotation += particle.spin * dtMs;
      survivors.push(particle);
    }
    this.particles = survivors;
    this.handTrail = this.handTrail
      .map(entry => ({ ...entry, age: entry.age + dtMs }))
      .filter(entry => entry.age < 140);
  }

  /**
   * Draw one frame. The context must already be transformed so that one unit
   * is one stage unit; line widths below are therefore in stage units too.
   */
  draw(ctx: CanvasRenderingContext2D, frame: FxFrame) {
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    this.drawEmbers(ctx);
    if (frame.reachRing) this.drawReach(ctx, frame.reachRing);
    if (frame.deadlineTell) this.drawDeadlineTell(ctx, frame.deadlineTell, frame.deadlineRadius);
    for (const mark of frame.deadlines) this.drawDeadline(ctx, mark, frame.deadlineRadius);
    if (frame.sweepTell) this.drawSweepTell(ctx, frame);
    if (frame.sweep) this.drawSecondHand(ctx, frame);
    for (const shot of frame.projectiles) this.drawBolt(ctx, shot, frame);
    if (frame.goldLine) this.drawGoldLine(ctx, frame.goldLine);
    this.drawParticles(ctx);

    ctx.restore();
  }

  private drawEmbers(ctx: CanvasRenderingContext2D) {
    for (const particle of this.particles) {
      if (particle.kind !== "ember") continue;
      const t = particle.life / particle.maxLife;
      ctx.globalAlpha = Math.sin(t * Math.PI) * 0.55;
      ctx.fillStyle = particle.color;
      ctx.beginPath();
      ctx.arc(particle.x + Math.sin(particle.life / 700) * 1.2, particle.y, particle.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private drawReach(ctx: CanvasRenderingContext2D, reach: NonNullable<FxFrame["reachRing"]>) {
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 140);
    ctx.save();
    ctx.translate(reach.at.x, reach.at.y);
    ctx.globalAlpha = reach.ready ? 0.55 + 0.35 * pulse : 0.22;
    ctx.strokeStyle = reach.ready ? "#9ffcff" : "#e9fbff";
    ctx.lineWidth = reach.ready ? 0.7 : 0.4;
    ctx.setLineDash(reach.ready ? [] : [1.6, 1.6]);
    ctx.beginPath();
    ctx.arc(0, 0, reach.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  private floorEllipse(ctx: CanvasRenderingContext2D, at: StagePoint, radius: number) {
    ctx.beginPath();
    ctx.ellipse(at.x, at.y, radius, radius * FLOOR_FORESHORTENING, 0, 0, Math.PI * 2);
  }

  private drawDeadlineTell(ctx: CanvasRenderingContext2D, tell: NonNullable<FxFrame["deadlineTell"]>, radius: number) {
    ctx.save();
    ctx.globalAlpha = 0.18 + tell.progress * 0.35;
    ctx.strokeStyle = "#ffb15a";
    ctx.lineWidth = 0.45;
    ctx.setLineDash([1.4, 1.4]);
    this.floorEllipse(ctx, tell.at, radius * (1.25 - tell.progress * 0.25));
    ctx.stroke();
    ctx.restore();
  }

  private drawDeadline(ctx: CanvasRenderingContext2D, mark: FxDeadline, radius: number) {
    const progress = 1 - Math.max(0, mark.fuseMs) / mark.fuseTotalMs;
    const late = progress > 0.8;
    const flash = late ? 0.5 + 0.5 * Math.sin(performance.now() / 45) : 0;
    const tint = mark.deferred ? "#c9a2ff" : "#ffb15a";
    ctx.save();
    // Face of the floor clock.
    ctx.globalAlpha = 0.22 + progress * 0.28;
    ctx.fillStyle = mark.deferred ? "rgba(90, 40, 140, 1)" : "rgba(150, 50, 20, 1)";
    this.floorEllipse(ctx, mark.at, radius);
    ctx.fill();
    // The countdown sweeps like a minute hand around the face.
    ctx.globalAlpha = 0.45 + flash * 0.4;
    ctx.fillStyle = mark.deferred ? "rgba(190, 150, 255, 1)" : "rgba(255, 120, 60, 1)";
    ctx.beginPath();
    ctx.moveTo(mark.at.x, mark.at.y);
    const start = -Math.PI / 2;
    for (let i = 0; i <= 40; i += 1) {
      const angle = start + (i / 40) * progress * Math.PI * 2;
      ctx.lineTo(mark.at.x + Math.cos(angle) * radius, mark.at.y + Math.sin(angle) * radius * FLOOR_FORESHORTENING);
    }
    ctx.closePath();
    ctx.fill();
    // Rim and twelve ticks.
    ctx.globalAlpha = 0.95;
    ctx.strokeStyle = tint;
    ctx.lineWidth = 0.6 + flash * 0.5;
    this.floorEllipse(ctx, mark.at, radius);
    ctx.stroke();
    ctx.lineWidth = 0.35;
    for (let i = 0; i < 12; i += 1) {
      const angle = (i / 12) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle) * FLOOR_FORESHORTENING;
      ctx.beginPath();
      ctx.moveTo(mark.at.x + cos * radius * 0.82, mark.at.y + sin * radius * 0.82);
      ctx.lineTo(mark.at.x + cos * radius * 0.96, mark.at.y + sin * radius * 0.96);
      ctx.stroke();
    }
    if (mark.deferred) {
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = "#f3e8ff";
      ctx.font = "700 2.4px Georgia, serif";
      ctx.textAlign = "center";
      ctx.fillText("DEFERRED", mark.at.x, mark.at.y - radius * FLOOR_FORESHORTENING - 1.4);
    }
    ctx.restore();
  }

  private handPolygon(ctx: CanvasRenderingContext2D, origin: StagePoint, angleDeg: number, length: number, halfWidth: number) {
    const angle = (angleDeg * Math.PI) / 180;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const nx = -dy;
    const ny = dx;
    const base = halfWidth * 1.6;
    ctx.beginPath();
    ctx.moveTo(origin.x + nx * base, origin.y + ny * base);
    ctx.lineTo(origin.x + dx * length * 0.94 + nx * halfWidth * 0.6, origin.y + dy * length * 0.94 + ny * halfWidth * 0.6);
    ctx.lineTo(origin.x + dx * length, origin.y + dy * length);
    ctx.lineTo(origin.x + dx * length * 0.94 - nx * halfWidth * 0.6, origin.y + dy * length * 0.94 - ny * halfWidth * 0.6);
    ctx.lineTo(origin.x - nx * base, origin.y - ny * base);
    ctx.closePath();
  }

  private drawSweepTell(ctx: CanvasRenderingContext2D, frame: FxFrame) {
    const tell = frame.sweepTell!;
    const radius = 78;
    const from = (tell.from * Math.PI) / 180;
    const to = (tell.to * Math.PI) / 180;
    ctx.save();
    ctx.globalAlpha = 0.25 + tell.progress * 0.45;
    ctx.strokeStyle = frame.hologram ? HOLO : "#ffe7a6";
    ctx.lineWidth = 0.55;
    ctx.setLineDash([2, 1.6]);
    ctx.beginPath();
    ctx.arc(frame.origin.x, frame.origin.y, radius, Math.min(from, to), Math.max(from, to));
    ctx.stroke();
    ctx.setLineDash([]);
    // Arrowhead at the far end so the direction reads without words.
    const tip = to;
    const tipX = frame.origin.x + Math.cos(tip) * radius;
    const tipY = frame.origin.y + Math.sin(tip) * radius;
    const sign = to > from ? 1 : -1;
    const back = tip - sign * 0.07;
    ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(frame.origin.x + Math.cos(back) * (radius + 2.4), frame.origin.y + Math.sin(back) * (radius + 2.4));
    ctx.lineTo(frame.origin.x + Math.cos(back) * (radius - 2.4), frame.origin.y + Math.sin(back) * (radius - 2.4));
    ctx.closePath();
    ctx.fill();
    // A ghost of the hand where it will begin.
    ctx.globalAlpha = 0.14 + tell.progress * 0.3;
    ctx.fillStyle = frame.hologram ? HOLO : "#fff2c4";
    this.handPolygon(ctx, frame.origin, tell.from, frame.handLength, frame.handHalfWidth);
    ctx.fill();
    ctx.restore();
  }

  private drawSecondHand(ctx: CanvasRenderingContext2D, frame: FxFrame) {
    const sweep = frame.sweep!;
    if (sweep.live && !this.reducedMotion) {
      const last = this.handTrail[this.handTrail.length - 1];
      if (!last || Math.abs(last.angle - sweep.angle) > 0.8) this.handTrail.push({ angle: sweep.angle, age: 0 });
    }
    ctx.save();
    for (const ghost of this.handTrail) {
      ctx.globalAlpha = (1 - ghost.age / 140) * 0.22;
      ctx.fillStyle = frame.hologram ? HOLO : "#ffd88a";
      this.handPolygon(ctx, frame.origin, ghost.angle, frame.handLength, frame.handHalfWidth);
      ctx.fill();
    }
    ctx.globalAlpha = sweep.live ? 0.92 : 0.35;
    const angle = (sweep.angle * Math.PI) / 180;
    const gradient = ctx.createLinearGradient(
      frame.origin.x,
      frame.origin.y,
      frame.origin.x + Math.cos(angle) * frame.handLength,
      frame.origin.y + Math.sin(angle) * frame.handLength
    );
    if (frame.hologram) {
      gradient.addColorStop(0, "rgba(230, 255, 255, 0.95)");
      gradient.addColorStop(0.5, "rgba(143, 243, 255, 0.75)");
      gradient.addColorStop(1, "rgba(143, 243, 255, 0.1)");
    } else {
      gradient.addColorStop(0, "rgba(255, 250, 225, 1)");
      gradient.addColorStop(0.45, "rgba(255, 196, 92, 0.9)");
      gradient.addColorStop(1, "rgba(255, 120, 50, 0.15)");
    }
    ctx.fillStyle = gradient;
    this.handPolygon(ctx, frame.origin, sweep.angle, frame.handLength, frame.handHalfWidth);
    ctx.fill();
    ctx.globalAlpha = sweep.live ? 0.9 : 0.3;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
    ctx.lineWidth = 0.35;
    ctx.beginPath();
    ctx.moveTo(frame.origin.x, frame.origin.y);
    ctx.lineTo(frame.origin.x + Math.cos(angle) * frame.handLength, frame.origin.y + Math.sin(angle) * frame.handLength);
    ctx.stroke();
    ctx.restore();
  }

  private drawBolt(ctx: CanvasRenderingContext2D, shot: ColosseumProjectile, frame: FxFrame) {
    const charging = (shot.delayMs ?? 0) > 0;
    const color = shot.reversed ? REWIND : frame.hologram ? HOLO : GOLD;
    ctx.save();
    if (charging) {
      // Queued inside his face: the fan's stagger is visible before it fires.
      const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 60 + shot.x);
      ctx.globalAlpha = 0.55 * pulse;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(shot.x, shot.y, 1.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }
    const speed = Math.hypot(shot.vx, shot.vy) || 1;
    const ux = shot.vx / speed;
    const uy = shot.vy / speed;
    const hanging = shot.hanging === true;
    const jitter = hanging && !this.reducedMotion ? (Math.random() - 0.5) * 0.35 : 0;
    const x = shot.x + jitter;
    const y = shot.y + jitter;

    if (!hanging) {
      const trail = Math.min(9, speed * 0.09);
      const gradient = ctx.createLinearGradient(x, y, x - ux * trail, y - uy * trail);
      gradient.addColorStop(0, shot.reversed ? "rgba(185,232,255,0.85)" : frame.hologram ? "rgba(143,243,255,0.8)" : "rgba(255,196,92,0.9)");
      gradient.addColorStop(1, "rgba(255,120,50,0)");
      ctx.strokeStyle = gradient;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - ux * trail, y - uy * trail);
      ctx.stroke();
    }

    // Soft bloom, then a hot core.
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 2.9, 0, Math.PI * 2);
    ctx.fill();
    const core = ctx.createRadialGradient(x - 0.35, y - 0.35, 0.1, x, y, 1.7);
    core.addColorStop(0, "#ffffff");
    core.addColorStop(0.4, shot.reversed ? "#e3f7ff" : frame.hologram ? "#dcfeff" : "#ffe9a6");
    core.addColorStop(1, shot.reversed ? "#4aa9d6" : frame.hologram ? "#2aaecb" : "#e0561f");
    ctx.globalAlpha = 1;
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(x, y, 1.6, 0, Math.PI * 2);
    ctx.fill();

    if (hanging && shot.hang && shot.ageMs != null) {
      // The hang has its own little clock: when it closes, the bolt resumes.
      const progress = Math.min(1, Math.max(0, (shot.ageMs - shot.hang.atMs) / shot.hang.forMs));
      const imminent = progress > 0.78;
      ctx.lineWidth = 0.5;
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.beginPath();
      ctx.arc(x, y, 3.8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = imminent ? "#ffffff" : "#ffe4a0";
      ctx.lineWidth = imminent ? 0.9 : 0.6;
      ctx.beginPath();
      ctx.arc(x, y, 3.8, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
      ctx.stroke();
      if (imminent) {
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(x, y, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  private drawGoldLine(ctx: CanvasRenderingContext2D, line: NonNullable<FxFrame["goldLine"]>) {
    ctx.save();
    if (line.mode === "grow") {
      const t = Math.max(0, Math.min(1, line.t));
      const eased = 1 - Math.pow(1 - t, 3);
      const tipX = line.from.x + (line.to.x - line.from.x) * eased;
      const tipY = line.from.y + (line.to.y - line.from.y) * eased;
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = "#ffb01f";
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(line.from.x, line.from.y);
      ctx.lineTo(tipX, tipY);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "#fff4c8";
      ctx.lineWidth = 0.7;
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(tipX, tipY, 1.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }
    const taut = Math.min(1, line.t * 1.6);
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = "#ffd36b";
    ctx.lineWidth = 0.5 + taut * 0.5;
    ctx.beginPath();
    ctx.moveTo(line.from.x, line.from.y);
    const midX = (line.from.x + line.to.x) / 2;
    const midY = (line.from.y + line.to.y) / 2 + (1 - taut) * 8;
    ctx.quadraticCurveTo(midX, midY, line.to.x, line.to.y);
    ctx.stroke();
    ctx.globalAlpha = 0.3;
    ctx.lineWidth = 2.2;
    ctx.stroke();
    ctx.restore();
  }

  private drawParticles(ctx: CanvasRenderingContext2D) {
    for (const particle of this.particles) {
      const t = particle.life / particle.maxLife;
      switch (particle.kind) {
        case "spark": {
          ctx.globalAlpha = 1 - t;
          ctx.strokeStyle = particle.color;
          ctx.lineWidth = particle.size;
          const length = Math.hypot(particle.vx, particle.vy) * 0.03 + 0.4;
          const heading = Math.atan2(particle.vy, particle.vx);
          ctx.beginPath();
          ctx.moveTo(particle.x, particle.y);
          ctx.lineTo(particle.x - Math.cos(heading) * length, particle.y - Math.sin(heading) * length);
          ctx.stroke();
          break;
        }
        case "ring": {
          ctx.globalAlpha = (1 - t) * 0.9;
          ctx.strokeStyle = particle.color;
          ctx.lineWidth = 0.9 * (1 - t) + 0.15;
          ctx.beginPath();
          ctx.arc(particle.x, particle.y, particle.size * (0.25 + t * 0.9), 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        case "glint": {
          ctx.globalAlpha = Math.sin(t * Math.PI);
          ctx.fillStyle = particle.color;
          const s = particle.size * (0.6 + Math.sin(t * Math.PI) * 0.6);
          ctx.save();
          ctx.translate(particle.x, particle.y);
          ctx.rotate(particle.rotation);
          ctx.beginPath();
          ctx.moveTo(0, -s);
          ctx.lineTo(s * 0.16, -s * 0.16);
          ctx.lineTo(s, 0);
          ctx.lineTo(s * 0.16, s * 0.16);
          ctx.lineTo(0, s);
          ctx.lineTo(-s * 0.16, s * 0.16);
          ctx.lineTo(-s, 0);
          ctx.lineTo(-s * 0.16, -s * 0.16);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
          break;
        }
        case "slash": {
          const from = ((particle.from ?? -160) * Math.PI) / 180;
          const to = ((particle.to ?? -30) * Math.PI) / 180;
          const grow = Math.min(1, t * 3.2);
          const current = from + (to - from) * grow;
          ctx.globalAlpha = 1 - Math.max(0, (t - 0.35) / 0.65);
          ctx.strokeStyle = "rgba(255, 190, 80, 0.55)";
          ctx.lineWidth = 2.6;
          ctx.beginPath();
          ctx.arc(particle.x, particle.y, particle.size, Math.min(from, current), Math.max(from, current));
          ctx.stroke();
          ctx.strokeStyle = particle.color;
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.arc(particle.x, particle.y, particle.size, Math.min(from, current), Math.max(from, current));
          ctx.stroke();
          break;
        }
        case "shock": {
          const radius = particle.size * (1 - Math.pow(1 - t, 3));
          ctx.globalAlpha = (1 - t) * 0.85;
          ctx.strokeStyle = "#fff4c8";
          ctx.lineWidth = 1.2 + (1 - t) * 2.4;
          ctx.beginPath();
          ctx.arc(particle.x, particle.y, radius, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = (1 - t) * 0.35;
          ctx.strokeStyle = particle.color;
          ctx.lineWidth = 5 * (1 - t) + 0.5;
          ctx.stroke();
          break;
        }
        case "debris": {
          ctx.globalAlpha = Math.min(1, (1 - t) * 1.6);
          ctx.fillStyle = particle.color;
          ctx.save();
          ctx.translate(particle.x, particle.y);
          ctx.rotate(particle.rotation);
          ctx.fillRect(-particle.size / 2, -particle.size / 3, particle.size, particle.size * 0.66);
          ctx.restore();
          break;
        }
        case "dust": {
          ctx.globalAlpha = (1 - t) * 0.4;
          ctx.fillStyle = particle.color;
          ctx.beginPath();
          const r = particle.size * (0.7 + t * 0.8);
          ctx.ellipse(particle.x, particle.y, r, r * FLOOR_FORESHORTENING, 0, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case "ember":
          break;
      }
    }
    ctx.globalAlpha = 1;
  }
}

/**
 * Size a canvas to the stage at a device-pixel ratio the phone can afford:
 * at most 2x, and never more than ~2.4 megapixels however large the stage.
 */
export function fxResolution(stageWidthPx: number, stageHeightPx: number, devicePixelRatio: number): number {
  const wanted = Math.min(2, Math.max(1, devicePixelRatio || 1));
  const budget = Math.sqrt(2_400_000 / Math.max(1, stageWidthPx * stageHeightPx));
  return Math.max(0.75, Math.min(wanted, budget));
}
