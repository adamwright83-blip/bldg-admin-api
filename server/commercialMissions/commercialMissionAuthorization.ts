import type { CommercialMission, CommercialMissionStatus } from "@shared/commercialMission";

const DRIVER_TRANSITIONS = new Set<CommercialMissionStatus>([
  "preparing",
  "en_route",
  "arrived",
  "visit_completed",
  "follow_up",
  "won",
  "lost",
]);

export function assertDriverCanReadMission(input: {
  mission: CommercialMission;
  userId: string;
  isAdmin: boolean;
}): void {
  if (input.isAdmin) return;
  if (!input.mission.assignedTo || input.mission.assignedTo !== input.userId) {
    throw new Error("Commercial mission is not assigned to this field user");
  }
}

export function assertDriverTransitionAllowed(toStatus: CommercialMissionStatus): void {
  if (!DRIVER_TRANSITIONS.has(toStatus)) {
    throw new Error(`Field users cannot transition a commercial mission to ${toStatus}`);
  }
}
