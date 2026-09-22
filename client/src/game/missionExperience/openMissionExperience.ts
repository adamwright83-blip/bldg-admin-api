import type { MissionEntrance } from "../../../../shared/missionExperience";

export type MissionExperienceOpen = (input: {
  instanceId: string;
  entrance: MissionEntrance;
}) => void;

/**
 * Entrance is telemetry. It does not choose the mission or change its truth.
 * Both call sites pass the instance id they were given.
 */
export function openMissionExperience(input: {
  instanceId: string;
  entrance: MissionEntrance;
  open: MissionExperienceOpen;
}): void {
  input.open({ instanceId: input.instanceId, entrance: input.entrance });
}

export function openMissionFromDayLine(instanceId: string, open: MissionExperienceOpen): void {
  openMissionExperience({ instanceId, entrance: "DAY_LINE", open });
}

/**
 * Overworld stub. No landmark and no worldDestinationId. The same instance
 * id resumes. This does not create a destination.
 */
export function openMissionFromOverworld(instanceId: string, open: MissionExperienceOpen): void {
  openMissionExperience({ instanceId, entrance: "OVERWORLD", open });
}
