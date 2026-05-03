import type { AgentTool } from "../toolRegistry";

const driverMissionTypes = new Set([
  "route_stop",
  "flyer_placement",
  "proof_upload",
  "building_coverage",
  "territory_progress",
  "nearby_complex_suggestion",
]);

export const createDriverMissionTool: AgentTool<Record<string, any>> = {
  name: "createDriverMissionTool",
  description: "Create driver field execution or field marketing missions based on route context.",
  async execute(input) {
    const missionType = input.missionType ?? "route_stop";
    if (!driverMissionTypes.has(missionType)) {
      throw new Error("Driver missions must be field execution or field marketing missions");
    }
    const mission = {
      missionType,
      title: input.title ?? "Driver mission",
      routeStopId: input.routeStopId ?? null,
      orderId: input.orderId ?? null,
      driverId: input.driverId ?? null,
      originBuilding: input.originBuilding ?? null,
      targetBuilding: input.targetBuilding ?? null,
      routeRadiusMeters: input.routeRadiusMeters ?? null,
      suggestedNearbyBuildings: input.suggestedNearbyBuildings ?? [],
      proofRequired: missionType === "flyer_placement" || missionType === "proof_upload",
      proofPhotoUrl: input.proofPhotoUrl ?? null,
      territoryXpAward: input.territoryXpAward ?? (input.proofPhotoUrl ? 10 : 0),
      adminGameCategory: false,
    };
    return { entityType: "driver_mission", entityId: input.missionId ?? mission.title, output: mission };
  },
};
