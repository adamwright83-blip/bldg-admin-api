/**
 * Claire's tether: the resident app's pen-pull mechanic, carried over without
 * the pen. Pull Claire's head down from the top-right corner past the line near
 * the bottom to message her; keep the same touch and slide right to call.
 * Nothing happens until release, and releasing above the line does nothing.
 */
export type TetherZone = "rest" | "pulling" | "message" | "call";

export type TetherGeometry = {
  /** Layer size in CSS pixels. */
  width: number;
  height: number;
  /** Centre of the head at rest. */
  restX: number;
  restY: number;
  /** Head diameter. */
  size: number;
};

export const TETHER_TUNING = {
  /** Distance from the bottom of the layer where the message line sits. */
  unlockBottomInset: 150,
  /** Pulling back this far above the line disarms it again. */
  disarmSlack: 28,
  /** Rightward travel after arming that switches to calling. */
  callTravel: 34,
  /** A quick rightward flick also switches to calling. */
  callFlickVelocity: 650,
  callFlickTravel: 14,
  /** Movement below this is a tap, not a pull. */
  tapSlop: 8,
  /** Horizontal give before the line is crossed (the pen's right-edge corridor). */
  corridorResistance: 0.35,
  /** How far below the line the head may travel. */
  floorInset: 64,
} as const;

export function unlockLineY(g: TetherGeometry) {
  return g.height - TETHER_TUNING.unlockBottomInset;
}

export function classifyTether(input: {
  geometry: TetherGeometry;
  previous: TetherZone;
  /** Pointer travel since press. */
  dx: number;
  dy: number;
  /** Head centre y for this pointer position. */
  headY: number;
  /** Pointer x when the message line was first crossed during this press. */
  armedAtX: number | null;
  pointerX: number;
  velocityX: number;
}): TetherZone {
  const { geometry, previous, headY, armedAtX, pointerX, velocityX } = input;
  const line = unlockLineY(geometry);
  const moved = Math.hypot(input.dx, input.dy) > TETHER_TUNING.tapSlop;
  const armed = previous === "message" || previous === "call";
  const below = armed ? headY >= line - TETHER_TUNING.disarmSlack : headY >= line;
  if (!below) return moved ? "pulling" : "rest";
  if (armedAtX === null) return "message";
  const travel = pointerX - armedAtX;
  const flick = velocityX > TETHER_TUNING.callFlickVelocity && travel > TETHER_TUNING.callFlickTravel;
  const offEdge = pointerX >= geometry.width - 4;
  if (travel >= TETHER_TUNING.callTravel || flick || offEdge) return "call";
  return "message";
}

/** Where the head is drawn for a pointer travel of (dx, dy). */
export function headPosition(g: TetherGeometry, zone: TetherZone, dx: number, dy: number) {
  const floor = g.height - TETHER_TUNING.floorInset;
  const y = Math.min(Math.max(g.restY + dy, g.restY), floor);
  const free = zone === "message" || zone === "call";
  const x = free
    ? Math.min(g.restX + dx, g.width + g.size * 0.15)
    : g.restX + dx * TETHER_TUNING.corridorResistance;
  return { x: Math.max(g.size / 2, x), y };
}

/** The tether from the corner anchor to the top of the head, with slack that tightens as it is pulled. */
export function tetherPath(g: TetherGeometry, head: { x: number; y: number }) {
  const anchorX = g.restX;
  const anchorY = g.restY - g.size / 2 - 6;
  const endY = head.y - g.size / 2;
  const pull = Math.min(1, Math.max(0, (endY - anchorY) / Math.max(1, unlockLineY(g) - anchorY)));
  const slack = 14 - pull * 12;
  const cx = (anchorX + head.x) / 2 + (anchorX - head.x) * 0.15;
  const cy = (anchorY + endY) / 2 + slack;
  return `M ${anchorX.toFixed(1)} ${anchorY.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${head.x.toFixed(1)} ${endY.toFixed(1)}`;
}

export function tetherHint(zone: TetherZone): string {
  if (zone === "message") return "Release to message Claire · slide right to call";
  if (zone === "call") return "Release to call Claire";
  return "Pull Claire down to message her";
}
