/**
 * Timing rules for the mirror placement: the base game's anti-soft-lock assist, and the hinted playtest's single cue.
 * Pure, so the three situations can be proven without a renderer:
 *   normal game      -> assist after ASSIST_SECONDS
 *   mirror-cold      -> neither assist nor cue, ever
 *   mirror-hinted    -> exactly one cue at hintAfter seconds (if never pressed), never the assist
 */
export const ASSIST_SECONDS = 40;

export interface SoftLockState { stuckFor: number; cueDone: boolean; assistFired: boolean }
export interface SoftLockConfig {
  /** false in both playtest modes */
  assistEnabled: boolean;
  /** seconds until the one cue; null = no cue */
  hintAfter: number | null;
}
export interface SoftLockInput { dragging: boolean; everPressed: boolean }
export interface SoftLockStep {
  state: SoftLockState;
  /** fire the single hint cue on this step */
  cue: boolean;
  /** the room should nudge the button toward the light on this step */
  assistActive: boolean;
  /** first step on which the assist became active (for logging) */
  assistFiredNow: boolean;
}

export const freshSoftLock = (): SoftLockState => ({ stuckFor: 0, cueDone: false, assistFired: false });

export function stepSoftLock(s: SoftLockState, dt: number, cfg: SoftLockConfig, input: SoftLockInput): SoftLockStep {
  const stuckFor = s.stuckFor + dt;
  const cue = cfg.hintAfter !== null && !s.cueDone && !input.everPressed && stuckFor > cfg.hintAfter;
  const assistActive = cfg.assistEnabled && stuckFor > ASSIST_SECONDS && !input.dragging;
  const assistFiredNow = assistActive && !s.assistFired;
  return { state: { stuckFor, cueDone: s.cueDone || cue, assistFired: s.assistFired || assistActive }, cue, assistActive, assistFiredNow };
}
