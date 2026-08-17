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

/**
 * A missing decision-maker costs a Call link, not the whole game.
 *
 * This reached three levels deep unguarded, so a mission that arrived without
 * an account or without a decision maker threw inside a `.map` during render
 * and took the entire driver surface down to "An unexpected error occurred" —
 * no route, no stops, no way to work the day. Absent contact detail is an
 * ordinary state of real sales data, and the app already renders a disabled
 * Call affordance for it.
 */
function phoneUrl(mission: CommercialMission) {
  const phone = mission.account?.decisionMaker?.phone?.trim();
  return phone ? `tel:${phone}` : null;
}

function moveForMission(
  moves: FieldMoveCandidate[],
  missionId: number
): FieldMoveCandidate | undefined {
  return moves.find(move => move.missionId === missionId);
}

export function projectMissionTruth(input: {
  missions?: CommercialMission[];
  moves?: FieldMovesResult;
  worldNodes?: DriverGameWorldNode[];
}): PlayableMission[] {
  // `?? []` only guards null and undefined. Anything else non-iterable — an
  // envelope, an object, a paginated shape — throws inside these iterations
  // during render, which white-screens the driver's entire day rather than
  // costing the one list that arrived malformed.
  const missions = Array.isArray(input.missions) ? input.missions : [];
  const moveList = input.moves?.recommendedMoves;
  const moves = Array.isArray(moveList) ? moveList : [];
  const nodeByMission = new Map(
    (Array.isArray(input.worldNodes) ? input.worldNodes : []).map(node => [
      node.missionId,
      node,
    ])
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
    entry =>
      entry.missionId != null ? `mission:${entry.missionId}` : entry.key,
    entry => (entry.key.startsWith("mission:") ? 0 : 1)
  );
  return deduped;
}

export function projectPlayableMissions(input: {
  missions?: CommercialMission[];
  moves?: FieldMovesResult;
  worldNodes?: DriverGameWorldNode[];
}): PlayableMission[] {
  return projectMissionTruth(input)
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
