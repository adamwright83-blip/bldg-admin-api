import type { CommercialMissionStatus } from "./commercialMission";
import { pipelineStageForMissionStatus } from "./commercialPipeline";
import { eventNameForCommercialMissionTransition } from "./commercialMissionLifecycle";
import {
  visualStateForBusinessStatus,
  type WorldMissionState,
} from "./driverGameWorld";

/**
 * Two ways to finish the same commercial mission objective.
 *
 * Play walks the existing BORESLAY ceremony (game start, qualifying result,
 * phone unlock) and is already recorded on `commercial_mission_events`.
 * Direct records one event on that same ledger and lands on the same
 * objective. It does not award XP, streaks, coins, or gold.
 */
export const MISSION_COMPLETION_PATHS = ["play", "direct"] as const;
export type MissionCompletionPath = (typeof MISSION_COMPLETION_PATHS)[number];

export const DIRECT_OBJECTIVE_EVENT = "direct_objective_completed";

/** The business objective both paths reach: the field mission is unlocked. */
export const SHARED_MISSION_OBJECTIVE = {
  status: "phone_ready",
  pipelineStage: "field_ready",
  worldVisualState: "active",
} as const;

export type SharedMissionObjective = {
  status: typeof SHARED_MISSION_OBJECTIVE.status;
  pipelineStage: typeof SHARED_MISSION_OBJECTIVE.pipelineStage;
  worldVisualState: typeof SHARED_MISSION_OBJECTIVE.worldVisualState;
  completionPath: MissionCompletionPath;
  awardsXp: boolean;
  awardsStreak: boolean;
};

export type MissionLedgerEvent = {
  eventName: string;
  fromStatus: CommercialMissionStatus;
  toStatus: CommercialMissionStatus;
  metadata?: Record<string, unknown>;
};

const PLAY_OFFER_STATUSES = ["game_ready", "game_active"] as const;
export type PlayOfferStatus = (typeof PLAY_OFFER_STATUSES)[number];

export function missionOffersBothCompletionPaths(
  status: CommercialMissionStatus
): status is PlayOfferStatus {
  return status === "game_ready" || status === "game_active";
}

export function worldAcknowledgementForObjective(): WorldMissionState {
  return visualStateForBusinessStatus({
    missionStatus: SHARED_MISSION_OBJECTIVE.status,
  });
}

export function objectiveForCompletionPath(
  path: MissionCompletionPath
): SharedMissionObjective {
  const worldVisualState = worldAcknowledgementForObjective();
  if (
    worldVisualState !== SHARED_MISSION_OBJECTIVE.worldVisualState ||
    pipelineStageForMissionStatus({ status: SHARED_MISSION_OBJECTIVE.status }) !==
      SHARED_MISSION_OBJECTIVE.pipelineStage
  ) {
    throw new Error("Shared mission objective drifted from its world and pipeline projections");
  }
  return {
    status: SHARED_MISSION_OBJECTIVE.status,
    pipelineStage: SHARED_MISSION_OBJECTIVE.pipelineStage,
    worldVisualState: SHARED_MISSION_OBJECTIVE.worldVisualState,
    completionPath: path,
    awardsXp: path === "play",
    awardsStreak: path === "play",
  };
}

/**
 * Event names the existing play service already writes. `completionPath` is
 * not added here: that service is unchanged, and these names are how the
 * ledger already records a played completion.
 */
export function playPathLedger(
  from: PlayOfferStatus
): readonly MissionLedgerEvent[] {
  const events: MissionLedgerEvent[] = [];
  if (from === "game_ready") {
    events.push({
      eventName: eventNameForCommercialMissionTransition("game_ready", "game_active"),
      fromStatus: "game_ready",
      toStatus: "game_active",
    });
  }
  events.push({
    eventName: eventNameForCommercialMissionTransition("game_active", "game_completed"),
    fromStatus: "game_active",
    toStatus: "game_completed",
  });
  events.push({
    eventName: eventNameForCommercialMissionTransition("game_completed", "phone_ready"),
    fromStatus: "game_completed",
    toStatus: "phone_ready",
  });
  return events;
}

export type DirectCompletionMetadata = {
  completionPath: "direct";
  objective: "phone_mission_unlocked";
  objectiveStatus: "phone_ready";
  pipelineStage: "field_ready";
  worldVisualState: WorldMissionState;
  gameXpAwarded: false;
  streakAwarded: false;
};

export function directPathLedger(from: PlayOfferStatus): readonly MissionLedgerEvent[] {
  const objective = objectiveForCompletionPath("direct");
  const metadata: DirectCompletionMetadata = {
    completionPath: "direct",
    objective: "phone_mission_unlocked",
    objectiveStatus: objective.status,
    pipelineStage: objective.pipelineStage,
    worldVisualState: objective.worldVisualState,
    gameXpAwarded: false,
    streakAwarded: false,
  };
  return [
    {
      eventName: DIRECT_OBJECTIVE_EVENT,
      fromStatus: from,
      toStatus: objective.status,
      metadata,
    },
  ];
}

export function directCompletionIdempotencyKey(requestId: string): string {
  return `direct-objective:${requestId}`;
}

export function completionPathFromLedger(
  events: readonly { eventName: string; metadata?: Record<string, unknown> | null }[]
): MissionCompletionPath | null {
  if (
    events.some(
      event =>
        event.eventName === DIRECT_OBJECTIVE_EVENT ||
        event.metadata?.completionPath === "direct"
    )
  ) {
    return "direct";
  }
  if (
    events.some(
      event =>
        event.eventName === "game_completed" ||
        event.eventName === "phone_unlocked" ||
        event.metadata?.completionPath === "play"
    )
  ) {
    return "play";
  }
  return null;
}

export function ledgerReachesSharedObjective(
  events: readonly MissionLedgerEvent[]
): boolean {
  const last = events[events.length - 1];
  return last?.toStatus === SHARED_MISSION_OBJECTIVE.status;
}

/** Same dispatch gate the play path uses once the field mission is unlocked. */
export function missionNeedsSameFieldDispatch(mission: {
  assignedTo: string | null;
  steps: readonly { type?: string | null }[];
}): boolean {
  return (
    Boolean(mission.assignedTo) &&
    mission.steps.some(step => step.type !== "generic")
  );
}
