/**
 * The two-clock rule (§62).
 *
 * There are two different clocks in Goldline and they must never be the
 * same object.
 *
 * FICTIONAL time may be slowed (Linehook aim runs at 0.2x), frozen
 * (hit-stop), or paused (backgrounded tab). It drives enemy state
 * machines, tether physics, animation, and nothing else.
 *
 * AUTHORITATIVE time is real wall-clock time. It drives order timestamps,
 * pickup windows, business deadlines, and every value that will ever be
 * written to the database or compared against a real due date. It is
 * `Date.now()` and it is never scaled, never paused, never rewound.
 *
 * The separation is enforced by shape: `ExpeditionClock` exposes fictional
 * seconds as a distinct accessor from authoritative milliseconds, and
 * `setTimeScale` is physically unable to reach the authoritative reading
 * because that reading never consults stored state. `expeditionClock.test.ts`
 * proves that dilating fiction to 0.2x, hit-stopping to 0, and pausing all
 * leave the authoritative clock advancing at exactly 1x.
 */

/** §14: aim mode slows fiction to approximately this factor. */
export const AIM_TIME_SCALE = 0.2;

/** Hit-stop is a full fictional freeze for a very short real duration. */
export const HIT_STOP_SCALE = 0;

export type NowMs = () => number;

export class ExpeditionClock {
  /** Accumulated FICTIONAL seconds. Scaled, pausable, freezable. */
  private fictionalSeconds = 0;
  private timeScale = 1;
  private paused = false;
  /** Real ms remaining on an active hit-stop, counted in real time. */
  private hitStopRemainingMs = 0;

  /**
   * Injectable only so tests can drive real time deterministically. It is
   * a reader of real time, never a store of it — nothing in this class can
   * scale, offset, or freeze what it returns.
   */
  constructor(private readonly nowMs: NowMs = () => Date.now()) {}

  /**
   * Real wall-clock milliseconds. THE ONLY value safe to compare against
   * order timestamps, pickup windows, or business deadlines.
   *
   * Deliberately delegates straight to the injected reader and consults no
   * field of this object, so no amount of dilation, hit-stop, or pausing
   * can influence it.
   */
  authoritativeNowMs(): number {
    return this.nowMs();
  }

  /** Accumulated fictional seconds. NEVER valid as business time. */
  fictionalElapsedSeconds(): number {
    return this.fictionalSeconds;
  }

  getTimeScale(): number {
    return this.paused || this.hitStopRemainingMs > 0 ? 0 : this.timeScale;
  }

  /** Linehook aim calls this with AIM_TIME_SCALE, and 1 on release. */
  setTimeScale(scale: number) {
    this.timeScale = Math.max(0, scale);
  }

  /** Backgrounding / navigation pause. Fiction only. */
  setPaused(paused: boolean) {
    this.paused = paused;
  }

  isPaused(): boolean {
    return this.paused;
  }

  /**
   * Freeze fiction for a short REAL duration. Measured in real ms so a
   * hit-stop lasts the same human moment regardless of current dilation —
   * a hit landed during aim should not stutter for five times as long.
   */
  hitStop(realMs: number) {
    this.hitStopRemainingMs = Math.max(this.hitStopRemainingMs, realMs);
  }

  isHitStopped(): boolean {
    return this.hitStopRemainingMs > 0;
  }

  /**
   * Advance by one frame's REAL delta. Returns the FICTIONAL delta the
   * simulation should integrate — 0 while paused or hit-stopped.
   */
  advance(realDeltaSeconds: number): number {
    const realMs = realDeltaSeconds * 1000;

    if (this.hitStopRemainingMs > 0) {
      this.hitStopRemainingMs = Math.max(0, this.hitStopRemainingMs - realMs);
      return 0;
    }
    if (this.paused) return 0;

    const fictionalDelta = realDeltaSeconds * this.timeScale;
    this.fictionalSeconds += fictionalDelta;
    return fictionalDelta;
  }
}
