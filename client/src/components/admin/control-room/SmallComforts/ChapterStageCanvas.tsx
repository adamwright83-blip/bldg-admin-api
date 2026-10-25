import { useEffect, useRef } from "react";
import type { MouseActorId, SmallComfortsStoryState } from "./logic/chapters";

interface ChapterStageCanvasProps {
  story: SmallComfortsStoryState;
  slingDraft: number;
  onCanvasTap: (nx: number, ny: number) => void;
  onCanvasDrag: (nx: number, ny: number, isDown: boolean) => void;
}

/**
 * Live 2.5D Illustrated Cutout & Mouse Slapstick Stage
 *
 * Renders the actual characters, props, contraptions, paper-cutout humans,
 * three costumed mice (Pip with crutch, Biscuit with chef hat, Conductor with
 * navy cap & umbrella), and the 5 liberated singing glass shards directly
 * inside the warm tin-can interior—with zero menu boxes covering the art.
 */
export function ChapterStageCanvas({
  story,
  slingDraft,
  onCanvasTap,
  onCanvasDrag,
}: ChapterStageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const storyRef = useRef(story);
  storyRef.current = story;
  const slingRef = useRef(slingDraft);
  slingRef.current = slingDraft;
  const pointerDownRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let raf = 0;
    const t0 = performance.now();

    const render = (now: number) => {
      const t = (now - t0) / 1000;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      const W = Math.max(320, Math.round(rect.width));
      const H = Math.max(480, Math.round(rect.height));
      if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
        canvas.width = W * dpr;
        canvas.height = H * dpr;
      }
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.save();
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, W, H);
        drawStage(ctx, W, H, t, storyRef.current, slingRef.current);
        ctx.restore();
      }
      raf = window.requestAnimationFrame(render);
    };
    raf = window.requestAnimationFrame(render);
    return () => window.cancelAnimationFrame(raf);
  }, []);

  const normCoords = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      nx: (e.clientX - r.left) / Math.max(1, r.width),
      ny: (e.clientY - r.top) / Math.max(1, r.height),
    };
  };

  return (
    <canvas
      ref={canvasRef}
      className="scp-live-stage-canvas"
      data-testid={`sc-stage-canvas-ch${story.activeChapter}`}
      onPointerDown={e => {
        pointerDownRef.current = true;
        const { nx, ny } = normCoords(e);
        onCanvasTap(nx, ny);
        onCanvasDrag(nx, ny, true);
      }}
      onPointerMove={e => {
        if (!pointerDownRef.current) return;
        const { nx, ny } = normCoords(e);
        onCanvasDrag(nx, ny, true);
      }}
      onPointerUp={e => {
        pointerDownRef.current = false;
        const { nx, ny } = normCoords(e);
        onCanvasDrag(nx, ny, false);
      }}
      onPointerCancel={() => {
        pointerDownRef.current = false;
      }}
    />
  );
}

// ============================================================================
// Drawing Helpers — Paper-Cutout Humans, Mice, Props & Free Singing Glass Shards
// ============================================================================

const INK = "#241715";
const PAPER_SHADOW = "rgba(12, 8, 6, 0.52)";

function withPaperShadow(ctx: CanvasRenderingContext2D, fn: () => void) {
  ctx.save();
  ctx.shadowColor = PAPER_SHADOW;
  ctx.shadowBlur = 14;
  ctx.shadowOffsetX = 3;
  ctx.shadowOffsetY = 6;
  fn();
  ctx.restore();
}

function drawMouseCharacter(
  ctx: CanvasRenderingContext2D,
  kind: MouseActorId,
  x: number,
  y: number,
  scale: number,
  t: number,
  opts: {
    jumpY?: number;
    playingDead?: boolean;
    active?: boolean;
    flipX?: boolean;
    holdingCord?: boolean;
    wedgedInZipper?: boolean;
  } = {},
) {
  ctx.save();
  ctx.translate(x, y - (opts.jumpY ?? 0));
  if (opts.flipX) ctx.scale(-scale, scale);
  else ctx.scale(scale, scale);

  if (opts.playingDead) {
    ctx.rotate(-Math.PI / 2);
  } else if (opts.wedgedInZipper) {
    ctx.rotate(Math.sin(t * 14) * 0.18);
  } else {
    ctx.translate(0, Math.sin(t * 5 + (kind === "pip" ? 0 : kind === "biscuit" ? 2 : 4)) * 2.2);
  }

  // Active mouse golden halo ring on floor
  if (opts.active && !opts.wedgedInZipper) {
    ctx.save();
    ctx.strokeStyle = "rgba(255, 218, 108, 0.9)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(0, 26, 26, 9, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  const fur =
    kind === "conductor" ? "#8fa4be" : kind === "biscuit" ? "#e2be91" : "#b38c64";
  const bodyRx = kind === "biscuit" ? 21 : kind === "pip" ? 14 : 17;
  const bodyRy = kind === "biscuit" ? 22 : kind === "pip" ? 16 : 20;

  withPaperShadow(ctx, () => {
    // Pink tail
    ctx.strokeStyle = "#efa8b0";
    ctx.lineWidth = 4.5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-bodyRx * 0.7, 12);
    ctx.quadraticCurveTo(
      -bodyRx - 18,
      4 + Math.sin(t * 6) * 6,
      -bodyRx - 26,
      -8 + Math.cos(t * 6) * 5,
    );
    ctx.stroke();

    // Feet
    ctx.fillStyle = "#f2b8be";
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    for (const fx of [-8, 8]) {
      ctx.beginPath();
      ctx.ellipse(fx, 22, 7, 4.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // Torso
    ctx.fillStyle = fur;
    ctx.beginPath();
    ctx.ellipse(0, 4, bodyRx, bodyRy, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Warm cream belly patch
    ctx.fillStyle = "#f8ead6";
    ctx.beginPath();
    ctx.ellipse(3, 6, bodyRx * 0.62, bodyRy * 0.68, 0, 0, Math.PI * 2);
    ctx.fill();

    // Costume details on torso
    if (kind === "conductor") {
      // Navy railway coat + brass buttons
      ctx.fillStyle = "#1f3a5f";
      ctx.beginPath();
      ctx.arc(0, 3, bodyRx * 0.95, -0.9, Math.PI + 0.9);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#f2cc6b";
      for (const by of [-2, 5, 12]) {
        ctx.beginPath();
        ctx.arc(5, by, 2.3, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (kind === "biscuit") {
      // Red knitted scarf + baker apron
      ctx.fillStyle = "#d1473c";
      ctx.beginPath();
      ctx.roundRect(-bodyRx * 0.85, -12, bodyRx * 1.7, 8, 4);
      ctx.fill();
      ctx.stroke();
    } else if (kind === "pip") {
      // Olive cardigan + tiny wooden crutch under arm
      ctx.fillStyle = "#5f7a50";
      ctx.beginPath();
      ctx.roundRect(-bodyRx * 0.85, -4, bodyRx * 1.6, 16, 5);
      ctx.fill();
      ctx.stroke();
      // Wooden crutch
      ctx.strokeStyle = "#c88a4b";
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(13, -2);
      ctx.lineTo(19, 26);
      ctx.moveTo(9, -3);
      ctx.lineTo(17, -1);
      ctx.stroke();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.5;
    }

    // Head + Snout + Big Round Mouse Ears
    const hy = -bodyRy + 2;
    for (const ex of [-12, 8]) {
      ctx.fillStyle = fur;
      ctx.beginPath();
      ctx.arc(ex, hy - 12, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#f2a3b2";
      ctx.beginPath();
      ctx.arc(ex, hy - 12, 6, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = fur;
    ctx.beginPath();
    ctx.ellipse(2, hy, 15, 13, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Pointed snout & pink nose
    ctx.beginPath();
    ctx.moveTo(10, hy - 6);
    ctx.quadraticCurveTo(25, hy, 10, hy + 7);
    ctx.fill();
    ctx.fillStyle = "#e87a90";
    ctx.beginPath();
    ctx.arc(21, hy, 3.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Eyes & Whiskers
    ctx.fillStyle = INK;
    if (opts.playingDead) {
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(6, hy - 4);
      ctx.lineTo(11, hy + 1);
      ctx.moveTo(11, hy - 4);
      ctx.lineTo(6, hy + 1);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(9, hy - 2, 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(10, hy - 3, 1, 0, Math.PI * 2);
      ctx.fill();
    }

    // Hats
    if (kind === "conductor") {
      ctx.fillStyle = "#1f3a5f";
      ctx.beginPath();
      ctx.roundRect(-9, hy - 24, 20, 10, 3);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#f2cc6b";
      ctx.fillRect(-9, hy - 16, 20, 3);
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.ellipse(6, hy - 14, 12, 3, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (kind === "biscuit") {
      // Puffy white baker toque
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(-1, hy - 23, 11, 0, Math.PI * 2);
      ctx.arc(7, hy - 21, 9, 0, Math.PI * 2);
      ctx.roundRect(-9, hy - 19, 18, 8, 2);
      ctx.fill();
      ctx.stroke();
    } else if (kind === "pip") {
      // Little patched newsboy cap
      ctx.fillStyle = "#7a9e6b";
      ctx.beginPath();
      ctx.ellipse(0, hy - 14, 12, 6, -0.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // Conductor's red umbrella
    if (kind === "conductor" && !opts.holdingCord) {
      ctx.strokeStyle = "#c8323c";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(-14, 2);
      ctx.lineTo(-22, -20);
      ctx.stroke();
    }
  });

  ctx.restore();
}

function drawFreeSingingShard(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rotDeg: number,
  bounceAmt: number,
  index: number,
  lyric: string,
  t: number,
) {
  const isSinging = bounceAmt > 0.04;
  const bob = Math.sin(t * 7 + index * 1.3) * 3 + bounceAmt * 28;

  ctx.save();
  ctx.translate(x, y - bob);
  ctx.rotate(((rotDeg + Math.sin(t * 5 + index) * (isSinging ? 12 : 4)) * Math.PI) / 180);

  withPaperShadow(ctx, () => {
    // Crystalline prism shard polygon
    const grad = ctx.createLinearGradient(-22, -32, 24, 26);
    if (isSinging) {
      grad.addColorStop(0, "rgba(255, 248, 190, 0.96)");
      grad.addColorStop(0.5, "rgba(165, 238, 255, 0.92)");
      grad.addColorStop(1, "rgba(110, 195, 255, 0.88)");
    } else {
      grad.addColorStop(0, "rgba(220, 246, 255, 0.92)");
      grad.addColorStop(0.6, "rgba(142, 212, 248, 0.85)");
      grad.addColorStop(1, "rgba(88, 162, 214, 0.82)");
    }

    ctx.fillStyle = grad;
    ctx.strokeStyle = isSinging ? "#ffd23f" : "#ffffff";
    ctx.lineWidth = isSinging ? 3 : 2;

    ctx.beginPath();
    if (index % 2 === 0) {
      ctx.moveTo(0, -34);
      ctx.lineTo(24, 14);
      ctx.lineTo(-6, 26);
      ctx.lineTo(-22, 6);
    } else {
      ctx.moveTo(-8, -32);
      ctx.lineTo(22, -10);
      ctx.lineTo(14, 24);
      ctx.lineTo(-20, 16);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Specular glass highlight slash
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-6, -18);
    ctx.lineTo(8, 8);
    ctx.stroke();

    // Little prison-break stick arms thrown up in celebration!
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.2;
    const armWave = Math.sin(t * 14 + index) * 8;
    ctx.beginPath();
    ctx.moveTo(-14, -2);
    ctx.lineTo(-26, -16 + armWave);
    ctx.moveTo(14, -2);
    ctx.lineTo(26, -16 - armWave);
    ctx.stroke();

    // Googly cartoon eyes
    for (const ex of [-6, 6]) {
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(ex, -6, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.arc(ex + 1, -6, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Wide singing O-mouth or joyous grin
    ctx.fillStyle = "#b8293d";
    ctx.beginPath();
    if (isSinging) {
      ctx.ellipse(0, 6, 6.5, 8.5, 0, 0, Math.PI * 2);
    } else {
      ctx.arc(0, 4, 6, 0, Math.PI);
    }
    ctx.fill();
    ctx.stroke();
  });

  // Floating musical notes when singing or celebrating freedom
  const noteBob = Math.sin(t * 6 + index) * 5;
  ctx.fillStyle = isSinging ? "#ffe680" : "rgba(255, 245, 214, 0.92)";
  ctx.font = `800 ${isSinging ? 18 : 14}px ui-sans-serif, -apple-system, sans-serif`;
  ctx.textAlign = "center";
  ctx.strokeStyle = "rgba(18, 12, 10, 0.9)";
  ctx.lineWidth = 3.5;
  const noteGlyph = index % 3 === 0 ? "♫ ♪" : index % 3 === 1 ? "♬ ♫" : "♪ ♬";
  ctx.strokeText(noteGlyph, 0, -40 + noteBob);
  ctx.fillText(noteGlyph, 0, -40 + noteBob);
  void lyric;

  ctx.restore();
}

// ============================================================================
// Chapter-Specific Scene Renderers
// ============================================================================

function drawChapter1Scene(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  t: number,
  story: SmallComfortsStoryState,
  slingDraft: number,
) {
  const c = story.ch1;

  // 1. Top Tin Rim & Brass Zipper Track across the upper left
  const zipX0 = W * 0.14;
  const zipY0 = H * 0.22;
  const zipX1 = W * 0.56;
  const zipY1 = H * 0.48;

  withPaperShadow(ctx, () => {
    ctx.strokeStyle = "#5a422e";
    ctx.lineWidth = 12;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(zipX0, zipY0);
    ctx.lineTo(zipX1, zipY1);
    ctx.stroke();

    // 5 Brass Zipper Teeth
    for (let i = 0; i < 5; i++) {
      const k = (i + 0.5) / 5;
      const tx = zipX0 + (zipX1 - zipX0) * k;
      const ty = zipY0 + (zipY1 - zipY0) * k;
      const freed = i < c.zipperTeethFreed;
      ctx.fillStyle = freed ? "#7be28a" : "#e8b94c";
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(tx - 8, ty - (freed ? 12 : 6), 16, 12, 3);
      ctx.fill();
      ctx.stroke();
    }
  });

  // 2. High Shelf on the right with Pip's Matchbox Bed
  const shelfX = W * 0.76;
  const shelfY = H * 0.28;
  withPaperShadow(ctx, () => {
    // Wooden shelf bracket
    ctx.fillStyle = "#8a5632";
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(shelfX - 75, shelfY, 145, 16, 5);
    ctx.fill();
    ctx.stroke();

    // Matchbox Bed on top of shelf
    ctx.fillStyle = "#c98c4a";
    ctx.beginPath();
    ctx.roundRect(shelfX - 55, shelfY - 34, 106, 34, 6);
    ctx.fill();
    ctx.stroke();
    // Mattress & Pillow
    ctx.fillStyle = "#7fb0a6";
    ctx.beginPath();
    ctx.roundRect(shelfX - 48, shelfY - 42, 92, 14, 5);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#fff8eb";
    ctx.beginPath();
    ctx.roundRect(shelfX + 12, shelfY - 50, 26, 12, 4);
    ctx.fill();
    ctx.stroke();
  });

  // 3. The Giant Hard-Boiled Egg (on top of tin, or cracked in the bottle cap)
  const capX = W * 0.54;
  const capY = H * 0.64;

  // Brass Bottle Cap on the floor under the zipper end
  if (c.bottleCapPlaced || c.step !== "free_biscuit") {
    const bx = c.bottleCapPlaced ? capX : W * 0.34;
    const by = c.bottleCapPlaced ? capY : H * 0.72;
    withPaperShadow(ctx, () => {
      ctx.fillStyle = "#d8a93d";
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(bx, by, 38, 14, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#f4dca0";
      ctx.beginPath();
      ctx.ellipse(bx, by - 3, 30, 9, 0, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  if (!c.eggCrackedInCap) {
    // Whole Egg perched high on the tin lid
    withPaperShadow(ctx, () => {
      ctx.fillStyle = "#fff6e5";
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(zipX0 + 18, zipY0 - 28, 24, 32, -0.15, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
  } else if (!c.pipInShelfBed) {
    // Sunny-side yolk sitting inside the bottle cap!
    withPaperShadow(ctx, () => {
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(capX, capY - 5, 26, 9, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#ffae19";
      ctx.beginPath();
      ctx.arc(capX, capY - 9, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
  }

  // 4. Eggshell Staircase stacked against the shelf
  if (c.shellStairsStacked > 0) {
    for (let i = 0; i < c.shellStairsStacked; i++) {
      const sx = W * 0.66 + i * 20;
      const sy = H * 0.64 - i * 32;
      const crunched = c.pipCrutchCrunched && i === 2;
      withPaperShadow(ctx, () => {
        ctx.fillStyle = "#fff3dc";
        ctx.strokeStyle = INK;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(sx, sy, 18, Math.PI, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        if (crunched) {
          ctx.strokeStyle = "#c8323c";
          ctx.beginPath();
          ctx.moveTo(sx - 6, sy - 16);
          ctx.lineTo(sx + 4, sy - 2);
          ctx.stroke();
        }
      });
    }
  }

  // 5. Red Whoopee Cushion Launchpad
  if (c.step === "whoopee_launchpad" || c.whoopeePlaced || c.pipInShelfBed) {
    const wx = W * 0.56;
    const wy = H * 0.73;
    withPaperShadow(ctx, () => {
      ctx.fillStyle = "#d93b48";
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(wx, wy, c.pipInShelfBed ? 42 : 48, c.pipInShelfBed ? 11 : 18, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#b82834";
      ctx.fillRect(wx - 58, wy - 5, 16, 10);
    });
  }

  // 6. Shoelace Sling Arc when aiming Conductor
  if (c.step === "aim_shoelace_sling") {
    const anchorX = zipX0 + 55;
    const anchorY = zipY0 - 10;
    const pullX = anchorX - slingDraft * 68;
    const pullY = anchorY + slingDraft * 75;
    ctx.strokeStyle = "#f3c45a";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(anchorX, anchorY);
    ctx.lineTo(pullX, pullY);
    ctx.stroke();
    drawMouseCharacter(ctx, "conductor", pullX, pullY, 0.95, t, {
      active: true,
      holdingCord: true,
    });
  } else {
    drawMouseCharacter(ctx, "conductor", W * 0.24, H * 0.68, 1.0, t, {
      active: story.activeMouse === "conductor",
    });
  }

  // Biscuit (wedged in zipper at start, or on shelf ready to cannonball)
  if (c.step === "free_biscuit") {
    drawMouseCharacter(ctx, "biscuit", (zipX0 + zipX1) * 0.45, (zipY0 + zipY1) * 0.45, 0.95, t, {
      wedgedInZipper: true,
      active: true,
    });
  } else if (c.step === "whoopee_launchpad") {
    drawMouseCharacter(ctx, "biscuit", shelfX - 40, shelfY - 22, 1.0, t, {
      active: true,
    });
  } else {
    drawMouseCharacter(ctx, "biscuit", W * 0.4, H * 0.72, 1.0, t, {
      active: story.activeMouse === "biscuit",
    });
  }

  // Pip (in his top-shelf bed once launched, or on floor with his crutch)
  if (c.pipInShelfBed) {
    drawMouseCharacter(ctx, "pip", shelfX - 10, shelfY - 56, 0.92, t, {
      active: true,
    });
  } else {
    drawMouseCharacter(ctx, "pip", W * 0.72, H * 0.7, 0.95, t, {
      active: story.activeMouse === "pip",
    });
  }
}

function drawChapter2Scene(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  t: number,
  story: SmallComfortsStoryState,
) {
  const c = story.ch2;
  const cx = W * 0.5;
  const cy = H * 0.47;

  // 1. Sleeping Man's Paper-Cutout Head on Pillow
  withPaperShadow(ctx, () => {
    // Striped pillow
    ctx.fillStyle = "#f5ead4";
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.roundRect(cx - 148, cy - 115, 296, 195, 24);
    ctx.fill();
    ctx.stroke();

    // Cutout Face
    ctx.fillStyle = "#f2c6a0";
    ctx.beginPath();
    ctx.ellipse(cx, cy - 18, 108, 92, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Ears
    for (const sx of [-1, 1]) {
      ctx.fillStyle = "#eab890";
      ctx.beginPath();
      ctx.ellipse(cx + sx * 108, cy - 18, 16, 26, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // Eyes (asleep, twitching eyebrow, or wide awake when "...this is a sign" fires)
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3.5;
    for (const sx of [-1, 1]) {
      const ex = cx + sx * 38;
      const ey = cy - 46;
      if (c.wokeLineSpoken || c.step === "phone_pinball" || c.step === "complete") {
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(ex, ey, 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = INK;
        ctx.beginPath();
        ctx.arc(ex, ey + 2, 6, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(ex, ey, 14, 0.15 * Math.PI, 0.85 * Math.PI);
        ctx.stroke();
      }
      // Bushy eyebrows (twitch during warning/stir!)
      const browTilt =
        c.sleepPhase === "stirring"
          ? sx * -0.35
          : c.sleepPhase === "twitch_warning"
            ? Math.sin(t * 25) * 0.2
            : 0;
      ctx.save();
      ctx.translate(ex, ey - 18);
      ctx.rotate(browTilt);
      ctx.fillStyle = "#4a3020";
      ctx.beginPath();
      ctx.roundRect(-18, -5, 36, 9, 4);
      ctx.fill();
      ctx.restore();
    }

    // Big Cartoon Cutout Nose (flares red when stirring!)
    const noseFlare = c.sleepPhase === "stirring" ? 6 : c.sleepPhase === "twitch_warning" ? 3 : 0;
    ctx.fillStyle = c.sleepPhase === "stirring" ? "#f09080" : "#e5ae86";
    ctx.beginPath();
    ctx.ellipse(cx, cy - 22, 20 + noseFlare, 25, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  });

  // 2. Procedural 16x8 Beard Tuft Mask directly on his chin & cheeks
  const cols = 16;
  const rows = 8;
  const gridW = 204;
  const gridH = 98;
  const gx0 = cx - gridW / 2;
  const gy0 = cy + 6;
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      const hasHair = c.beardMask[r * cols + col];
      const tx = gx0 + (col + 0.5) * (gridW / cols);
      const ty = gy0 + (r + 0.5) * (gridH / rows);
      if (hasHair) {
        ctx.fillStyle = (r + col) % 2 === 0 ? "#5a3b26" : "#4a2f1d";
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(tx, ty, 8.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else {
        // Shaved skin path showing through!
        ctx.fillStyle = "rgba(255, 224, 194, 0.45)";
        ctx.beginPath();
        ctx.arc(tx, ty, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Speech bubble when he wakes up with the shaved beard path
  if (c.wokeLineSpoken || c.step === "phone_pinball" || c.step === "complete") {
    withPaperShadow(ctx, () => {
      ctx.fillStyle = "#fff8e6";
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(cx - 95, cy - 162, 190, 38, 18);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = INK;
      ctx.font = "italic 800 16px Georgia, serif";
      ctx.textAlign = "center";
      ctx.fillText("“…this is a sign.”", cx, cy - 137);
    });
  }

  // 3. The Three Mice in Position:
  // Pip on Nose Lookout
  drawMouseCharacter(ctx, "pip", cx, cy - 48, 0.78, t, {
    playingDead: c.micePlayingDead,
    active: story.activeMouse === "pip",
  });

  // Biscuit riding the electric clippers across the beard
  const lastStroke = c.strokes[c.strokes.length - 1] ?? { x: 0.3, y: 0.45 };
  const clipX = gx0 + lastStroke.x * gridW;
  const clipY = gy0 + lastStroke.y * gridH;
  withPaperShadow(ctx, () => {
    ctx.save();
    ctx.translate(clipX, clipY + 12);
    ctx.rotate(Math.sin(t * 35) * (c.trimmerActive ? 0.14 : 0.02));
    ctx.fillStyle = "#c8323c";
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(-22, -10, 44, 20, 6);
    ctx.fill();
    ctx.stroke();
    // Silver clipper teeth
    ctx.fillStyle = "#dfe5eb";
    ctx.fillRect(18, -9, 8, 18);
    ctx.restore();
  });
  drawMouseCharacter(ctx, "biscuit", clipX - 4, clipY - 12, 0.85, t, {
    playingDead: c.micePlayingDead,
    active: true,
  });

  // Conductor steering the clipper cord on the right
  ctx.strokeStyle = "#241715";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(clipX - 22, clipY + 12);
  ctx.quadraticCurveTo(W * 0.72, H * 0.72, W * 0.82, H * 0.66);
  ctx.stroke();
  drawMouseCharacter(ctx, "conductor", W * 0.82, H * 0.64, 0.92, t, {
    playingDead: c.micePlayingDead,
    holdingCord: true,
    flipX: true,
  });
}

function drawChapter3Scene(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  t: number,
  story: SmallComfortsStoryState,
) {
  const c = story.ch3;
  const manX = W * 0.72;
  const manY = H * 0.44;
  const isInhale = c.breathPhase === "inhale_open" || c.breathPhase === "peak_hold";

  // 1. Sleeping Man's Cutout Head in Profile with Opening/Closing Mouth
  withPaperShadow(ctx, () => {
    ctx.fillStyle = "#f2c6a0";
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.arc(manX, manY, 86, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Open mouth cavity scaled by mouthOpenness
    const mouthH = 12 + c.mouthOpenness * 38;
    ctx.fillStyle = c.chokingTriggered ? "#8e2f3f" : "#4a1c24";
    ctx.beginPath();
    ctx.ellipse(manX - 48, manY + 18, 28, mouthH, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Mustache (with powdered scrap crumbs if exhale blowback happened!)
    ctx.fillStyle = "#4a2f1d";
    ctx.beginPath();
    ctx.roundRect(manX - 82, manY - 12, 56, 16, 8);
    ctx.fill();
    ctx.stroke();
    if (c.mustacheScraps > 0) {
      ctx.fillStyle = "#ffe28a";
      for (let i = 0; i < 6; i++) {
        ctx.beginPath();
        ctx.arc(manX - 74 + i * 8, manY - 4 + (i % 2) * 5, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  });

  // Breath wind streamlines (pulling IN on inhale, blasting OUT on exhale)
  ctx.save();
  ctx.strokeStyle = isInhale ? "rgba(123, 226, 138, 0.85)" : "rgba(255, 138, 120, 0.8)";
  ctx.lineWidth = 3;
  ctx.setLineDash([8, 6]);
  for (let i = -1; i <= 1; i++) {
    const yOff = manY + 16 + i * 18;
    ctx.beginPath();
    if (isInhale) {
      const flow = (t * 80) % 40;
      ctx.moveTo(manX - 160 + flow, yOff);
      ctx.lineTo(manX - 82, yOff);
    } else {
      const flow = (t * 95) % 45;
      ctx.moveTo(manX - 80, yOff);
      ctx.lineTo(manX - 165 - flow, yOff + i * 8);
    }
    ctx.stroke();
  }
  ctx.restore();

  // 2. Teaspoon Catapult on Thread Spool Fulcrum
  const spoonX = W * 0.3;
  const spoonY = H * 0.64;
  withPaperShadow(ctx, () => {
    // Red thread spool fulcrum
    ctx.fillStyle = "#c8323c";
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(spoonX - 22, spoonY, 44, 32, 5);
    ctx.fill();
    ctx.stroke();

    // Silver Teaspoon lever
    ctx.save();
    ctx.translate(spoonX, spoonY);
    ctx.rotate(c.spoonLoaded ? -0.28 : 0.18);
    ctx.fillStyle = "#d9e2ec";
    ctx.beginPath();
    ctx.roundRect(-78, -6, 145, 10, 5);
    ctx.ellipse(-78, -2, 26, 14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Loaded scrap food in the spoon bowl
    if (c.spoonLoaded) {
      ctx.fillStyle = c.courseIndex === 2 ? "#ffbe2e" : c.courseIndex === 1 ? "#f29b38" : "#d49448";
      ctx.beginPath();
      ctx.arc(-78, -12, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  });

  // 3. The Three Mice working the spoon catapult
  drawMouseCharacter(ctx, "biscuit", spoonX - 58, spoonY - 26, 0.96, t, {
    active: true,
  });
  drawMouseCharacter(ctx, "conductor", spoonX + 48, spoonY - 16, 0.94, t, {
    active: story.activeMouse === "conductor",
  });
  drawMouseCharacter(ctx, "pip", spoonX + 4, spoonY + 26, 0.88, t, {
    active: story.activeMouse === "pip",
  });
}

function drawChapter4Scene(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  t: number,
  story: SmallComfortsStoryState,
) {
  const c = story.ch4;
  const winX = W * 0.5;
  const winY = H * 0.34;
  const winW = Math.min(310, W * 0.82);
  const winH = 195;

  // 1. Bedroom Window Sash + Starlit Courtyard Beyond
  withPaperShadow(ctx, () => {
    // Night sky courtyard outside the window
    const skyGrad = ctx.createLinearGradient(winX, winY - winH / 2, winX, winY + winH / 2);
    skyGrad.addColorStop(0, "#13223b");
    skyGrad.addColorStop(0.65, "#1f3558");
    skyGrad.addColorStop(1, "#2a4c3e");
    ctx.fillStyle = skyGrad;
    ctx.strokeStyle = "#d9b37c";
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.roundRect(winX - winW / 2, winY - winH / 2, winW, winH, 10);
    ctx.fill();
    ctx.stroke();

    // Courtyard hedge / grass at bottom of window view
    ctx.fillStyle = "#2d593e";
    ctx.beginPath();
    ctx.roundRect(winX - winW / 2 + 4, winY + winH / 2 - 46, winW - 8, 42, 6);
    ctx.fill();

    // If window is NOT shattered yet, draw intact glass panes
    if (!c.windowShattered) {
      ctx.fillStyle = "rgba(175, 222, 255, 0.28)";
      ctx.fillRect(winX - winW / 2 + 6, winY - winH / 2 + 6, winW - 12, winH - 12);
      ctx.strokeStyle = "#d9b37c";
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(winX, winY - winH / 2);
      ctx.lineTo(winX, winY + winH / 2);
      ctx.moveTo(winX - winW / 2, winY);
      ctx.lineTo(winX + winW / 2, winY);
      ctx.stroke();
    } else {
      // Jagged broken glass teeth left in the corners of the frame
      ctx.fillStyle = "rgba(195, 238, 255, 0.55)";
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      const xL = winX - winW / 2 + 4;
      const xR = winX + winW / 2 - 4;
      const yT = winY - winH / 2 + 4;
      ctx.beginPath();
      ctx.moveTo(xL, yT);
      ctx.lineTo(xL + 36, yT);
      ctx.lineTo(xL + 14, yT + 28);
      ctx.closePath();
      ctx.moveTo(xR, yT);
      ctx.lineTo(xR - 38, yT);
      ctx.lineTo(xR - 18, yT + 32);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  });

  // 2. Paper-Cutout Man & Cast-Armed Neighbour Performance
  const thrustOffset =
    c.beat === "6_one_armed_heimlich_sync"
      ? Math.sin(c.compressionCycle * Math.PI) * 14
      : 0;

  if (!c.manOutsideOnAss) {
    // Inside bedroom, clutching throat and backing toward window
    const manScale = c.beat === "1_fed_and_choking" ? 1.0 : 0.88;
    const my = winY + 25;
    withPaperShadow(ctx, () => {
      ctx.save();
      ctx.translate(winX, my);
      ctx.scale(manScale, manScale);
      // Pajama torso
      ctx.fillStyle = "#5b82a6";
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.roundRect(-42, -10, 84, 78, 16);
      ctx.fill();
      ctx.stroke();
      // Flushed choking cutout head
      ctx.fillStyle = "#e88b84";
      ctx.beginPath();
      ctx.arc(0, -38, 36, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // Bugged-out cartoon eyes
      for (const sx of [-12, 12]) {
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(sx, -44, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = INK;
        ctx.beginPath();
        ctx.arc(sx, -44, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      // Hands clutching throat
      ctx.fillStyle = "#f2c6a0";
      ctx.beginPath();
      ctx.arc(-14, -10, 11, 0, Math.PI * 2);
      ctx.arc(14, -10, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    });
  } else {
    // Outside on his ass in the courtyard grass + Cast-Armed Neighbour behind him!
    const pairX = winX;
    const pairY = winY + 22 - thrustOffset * 0.4;

    withPaperShadow(ctx, () => {
      // Neighbour standing behind him in yellow robe
      if (c.neighborPresent) {
        ctx.fillStyle = "#e0a93b";
        ctx.strokeStyle = INK;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.roundRect(pairX - 48, pairY - 62, 96, 86, 18);
        ctx.fill();
        ctx.stroke();

        // Neighbour head + curly hair bun
        ctx.fillStyle = "#7a3e28";
        ctx.beginPath();
        ctx.arc(pairX + 18, pairY - 98, 24, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#eab68c";
        ctx.beginPath();
        ctx.arc(pairX + 14, pairY - 82, 24, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Neighbour eyes & determined grimace
        ctx.fillStyle = INK;
        ctx.beginPath();
        ctx.arc(pairX + 8, pairY - 86, 3, 0, Math.PI * 2);
        ctx.arc(pairX + 20, pairY - 86, 3, 0, Math.PI * 2);
        ctx.fill();

        // HER BROKEN LEFT ARM IN A BIG WHITE PLASTER CAST + BLUE SLING (visibly sticking out!)
        ctx.save();
        ctx.translate(pairX - 48, pairY - 34);
        ctx.rotate(-0.25);
        // Blue sling strap
        ctx.strokeStyle = "#3a6ea5";
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(28, -28);
        ctx.lineTo(-28, 8);
        ctx.stroke();
        // Big white plaster cast
        ctx.fillStyle = "#f7f9fc";
        ctx.strokeStyle = INK;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.roundRect(-42, -12, 54, 24, 9);
        ctx.fill();
        ctx.stroke();
        // Bandage wrap lines on plaster cast
        ctx.strokeStyle = "#d0d7de";
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(-26, -12);
        ctx.lineTo(-20, 12);
        ctx.moveTo(-10, -12);
        ctx.lineTo(-4, 12);
        ctx.stroke();
        ctx.restore();
      }

      // The Man sitting flat on his ass in front of her, legs splayed out!
      // Splayed pajama legs & bare feet sticking up on left and right
      for (const sx of [-1, 1]) {
        ctx.fillStyle = "#5b82a6";
        ctx.strokeStyle = INK;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(pairX + sx * 52, pairY + 38, 28, 13, sx * 0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        // Bare foot sticking up
        ctx.fillStyle = "#f2c6a0";
        ctx.beginPath();
        ctx.ellipse(pairX + sx * 74, pairY + 28, 11, 18, sx * 0.25, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      // Man's torso & head
      ctx.fillStyle = "#5b82a6";
      ctx.beginPath();
      ctx.roundRect(pairX - 36, pairY - 18, 72, 62, 16);
      ctx.fill();
      ctx.stroke();

      // Neighbour's ONE GOOD RIGHT ARM wrapping around his belly to do the one-armed Heimlich!
      if (c.neighborPresent) {
        ctx.fillStyle = "#e0a93b";
        ctx.beginPath();
        ctx.roundRect(pairX - 28, pairY + 4 - thrustOffset * 0.3, 68, 18, 9);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#eab68c";
        ctx.beginPath();
        ctx.arc(pairX - 18, pairY + 13 - thrustOffset * 0.3, 11, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      // Man's face (purple/flushed while choking, relieved once food expelled!)
      ctx.fillStyle = c.foodExpelled ? "#f2c6a0" : "#d97a8c";
      ctx.beginPath();
      ctx.arc(pairX - 6, pairY - 42, 28, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // Eyes
      for (const ex of [-15, -1]) {
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(pairX + ex, pairY - 46, 7.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = INK;
        ctx.beginPath();
        ctx.arc(pairX + ex, pairY - 46, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      // Mouth
      ctx.fillStyle = "#4a1c24";
      ctx.beginPath();
      ctx.arc(pairX - 8, pairY - 30, c.foodExpelled ? 6 : 10, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  // 3. Curtain-Cord Jump-Rope & The Three Mice Jumping in Sync on the Sill!
  const sillY = winY + winH / 2 + 24;
  const bounceMax = Math.max(0, ...c.shards.map(s => s.bounceAmt));
  const cordSag = bounceMax * 26 + thrustOffset * 0.8;

  // Gold curtain cord stretched across the sill
  ctx.strokeStyle = "#f3c45a";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(winX - winW / 2 + 10, sillY);
  ctx.quadraticCurveTo(winX, sillY + 18 + cordSag, winX + winW / 2 - 10, sillY);
  ctx.stroke();

  // One-Armed Heimlich Visual Rhythm Ring right on the curtain cord (no text box needed!)
  if (c.beat === "6_one_armed_heimlich_sync") {
    const inSweetSpot = c.compressionCycle >= 0.3 && c.compressionCycle <= 0.78;
    const pulseR = 18 + (1 - c.compressionCycle) * 36;
    ctx.save();
    ctx.strokeStyle = inSweetSpot ? "#7be28a" : "rgba(255, 214, 108, 0.75)";
    ctx.lineWidth = inSweetSpot ? 5 : 3;
    ctx.beginPath();
    ctx.arc(winX, sillY - 12, 28, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(winX, sillY - 12, pulseR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // The Three Mice on the Curtain Cord (Pip, Biscuit, Conductor)
  const mousePositions: readonly { id: MouseActorId; x: number }[] = [
    { id: "pip", x: winX - 78 },
    { id: "biscuit", x: winX },
    { id: "conductor", x: winX + 78 },
  ];
  for (const mp of mousePositions) {
    const synced = c.syncedMice.includes(mp.id);
    const jumpArc = bounceMax * 48 + (synced ? Math.abs(Math.sin(t * 7)) * 18 : 0);
    drawMouseCharacter(ctx, mp.id, mp.x, sillY - 6, 0.92, t, {
      jumpY: jumpArc,
      active: synced || story.activeMouse === mp.id,
    });
  }

  // If the food was expelled, draw the Guilt Egg arcing into Conductor's hovering cap!
  if (c.foodExpelled) {
    withPaperShadow(ctx, () => {
      ctx.fillStyle = "#fff6e5";
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(winX + 78, sillY - 68, 14, 18, 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
  }

  // 4. THE FIVE FREE GLASS SHARDS SINGING A CAPPELLA ACROSS THE SILL & FOREGROUND!
  if (c.windowShattered) {
    const shardYBase = H * 0.71;
    c.shards.forEach((shard, idx) => {
      const sx = winX + shard.x * (Math.min(W, 420) * 0.48);
      const sy = shardYBase + (idx % 2) * 24;
      drawFreeSingingShard(
        ctx,
        sx,
        sy,
        shard.rotationDeg,
        shard.bounceAmt,
        idx,
        shard.lyric,
        t,
      );
    });
  }
}

function drawStage(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  t: number,
  story: SmallComfortsStoryState,
  slingDraft: number,
) {
  if (story.activeChapter === 1) {
    drawChapter1Scene(ctx, W, H, t, story, slingDraft);
  } else if (story.activeChapter === 2) {
    drawChapter2Scene(ctx, W, H, t, story);
  } else if (story.activeChapter === 3) {
    drawChapter3Scene(ctx, W, H, t, story);
  } else {
    drawChapter4Scene(ctx, W, H, t, story);
  }
}
