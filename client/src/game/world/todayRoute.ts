/**
 * Today's Route (Slice 95) — the full playable projection of authoritative
 * current business reality, in the deterministic order the world already
 * uses to decide what to spotlight.
 *
 * This is NOT a new source of truth or a SaaS task list. It is
 * `MissionDirector.rankMissionsForRoute` (the exact ordering the game
 * already uses to pick its primary/secondary missions) run uncapped, with
 * each entry annotated with the real `ActionGrammar` the player's body would
 * actually need to perform. Zero live business actions in reality means
 * zero entries here — there is no floor, no minimum, no invented filler.
 */
import {
  resolveGoldlineAction,
  type GoldlineActionContext,
} from "../actions/actionRegistry";
import { deriveActionGrammar, type ActionGrammar } from "../../../../shared/actionGrammar";
import { rankMissionsForRoute } from "../state/MissionDirector";
import type { PlayableMission } from "../state/GameState";
import type { GoldlineProgressionProjection } from "../../../../shared/goldlineProgression";
import type { CapabilityEvaluation, ScoutReport } from "../../../../shared/expansionScout";
import type { AuthoritativeFollowUp } from "../actions/actionRegistry";

export type TodayRouteEntry = {
  mission: PlayableMission;
  /** Position in the deterministic real-priority order — 0 is next. */
  position: number;
  grammar: ActionGrammar | null;
};

export type ProjectTodayRouteInput = {
  missions: PlayableMission[];
  now: Date;
  progression?: GoldlineProgressionProjection | null;
  /** Real follow-up data, keyed by missionId, when known. */
  followUpsByMissionId?: Map<number, AuthoritativeFollowUp>;
  scoutCapability?: CapabilityEvaluation | null;
  scoutReport?: ScoutReport | null;
};

/**
 * Projects the complete real route for today. Every entry corresponds to a
 * mission that already exists in `missions` (itself sourced from
 * `projectMissionTruth`, backed by real `CommercialMission`/
 * `FieldMovesResult`/`DriverGameWorldNode` data) — nothing here can add,
 * remove, or reorder a mission independently of that real projection.
 */
export function projectTodayRoute(input: ProjectTodayRouteInput): TodayRouteEntry[] {
  const ranked = rankMissionsForRoute(input.missions, input.now, input.progression);
  return ranked.map((mission, position) => {
    const context: GoldlineActionContext = {
      mission,
      now: input.now,
      followUp: input.followUpsByMissionId?.get(mission.missionId ?? -1) ?? null,
      scoutCapability: input.scoutCapability ?? null,
      scoutReport: input.scoutReport ?? null,
    };
    const descriptor = resolveGoldlineAction(context);
    return {
      mission,
      position,
      grammar: descriptor ? deriveActionGrammar(descriptor) : null,
    };
  });
}
