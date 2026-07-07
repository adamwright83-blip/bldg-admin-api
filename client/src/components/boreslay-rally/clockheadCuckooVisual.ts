import a0 from "./clockheadCuckooAsset0";
import a1 from "./clockheadCuckooAsset1";
import a2 from "./clockheadCuckooAsset2";
import a3 from "./clockheadCuckooAsset3";
import a4 from "./clockheadCuckooAsset4";
import a5 from "./clockheadCuckooAsset5";
import a6 from "./clockheadCuckooAsset6";
import a7 from "./clockheadCuckooAsset7";
import type { RallyState } from "./rallyEngine";
import { RALLY_CONFIG } from "./rallyConfig";
import { RallyRenderer } from "./rallyRenderer";

type R = {
  drawClockhead(context: CanvasRenderingContext2D, state: RallyState, alpha: number): void;
  applyCeremonyReaction(context: CanvasRenderingContext2D, state: RallyState, side: "spark" | "clockhead"): void;
};

const p = RallyRenderer.prototype as unknown as R;
const fallback = p.drawClockhead;
const image = new Image();
image.src = `data:image/webp;base64,${[a0,a1,a2,a3,a4,a5,a6,a7].join("")}`;
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

p.drawClockhead = function(context, state, alpha) {
  if (!image.complete || image.naturalWidth <= 0) {
    fallback.call(this, context, state, alpha);
    return;
  }
  const x = mix(state.clockhead.prevX, state.clockhead.x, alpha);
  const y = mix(state.clockhead.prevY, state.clockhead.y, alpha);
  const right = state.clockhead.facing.x >= 0;
  const frame = right ? 0 : 1;
  const cellWidth = image.naturalWidth / 2;
  const cellHeight = image.naturalHeight;
  context.save();
  context.translate(x, y);
  this.applyCeremonyReaction(context, state, "clockhead");
  if (!state.reducedMotion) {
    context.translate(0, Math.sin(state.timeMs * 0.008) * 2);
    if (state.clockhead.telegraph === "swat") {
      context.rotate(-RALLY_CONFIG.juice.swatLeanRadians);
    } else if (state.timeMs < state.clockhead.whiffUntil) {
      context.rotate(right ? -0.08 : 0.08);
    }
    if (state.timeMs < state.clockhead.staggerUntil) {
      context.scale(1.07, 0.93);
    } else if (state.clockhead.telegraph === "freeze") {
      const pulse = 1 + Math.sin(state.timeMs * 0.025) * 0.018;
      context.scale(pulse, pulse);
    } else if (state.status === "victory") {
      const bounce = 1 + Math.sin(state.timeMs * 0.018) * 0.025;
      context.scale(bounce, 2 - bounce);
    }
  }
  context.drawImage(image, frame * cellWidth, 0, cellWidth, cellHeight, -135, -156, 270, 320);
  context.restore();
};
