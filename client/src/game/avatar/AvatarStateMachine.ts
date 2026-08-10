import type { AvatarState, CorridorAction } from "../state/GameState";

export class AvatarStateMachine {
  private current: AvatarState = "idle";

  get state() {
    return this.current;
  }

  setLocomotion(magnitude: number) {
    if (
      ["jump", "climb", "vault", "interact", "encounter_locked"].includes(
        this.current
      )
    ) {
      return;
    }
    this.current = magnitude < 0.08 ? "idle" : magnitude < 0.62 ? "walk" : "run";
  }

  beginAction(action: CorridorAction) {
    this.current = action.toLowerCase() as AvatarState;
  }

  lockEncounter() {
    this.current = "encounter_locked";
  }

  release() {
    this.current = "idle";
  }
}
