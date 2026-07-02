/** Saleslay Battle Canvas — pure canvas renderer. Draws the battlefield only;
 * the HUD (numbers, buttons, log) is HTML/CSS overlaid by the React shell.
 * Falls back to drawn placeholder shapes when sprite images fail to load. */
import { CANVAS_H, CANVAS_W, DRAGON_X, DRAGON_Y, VILLAIN_X, VILLAIN_Y } from "./engine";
import type { BattleState } from "./types";

export type SpriteSet = Partial<
  Record<
    | "background"
    | "dragon_idle"
    | "dragon_attack"
    | "dragon_hit"
    | "dragon_victory"
    | "villain_idle"
    | "villain_attack"
    | "villain_hit"
    | "villain_defeat"
    | "fireball"
    | "excuse_projectile",
    HTMLImageElement
  >
>;

const SPRITE_FILES: Record<keyof SpriteSet, string> = {
  background: "/assets/saleslay/background.png",
  dragon_idle: "/assets/saleslay/dragon_idle.png",
  dragon_attack: "/assets/saleslay/dragon_attack.png",
  dragon_hit: "/assets/saleslay/dragon_hit.png",
  dragon_victory: "/assets/saleslay/dragon_victory.png",
  villain_idle: "/assets/saleslay/villain_idle.png",
  villain_attack: "/assets/saleslay/villain_attack.png",
  villain_hit: "/assets/saleslay/villain_hit.png",
  villain_defeat: "/assets/saleslay/villain_defeat.png",
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

/** Slow drifting island silhouette — cheap parallax, no assets needed. */
function drawIsland(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, alpha: number) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "#241b3a";
  ctx.beginPath();
  ctx.ellipse(x, y, 70 * scale, 22 * scale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x - 14 * scale, y - 18 * scale);
  ctx.lineTo(x - 4 * scale, y - 40 * scale);
  ctx.lineTo(x + 6 * scale, y - 18 * scale);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawClothesline(ctx: CanvasRenderingContext2D, t: number) {
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = "#c9b48a";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(240, 200);
  ctx.quadraticCurveTo(640, 250 + Math.sin(t * 0.4) * 4, 1000, 190);
  ctx.stroke();
  const spots = [[400, 214], [640, 236], [860, 210]];
  const colors = ["#7bbcb0", "#e8d9b0", "#d88a70"];
  spots.forEach(([sx, sy], i) => {
    ctx.fillStyle = colors[i];
    ctx.fillRect(sx - 13, sy, 26, 20);
  });
  ctx.restore();
}

function drawBackground(ctx: CanvasRenderingContext2D, state: BattleState, sprites: SpriteSet) {
  if (spriteReady(sprites.background)) {
    ctx.drawImage(sprites.background, 0, 0, CANVAS_W, CANVAS_H);
    return;
  }

  // Base sky.
  const grad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
  grad.addColorStop(0, "#1c2340");
  grad.addColorStop(0.55, "#2b3a63");
  grad.addColorStop(1, "#12162a");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // Frontier split: warm lantern light on Spark's side, cool fog on the
  // Procrastinator's side. frontierPct (0..100) is shared with the DOM meter.
  const frontierX = (state.frontierPct / 100) * CANVAS_W;

  const warm = ctx.createRadialGradient(DRAGON_X, DRAGON_Y - 60, 40, DRAGON_X, DRAGON_Y - 60, frontierX * 0.9 + 120);
  warm.addColorStop(0, "rgba(255, 176, 90, 0.22)");
  warm.addColorStop(1, "rgba(255, 176, 90, 0)");
  ctx.fillStyle = warm;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  const cool = ctx.createRadialGradient(
    VILLAIN_X,
    VILLAIN_Y - 80,
    40,
    VILLAIN_X,
    VILLAIN_Y - 80,
    (CANVAS_W - frontierX) * 0.9 + 140
  );
  cool.addColorStop(0, "rgba(140, 110, 190, 0.28)");
  cool.addColorStop(1, "rgba(140, 110, 190, 0)");
  ctx.fillStyle = cool;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // Parallax islands, drifting slowly, dimmer on the fog side.
  const t = state.dragonBobT;
  drawIsland(ctx, 340, 150 + Math.sin(t * 0.15) * 6, 1, 0.75);
  drawIsland(ctx, 560, 120 + Math.sin(t * 0.12 + 1) * 5, 0.65, 0.55);
  drawIsland(ctx, 900, 160 + Math.sin(t * 0.18 + 2) * 6, 0.85, 0.5);

  drawClothesline(ctx, t);

  // Frontier seam line — subtle, matches the DOM meter's knot position.
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = "#f4d35e";
  ctx.setLineDash([6, 8]);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(frontierX, 0);
  ctx.lineTo(frontierX, CANVAS_H - 120);
  ctx.stroke();
  ctx.restore();

  // Ground.
  const floor = ctx.createLinearGradient(0, CANVAS_H - 120, 0, CANVAS_H);
  floor.addColorStop(0, "#241a2e");
  floor.addColorStop(1, "#120d18");
  ctx.fillStyle = floor;
  ctx.fillRect(0, CANVAS_H - 120, CANVAS_W, 120);
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  [[220, 45], [520, 30], [820, 40]].forEach(([fx, fw]) => {
    ctx.beginPath();
    ctx.ellipse(fx, CANVAS_H - 30, fw, 8, 0, 0, Math.PI * 2);
    ctx.fill();
  });

  // Scattered excuse scraps on the villain's floor side — flavor only.
  ctx.save();
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = "#c9c9c9";
  [[880, CANVAS_H - 55], [960, CANVAS_H - 40], [1040, CANVAS_H - 60]].forEach(([px, py]) => {
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(0.3);
    ctx.fillRect(-10, -6, 20, 12);
    ctx.restore();
  });
  ctx.restore();

  // Vignette so HUD corners stay readable.
  const vignette = ctx.createRadialGradient(
    CANVAS_W / 2,
    CANVAS_H / 2,
    CANVAS_H * 0.35,
    CANVAS_W / 2,
    CANVAS_H / 2,
    CANVAS_W * 0.7
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.35)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
}

/** Soft pulsing ring under Spark — reads as "this is your character." */
function drawSelectionRing(ctx: CanvasRenderingContext2D, state: BattleState, x: number, y: number) {
  if (state.villainDefeated) return;
  const pulse = 0.75 + Math.sin(state.dragonBobT * 2.4) * 0.15;
  const ready = Date.now() >= state.dragonWindupUntil;
  ctx.save();
  ctx.globalAlpha = (ready ? 0.5 : 0.32) * pulse;
  ctx.strokeStyle = "#6fc4ff";
  ctx.lineWidth = ready ? 4 : 3;
  ctx.beginPath();
  ctx.ellipse(x, y + 58, 74, 20, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawDragon(ctx: CanvasRenderingContext2D, state: BattleState, sprites: SpriteSet) {
  const winding = Date.now() < state.dragonWindupUntil;
  const bob = Math.sin(state.dragonBobT * (state.dragonCelebrating ? 6 : 2.2)) * (state.dragonCelebrating ? 18 : 8);
  const x = DRAGON_X - (winding ? 8 : 0);
  const y = DRAGON_Y + bob;

  drawSelectionRing(ctx, state, DRAGON_X, DRAGON_Y);

  const flashing = Date.now() < state.dragonHitFlashUntil;
  const sprite = state.dragonCelebrating
    ? sprites.dragon_victory
    : winding
      ? sprites.dragon_attack
      : flashing
        ? sprites.dragon_hit
        : sprites.dragon_idle;

  ctx.save();
  if (flashing) ctx.filter = "brightness(1.8) saturate(1.4)";
  if (winding) ctx.translate(x - DRAGON_X, 0);

  if (spriteReady(sprite)) {
    ctx.drawImage(sprite, x - 90, y - 90, 180, 180);
  } else {
    // placeholder dragon: body + head + wing + snout, blue-ish
    ctx.fillStyle = "#3aa0c9";
    ctx.beginPath();
    ctx.ellipse(x, y, winding ? 76 : 70, 46, 0, 0, Math.PI * 2);
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

const HIT_FLASH_DURATION_MS = 220;
const STAGGER_DISTANCE_PX = 22;
const DEFEAT_FADE_MS = 500;

function drawVillain(ctx: CanvasRenderingContext2D, state: BattleState, sprites: SpriteSet) {
  const defeatAge = state.villainDefeated ? Date.now() - state.villainDefeatedAt : -1;
  if (state.villainDefeated && defeatAge > DEFEAT_FADE_MS) return;

  const telegraphing = Date.now() < state.villainTelegraphUntil;
  const shuffle = telegraphing ? -6 : Math.sin(state.villainShuffleT * 1.4) * 10;
  const hitAgeMs = HIT_FLASH_DURATION_MS - (state.villainHitFlashUntil - Date.now());
  const flashing = hitAgeMs >= 0 && hitAgeMs < HIT_FLASH_DURATION_MS;
  // Knockback: snaps away from the dragon on impact, eases back to rest.
  const stagger = flashing
    ? STAGGER_DISTANCE_PX * (1 - hitAgeMs / HIT_FLASH_DURATION_MS)
    : 0;
  const x = VILLAIN_X + shuffle + stagger;
  const defeatFadeT = state.villainDefeated ? Math.min(1, defeatAge / DEFEAT_FADE_MS) : 0;
  const y = VILLAIN_Y + defeatFadeT * 40 - (telegraphing ? 6 : 0);
  const sprite = state.villainDefeated
    ? sprites.villain_defeat
    : flashing
      ? sprites.villain_hit
      : telegraphing
        ? sprites.villain_attack
        : sprites.villain_idle;

  ctx.save();
  ctx.globalAlpha = 1 - defeatFadeT;
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
    const popScale = age < 0.11 ? 1.3 - (age / 0.11) * 0.3 : 1;
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - age);
    ctx.fillStyle = f.color;
    ctx.font = "bold 20px sans-serif";
    ctx.textAlign = "center";
    ctx.translate(f.x, f.y - rise);
    ctx.scale(popScale, popScale);
    ctx.fillText(f.text, 0, 0);
    ctx.restore();
  }
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

  drawBackground(ctx, state, sprites);
  drawDragon(ctx, state, sprites);
  drawVillain(ctx, state, sprites);

  for (const fb of state.fireballs) drawFireball(ctx, fb.x, fb.y, sprites.fireball);
  for (const ex of state.excuses) drawExcuse(ctx, ex.x, ex.y, sprites.excuse_projectile);

  drawFloaters(ctx, state);
  drawBanner(ctx, state);

  ctx.restore();
}
