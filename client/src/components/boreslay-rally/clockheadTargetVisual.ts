import type { RallyState } from "./rallyEngine";
import { RallyRenderer } from "./rallyRenderer";

type R = {
  drawButtTargets(context: CanvasRenderingContext2D, state: RallyState, alpha: number): void;
};

const p = RallyRenderer.prototype as unknown as R;
const draw = p.drawButtTargets;

p.drawButtTargets = function(context, state, alpha) {
  if (state.controlMode !== "duel" || state.scoringMode !== "buttHybrid") {
    draw.call(this, context, state, alpha);
    return;
  }
  const hiddenClockhead = {
    ...state.buttTargets.clockhead,
    x: -5000,
    y: -5000,
    prevX: -5000,
    prevY: -5000,
  };
  const visualState = {
    ...state,
    buttTargets: {
      ...state.buttTargets,
      clockhead: hiddenClockhead,
    },
  };
  draw.call(this, context, visualState, alpha);
};
