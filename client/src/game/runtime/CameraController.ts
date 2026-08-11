import type { Container } from "pixi.js";

/**
 * Camera lag: how quickly the world container eases toward its target
 * offset. Expressed as an ease-per-second constant rather than a fixed
 * millisecond delay so it scales correctly at any frame rate.
 *
 * `LAG_EASE_PER_SECOND = 4.5` was the pre-existing tuned value (~180ms to
 * settle). We were asked to pick the best-feeling value through real mobile
 * testing rather than hardcode an untested number — this environment has no
 * way to hands-on test camera feel on a physical device, so the honest move
 * is to keep the one value that had already been tuned and shipped through
 * Runs 1-3's mobile verification, rather than replace it with an unverified
 * guess. Treat this constant as the thing to re-tune first if a real device
 * pass says otherwise.
 */
const LAG_EASE_PER_SECOND = 4.5;

/** How strongly the camera biases toward the next portal ahead of the player. */
const LOOKAHEAD_STRENGTH = 26;

export class CameraController {
  private targetX = 0;
  private lookaheadX = 0;

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

  update(deltaSeconds: number) {
    const easing = Math.min(1, deltaSeconds * LAG_EASE_PER_SECOND);
    const target = this.targetX + this.lookaheadX;
    this.world.x += (target - this.world.x) * easing;
  }
}
