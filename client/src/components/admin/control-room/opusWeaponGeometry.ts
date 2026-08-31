/**
 * Baked composition constants for the OPUS weapon overlays, in the 800x1200
 * art space shared by every tower asset.
 *
 * The club and the ball are separate PNGs composited against
 * `opus-la-tower-plate-v4.png`, which is the original tower art with BOTH the
 * baked-in club and the baked-in ball surgically removed. Tower geometry,
 * lighting, perspective, silhouette, signage, podium, tee and base are
 * untouched, so the facade-scar bounds measured against the original art
 * remain valid.
 *
 * These numbers are what the overlays were baked from. They are asserted in
 * tests so the spatial contract cannot silently drift: if the art is ever
 * re-composited, these must be updated with it.
 *
 *   hinge  attaches near the top of the TALLER tower
 *   shaft  runs down and to the right from the hinge
 *   head   rests to the LEFT of the ball, so the club arrives from the left
 *   ball   sits on the shorter tower's tee, and is struck left -> right
 *          toward Century Park East, which renders to the RIGHT in the arena
 */
export const OPUS_ART_SPACE = { width: 800, height: 1200 } as const;

/** Pivot of the articulated mount — also the CSS transform-origin for the swing. */
export const OPUS_DRIVER_HINGE = { x: 320, y: 270 } as const;

/** Centre of the club head at rest. */
export const OPUS_DRIVER_HEAD = { x: 370, y: 712 } as const;

/** Centre of the golf ball at rest, on the tee. */
export const OPUS_BALL_CENTRE = { x: 548, y: 754 } as const;

/** Century Park East renders on this side of OPUS, so a strike travels this way. */
export const OPUS_STRIKE_DIRECTION = "left_to_right" as const;

/** The three assets that make up the OPUS piece. Exactly one club, one ball. */
export const OPUS_PIECE_ASSETS = {
  /** Tower with the baked-in club AND ball removed. */
  plate: "opus-la-tower-plate-v4.png",
  /** The only club. */
  driver: "opus-la-driver-overlay-v6.png",
  /** The only ball — at rest on the tee, airborne while firing. */
  ball: "opus-la-ball-v1.png",
} as const;

/** transform-origin for the swing, as CSS percentages of the art space. */
export function hingeOriginPercent(): { x: number; y: number } {
  return {
    x: (OPUS_DRIVER_HINGE.x / OPUS_ART_SPACE.width) * 100,
    y: (OPUS_DRIVER_HINGE.y / OPUS_ART_SPACE.height) * 100,
  };
}
