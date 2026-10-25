/**
 * The Round-Up, painted. Same ground, depth, shadows and sprites as the story; plus what makes herding readable and
 * physical: the pen's fence with its gate, the creek, the tear in the field with the garage light coming up through
 * it, dust behind anything running, a ring on the ground when she barks, a jolt when the boxer charges, a hop and a
 * gold +1 when a cow goes home, and the light going from afternoon to dusk on the clock.
 */
import { BOXER, CALF, COYOTE, TERRIER, type Rect, type Sheet } from "./cells";
import { GROUND, VIEW } from "./adventure";
import { DURATION, CREEK, HOLE, HW, HZ, PEN, type Herd } from "./herd";
import { H, PAINT_SCALE, PAINT_Y, depthScale, drawSprite, petals, propSprite, shadow, type Art } from "./paint";

const [TOP, BOTTOM] = GROUND.pasture;
const gy = (z: number) => TOP + (z / HZ) * (BOTTOM - TOP);
const dOf = (z: number) => z / HZ;

type Puff = { x: number; z: number; t: number; s: number };
type Float = { x: number; z: number; t: number; text: string; gold: boolean };
export type HerdFx = { puffs: Puff[]; floats: Float[]; flash: number; shakeSeed: number };
export const newFx = (): HerdFx => ({ puffs: [], floats: [], flash: 0, shakeSeed: 0 });

const COW_TINTS = ["rgba(255, 200, 120, 0.12)", "rgba(90, 40, 20, 0.18)", "rgba(255, 240, 220, 0.16)", "rgba(60, 30, 20, 0.28)"];

export function paintHerd(c: CanvasRenderingContext2D, art: Art, h: Herd, fx: HerdFx, cam: number, dt: number, reduced: boolean) {
  const t = reduced ? 0 : h.time;
  const dusk = Math.min(1, Math.max(0, (h.time / DURATION - 0.35) / 0.65));
  c.clearRect(0, 0, VIEW, H);
  c.save();
  if (h.shake > 0 && !reduced) c.translate((Math.random() - 0.5) * h.shake * 16, (Math.random() - 0.5) * h.shake * 10);
  c.fillStyle = "#5bace3";
  c.fillRect(-20, -20, VIEW + 40, H + 40);
  c.drawImage(art["08-ranch-far"], -cam * 0.12, -140, 1600, 1067);
  c.drawImage(art["09-ranch-mid"], -cam, PAINT_Y, 1536 * PAINT_SCALE, 1024 * PAINT_SCALE);

  c.save();
  c.translate(-cam, 0);
  type D = { z: number; draw: () => void };
  const list: D[] = [];
  const tint = "rgba(255, 196, 90, 0.12)";
  const animal = (sheet: Sheet, r: Rect, x: number, z: number, face: 1 | -1, opt: { size?: number; lift?: number; tint?: string; tongue?: number; squash?: number; rot?: number; alpha?: number } = {}) => {
    const d = dOf(z);
    const sc = depthScale(d) * (sheet.height / sheet.stand[3]) * (opt.size ?? 1);
    const y = gy(z);
    list.push({
      z: z + 0.01,
      draw: () => {
        if (opt.alpha === undefined || opt.alpha > 0.5) shadow(c, x, y, r[2] * sc * 0.9, opt.lift ?? 0);
        if (opt.rot) {
          c.save();
          c.translate(x, y);
          c.rotate(opt.rot);
          c.translate(-x, -y);
        }
        drawSprite(c, art, sheet, r, x, y - (opt.lift ?? 0), sc, face, { tint: opt.tint ?? tint, tongue: opt.tongue, time: t, squash: opt.squash, alpha: opt.alpha });
        if (opt.rot) c.restore();
      },
    });
  };
  const frame = (sheet: Sheet, rate: number, seed = 0) => sheet.walk[Math.floor(t * rate + seed) % sheet.walk.length];

  // ---- the tear in the field, garage light coming up through it
  {
    const { sp, r } = propSprite(art, "hole");
    list.push({
      z: HOLE.z - 30,
      draw: () => {
        const w = HOLE.r * 4.2 * depthScale(dOf(HOLE.z)), hh = (w * r[3]) / r[2];
        c.save();
        c.globalAlpha = 0.95;
        c.drawImage(sp, HOLE.x - w / 2, gy(HOLE.z) - hh * 0.62, w, hh);
        c.restore();
        // the cold glow pulses: something is wrong here
        const g = c.createRadialGradient(HOLE.x, gy(HOLE.z) - 6, 4, HOLE.x, gy(HOLE.z) - 6, 70 + Math.sin(t * 2) * 6);
        g.addColorStop(0, `rgba(190, 240, 255, ${0.35 + fx.flash * 0.5})`);
        g.addColorStop(1, "rgba(190, 240, 255, 0)");
        c.fillStyle = g;
        c.fillRect(HOLE.x - 90, gy(HOLE.z) - 90, 180, 160);
      },
    });
  }
  // ---- the creek is painted into the ranch; only its glints move, drifting downstream along the painted water
  list.push({
    z: 0.5,
    draw: () => {
      c.save();
      c.lineCap = "round";
      for (let i = 0; i < 22; i++) {
        const k = (i * 0.137 + t * 0.05) % 1;
        const z = k * HZ;
        const y = gy(z);
        const across = 0.2 + ((i * 0.618) % 0.6);
        const xm = CREEK.x0 + CREEK.slope * z + (CREEK.x1 - CREEK.x0) * across;
        const a = Math.max(0, Math.sin(k * Math.PI) * (0.45 + 0.45 * Math.sin(t * 3 + i * 1.7)));
        c.strokeStyle = `rgba(255, 252, 236, ${a * 0.85})`;
        c.lineWidth = 1.4 + (z / HZ) * 1.8;
        c.beginPath();
        c.moveTo(xm - 7 - (z / HZ) * 7, y);
        c.lineTo(xm + 7 + (z / HZ) * 7, y);
        c.stroke();
      }
      c.restore();
    },
  });
  // ---- the pen: back rail, the left fence with its gate, front rail (in front of everything)
  const post = (x: number, z: number, tall = 1) => {
    const s = depthScale(dOf(z));
    const w = 10 * s, hgt = 74 * s * tall;
    c.fillStyle = "#6e4a2c";
    c.fillRect(x - w / 2, gy(z) - hgt, w, hgt);
    c.fillStyle = "#a7774a";
    c.fillRect(x - w / 2, gy(z) - hgt, w * 0.4, hgt);
    c.fillStyle = "rgba(74, 44, 120, 0.3)";
    c.fillRect(x + w / 2, gy(z) - 4 * s, 18 * s, 4 * s);
  };
  const rail = (x0: number, z0: number, x1: number, z1: number, at: number) => {
    const s0 = depthScale(dOf(z0)), s1 = depthScale(dOf(z1));
    c.strokeStyle = "#7c5434";
    c.lineWidth = 6 * (s0 + s1) * 0.5;
    c.beginPath();
    c.moveTo(x0, gy(z0) - at * s0);
    c.lineTo(x1, gy(z1) - at * s1);
    c.stroke();
    c.strokeStyle = "rgba(255, 220, 160, 0.35)";
    c.lineWidth = 1.5;
    c.stroke();
  };
  list.push({
    z: -1,
    draw: () => {
      for (let x = PEN.x0; x <= HW; x += 70) post(x, 0);
      rail(PEN.x0, 0, HW, 0, 30);
      rail(PEN.x0, 0, HW, 0, 58);
    },
  });
  const sideZ = [0, 20, 40, 60, PEN.gate0, PEN.gate1, 190, 215, HZ];
  for (let i = 0; i < sideZ.length; i++) {
    const z = sideZ[i];
    const gatePost = z === PEN.gate0 || z === PEN.gate1;
    list.push({
      z,
      draw: () => {
        post(PEN.x0, z, gatePost ? 1.35 : 1);
        const nz = sideZ[i + 1];
        if (nz !== undefined && !(z === PEN.gate0 && nz === PEN.gate1)) {
          rail(PEN.x0, z, PEN.x0, nz, 30);
          rail(PEN.x0, z, PEN.x0, nz, 58);
        }
        if (gatePost) {
          // a lantern on each gate post, so the gate reads from across the field
          const s = depthScale(dOf(z));
          const y = gy(z) - 74 * s * 1.35 - 8 * s;
          c.fillStyle = "#3a2a22";
          c.fillRect(PEN.x0 - 5 * s, y, 10 * s, 12 * s);
          c.fillStyle = `rgba(255, 214, 120, ${0.7 + Math.sin(t * 3 + z) * 0.15 + dusk * 0.3})`;
          c.fillRect(PEN.x0 - 3.5 * s, y + 2 * s, 7 * s, 8 * s);
          if (dusk > 0.1) {
            const g = c.createRadialGradient(PEN.x0, y + 6 * s, 2, PEN.x0, y + 6 * s, 60 * s);
            g.addColorStop(0, `rgba(255, 200, 110, ${0.4 * dusk})`);
            g.addColorStop(1, "rgba(255, 200, 110, 0)");
            c.fillStyle = g;
            c.fillRect(PEN.x0 - 60 * s, y - 54 * s, 120 * s, 120 * s);
          }
        }
      },
    });
  }
  list.push({
    z: HZ + 0.5,
    draw: () => {
      for (let x = PEN.x0 + 70; x <= HW; x += 70) post(x, HZ);
      rail(PEN.x0, HZ, HW, HZ, 30);
      rail(PEN.x0, HZ, HW, HZ, 58);
    },
  });

  // ---- the animals
  for (const cow of h.cows) {
    if (cow.state === "lost") continue;
    const sheet = CALF;
    let r: Rect = sheet.stand;
    let rot = 0, alpha = 1, lift = 0, size = cow.size;
    if (cow.state === "falling") {
      const k = Math.min(1, cow.fall / 0.9);
      r = sheet.poses.scared;
      rot = k * 2.4 * cow.face;
      size *= 1 - k * 0.75;
      alpha = 1 - k;
      lift = -k * 30;
    } else if (cow.state === "run") r = sheet.poses.run;
    else if (cow.state === "walk") r = frame(sheet, 7, cow.seed);
    else if (cow.startle > 0.3) r = sheet.poses.scared;
    else r = Math.sin(t * 0.3 + cow.seed) > -0.2 ? sheet.poses.nuzzle : sheet.stand; // grazing, head down
    if (cow.state === "penned" && Math.hypot(cow.vx, cow.vz) < 10) r = Math.sin(t * 0.2 + cow.seed) > 0.4 ? sheet.poses.lie : sheet.poses.nuzzle;
    lift += Math.sin(Math.min(1, cow.hop) * Math.PI) * 26;
    animal(sheet, r, cow.x, cow.z, cow.face, { size, rot, alpha, lift, tint: cow.calf ? undefined : COW_TINTS[cow.tint] });
    // a startled cow throws up a little shape over its head
    if (cow.startle > 0.45 && cow.state !== "penned") {
      const s = depthScale(dOf(cow.z));
      list.push({
        z: cow.z + 0.02,
        draw: () => {
          const y = gy(cow.z) - 150 * s * cow.size;
          c.fillStyle = "#fff6e6";
          c.beginPath();
          c.ellipse(cow.x, y, 11 * s, 14 * s, 0, 0, Math.PI * 2);
          c.fill();
          c.fillStyle = "#c8443a";
          c.fillRect(cow.x - 2 * s, y - 9 * s, 4 * s, 11 * s);
          c.fillRect(cow.x - 2 * s, y + 5 * s, 4 * s, 4 * s);
        },
      });
    }
  }
  const b = h.boxer;
  const boxerR = b.state === "nap" ? BOXER.poses.sleep : b.state === "charge" ? BOXER.poses.charge : b.state === "stop" ? BOXER.stand : Math.hypot(b.vx, b.vz) > 30 ? frame(BOXER, 9) : BOXER.stand;
  animal(BOXER, boxerR, b.x, b.z, b.face, { squash: b.state === "charge" ? 0.25 : 0 });
  const d = h.dog;
  const dogMoving = Math.hypot(d.vx, d.vz) > 25;
  const dogR = d.ring > 0.75 ? TERRIER.poses.jump : dogMoving ? frame(TERRIER, d.sprint ? 14 : 10) : TERRIER.stand;
  animal(TERRIER, dogR, d.x, d.z, d.face, { tongue: dogMoving || d.ring > 0 ? 1 : 0, lift: d.ring > 0.75 ? (d.ring - 0.75) * 40 : 0 });
  const co = h.coyote;
  if (co.state === "stalk" || co.state === "flee") animal(COYOTE, co.state === "flee" ? frame(COYOTE, 12) : COYOTE.poses.slink, co.x, co.z, co.face, { size: 1 });

  // bark ring on the ground
  if (d.ring > 0) {
    list.push({
      z: d.z - 0.5,
      draw: () => {
        const k = 1 - d.ring;
        c.save();
        c.strokeStyle = `rgba(255, 246, 230, ${d.ring * 0.85})`;
        c.lineWidth = 4 * d.ring + 1;
        c.beginPath();
        c.ellipse(d.x, gy(d.z), 40 + k * 260, (40 + k * 260) * 0.28, 0, 0, Math.PI * 2);
        c.stroke();
        c.restore();
      },
    });
  }
  // dust behind anything running
  if (!reduced) {
    const kick = (x: number, z: number, sp: number) => {
      if (sp > 150 && Math.random() < dt * (sp / 40)) fx.puffs.push({ x: x + (Math.random() - 0.5) * 20, z: z + (Math.random() - 0.5) * 10, t: 0, s: 0.6 + Math.random() * 0.6 });
    };
    for (const cow of h.cows) if (cow.state !== "penned" && cow.state !== "lost") kick(cow.x, cow.z, Math.hypot(cow.vx, cow.vz));
    kick(b.x, b.z, Math.hypot(b.vx, b.vz) * (b.state === "charge" ? 2 : 1));
    kick(d.x, d.z, Math.hypot(d.vx, d.vz));
  }
  for (const p of fx.puffs) p.t += dt;
  fx.puffs = fx.puffs.filter(p => p.t < 0.9).slice(-90);
  for (const p of fx.puffs) {
    list.push({
      z: p.z - 0.1,
      draw: () => {
        const k = p.t / 0.9;
        c.fillStyle = `rgba(232, 204, 150, ${0.5 * (1 - k)})`;
        c.beginPath();
        c.ellipse(p.x, gy(p.z) - 6 - k * 16, (8 + k * 22) * p.s, (5 + k * 12) * p.s, 0, 0, Math.PI * 2);
        c.fill();
      },
    });
  }
  // the front grass, in front of everyone
  for (let x = 80; x < HW; x += 310) {
    const { sp, r } = propSprite(art, "grass");
    list.push({
      z: HZ + 2,
      draw: () => {
        const w = 170 * depthScale(1.05), hh = (w * r[3]) / r[2];
        const sway = Math.sin(t * 1.3 + x) * 0.03;
        c.save();
        c.transform(1, 0, sway, 1, -sway * (BOTTOM + 40), 0);
        c.drawImage(sp, x - w / 2, BOTTOM + 60 - hh, w, hh);
        c.restore();
      },
    });
  }
  list.sort((a, b2) => a.z - b2.z);
  for (const it of list) it.draw();

  // gold +1s and the like float up from the world
  for (const f of fx.floats) f.t += dt;
  fx.floats = fx.floats.filter(f => f.t < 1.4);
  for (const f of fx.floats) {
    const k = f.t / 1.4;
    c.save();
    c.globalAlpha = 1 - Math.max(0, k - 0.6) / 0.4;
    c.font = `700 ${f.gold ? 34 : 22}px Georgia, serif`;
    c.textAlign = "center";
    c.lineWidth = 5;
    c.strokeStyle = "rgba(60, 30, 50, 0.6)";
    c.fillStyle = f.gold ? "#ffd56a" : "#fff6e6";
    const y = gy(f.z) - 120 - k * 70;
    c.strokeText(f.text, f.x, y);
    c.fillText(f.text, f.x, y);
    c.restore();
  }
  c.restore();

  // the light: afternoon gold, then dusk violet
  if (dusk > 0) {
    c.fillStyle = `rgba(120, 60, 140, ${dusk * 0.32})`;
    c.fillRect(0, 0, VIEW, H);
    c.fillStyle = `rgba(255, 130, 60, ${Math.sin(dusk * Math.PI) * 0.16})`;
    c.fillRect(0, 0, VIEW, H);
  }
  fx.flash = Math.max(0, fx.flash - dt * 2);
  if (fx.flash > 0) {
    c.fillStyle = `rgba(200, 240, 255, ${fx.flash * 0.25})`;
    c.fillRect(0, 0, VIEW, H);
  }
  petals(c, t, 8);
  c.restore();
}
