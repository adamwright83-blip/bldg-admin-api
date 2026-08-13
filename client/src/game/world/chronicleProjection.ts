/**
 * Business Chronicle (Slice 98) — persistent personal world memory,
 * projected from the same authoritative history `projectPersistentHistory`
 * already reads (`DriverGameWorldNode[].isHistorical`). This module adds no
 * new source of truth: it pairs each historical entry with the same
 * semantic mutation descriptor the live world uses
 * (`shared/worldMutationDescriptor.ts`, PR #51), so a Chronicle entry's
 * "scar" language is exactly what that account's node earned in reality —
 * never an invented trophy, XP entry, or streak record.
 *
 * No midnight reset, no daily archive rotation: entries persist exactly as
 * long as `isHistorical` nodes exist in the authoritative world-state feed.
 */
import { projectPersistentHistory } from "../state/WorldProjection";
import {
  deriveWorldMutation,
  type WorldMutationDescriptor,
} from "../../../../shared/worldMutationDescriptor";
import type { DriverGameWorldNode } from "../../../../shared/driverGameWorld";
import type { PlayableMission } from "../state/GameState";

export type ChronicleEntry = {
  mission: PlayableMission;
  mutation: WorldMutationDescriptor;
  resolvedAt: string | null;
};

/**
 * Projects the Chronicle from real world-state history. Sorted newest
 * first, exactly matching `projectPersistentHistory`'s own ordering — this
 * function adds annotation, not a second sort/filter policy.
 */
export function projectChronicle(nodes: DriverGameWorldNode[] = []): ChronicleEntry[] {
  const history = projectPersistentHistory(nodes);
  const nodeByMission = new Map(nodes.map(node => [node.missionId, node]));
  return history.map(mission => {
    const node = nodeByMission.get(mission.missionId ?? -1);
    return {
      mission,
      mutation: deriveWorldMutation({ missionState: mission.state }),
      resolvedAt: node?.resolvedAt ?? null,
    };
  });
}
