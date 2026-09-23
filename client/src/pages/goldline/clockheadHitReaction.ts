/**
 * How Clockhead takes a hit, as pure functions of time: where the Lineblade
 * touches his face, how the whole construct rattles, and how it flashes red.
 *
 * Presentation only. The finale's loop feeds these straight to the DOM as
 * compositor transforms and opacity; nothing here changes the fight.
 */
import { CLOCKHEAD_RADIUS, type StagePoint } from "./colosseumStage";

/** The marble dial, inside the bronze bezel (71.6 of the construct's 100-unit ring). */
export const CLOCKHEAD_DIAL_RADIUS = CLOCKHEAD_RADIUS * 0.716;

/**
 * The Lineblade's reach past her own body: sparks fly off his face, never
 * off her, even when she is standing right under him.
 */
export const BLADE_REACH = 6;

export const HIT_REACTION = {
  /** Camera-style trauma added to the construct itself; squared, then decays. */
  trauma: { hit: 0.62, finisher: 1 },
  traumaDecayPerSecond: 2.6,
  /**
   * One red flush per hit: up hot, held, then eased out. It deliberately
   * never strobes — he fills a large share of a phone screen, and a large
   * area blinking red faster than ~3 times a second is a photosensitivity
   * risk (WCAG 2.3.1). A full combo still reads as him flashing red.
   */
  flash: {
    hit: { holdMs: 140, totalMs: 420, strength: 0.8 },
    finisher: { holdMs: 230, totalMs: 640, strength: 0.95 },
  },
  /** The first frames of a hit are white-hot before they turn red. */
  whitePopMs: 60,
} as const;

/**
 * Where the Lineblade touches his face: on the dial, between the mainspring
 * and her — at least a blade's length from her — stepping to either side
 * through a combo so each hit lands on new brass instead of the same pixel.
 */
export function contactPoint(faceCenter: StagePoint, torso: StagePoint, combo: number): StagePoint {
  const dx = torso.x - faceCenter.x;
  const dy = torso.y - faceCenter.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const reach = Math.max(0, Math.min(length - BLADE_REACH, CLOCKHEAD_DIAL_RADIUS * 0.55));
  const side = [0, -1, 1][Math.abs(combo) % 3]! * CLOCKHEAD_DIAL_RADIUS * 0.24;
  return {
    x: faceCenter.x + ux * reach - uy * side,
    y: faceCenter.y + uy * reach + ux * side,
  };
}

/**
 * The damage flush: 0..1 for the red tint and for the white pop that
 * precedes it, `elapsedMs` after the hit landed.
 */
export function hitFlashAt(elapsedMs: number, finisher: boolean): { red: number; white: number } {
  const curve = finisher ? HIT_REACTION.flash.finisher : HIT_REACTION.flash.hit;
  if (elapsedMs < 0 || elapsedMs >= curve.totalMs) return { red: 0, white: 0 };
  const white =
    elapsedMs < HIT_REACTION.whitePopMs ? 0.85 * (1 - elapsedMs / HIT_REACTION.whitePopMs) : 0;
  const held =
    elapsedMs <= curve.holdMs
      ? 1
      : Math.pow(1 - (elapsedMs - curve.holdMs) / (curve.totalMs - curve.holdMs), 1.6);
  // Rises through the white pop, so the red reads as coming up through him.
  const rise = Math.min(1, 0.35 + elapsedMs / HIT_REACTION.whitePopMs);
  return { red: held * rise * curve.strength, white };
}

/**
 * The construct's own shake, in percent of its size and degrees. Trauma is
 * squared (small hits stay small) and the motion is a few incommensurate
 * sines, so it rattles rather than wobbles.
 */
export function rattleAt(
  trauma: number,
  timeMs: number
): { x: number; y: number; rotate: number; scale: number } {
  if (trauma <= 0.001) return { x: 0, y: 0, rotate: 0, scale: 1 };
  const power = trauma * trauma;
  const t = (timeMs / 1000) * Math.PI * 2;
  return {
    x: 2.6 * power * Math.sin(t * 14.6) * Math.cos(t * 3.7),
    y: 1.8 * power * Math.sin(t * 12.3 + 1.1),
    rotate: 3.2 * power * Math.sin(t * 10.2 + 0.4),
    scale: 1 + 0.045 * power,
  };
}

/** Trauma after `dtMs` of decay. */
export function decayTrauma(trauma: number, dtMs: number): number {
  return Math.max(0, trauma - (dtMs / 1000) * HIT_REACTION.traumaDecayPerSecond);
}
