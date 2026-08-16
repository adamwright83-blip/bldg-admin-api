/**
 * Action-pad interaction grammar (§13/§14).
 *
 * Exactly two primary interaction zones exist in normal expedition play:
 * the movement stick on the left, and this pad on the right. No third
 * button. The pad resolves one pointer into two verbs:
 *
 *   TAP   (< HOLD_THRESHOLD_MS)  -> DODGE
 *   HOLD  (>= HOLD_THRESHOLD_MS) -> LINEHOOK AIM, fired on release
 *
 * Two rules matter more than the thresholds:
 *
 *   1. Crossing the hold threshold is decided by REAL elapsed time, not
 *      fictional time — the pad must feel identical whether or not the
 *      simulation happens to be dilated (§62).
 *   2. Releasing an aim with no valid target must return cleanly to
 *      movement. It must NOT fall back to a dodge (§16); a silent
 *      substitute verb is exactly the kind of thing that makes mobile
 *      controls feel untrustworthy.
 */

/** §14 initial tuning target. */
export const HOLD_THRESHOLD_MS = 200;

export type ActionPadPhase = "idle" | "pending" | "aiming";

export type ActionPadResolution =
  | { kind: "dodge" }
  /** Aim released with a lock — the caller fires the Line at `targetId`. */
  | { kind: "fire"; targetId: string }
  /** Aim released with nothing valid — return to movement, no verb. */
  | { kind: "cancel" }
  /** Pointer went down and up without a meaningful gesture. */
  | { kind: "none" };

export type ActionPadObserver = {
  /** Entered aim: caller dilates fictional time and shows the cone. */
  onEnterAim?: () => void;
  /** Left aim for any reason: caller restores time scale and hides cone. */
  onExitAim?: () => void;
};

export class ActionPad {
  private phase: ActionPadPhase = "idle";
  private pressedAtMs = 0;
  /** Aim heading in radians, updated as the thumb moves. */
  private aimRadians = 0;
  private lockedTargetId: string | null = null;

  constructor(private readonly observer: ActionPadObserver = {}) {}

  getPhase(): ActionPadPhase {
    return this.phase;
  }

  isAiming(): boolean {
    return this.phase === "aiming";
  }

  getAimRadians(): number {
    return this.aimRadians;
  }

  getLockedTargetId(): string | null {
    return this.lockedTargetId;
  }

  /** @param nowMs REAL wall-clock ms. Never fictional time. */
  pointerDown(nowMs: number, aimRadians: number) {
    this.phase = "pending";
    this.pressedAtMs = nowMs;
    this.aimRadians = aimRadians;
    this.lockedTargetId = null;
  }

  /**
   * Called every frame while the pointer is down, and on pointer move.
   * Promotes pending -> aiming once the real hold threshold is crossed.
   */
  pointerUpdate(nowMs: number, aimRadians: number) {
    if (this.phase === "idle") return;
    this.aimRadians = aimRadians;
    if (this.phase === "pending" && nowMs - this.pressedAtMs >= HOLD_THRESHOLD_MS) {
      this.phase = "aiming";
      this.observer.onEnterAim?.();
    }
  }

  /** The aim overlay reports its current lock so release can fire it. */
  setLockedTargetId(id: string | null) {
    if (this.phase !== "aiming") return;
    this.lockedTargetId = id;
  }

  pointerUp(nowMs: number): ActionPadResolution {
    const phase = this.phase;
    const heldMs = nowMs - this.pressedAtMs;
    const locked = this.lockedTargetId;

    if (phase === "aiming") this.observer.onExitAim?.();
    this.phase = "idle";
    this.lockedTargetId = null;

    if (phase === "pending") {
      return heldMs < HOLD_THRESHOLD_MS ? { kind: "dodge" } : { kind: "none" };
    }
    if (phase === "aiming") {
      // No accidental dodge substitution. Clean return to movement.
      return locked ? { kind: "fire", targetId: locked } : { kind: "cancel" };
    }
    return { kind: "none" };
  }

  /** Pointer cancel / loss of capture. Never resolves to a verb. */
  cancel() {
    if (this.phase === "aiming") this.observer.onExitAim?.();
    this.phase = "idle";
    this.lockedTargetId = null;
  }
}

/** §14 dodge tuning. */
export const DODGE = {
  /** Readable burst, not a teleport. */
  speed: 430,
  durationSeconds: 0.22,
  /** Invulnerable window — makes a well-timed evade a real skill. */
  iFrameSeconds: 0.18,
  cooldownSeconds: 0.42,
  /** §14 initial haptic target. */
  hapticMs: 15,
} as const;

export type DodgeState = {
  active: boolean;
  remaining: number;
  cooldown: number;
  dirX: number;
  dirY: number;
};

export function createDodgeState(): DodgeState {
  return { active: false, remaining: 0, cooldown: 0, dirX: 1, dirY: 0 };
}

/**
 * Starts a dodge using the current movement direction when the stick is
 * meaningfully deflected, otherwise the most recent facing (§14).
 */
export function beginDodge(
  state: DodgeState,
  input: { x: number; y: number },
  facingX: number,
  facingY: number
): boolean {
  if (state.active || state.cooldown > 0) return false;
  const inputLen = Math.hypot(input.x, input.y);
  if (inputLen > 0.2) {
    state.dirX = input.x / inputLen;
    state.dirY = input.y / inputLen;
  } else {
    const len = Math.hypot(facingX, facingY) || 1;
    state.dirX = facingX / len;
    state.dirY = facingY / len;
  }
  state.active = true;
  state.remaining = DODGE.durationSeconds;
  state.cooldown = DODGE.durationSeconds + DODGE.cooldownSeconds;
  return true;
}

export function stepDodge(state: DodgeState, dt: number) {
  if (state.cooldown > 0) state.cooldown = Math.max(0, state.cooldown - dt);
  if (!state.active) return;
  state.remaining -= dt;
  if (state.remaining <= 0) {
    state.active = false;
    state.remaining = 0;
  }
}

export function dodgeIsInvulnerable(state: DodgeState): boolean {
  return (
    state.active && state.remaining > DODGE.durationSeconds - DODGE.iFrameSeconds
  );
}
