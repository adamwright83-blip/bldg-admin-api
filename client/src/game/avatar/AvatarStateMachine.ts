import type { AvatarState, CorridorAction } from "../state/GameState";

/**
 * Jump is authored as three phases rather than one squash-stretch tween:
 * a brief anticipation crouch (jump_start), a held airborne pose (jump_air),
 * and a landing beat (land) — proportions stay human throughout; only the
 * avatar's vertical offset and the ground-projected contact shadow move.
 */
const JUMP_START_MS = 140;
const JUMP_AIR_MS = 340;
const JUMP_LAND_MS = 140;
const JUMP_TOTAL_MS = JUMP_START_MS + JUMP_AIR_MS + JUMP_LAND_MS;

const ACTION_DURATIONS_MS: Record<CorridorAction, number> = {
  JUMP: JUMP_TOTAL_MS,
  CLIMB: 620,
  VAULT: 560,
  INTERACT: 0,
};

export class AvatarStateMachine {
  private current: AvatarState = "idle";
  private actionStartedAt = 0;
  private activeAction: CorridorAction | null = null;

  get state() {
    return this.current;
  }

  setLocomotion(magnitude: number) {
    if (
      ["jump_start", "jump_air", "land", "climb", "vault", "interact", "encounter_locked"].includes(
        this.current
      )
    ) {
      return;
    }
    this.current = magnitude < 0.08 ? "idle" : magnitude < 0.62 ? "walk" : "run";
  }

  beginAction(action: CorridorAction, now: number) {
    this.activeAction = action;
    this.actionStartedAt = now;
    this.current = action === "JUMP" ? "jump_start" : (action.toLowerCase() as AvatarState);
  }

  /** Advances jump's internal phase. No-op for single-phase actions. */
  tick(now: number) {
    if (this.activeAction !== "JUMP") return;
    const elapsed = now - this.actionStartedAt;
    if (elapsed < JUMP_START_MS) this.current = "jump_start";
    else if (elapsed < JUMP_START_MS + JUMP_AIR_MS) this.current = "jump_air";
    else this.current = "land";
  }

  actionDurationMs(action: CorridorAction): number {
    return ACTION_DURATIONS_MS[action];
  }

  /**
   * 0 at takeoff/landing, 1 at the apex — a smooth bell curve, not a linear
   * ramp, so the vertical motion and the contact-shadow separation both read
   * as an arc rather than a mechanical elevator.
   */
  jumpHeightFactor(now: number): number {
    if (this.activeAction !== "JUMP") return 0;
    const elapsed = Math.max(0, Math.min(JUMP_TOTAL_MS, now - this.actionStartedAt));
    return Math.sin((elapsed / JUMP_TOTAL_MS) * Math.PI);
  }

  lockEncounter() {
    this.activeAction = null;
    this.current = "encounter_locked";
  }

  release() {
    this.activeAction = null;
    this.current = "idle";
  }
}
