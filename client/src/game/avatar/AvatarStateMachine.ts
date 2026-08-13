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

export type AvatarLocomotionPhase =
  | "steady"
  | "accelerating"
  | "decelerating"
  | "reversing";

export type AvatarChoreographyPhase =
  | "traversal"
  | "human_approach"
  | "encounter_ready"
  | "outcome_reaction"
  | "departure"
  | "return_to_control";

export class AvatarStateMachine {
  private current: AvatarState = "idle";
  private actionStartedAt = 0;
  private activeAction: CorridorAction | null = null;
  private previousMagnitude = 0;
  private locomotionPhaseValue: AvatarLocomotionPhase = "steady";
  private choreographyPhaseValue: AvatarChoreographyPhase = "traversal";
  private choreographyStartedAt = 0;

  get state() {
    return this.current;
  }

  get locomotionPhase() {
    return this.locomotionPhaseValue;
  }

  get choreographyPhase() {
    return this.choreographyPhaseValue;
  }

  setLocomotion(magnitude: number) {
    if (
      [
        "jump_start",
        "jump_air",
        "land",
        "climb",
        "vault",
        "interact",
        "encounter_locked",
      ].includes(this.current)
    ) {
      return;
    }
    const delta = magnitude - this.previousMagnitude;
    this.locomotionPhaseValue =
      delta > 0.18 ? "accelerating" : delta < -0.18 ? "decelerating" : "steady";
    this.previousMagnitude = magnitude;
    this.current =
      magnitude < 0.08 ? "idle" : magnitude < 0.62 ? "walk" : "run";
  }

  noteReversal() {
    this.locomotionPhaseValue = "reversing";
  }

  beginAction(action: CorridorAction, now: number) {
    this.activeAction = action;
    this.actionStartedAt = now;
    this.current =
      action === "JUMP" ? "jump_start" : (action.toLowerCase() as AvatarState);
  }

  /** Advances jump's internal phase. No-op for single-phase actions. */
  tick(now: number) {
    if (this.activeAction === "JUMP") {
      const elapsed = now - this.actionStartedAt;
      if (elapsed < JUMP_START_MS) this.current = "jump_start";
      else if (elapsed < JUMP_START_MS + JUMP_AIR_MS) this.current = "jump_air";
      else this.current = "land";
    }
    if (
      this.choreographyPhaseValue === "human_approach" &&
      now - this.choreographyStartedAt >= 320
    ) {
      this.choreographyPhaseValue = "encounter_ready";
    } else if (
      this.choreographyPhaseValue === "outcome_reaction" &&
      now - this.choreographyStartedAt >= 420
    ) {
      this.choreographyPhaseValue = "departure";
    } else if (
      this.choreographyPhaseValue === "return_to_control" &&
      now - this.choreographyStartedAt >= 180
    ) {
      this.choreographyPhaseValue = "traversal";
    }
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
    const elapsed = Math.max(
      0,
      Math.min(JUMP_TOTAL_MS, now - this.actionStartedAt)
    );
    return Math.sin((elapsed / JUMP_TOTAL_MS) * Math.PI);
  }

  lockEncounter() {
    this.activeAction = null;
    this.current = "encounter_locked";
    this.beginHumanApproach(performance.now());
  }

  beginHumanApproach(now: number) {
    this.choreographyPhaseValue = "human_approach";
    this.choreographyStartedAt = now;
  }

  acknowledgeAuthoritativeOutcome(now: number) {
    this.choreographyPhaseValue = "outcome_reaction";
    this.choreographyStartedAt = now;
  }

  returnToControl(now: number) {
    this.choreographyPhaseValue = "return_to_control";
    this.choreographyStartedAt = now;
  }

  release() {
    this.activeAction = null;
    this.current = "idle";
    this.returnToControl(performance.now());
  }
}
