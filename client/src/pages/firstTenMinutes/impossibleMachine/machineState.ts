import type { DraftStatus } from "@shared/firstTenMinutesChapter";
import {
  evaluateMachineRoute,
  nextJunctionPosition,
  toggleDialState,
  toggleRotorOrientation,
} from "./machineGraph";
import type {
  CorrespondenceChoice,
  JunctionPosition,
  MachineDialState,
  MachineEngineState,
  RotorOrientation,
} from "./machineTypes";

export const ROOK_LINES = {
  discovery: "I am not stuck. I am simply inspecting the glass from the inside.",
  experimentConnected: "That clicked. Try the brass crank.",
  experimentBroken: "Mind the gap. Even a miniature carriage needs rails.",
  outboundSolved: "There it is. Now bring the little thing back.",
  machineShifts: "Oh, clever. It locked the top gate behind us.",
  centerExamined: "Someone left an old note wedged in the middle coupler.",
  choicePrepare: "Short enough to answer.",
  choiceLater: "Fair enough. The lower turntable still turns.",
  choiceDecline: "Struck from the timetable. Let's take the low road.",
  centerRestored: "Well, look at that. Brass right across the middle.",
  lowerAligned: "The lower line holds. Wind it home.",
  domeUnlocked: "Finally. Air. And a deeply unsupervised contraption.",
  stealing: "It'll fit in the satchel if I fold the chimney.",
} as const;

/**
 * Initial deterministic state (State A — Discovery):
 * - Rook is trapped under the dome on the left.
 * - Key is at the station on the right.
 * - Time dial starts at THEN.
 * - Upper railway has visible disconnected sections (west="center", upperRotor="misaligned", east="lower").
 */
export function createInitialMachineState(): MachineEngineState {
  return {
    phase: "discovery",
    dial: "THEN",
    westJunction: "center",
    eastJunction: "lower",
    upperRotor: "misaligned",
    lowerRotor: "misaligned",
    keyRetrieved: false,
    centerExamined: false,
    correspondenceChoice: null,
    centerBridgeRestored: false,
    returnRouteUsed: null,
    domeUnlocked: false,
    rookRescued: false,
    rookStealing: false,
    adventureCompleted: false,
    lastAttempt: null,
    rookLine: ROOK_LINES.discovery,
  };
}

export type MachineAction =
  | { type: "ROTATE_WEST_JUNCTION"; to?: JunctionPosition }
  | { type: "ROTATE_EAST_JUNCTION"; to?: JunctionPosition }
  | { type: "TOGGLE_UPPER_ROTOR"; to?: RotorOrientation }
  | { type: "TOGGLE_LOWER_ROTOR"; to?: RotorOrientation }
  | { type: "SET_DIAL"; to?: MachineDialState }
  | { type: "WIND_CRANK" }
  | { type: "COMPLETE_OUTBOUND_TRAVEL" }
  | { type: "EXAMINE_CENTER" }
  | { type: "CHOOSE_CORRESPONDENCE"; choice: Exclude<CorrespondenceChoice, null> }
  | { type: "SYNC_DRAFT_STATUS"; draftStatus: DraftStatus | null }
  | { type: "COMPLETE_RETURN_TRAVEL" }
  | { type: "COMPLETE_DOME_UNLOCK" };

export function reduceMachineState(state: MachineEngineState, action: MachineAction): MachineEngineState {
  switch (action.type) {
    case "ROTATE_WEST_JUNCTION": {
      if (state.domeUnlocked) return state;
      const westJunction = action.to ?? nextJunctionPosition(state.westJunction);
      const next = {
        ...state,
        westJunction,
        phase: state.phase === "discovery" ? ("experiment" as const) : state.phase,
        lastAttempt: null,
      };
      const evalRoute = evaluateMachineRoute(next);
      return {
        ...next,
        rookLine: evalRoute.connected
          ? next.keyRetrieved
            ? ROOK_LINES.lowerAligned
            : ROOK_LINES.experimentConnected
          : state.rookLine,
      };
    }

    case "ROTATE_EAST_JUNCTION": {
      if (state.domeUnlocked) return state;
      const eastJunction = action.to ?? nextJunctionPosition(state.eastJunction);
      const next = {
        ...state,
        eastJunction,
        phase: state.phase === "discovery" ? ("experiment" as const) : state.phase,
        lastAttempt: null,
      };
      const evalRoute = evaluateMachineRoute(next);
      return {
        ...next,
        rookLine: evalRoute.connected
          ? next.keyRetrieved
            ? ROOK_LINES.lowerAligned
            : ROOK_LINES.experimentConnected
          : state.rookLine,
      };
    }

    case "TOGGLE_UPPER_ROTOR": {
      if (state.domeUnlocked) return state;
      const upperRotor = action.to ?? toggleRotorOrientation(state.upperRotor);
      const next = {
        ...state,
        upperRotor,
        phase: state.phase === "discovery" ? ("experiment" as const) : state.phase,
        lastAttempt: null,
      };
      const evalRoute = evaluateMachineRoute(next);
      return {
        ...next,
        rookLine: evalRoute.connected && !next.keyRetrieved ? ROOK_LINES.experimentConnected : state.rookLine,
      };
    }

    case "TOGGLE_LOWER_ROTOR": {
      if (state.domeUnlocked) return state;
      const lowerRotor = action.to ?? toggleRotorOrientation(state.lowerRotor);
      const next = {
        ...state,
        lowerRotor,
        phase: state.phase === "discovery" ? ("experiment" as const) : state.phase,
        lastAttempt: null,
      };
      const evalRoute = evaluateMachineRoute(next);
      return {
        ...next,
        rookLine: evalRoute.connected && next.keyRetrieved ? ROOK_LINES.lowerAligned : state.rookLine,
      };
    }

    case "SET_DIAL": {
      if (state.domeUnlocked) return state;
      const dial = action.to ?? toggleDialState(state.dial);
      const next = {
        ...state,
        dial,
        phase: state.phase === "discovery" ? ("experiment" as const) : state.phase,
        lastAttempt: null,
      };
      return next;
    }

    case "WIND_CRANK": {
      if (state.domeUnlocked) return state;
      const attempt = evaluateMachineRoute(state);
      if (!attempt.connected) {
        // State B: failed route gives recoverable feedback without destroying player's junction settings
        return {
          ...state,
          phase: state.phase === "discovery" ? "experiment" : state.phase,
          lastAttempt: attempt,
          rookLine: ROOK_LINES.experimentBroken,
        };
      }

      if (!state.keyRetrieved) {
        // State C: Outbound route solved!
        return {
          ...state,
          phase: "outbound_solved",
          lastAttempt: attempt,
          rookLine: ROOK_LINES.outboundSolved,
        };
      }

      // State G or H: Return route solved!
      const returnRouteUsed = attempt.activeRoute === "center" ? "center" : "lower";
      return {
        ...state,
        phase: "return_solved",
        returnRouteUsed,
        lastAttempt: attempt,
      };
    }

    case "COMPLETE_OUTBOUND_TRAVEL": {
      // Transition from State C -> State D:
      // Key is collected, carriage now carries key, dial advances to NOW, upper route gate closes,
      // lower route is available in NOW but misaligned.
      if (!state.keyRetrieved && state.phase !== "outbound_solved") {
        // Only valid if outbound route was actually connected or solved
        const check = evaluateMachineRoute(state);
        if (!check.connected || check.direction !== "outbound") return state;
      }
      return {
        ...state,
        phase: "return_puzzle",
        keyRetrieved: true,
        dial: "NOW",
        lowerRotor: "misaligned",
        lastAttempt: null,
        rookLine: ROOK_LINES.machineShifts,
      };
    }

    case "EXAMINE_CENTER": {
      if (state.domeUnlocked) return state;
      return {
        ...state,
        phase: state.keyRetrieved ? "center_examined" : state.phase,
        centerExamined: true,
        rookLine: ROOK_LINES.centerExamined,
      };
    }

    case "CHOOSE_CORRESPONDENCE": {
      if (state.domeUnlocked) return state;
      const line =
        action.choice === "prepare_reply"
          ? ROOK_LINES.choicePrepare
          : action.choice === "keep_for_later"
            ? ROOK_LINES.choiceLater
            : ROOK_LINES.choiceDecline;
      // Note: Choosing "prepare_reply" NEVER restores the center bridge on its own!
      return {
        ...state,
        phase: state.centerBridgeRestored ? "center_restored" : "choice_made",
        centerExamined: true,
        correspondenceChoice: action.choice,
        rookLine: line,
      };
    }

    case "SYNC_DRAFT_STATUS": {
      // State G: ONLY `verified_sent` restores the center bridge.
      // `prepared`, `sending`, `declined`, `handed_off`, `reported_sent`, or `null` do NOT restore it.
      const verified = action.draftStatus === "verified_sent";
      if (!verified) {
        return {
          ...state,
          centerBridgeRestored: false,
        };
      }
      if (state.centerBridgeRestored) return state;
      return {
        ...state,
        centerBridgeRestored: true,
        phase: state.domeUnlocked
          ? state.phase
          : state.keyRetrieved
            ? "center_restored"
            : state.phase,
        rookLine: state.domeUnlocked ? state.rookLine : ROOK_LINES.centerRestored,
      };
    }

    case "COMPLETE_RETURN_TRAVEL": {
      // Guard: Rook cannot be declared rescued unless keyRetrieved is true and return route is connected
      if (!state.keyRetrieved) return state;
      const check = state.lastAttempt?.connected && state.lastAttempt.direction === "return"
        ? state.lastAttempt
        : evaluateMachineRoute(state);
      if (!check.connected || check.direction !== "return") return state;

      const routeUsed = check.activeRoute === "center" ? "center" : "lower";
      return {
        ...state,
        phase: "dome_unlocked",
        returnRouteUsed: routeUsed,
        domeUnlocked: true,
        rookRescued: true,
        rookLine: ROOK_LINES.domeUnlocked,
      };
    }

    case "COMPLETE_DOME_UNLOCK": {
      if (!state.domeUnlocked || !state.rookRescued) return state;
      return {
        ...state,
        phase: "completed",
        rookStealing: true,
        adventureCompleted: true,
        rookLine: ROOK_LINES.stealing,
      };
    }
  }
}
