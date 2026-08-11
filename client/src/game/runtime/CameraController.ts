import type { Container } from "pixi.js";

/**
 * Camera lag: how quickly the world container eases toward its target
 * offset, expressed as an ease-per-second constant (scales correctly at any
 * frame rate, unlike a fixed per-frame lerp factor).
 *
 * Tuned to settle in ~180ms — inside the requested 120-220ms range, chosen
 * at the middle rather than either edge: fast enough that the camera never
 * visibly fights the joystick (a risk toward 220ms), slow enough to still
 * read as weight rather than a rigid follow-cam (a risk toward 120ms).
 * `movementFeel.test.ts` asserts the settle time stays in-range structurally
 * so a future retune can't silently drift outside it. There is no way to
 * hands-on validate "feel" on a physical device in this environment; if a
 * real mobile pass says otherwise, this is the single constant to change.
 */
const LAG_EASE_PER_SECOND = 1000 / 180;

/** How strongly the camera biases toward the next portal ahead of the player. */
const LOOKAHEAD_STRENGTH = 26;

/** Camera impulse: a brief, small kick on takeoff/landing — never a shake
 * loop, never strong enough to read as motion sickness. Decays to zero
 * within ~220ms. */
const IMPULSE_DECAY_PER_SECOND = 1000 / 90;

export class CameraController {
  private targetX = 0;
  private lookaheadX = 0;
  private impulseX = 0;

  constructor(private readonly world: Container) {}

  focusMainGate() {
    this.targetX = 0;
  }

  focusRecoveryPath() {
    this.targetX = -42;
  }

  /**
   * Biases the camera toward the next meaningful portal ahead, scaled by how
   * close it is. `direction` is -1..1 (left/right of center); `proximity` is
   * 0..1, 1 meaning the portal is imminent.
   */
  setLookahead(direction: number, proximity: number) {
    this.lookaheadX = -direction * LOOKAHEAD_STRENGTH * Math.max(0, Math.min(1, proximity));
  }

  clearLookahead() {
    this.lookaheadX = 0;
  }

  /**
   * A small, one-shot acknowledgement — jump takeoff/landing, a mutation
   * branch activating. Never a repeating shake; decays to zero on its own.
   */
  impulse(strength: number) {
    this.impulseX += strength;
  }

  update(deltaSeconds: number) {
    const easing = Math.min(1, deltaSeconds * LAG_EASE_PER_SECOND);
    const target = this.targetX + this.lookaheadX;
    this.world.x += (target - this.world.x) * easing;

    if (this.impulseX !== 0) {
      this.world.x += this.impulseX;
      const decay = Math.min(1, deltaSeconds * IMPULSE_DECAY_PER_SECOND);
      this.impulseX -= this.impulseX * decay;
      if (Math.abs(this.impulseX) < 0.05) this.impulseX = 0;
    }
  }
}

/** Exposed for tests only — the settle-time assertion needs the real rate. */
export const CAMERA_LAG_EASE_PER_SECOND = LAG_EASE_PER_SECOND;
