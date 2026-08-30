/**
 * Assembles the canonical building seam from the services that already own
 * each half of the truth. This module runs no new business logic: it loads
 * what Level 4 and Tower Wars already compute, resolves commercial missions
 * onto the same physical objects by real address, and hands the pieces to the
 * pure composer in shared/canonicalBuilding.ts.
 *
 * Geographic truth comes only from `commercial_account_locations.latitude/
 * longitude` — a real stored coordinate. Nothing here geocodes, estimates, or
 * infers a position, so a building without a stored coordinate stays null
 * rather than being placed approximately on the atlas.
 */
import { and, eq, inArray } from "drizzle-orm";
import {
  commercialAccountLocations,
  commercialMissions,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { BUILDINGS } from "@shared/buildings";
import { TOWER_DEFINITIONS } from "@shared/propertyTowers";
import {
  composeCanonicalBuilding,
  firstBrokenLink,
  hasUnbrokenContinuity,
  resolveCanonicalBuilding,
  traceBuildingContinuity,
  type CanonicalBuilding,
  type ContinuityLink,
  type BuildingCoordinate,
} from "@shared/canonicalBuilding";
import type { CommercialMissionStatus } from "@shared/commercialMission";
import { getLevel4OffensiveState } from "../level4Offensive";
import { getTowerWarsToday } from "../towerWars/towerWarsService";
import { visualStateForBusinessStatus } from "@shared/driverGameWorld";

export type CanonicalBuildingView = {
  building: CanonicalBuilding;
  continuity: ContinuityLink[];
  unbroken: boolean;
  firstBroken: ContinuityLink | null;
};

export type CanonicalBuildingWorld = {
  tenantId: string;
  /** False when the database is unavailable — callers must not treat empty as zero. */
  evidenceSufficient: boolean;
  buildings: CanonicalBuildingView[];
  /**
   * Addresses that one registry recognised and the other did not. A non-empty
   * list is a real data problem, not a display concern: those orders drop out
   * of buildingSlug derivation and therefore out of penetration counts.
   */
  registryDisagreements: Array<{
    address: string;
    agreement: string;
    missionId: number;
  }>;
};

type MissionRow = {
  missionId: number;
  status: CommercialMissionStatus;
  address: string | null;
  latitude: string | null;
  longitude: string | null;
};

async function loadMissionsByBuilding(tenantId: string) {
  const db = await getDb();
  const byCanonicalId = new Map<string, MissionRow>();
  const disagreements: CanonicalBuildingWorld["registryDisagreements"] = [];
  if (!db) return { byCanonicalId, disagreements };

  let rows: Array<{
    missionId: number;
    status: CommercialMissionStatus;
    address: string | null;
    latitude: string | null;
    longitude: string | null;
  }> = [];
  try {
    rows = (await db
      .select({
        missionId: commercialMissions.id,
        status: commercialMissions.status,
        address: commercialAccountLocations.address,
        latitude: commercialAccountLocations.latitude,
        longitude: commercialAccountLocations.longitude,
      })
      .from(commercialMissions)
      .leftJoin(
        commercialAccountLocations,
        and(
          eq(commercialAccountLocations.tenantId, commercialMissions.tenantId),
          eq(commercialAccountLocations.isPrimary, true)
        )
      )
      .where(eq(commercialMissions.tenantId, tenantId))) as typeof rows;
  } catch {
    // Missing table tolerance, matching the level4 pattern: the seam degrades
    // to "no missions" rather than taking down the admin surface.
    return { byCanonicalId, disagreements };
  }

  for (const row of rows) {
    if (!row.address) continue;
    const resolved = resolveCanonicalBuilding(row.address);
    if (resolved.agreement === "none") continue;
    if (
      resolved.agreement === "conflict" ||
      resolved.agreement === "tower_only"
    ) {
      disagreements.push({
        address: row.address,
        agreement: resolved.agreement,
        missionId: row.missionId,
      });
    }
    const canonicalId =
      resolved.config?.id ?? resolved.tower?.propertyGroup ?? null;
    if (!canonicalId) continue;
    // Deepest mission wins when several target one building — a won account
    // must never be hidden behind an unrelated candidate on the same address.
    const existing = byCanonicalId.get(canonicalId);
    if (!existing || rankStatus(row.status) > rankStatus(existing.status)) {
      byCanonicalId.set(canonicalId, row);
    }
  }
  return { byCanonicalId, disagreements };
}

/** Ordering used only to pick the most-advanced mission per building. */
function rankStatus(status: CommercialMissionStatus): number {
  if (status === "won") return 100;
  if (status === "lost") return -1;
  return [
    "candidate",
    "selected",
    "game_ready",
    "game_active",
    "game_completed",
    "phone_ready",
    "preparing",
    "en_route",
    "arrived",
    "visit_completed",
    "follow_up",
  ].indexOf(status);
}

function coordinateFrom(row: MissionRow | undefined): BuildingCoordinate | null {
  if (!row?.latitude || !row?.longitude) return null;
  const latitude = Number(row.latitude);
  const longitude = Number(row.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude, source: "provider_sourced" };
}

export async function getCanonicalBuildingWorld(input: {
  tenantId: string;
  now?: Date;
}): Promise<CanonicalBuildingWorld> {
  const [offensive, war, missions] = await Promise.all([
    getLevel4OffensiveState(input.tenantId),
    getTowerWarsToday({ tenantId: input.tenantId, now: input.now }),
    loadMissionsByBuilding(input.tenantId),
  ]);

  const penetrationBySlug = new Map(
    offensive.buildingPenetration.map(block => [block.buildingSlug, block])
  );

  const buildings: CanonicalBuildingView[] = [];
  for (const config of BUILDINGS) {
    const block = penetrationBySlug.get(config.slug);
    const missionRow = missions.byCanonicalId.get(config.id);
    const towerState =
      config.id === "opus_la" || config.id === "century_park_east"
        ? war.state.buildings[config.id]
        : null;
    const tower =
      Object.values(TOWER_DEFINITIONS).find(
        definition => definition.propertyGroup === config.id
      ) ?? null;

    const composed = composeCanonicalBuilding({
      config,
      tower,
      coordinate: coordinateFrom(missionRow),
      siege: missionRow
        ? {
            missionId: missionRow.missionId,
            missionStatus: missionRow.status,
            worldState: visualStateForBusinessStatus({
              missionStatus: missionRow.status,
            }),
            lossReason: null,
            verifiedAnnualValueCents: null,
            realizedRevenueCents: towerState?.revenueCents ?? 0,
          }
        : null,
      residents: block
        ? {
            signups: block.convertedUsers,
            paidResidents: block.convertedPaidUsers,
          }
        : null,
      war: towerState
        ? {
            towerWarsBuildingId: towerState.buildingId,
            revenueCents: towerState.revenueCents,
            orderCount: towerState.orderCount,
            todayDamage: towerState.damage,
            // Nothing settles into permanent history yet — the daily-settle
            // contract is not built. Reported honestly as zero rather than
            // borrowing today's damage and calling it history.
            settledScars: 0,
          }
        : null,
    });
    if (!composed) continue;

    buildings.push({
      building: composed,
      continuity: traceBuildingContinuity(composed),
      unbroken: hasUnbrokenContinuity(composed),
      firstBroken: firstBrokenLink(composed),
    });
  }

  return {
    tenantId: input.tenantId,
    evidenceSufficient: offensive.dbAvailable && war.evidenceSufficient,
    buildings,
    registryDisagreements: missions.disagreements,
  };
}
