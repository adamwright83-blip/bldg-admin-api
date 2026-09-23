/**
 * Colosseum stage geometry, expressed in the approved painting's own space.
 *
 * WHY A STAGE AND NOT VIEWPORT PERCENTAGES
 *
 * The first playable pass positioned doors, shield and boss in percentages of
 * whatever box the phone happened to give it, while the painting behind them
 * was `background-size: cover`. The two only agreed at one aspect ratio, so
 * the painted doors and the doors you could actually walk into drifted apart
 * (on a 412×915 phone the centre door had no hit zone at all). Everything here
 * is measured against `arena-background-hd.webp` itself, so art and gameplay
 * cannot disagree at any screen size.
 *
 * Units are isotropic: x runs 0..100 across the painting and y runs
 * 0..STAGE_HEIGHT down it, so a distance means the same number of pixels in
 * every direction and circles are circles.
 *
 * TRUTH BOUNDARY
 *
 * Nothing in this file reads or writes business state except
 * `projectColosseumArena`, which takes three read-only numbers from the
 * already-authoritative campaign projection and turns them into scenery. It
 * cannot advance the campaign, and no fictional state can feed back into it.
 */

export type StagePoint = { x: number; y: number };

/** The approved arena painting and its native pixel size. */
export const STAGE_ART = {
  src: "/assets/goldline/colosseum/arena-background-hd.webp",
  width: 941,
  height: 1672,
} as const;

export const STAGE_WIDTH = 100;
export const STAGE_HEIGHT = (STAGE_WIDTH * STAGE_ART.height) / STAGE_ART.width;

/** Convert a measurement taken as percentages of the painting into stage units. */
export function artPoint(xPercent: number, yPercent: number): StagePoint {
  return { x: xPercent, y: (yPercent / 100) * STAGE_HEIGHT };
}

/** Stage units → CSS percentages of the stage box, for `left`/`top`. */
export function stagePercent(point: StagePoint): { left: string; top: string } {
  return {
    left: `${point.x}%`,
    top: `${(point.y / STAGE_HEIGHT) * 100}%`,
  };
}

export function stageDistance(a: StagePoint, b: StagePoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * The painted floor is seen at an angle: its circular emblem measures about
 * 0.55 as tall as it is wide. Anything lying ON the floor (a Deadline mark, a
 * shadow) is an ellipse with this ratio, and so is its hit test.
 */
export const FLOOR_FORESHORTENING = 0.55;

/** Distance measured on the floor plane, undoing the painting's foreshortening. */
export function floorDistance(a: StagePoint, b: StagePoint): number {
  return Math.hypot(a.x - b.x, (a.y - b.y) / FLOOR_FORESHORTENING);
}

/* ------------------------------------------------------------------------ */
/* The arena                                                                 */
/* ------------------------------------------------------------------------ */

/**
 * Where the operator's avatar re-enters the arena, and where the Gold Line
 * yanks her back to after a RECOIL (WORLD_BIBLE §26: "She crashes into the
 * most recent ANCHOR").
 */
export const ARENA_ANCHOR = artPoint(50, 86);

/** The shield rests on the painted sun emblem at the centre of the floor. */
export const SHIELD_REST = artPoint(50, 60.5);

/** Clockhead's clock face, hovering over the central pediment. */
export const CLOCKHEAD_CENTER = artPoint(50, 25);
/** Radius of his outer bronze ring, in stage units. */
export const CLOCKHEAD_RADIUS = 25;

/**
 * Where the clock sinks to while he winds himself — low enough that the
 * mainspring can be reached from the top step of the floor.
 */
export const CLOCKHEAD_WINDING_CENTER = artPoint(50, 38.5);

/** Where the Gold Line enters the arena: the service entrance beneath it. */
export const SERVICE_ENTRANCE = artPoint(20, 96);

/**
 * Where seal `index` of `count` sits on his rim, in clock-degrees: spread
 * across the upper three-quarters, leaving the bottom (where he lowers
 * himself to wind) clear.
 */
export function sealAngle(index: number, count: number): number {
  if (count <= 1) return 0;
  return -120 + (240 / (count - 1)) * index;
}

/** The same seal in stage units, for effects aimed at it. */
export function sealPoint(index: number, count: number, center: StagePoint = CLOCKHEAD_CENTER): StagePoint {
  const radians = ((sealAngle(index, count) - 90) * Math.PI) / 180;
  const radius = CLOCKHEAD_RADIUS * 1.04;
  return { x: center.x + Math.cos(radians) * radius, y: center.y + Math.sin(radians) * radius };
}

/**
 * The walkable floor, traced from the painting: the curb and door steps
 * along the top, the curved retaining walls down each side, and the two
 * foreground pillars with their planters pinching the bottom.
 */
export const ARENA_FLOOR: readonly StagePoint[] = [
  artPoint(8, 46.6),
  artPoint(92, 46.6),
  artPoint(95.5, 52),
  artPoint(96, 59),
  artPoint(95, 66),
  artPoint(87, 69.5),
  artPoint(80, 73.5),
  artPoint(77.5, 82),
  artPoint(75.5, 91.5),
  artPoint(24.5, 91.5),
  artPoint(22.5, 82),
  artPoint(20, 73.5),
  artPoint(13, 69.5),
  artPoint(5, 66),
  artPoint(4, 59),
  artPoint(4.5, 52),
];

export function pointInPolygon(
  point: StagePoint,
  polygon: readonly StagePoint[]
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    const crosses =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

/**
 * Move from `from` toward `to` without leaving the floor. Tries the full move,
 * then each axis on its own so Trailblazer slides along walls instead of
 * sticking to them, then stays put.
 */
export function slideWithinFloor(
  from: StagePoint,
  to: StagePoint,
  polygon: readonly StagePoint[] = ARENA_FLOOR
): StagePoint {
  if (pointInPolygon(to, polygon)) return to;
  const alongX = { x: to.x, y: from.y };
  if (pointInPolygon(alongX, polygon)) return alongX;
  const alongY = { x: from.x, y: to.y };
  if (pointInPolygon(alongY, polygon)) return alongY;
  return from;
}

const FLOOR_TOP = ARENA_FLOOR[0]!.y;
const FLOOR_BOTTOM = artPoint(0, 91.5).y;

/**
 * Perspective scale for a figure standing at depth `y`. The painted doors are
 * roughly 9.5% of the painting tall; at the door line Trailblazer stands a
 * little under that, and she roughly doubles by the foreground.
 */
export function stageDepthScale(y: number): number {
  const progress = Math.max(0, Math.min(1, (y - FLOOR_TOP) / (FLOOR_BOTTOM - FLOOR_TOP)));
  return 0.52 + progress * 0.48;
}

/** Trailblazer's height at the very front of the floor, in stage units. */
export const TRAILBLAZER_FRONT_HEIGHT = STAGE_HEIGHT * 0.165;

export function trailblazerHeightAt(y: number): number {
  return TRAILBLAZER_FRONT_HEIGHT * stageDepthScale(y);
}

/**
 * Collisions are resolved against her torso, not her boots, so a bolt that
 * visibly passes through her chest is the bolt that hurts.
 */
export function torsoPoint(feet: StagePoint): StagePoint {
  return { x: feet.x, y: feet.y - trailblazerHeightAt(feet.y) * 0.46 };
}

/* ------------------------------------------------------------------------ */
/* The six ceremonial doors                                                  */
/* ------------------------------------------------------------------------ */

export type ColosseumDoorId = "I" | "II" | "III" | "IV" | "V" | "VI";

export type ColosseumDoor = {
  id: ColosseumDoorId;
  /** Where standing triggers the door, at the foot of its steps. */
  threshold: StagePoint;
  /** Trigger radius in stage units. */
  radius: number;
  /** Painted into the approved art (I–V), or the one everybody argues about. */
  painted: boolean;
  /**
   * The Brass Republic considers "I don't know" indecent, so every door
   * confidently answers a question it cannot possibly answer
   * (WORLD_BIBLE §13).
   */
  claim: string;
};

/**
 * Six fictional doors. Their number is architecture, never business truth:
 * nothing here is counted toward the real campaign, and five painted doors
 * next to five real targets is a coincidence the code refuses to lean on.
 *
 * Door VI has been debated for generations. There is nothing behind it.
 */
export const COLOSSEUM_DOORS: readonly ColosseumDoor[] = [
  {
    id: "I",
    threshold: artPoint(13.4, 47.6),
    radius: 5.2,
    painted: true,
    claim: "HE IS BEHIND DOOR IV. CERTAINLY.",
  },
  {
    id: "II",
    threshold: artPoint(31.6, 47.2),
    radius: 5.2,
    painted: true,
    claim: "DOOR I IS LYING. HE IS BEHIND DOOR VI.",
  },
  {
    id: "III",
    threshold: artPoint(50, 47.2),
    radius: 5.6,
    painted: true,
    claim: "NOBODY HAS EVER BEEN BEHIND THIS DOOR. PROVABLY.",
  },
  {
    id: "IV",
    threshold: artPoint(67.6, 47.2),
    radius: 5.2,
    painted: true,
    claim: "HE LEFT BEFORE YOU ARRIVED. OBVIOUSLY.",
  },
  {
    id: "V",
    threshold: artPoint(86, 47.6),
    radius: 5.2,
    painted: true,
    claim: "ASK AGAIN AFTER REVIEW.",
  },
  {
    id: "VI",
    threshold: artPoint(76.2, 79.5),
    radius: 4.6,
    painted: false,
    claim: "DEBATED FOR GENERATIONS. BOOKS WRITTEN. CAREERS DESTROYED.",
  },
];

export function doorAt(feet: StagePoint): ColosseumDoor | null {
  for (const door of COLOSSEUM_DOORS) {
    if (stageDistance(feet, door.threshold) <= door.radius) return door;
  }
  return null;
}

/* ------------------------------------------------------------------------ */
/* Camera                                                                    */
/* ------------------------------------------------------------------------ */

export type CameraFrame = {
  /** Pixels per stage unit. */
  scale: number;
  /** Translation of the stage's top-left corner, in pixels. */
  x: number;
  y: number;
};

/**
 * The phone is a camera into a larger stage (WORLD_BIBLE §3). Cover the
 * viewport on phones, but never zoom so far in on a wide screen that less
 * than ~72% of the arena's height is visible — and never zoom out until the
 * whole level fits either.
 */
export function stageScaleFor(viewportWidth: number, viewportHeight: number): number {
  const cover = Math.max(viewportWidth / STAGE_WIDTH, viewportHeight / STAGE_HEIGHT);
  const heightCap = viewportHeight / (STAGE_HEIGHT * 0.72);
  const widthCap = viewportWidth / (STAGE_WIDTH * 0.72);
  return Math.max(0.1, Math.min(cover, heightCap, widthCap));
}

export function cameraFrame(input: {
  viewportWidth: number;
  viewportHeight: number;
  focus: StagePoint;
  /** 1 = gameplay framing; >1 punches in for cinematic beats. */
  zoom?: number;
}): CameraFrame {
  const scale =
    stageScaleFor(input.viewportWidth, input.viewportHeight) * (input.zoom ?? 1);
  const stageW = STAGE_WIDTH * scale;
  const stageH = STAGE_HEIGHT * scale;

  const axis = (viewport: number, stage: number, focus: number) => {
    if (stage <= viewport) return (viewport - stage) / 2;
    const ideal = viewport / 2 - focus * scale;
    return Math.max(viewport - stage, Math.min(0, ideal));
  };

  return {
    scale,
    x: axis(input.viewportWidth, stageW, input.focus.x),
    y: axis(input.viewportHeight, stageH, input.focus.y),
  };
}

/**
 * Where the camera should look during play: horizontally with her, leaning
 * toward the middle; vertically at the midpoint between Clockhead's top rim
 * and her boots, so on any screen tall enough to hold both, both are in
 * frame. (On a phone the whole painting's height is visible anyway.)
 */
export function gameplayFocus(feet: StagePoint, clockCenterY: number = CLOCKHEAD_CENTER.y): StagePoint {
  const top = clockCenterY - CLOCKHEAD_RADIUS - 2;
  const bottom = feet.y + 4;
  return { x: feet.x * 0.78 + 50 * 0.22, y: (top + bottom) / 2 };
}

/** Frame-rate independent exponential approach, for camera easing. */
export function damp(current: number, target: number, lambda: number, dtSeconds: number): number {
  return target + (current - target) * Math.exp(-lambda * dtSeconds);
}

/* ------------------------------------------------------------------------ */
/* Read-only projection of the real campaign into scenery                    */
/* ------------------------------------------------------------------------ */

/**
 * The clocks throughout Clockhead's world (WORLD_BIBLE §14). Each real visit
 * the operator records stops one of them: the correct time arrived, because
 * somebody went and did the thing.
 */
export const CLOCKHEAD_DEFERRALS = [
  "NOT YET",
  "SOON",
  "PENDING",
  "AFTER REVIEW",
  "NEXT WEEK",
  "PROVISIONALLY",
  "WHEN CONDITIONS IMPROVE",
] as const;

export type ArenaMood = "untraced" | "stirring" | "rattled" | "cornered" | "located";

export type ColosseumArenaProjection = {
  /** Real recorded outcomes inside this campaign, clamped to its size. */
  tracedCount: number;
  totalCount: number;
  /** One seal per real target; one breaks per real recorded outcome. */
  seals: ReadonlyArray<{ legend: string; broken: boolean }>;
  /** 0..1, how solid Clockhead's projection has become. */
  signal: number;
  /** True ONLY when the authoritative campaign says it is complete. */
  located: boolean;
  mood: ArenaMood;
  /** What Clockhead says about it. Fiction; never names a real place. */
  taunt: string;
};

const TAUNTS: Record<ArenaMood, string> = {
  untraced: "Nothing happens before the correct time. It is not the correct time.",
  stirring: "One of my clocks has stopped. Whatever you did out there — don't.",
  rattled: "Stop doing things. It's indecent. Nobody does things.",
  cornered: "One more and you'll find me. It isn't time. It is NOT time.",
  located: "…Fine. It's time.",
};

/**
 * Turns the real campaign's own counts into the arena's scenery.
 *
 * Deliberately narrow input: three numbers that `projectColosseumMission`
 * already computed from recorded outcomes. `located` follows the
 * authoritative `isComplete` flag and nothing else — five broken seals on a
 * campaign that is somehow not complete still do not reveal him.
 */
export function projectColosseumArena(real: {
  visitedCount: number;
  totalCount: number;
  isComplete: boolean;
}): ColosseumArenaProjection {
  const totalCount = Math.max(0, Math.floor(real.totalCount));
  const tracedCount = Math.max(0, Math.min(totalCount, Math.floor(real.visitedCount)));
  const seals = Array.from({ length: totalCount }, (_, index) => ({
    legend: CLOCKHEAD_DEFERRALS[index % CLOCKHEAD_DEFERRALS.length]!,
    broken: index < tracedCount,
  }));
  const located = real.isComplete === true;
  const ratio = totalCount === 0 ? 0 : tracedCount / totalCount;
  const mood: ArenaMood = located
    ? "located"
    : tracedCount === 0
      ? "untraced"
      : ratio < 0.5
        ? "stirring"
        : totalCount - tracedCount <= 1
          ? "cornered"
          : "rattled";
  return {
    tracedCount,
    totalCount,
    seals,
    signal: located ? 1 : ratio,
    located,
    mood,
    taunt: TAUNTS[mood],
  };
}
