/**
 * Spirit Human rescue pressure machine — extracted from Level 4 choreography.
 *
 * Level 4 remains a mechanics donor. This module is the JOYSTICK mission
 * runtime copy of calm → descent → holding → unstable → impact → resetting,
 * plus rescue. System latency and driving never punish the player.
 */

export const PRESSURE_PHASES = [
  "calm",
  "descent",
  "holding",
  "unstable",
  "impact",
  "resetting",
  "rescue",
] as const;

export type PressurePhase = (typeof PRESSURE_PHASES)[number];

export const PRESSURE_IDLE_TO_THREAT_MS = 3_000;
export const PRESSURE_THREAT_DURATION_MS = 27_000;
export const PRESSURE_IMPACT_THRESHOLD_MS = PRESSURE_IDLE_TO_THREAT_MS + PRESSURE_THREAT_DURATION_MS;
export const PRESSURE_HOLD_BUDGET_MS = 7_000;
export const PRESSURE_UNSTABLE_BUDGET_MS = 3_000;
export const PRESSURE_CANCEL_SLIP_MS = 600;
export const PRESSURE_SESSION_GRACE_MS = 60_000;

export type PressureFrozenReason =
  | null
  | "drafting"
  | "sending"
  | "driving"
  | "backgrounded"
  | "reduced_motion_hold";

export type PressureState = {
  phase: PressurePhase;
  roundAnchorMs: number;
  holdStartedAtMs: number | null;
  descentProgress: number;
  draftVisible: boolean;
  frozenReason: PressureFrozenReason;
};

export type PressureEvent =
  | { type: "tick"; nowMs: number }
  | { type: "player_prepare"; nowMs: number }
  | { type: "draft_ready"; nowMs: number }
  | { type: "send_started"; nowMs: number }
  | { type: "send_succeeded"; nowMs: number }
  | { type: "send_failed"; nowMs: number }
  | { type: "cancel"; nowMs: number }
  | { type: "impact_ack"; nowMs: number }
  | { type: "driving_changed"; nowMs: number; driving: boolean }
  | { type: "background"; nowMs: number }
  | { type: "foreground"; nowMs: number; elapsedBackgroundMs: number };

export function initialPressureState(nowMs: number): PressureState {
  return {
    phase: "calm",
    roundAnchorMs: nowMs,
    holdStartedAtMs: null,
    descentProgress: 0,
    draftVisible: false,
    frozenReason: null,
  };
}

function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function descentFromAnchor(nowMs: number, roundAnchorMs: number): number {
  const elapsed = Math.max(0, nowMs - roundAnchorMs);
  if (elapsed <= PRESSURE_IDLE_TO_THREAT_MS) return 0;
  return clamp01((elapsed - PRESSURE_IDLE_TO_THREAT_MS) / PRESSURE_THREAT_DURATION_MS);
}

function freeze(state: PressureState, reason: PressureFrozenReason): PressureState {
  return {
    ...state,
    phase: state.phase === "calm" || state.phase === "descent" ? "holding" : state.phase,
    holdStartedAtMs: state.holdStartedAtMs ?? 0,
    frozenReason: reason,
  };
}

export function reducePressure(state: PressureState, event: PressureEvent): PressureState {
  if (state.phase === "rescue") return state;

  switch (event.type) {
    case "player_prepare":
      return {
        ...state,
        phase: "holding",
        holdStartedAtMs: event.nowMs,
        frozenReason: "drafting",
      };
    case "draft_ready":
      return {
        ...state,
        phase: "holding",
        holdStartedAtMs: event.nowMs,
        draftVisible: true,
        frozenReason: null,
      };
    case "send_started":
      return freeze({ ...state, holdStartedAtMs: event.nowMs }, "sending");
    case "send_succeeded":
      return {
        ...state,
        phase: "rescue",
        frozenReason: null,
        holdStartedAtMs: null,
        descentProgress: 0,
      };
    case "send_failed":
      return {
        ...state,
        phase: "resetting",
        frozenReason: null,
        holdStartedAtMs: null,
      };
    case "cancel":
      return {
        ...state,
        phase: "descent",
        roundAnchorMs: event.nowMs - PRESSURE_IDLE_TO_THREAT_MS - PRESSURE_CANCEL_SLIP_MS,
        holdStartedAtMs: null,
        frozenReason: null,
      };
    case "impact_ack":
      return {
        ...initialPressureState(event.nowMs),
        draftVisible: state.draftVisible,
      };
    case "driving_changed":
      return event.driving
        ? freeze(state, "driving")
        : { ...state, frozenReason: state.frozenReason === "driving" ? null : state.frozenReason };
    case "background":
      return freeze(state, "backgrounded");
    case "foreground":
      return {
        ...state,
        frozenReason: state.frozenReason === "backgrounded" ? null : state.frozenReason,
        roundAnchorMs: state.roundAnchorMs + Math.max(0, event.elapsedBackgroundMs),
        holdStartedAtMs:
          state.holdStartedAtMs == null
            ? null
            : state.holdStartedAtMs + Math.max(0, event.elapsedBackgroundMs),
      };
    case "tick":
      return tickPressure(state, event.nowMs);
    default:
      return state;
  }
}

function tickPressure(state: PressureState, nowMs: number): PressureState {
  if (state.frozenReason) {
    return { ...state, phase: state.phase === "calm" || state.phase === "descent" ? "holding" : state.phase };
  }
  if (state.phase === "resetting" || state.phase === "impact" || state.phase === "rescue") {
    return state;
  }
  if (state.phase === "holding") {
    if (!state.draftVisible || state.holdStartedAtMs == null) return state;
    const held = nowMs - state.holdStartedAtMs;
    if (held >= PRESSURE_HOLD_BUDGET_MS) {
      return { ...state, phase: "unstable" };
    }
    return state;
  }
  if (state.phase === "unstable") {
    if (state.holdStartedAtMs == null) return state;
    const held = nowMs - state.holdStartedAtMs;
    if (held >= PRESSURE_HOLD_BUDGET_MS + PRESSURE_UNSTABLE_BUDGET_MS) {
      return {
        ...state,
        phase: "descent",
        roundAnchorMs: nowMs - PRESSURE_IDLE_TO_THREAT_MS - Math.round(state.descentProgress * PRESSURE_THREAT_DURATION_MS),
        holdStartedAtMs: null,
      };
    }
    return state;
  }

  const progress = descentFromAnchor(nowMs, state.roundAnchorMs);
  if (nowMs - state.roundAnchorMs >= PRESSURE_IMPACT_THRESHOLD_MS) {
    return { ...state, phase: "impact", descentProgress: 1, holdStartedAtMs: null };
  }
  if (progress > 0) {
    return { ...state, phase: "descent", descentProgress: progress };
  }
  return { ...state, phase: "calm", descentProgress: 0 };
}

export function restorePressureAcrossRefresh(input: {
  storedAnchorMs: number | null;
  nowMs: number;
  missionCompleted: boolean;
}): PressureState {
  if (input.missionCompleted) {
    return { ...initialPressureState(input.nowMs), phase: "rescue" };
  }
  if (
    input.storedAnchorMs != null &&
    input.nowMs - input.storedAnchorMs >= 0 &&
    input.nowMs - input.storedAnchorMs < PRESSURE_SESSION_GRACE_MS
  ) {
    return tickPressure(
      { ...initialPressureState(input.storedAnchorMs), roundAnchorMs: input.storedAnchorMs },
      input.nowMs
    );
  }
  return initialPressureState(input.nowMs);
}

export function punishmentWouldAdvance(state: PressureState): boolean {
  if (state.phase === "rescue" || state.phase === "impact" || state.phase === "resetting") return false;
  return state.frozenReason == null;
}
