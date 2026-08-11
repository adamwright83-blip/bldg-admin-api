import type { CommercialMission } from "../../../../shared/commercialMission";
import type { DriverGameWorldNode } from "../../../../shared/driverGameWorld";
import { visualStateForBusinessStatus } from "../../../../shared/driverGameWorld";
import type {
  FieldMoveCandidate,
  FieldMovesResult,
} from "../../../../server/field/types";
import { dedupeByEntityIdentity } from "../../../../shared/missionSource";
import type { PlayableMission } from "./GameState";

function mapsUrl(address: string | null | undefined) {
  return address
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`
    : null;
}

function phoneUrl(mission: CommercialMission) {
  const phone = mission.account.decisionMaker.phone?.trim();
  return phone ? `tel:${phone}` : null;
}

function moveForMission(
  moves: FieldMoveCandidate[],
  missionId: number
): FieldMoveCandidate | undefined {
  return moves.find(move => move.missionId === missionId);
}

export function projectPlayableMissions(input: {
  missions?: CommercialMission[];
  moves?: FieldMovesResult;
  worldNodes?: DriverGameWorldNode[];
}): PlayableMission[] {
  const missions = input.missions ?? [];
  const moves = input.moves?.recommendedMoves ?? [];
  const nodeByMission = new Map(
    (input.worldNodes ?? []).map(node => [node.missionId, node])
  );
  const projected: PlayableMission[] = missions.map(mission => {
    const move = moveForMission(moves, mission.id);
    const node = nodeByMission.get(mission.id);
    const low = move?.expectedValue.value?.lowCents ?? null;
    const high =
      move?.expectedValue.value?.highCents ??
      mission.opportunity.estimatedAnnualValueCents ??
      null;
    return {
      key: `mission:${mission.id}`,
      missionId: mission.id,
      moveId: move?.id ?? null,
      name: mission.account.name,
      address: mission.account.address || null,
      navigationUrl: mapsUrl(mission.account.address),
      phoneUrl: phoneUrl(mission),
      destinationPath: `/driver/sales-mission/${mission.id}`,
      state: visualStateForBusinessStatus({
        missionStatus: mission.status,
        savedVisualState: node?.visualState,
      }),
      timeBurdenMinutes: move?.expectedDurationMinutes ?? null,
      travelBurdenMinutes: move?.travelMinutes ?? null,
      estimatedValueLowCents: low,
      estimatedValueHighCents: high,
      confidence: move?.confidence ?? mission.opportunity.estimateConfidence,
      expiresAt: move?.expiresAt ?? mission.expiresAt,
      contestedUntil: node?.contestedUntil ?? null,
      verifiedAnnualValueCents:
        mission.status === "won"
          ? (node?.verifiedAnnualValueCents ?? null)
          : null,
      realizedRevenueCents: node?.realizedRevenueCents ?? 0,
      unlockedPath: node?.unlockedPath ?? null,
      lossReason: node?.lossReason ?? null,
    } satisfies PlayableMission;
  });
  for (const move of moves) {
    projected.push({
      key: `move:${move.id}`,
      missionId: move.missionId,
      moveId: move.id,
      name: move.target.name,
      address: null,
      navigationUrl: null,
      phoneUrl: null,
      destinationPath: move.destinationPath,
      state: "available",
      timeBurdenMinutes: move.expectedDurationMinutes,
      travelBurdenMinutes: move.travelMinutes,
      estimatedValueLowCents: move.expectedValue.value?.lowCents ?? null,
      estimatedValueHighCents: move.expectedValue.value?.highCents ?? null,
      confidence: move.confidence,
      expiresAt: move.expiresAt,
      contestedUntil: null,
      verifiedAnnualValueCents: null,
      realizedRevenueCents: 0,
      unlockedPath: null,
      lossReason: null,
    });
  }
  // A real business entity may be produced by more than one source (e.g. a
  // FIELD move already tracking an account Scout also discovered) — dedupe
  // by the missionId every source ultimately converges on so one entity
  // never yields two world nodes. Entries with a materialized `missionId`
  // (already a real commercialMissions row) always win over a bare move
  // candidate that merely references the same id.
  const deduped = dedupeByEntityIdentity(
    projected,
    entry => (entry.missionId != null ? `mission:${entry.missionId}` : entry.key),
    entry => (entry.key.startsWith("mission:") ? 0 : 1)
  );
  return deduped
    .filter(mission => !["captured", "closed"].includes(mission.state))
    .slice(0, 3);
}

export function projectPersistentHistory(
  nodes: DriverGameWorldNode[] = []
): PlayableMission[] {
  return nodes
    .filter(node => node.isHistorical)
    .sort((left, right) =>
      (right.resolvedAt ?? "").localeCompare(left.resolvedAt ?? "")
    )
    .map(node => ({
      key: `history:${node.missionId}`,
      missionId: node.missionId,
      moveId: null,
      name: node.accountName,
      address: null,
      navigationUrl: null,
      phoneUrl: null,
      destinationPath: `/driver/sales-mission/${node.missionId}`,
      state: node.visualState,
      timeBurdenMinutes: null,
      travelBurdenMinutes: null,
      estimatedValueLowCents: null,
      estimatedValueHighCents: null,
      confidence: "unknown",
      expiresAt: null,
      contestedUntil: node.contestedUntil,
      verifiedAnnualValueCents: node.verifiedAnnualValueCents,
      realizedRevenueCents: node.realizedRevenueCents,
      unlockedPath: node.unlockedPath,
      lossReason: node.lossReason,
    }));
}

export function moneyBandLabel(mission: PlayableMission): string {
  const format = (cents: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(cents / 100);
  if (mission.estimatedValueLowCents && mission.estimatedValueHighCents) {
    return `${format(mission.estimatedValueLowCents)}–${format(mission.estimatedValueHighCents)}/YR EST.`;
  }
  if (mission.estimatedValueHighCents) {
    return `${format(mission.estimatedValueHighCents)}/YR EST.`;
  }
  return "VALUE NOT SOURCED";
}
