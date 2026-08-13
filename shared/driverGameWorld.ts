import type { CommercialMissionStatus } from "./commercialMission";

export const WORLD_MISSION_STATES = [
  "available",
  "approaching",
  "active",
  "captured",
  "contested",
  "recovery_available",
  "recovery_active",
  "watching",
  "closed",
] as const;

export type WorldMissionState = (typeof WORLD_MISSION_STATES)[number];

export type DriverGameWorldNode = {
  missionId: number;
  entityType: "commercial_mission";
  entityId: string;
  accountId: number;
  accountName: string;
  locationId: number | null;
  missionStatus: CommercialMissionStatus;
  visualState: WorldMissionState;
  worldAnchor: string;
  unlockedPath: string | null;
  discoveryState: "hidden" | "discovered" | "engaged";
  contestedUntil: string | null;
  verifiedAnnualValueCents: number | null;
  realizedRevenueCents: number;
  lossReason: string | null;
  version: number;
  isTodayActive: boolean;
  isHistorical: boolean;
  regionKey: string;
  resolvedAt: string | null;
};

export function gameWorldControlPercent(nodes: DriverGameWorldNode[]): number {
  // Game progression only: captured nodes / non-closed pursued nodes.
  // This deliberately does not represent geographic or commercial market share.
  const pursued = nodes.filter(node => node.visualState !== "closed");
  if (!pursued.length) return 0;
  const captured = pursued.filter(
    node => node.visualState === "captured"
  ).length;
  return Math.round((captured / pursued.length) * 100);
}

export function visualStateForBusinessStatus(input: {
  missionStatus: CommercialMissionStatus;
  savedVisualState?: WorldMissionState | null;
}): WorldMissionState {
  if (input.missionStatus === "won") return "captured";
  if (input.missionStatus === "lost") return "closed";
  if (input.missionStatus === "follow_up") {
    return input.savedVisualState === "recovery_active" ||
      input.savedVisualState === "recovery_available"
      ? input.savedVisualState
      : "contested";
  }
  if (["candidate", "selected", "game_ready"].includes(input.missionStatus)) {
    return "available";
  }
  if (
    ["game_active", "preparing", "en_route", "arrived"].includes(
      input.missionStatus
    )
  ) {
    return "active";
  }
  return "watching";
}

export function coolingLabel(
  contestedUntil: string | null,
  now = new Date()
): string {
  if (!contestedUntil) return "CONTESTED · AWAITING ACTION";
  const due = new Date(contestedUntil);
  if (!Number.isFinite(due.getTime())) return "CONTESTED · AWAITING ACTION";
  const minutes = Math.max(
    0,
    Math.ceil((due.getTime() - now.getTime()) / 60_000)
  );
  if (minutes < 60) return `COOLING ${minutes}M`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `COOLING ${hours}H${remainder ? ` ${remainder}M` : ""}`;
}
