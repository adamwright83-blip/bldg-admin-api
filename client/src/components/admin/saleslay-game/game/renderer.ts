/** Saleslay Battle Canvas — pure canvas renderer. Draws the battlefield only;
 * the HUD (numbers, buttons, log) is HTML/CSS overlaid by the React shell.
 * Falls back to drawn placeholder shapes when sprite images fail to load. */
import { CANVAS_H, CANVAS_W, DRAGON_X, DRAGON_Y, VILLAIN_X, VILLAIN_Y } from "./engine";
import type { BattleState } from "./types";

export type SpriteSet = Partial<
  Record<
    | "background"
    | "dragon_idle"
    | "dragon_fire"
    | "villain_idle"
    | "villain_hit"
    | "fireball"
    | "excuse_projectile",
    HTMLImageElement
  >
>;

const SPRITE_FILES: Record<keyof SpriteSet, string> = {
  background: "/assets/saleslay/background.png",
  dragon_idle: "/assets/saleslay/dragon_idle.png",
  dragon_fire: "/assets/saleslay/dragon_fire.png",
  villain_idle: "/assets/saleslay/villain_idle.png",
  villain_hit: "/assets/saleslay/villain_hit.png",
  fireball: "/assets/saleslay/fireball.png",
  excuse_projectile: "/assets/saleslay/excuse_projectile.png",
};

export function loadSprites(onEach?: () => void): SpriteSet {
  const sprites: SpriteSet = {};
  (Object.keys(SPRITE_FILES) as Array<keyof SpriteSet>).forEach((key) => {
    const img = new Image();
    img.onload = () => onEach?.();
    img.onerror = () => {
      delete sprites[key];
      onEach?.();
    };
    img.src = SPRITE_FILES[key];
    sprites[key] = img;
  });
  return sprites;
}

function spriteReady(img: HTMLImageElement | undefined): img is HTMLImageElement {
  return !!img && img.complete && img.naturalWidth > 0;
}

function drawBackground(ctx: CanvasRenderingContext2D, sprites: SpriteSet) {
  if (spriteReady(sprites.background)) {
    ctx.drawImage(sprites.background, 0, 0, CANVAS_W, CANVAS_H);
    return;
  }
  const grad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
  grad.addColorStop(0, "#1c2340");
  grad.addColorStop(0.55, "#2b3a63");
  grad.addColorStop(1, "#12162a");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // ground
  ctx.fillStyle = "#0e1122";
  ctx.fillRect(0, CANVAS_H - 120, CANVAS_W, 120);

  // faint floating castle silhouette, purely decorative
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.beginPath();
  ctx.moveTo(560, 260);
  ctx.lineTo(720, 260);
  ctx.lineTo(700, 180);
  ctx.lineTo(640, 220);
  ctx.lineTo(580, 180);
  ctx.closePath();
  ctx.fill();
}

function drawDragon(ctx: CanvasRenderingContext2D, state: BattleState, sprites: SpriteSet) {
  const bob = Math.sin(state.dragonBobT * (state.dragonCelebrating ? 6 : 2.2)) * (state.dragonCelebrating ? 18 : 8);
  const x = DRAGON_X;
  const y = DRAGON_Y + bob;
  const flashing = Date.now() < state.dragonHitFlashUntil;
  const sprite = sprites.dragon_idle;

  ctx.save();
  if (flashing) ctx.filter = "brightness(1.8) saturate(1.4)";

  if (spriteReady(sprite)) {
    ctx.drawImage(sprite, x - 90, y - 90, 180, 180);
  } else {
    // placeholder dragon: body + head + wing + snout, blue-ish
    ctx.fillStyle = "#3aa0c9";
    ctx.beginPath();
    ctx.ellipse(x, y, 70, 46, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x + 65, y - 20, 30, 24, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#2a7fa3";
    ctx.beginPath();
    ctx.moveTo(x - 10, y - 30);
    ctx.lineTo(x - 60, y - 90);
    ctx.lineTo(x + 20, y - 45);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#f4d35e";
    ctx.beginPath();
    ctx.arc(x + 82, y - 24, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  if (state.dragonCelebrating) {
    ctx.fillStyle = "rgba(255, 214, 90, 0.85)";
    ctx.font = "bold 22px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("★", x, y - 110);
  }
}

function drawVillain(ctx: CanvasRenderingContext2D, state: BattleState, sprites: SpriteSet) {
  if (state.villainDefeated) return;
  const shuffle = Math.sin(state.villainShuffleT * 1.4) * 10;
  const x = VILLAIN_X + shuffle;
  const y = VILLAIN_Y;
  const flashing = Date.now() < state.villainHitFlashUntil;
  const sprite = flashing ? sprites.villain_hit : sprites.villain_idle;

  ctx.save();
  if (flashing) ctx.filter = "brightness(1.6) saturate(1.6) hue-rotate(-20deg)";

  if (spriteReady(sprite)) {
    ctx.drawImage(sprite, x - 90, y - 100, 180, 190);
  } else {
    // placeholder: cloaked figure with a clock-face head
    ctx.fillStyle = "#4b3a54";
    ctx.beginPath();
    ctx.moveTo(x - 55, y + 40);
    ctx.lineTo(x - 40, y - 60);
    ctx.lineTo(x + 40, y - 60);
    ctx.lineTo(x + 55, y + 40);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#f2ead8";
    ctx.beginPath();
    ctx.arc(x, y - 90, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#3a2f42";
    ctx.lineWidth = 3;
    ctx.stroke();
    // clock hands
    ctx.strokeStyle = "#3a2f42";
    ctx.beginPath();
    ctx.moveTo(x, y - 90);
    ctx.lineTo(x, y - 108);
    ctx.moveTo(x, y - 90);
    ctx.lineTo(x + 14, y - 84);
    ctx.stroke();
  }
  ctx.restore();
}

function drawFireball(ctx: CanvasRenderingContext2D, x: number, y: number, sprite?: HTMLImageElement) {
  if (spriteReady(sprite)) {
    ctx.drawImage(sprite, x - 22, y - 22, 44, 44);
    return;
  }
  const grad = ctx.createRadialGradient(x, y, 2, x, y, 20);
  grad.addColorStop(0, "#fff3c4");
  grad.addColorStop(0.5, "#ff9d3a");
  grad.addColorStop(1, "rgba(255,80,20,0)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, 20, 0, Math.PI * 2);
  ctx.fill();
}

function drawExcuse(ctx: CanvasRenderingContext2D, x: number, y: number, sprite?: HTMLImageElement) {
  if (spriteReady(sprite)) {
    ctx.drawImage(sprite, x - 18, y - 18, 36, 36);
    return;
  }
  ctx.fillStyle = "#c9c9c9";
  ctx.fillRect(x - 16, y - 10, 32, 20);
  ctx.strokeStyle = "#8a8a8a";
  ctx.strokeRect(x - 16, y - 10, 32, 20);
}

function drawFloaters(ctx: CanvasRenderingContext2D, state: BattleState) {
  const now = Date.now();
  for (const f of state.floaters) {
    const age = (now - f.createdAt) / 900;
    const rise = age * 40;
    ctx.globalAlpha = Math.max(0, 1 - age);
    ctx.fillStyle = f.color;
    ctx.font = "bold 20px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(f.text, f.x, f.y - rise);
  }
  ctx.globalAlpha = 1;
}

function drawBanner(ctx: CanvasRenderingContext2D, state: BattleState) {
  if (!state.banner) return;
  ctx.save();
  ctx.fillStyle = "rgba(10,10,20,0.72)";
  ctx.fillRect(CANVAS_W / 2 - 340, 260, 680, 90);
  ctx.strokeStyle = "#f4d35e";
  ctx.lineWidth = 2;
  ctx.strokeRect(CANVAS_W / 2 - 340, 260, 680, 90);
  ctx.fillStyle = "#f4d35e";
  ctx.font = "bold 30px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(state.banner.text, CANVAS_W / 2, 315);
  ctx.restore();
}

export function draw(ctx: CanvasRenderingContext2D, state: BattleState, sprites: SpriteSet) {
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

  const shaking = Date.now() < state.shakeUntil;
  ctx.save();
  if (shaking) {
    ctx.translate((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8);
  }

  drawBackground(ctx, sprites);
  drawDragon(ctx, state, sprites);
  drawVillain(ctx, state, sprites);

  for (const fb of state.fireballs) drawFireball(ctx, fb.x, fb.y, sprites.fireball);
  for (const ex of state.excuses) drawExcuse(ctx, ex.x, ex.y, sprites.excuse_projectile);

  drawFloaters(ctx, state);
  drawBanner(ctx, state);

  ctx.restore();
}
