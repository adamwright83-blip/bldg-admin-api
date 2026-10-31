import type { ChapterOpportunity, DraftApproach, DraftView } from "@shared/firstTenMinutesChapter";
import type { ActivationView } from "@shared/firstTenMinutesActivation";
import type { SendOutcome } from "../chapter/SendDesk";

export type MachineDialState = "THEN" | "NOW";

export type JunctionPosition = "upper" | "center" | "lower";

export type RotorOrientation = "aligned" | "misaligned";

export type MachinePhase =
  | "discovery" // State A: arrives, Rook trapped, key across railway, dial THEN
  | "experiment" // State B: first experiment, junctions rotated or crank tried
  | "outbound_solved" // State C: carriage traveling outbound along upper route
  | "return_puzzle" // State D: key collected, machine shifts to NOW, upper gate closed
  | "center_examined" // State E: player examined the middle crossing / correspondence card
  | "choice_made" // State F: player chose Prepare a reply / Keep for later / Not for me
  | "center_restored" // State G: verified real send reconnected the central crossing
  | "return_solved" // State G/H: carriage traveling back with key (center or lower route)
  | "dome_unlocked" // State I: key enters lock, tumblers turn, dome lifts, Rook steps out
  | "completed"; // State I final beat: Rook tries to steal the machine into his satchel

export type CorrespondenceChoice = "prepare_reply" | "keep_for_later" | "not_for_me" | null;

export type MachineRouteKind = "upper" | "center" | "lower";

export type MachineNodeId =
  | "rook_dome"
  | "west_junction"
  | "upper_rotor"
  | "center_crossing"
  | "lower_rotor"
  | "east_junction"
  | "key_station";

export interface MachinePoint {
  x: number;
  y: number;
}

export interface MachineGraphConfig {
  dial: MachineDialState;
  westJunction: JunctionPosition;
  eastJunction: JunctionPosition;
  upperRotor: RotorOrientation;
  lowerRotor: RotorOrientation;
  /** True after key is retrieved (State D+): upper route gate closes for return trip */
  keyRetrieved: boolean;
  /** True ONLY when a qualifying real-world send has been verified (`verified_sent`) */
  centerBridgeRestored: boolean;
}

export interface RouteEvaluation {
  direction: "outbound" | "return";
  connected: boolean;
  activeRoute: MachineRouteKind | null;
  /** Ordered node sequence reached before stopping (or full route if connected) */
  reachedNodes: MachineNodeId[];
  /** Point sequence in 1280x720 logical coordinates for carriage travel */
  pathPoints: MachinePoint[];
  /** Reason the route stopped early, if not connected */
  stopReason:
    | null
    | "west_junction_disconnected"
    | "upper_dial_requires_then"
    | "upper_return_gate_closed"
    | "upper_rotor_misaligned"
    | "center_crossing_broken"
    | "lower_dial_requires_now"
    | "lower_rotor_misaligned"
    | "east_junction_mismatch";
  /** Logical coordinate where the carriage halts on a broken route */
  haltPoint: MachinePoint | null;
}

export interface MachineEngineState {
  phase: MachinePhase;
  dial: MachineDialState;
  westJunction: JunctionPosition;
  eastJunction: JunctionPosition;
  upperRotor: RotorOrientation;
  lowerRotor: RotorOrientation;
  keyRetrieved: boolean;
  centerExamined: boolean;
  correspondenceChoice: CorrespondenceChoice;
  centerBridgeRestored: boolean;
  returnRouteUsed: "center" | "lower" | null;
  domeUnlocked: boolean;
  rookRescued: boolean;
  rookStealing: boolean;
  adventureCompleted: boolean;
  lastAttempt: RouteEvaluation | null;
  rookLine: string;
}

export interface MachineMilestonePayload {
  milestone:
    | "key_retrieved"
    | "center_examined"
    | "choice_prepare_reply"
    | "choice_keep_for_later"
    | "choice_not_for_me"
    | "center_restored"
    | "return_completed"
    | "rook_rescued"
    | "adventure_completed";
  route?: "center" | "lower";
}

export interface MachineBusinessAdapter {
  isSimulated?: boolean;
  example: boolean;
  businessName: string | null;
  opportunity: ChapterOpportunity | null;
  draft: DraftView | null;
  activation: ActivationView | null;
  checkoutNotice?: "success" | "cancelled" | null;
  connectNotice?: string | null;
  onPrepareDraft: () => Promise<unknown>;
  onChangeDraft: (change: { approach?: DraftApproach; body?: string }) => Promise<unknown>;
  onDeclineDraft: () => Promise<unknown>;
  onRecordChoice: (choice: "prepare_reply" | "keep_for_later" | "not_for_me") => Promise<unknown>;
  onRecordMilestone: (payload: MachineMilestonePayload) => Promise<unknown>;
  onBeginActivation?: (identity: {
    businessName: string;
    contactName: string;
    ownerEmail: string;
    timeZone: string;
  }) => Promise<void>;
  onBringYourOwn?: () => void;
  onSendDraft?: (
    approved: { to: string; subject: string; body: string },
    options?: { resendUnconfirmed?: boolean }
  ) => Promise<SendOutcome>;
  onAllowSend?: () => Promise<void>;
  onVerifyDraft?: () => Promise<void>;
  onFinishAdventure?: () => Promise<void>;
}
