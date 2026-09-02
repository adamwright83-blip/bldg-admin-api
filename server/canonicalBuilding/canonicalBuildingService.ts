/**
 * Assembles the canonical building seam from the services that already own
 * each half of the truth. This module runs no new business logic: it loads
 * what Level 4 and Tower Wars already compute, resolves commercial missions
 * onto the same physical objects, and hands the pieces to the pure composer in
 * shared/canonicalBuilding.ts.
 *
 * MISSION -> BUILDING IDENTITY
 *
 * A mission's building is established through the authoritative ownership
 * chain and nothing weaker:
 *
 *   commercial_missions.opportunityId
 *     -> commercial_opportunities.id
 *     -> commercial_opportunities.accountId
 *     -> commercial_account_locations.accountId
 *
 * Shared tenancy is NOT identity. An earlier version of this loader joined
 * missions to locations on `tenantId` plus `isPrimary`, which pairs every
 * mission with every primary location in the tenant — a cross product that
 * silently attributes a mission to another account's building as soon as a
 * second account exists. `bindMissionsToLocations` below is the pure form of
 * the correct rule, so the invariant is asserted in tests rather than trusted
 * to a join clause.
 *
 * Geographic truth comes only from a stored `commercial_account_locations`
 * coordinate. Nothing here geocodes, estimates, or infers a position.
 */
import { and, eq } from "drizzle-orm";
import {
  commercialAccountLocations,
  commercialMissions,
  commercialOpportunities,
  commercialPipelineRecords,
  operationsEvents,
  orders,
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
import {
  getTowerWarsSettlement,
  getTowerWarsToday,
} from "../towerWars/towerWarsService";
import { visualStateForBusinessStatus } from "@shared/driverGameWorld";
import type { TowerWarsSettlement } from "@shared/towerWarsSettlement";

export type CanonicalBuildingView = {
  building: CanonicalBuilding;
  /** Exact production work destination bound through this building's mission. */
  pipelineId: number | null;
  continuity: ContinuityLink[];
  unbroken: boolean;
  firstBroken: ContinuityLink | null;
};

export type RegistryDisagreement = {
  address: string;
  agreement: string;
  missionId: number;
};

export type CanonicalBuildingWorld = {
  tenantId: string;
  /** False when the database is unavailable — callers must not treat empty as zero. */
  evidenceSufficient: boolean;
  buildings: CanonicalBuildingView[];
  settlement: TowerWarsSettlement;
  /**
   * Addresses that one registry recognised and the other did not. A non-empty
   * list is a real data problem, not a display concern: those orders drop out
   * of buildingSlug derivation and therefore out of penetration counts.
   */
  registryDisagreements: RegistryDisagreement[];
  /**
   * Dated, completed pickups keyed by building slug. Paired with `settlement`'s
   * strata to decide how far a facade has been REPAIRED, which needs the time
   * the collection actually happened rather than merely that it did.
   *
   * Empty for a building means no healing, never "assume recovered".
   */
  restorationEvidence: Record<string, DatedPickupRow[]>;
};

/* ── The pure identity rule ─────────────────────────────────────────────── */

/**
 * One row per (mission, location-belonging-to-that-mission's-account).
 *
 * `accountId` is the account reached through the mission's own opportunity.
 * A row whose `accountId` is null cannot establish ownership and is dropped —
 * never guessed at from tenancy.
 */
export type MissionLocationRow = {
  missionId: number;
  pipelineId: number | null;
  status: CommercialMissionStatus;
  opportunityId: number | null;
  /** Account reached via this mission's own opportunity. */
  accountId: number | null;
  locationId: number;
  locationAccountId: number;
  address: string | null;
  latitude: string | null;
  longitude: string | null;
  isPrimary: boolean;
  approvedContractValueCents: number | null;
  pipelineStage: string | null;
  realizedRevenueCents: number | null;
  lossReason: string | null;
};

export type BoundMission = {
  missionId: number;
  pipelineId: number | null;
  status: CommercialMissionStatus;
  accountId: number;
  locationId: number;
  address: string;
  latitude: string | null;
  longitude: string | null;
  approvedContractValueCents: number | null;
  pipelineStage: string | null;
  realizedRevenueCents: number | null;
  lossReason: string | null;
};

/**
 * Deterministic location choice within a mission's OWN account: a primary
 * location wins, and among equals the lowest location id wins so the result
 * never depends on row order.
 */
function preferLocation(a: MissionLocationRow, b: MissionLocationRow) {
  if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
  return a.locationId - b.locationId;
}

/**
 * Bind each mission to a location belonging to its own account.
 *
 * The single invariant: `row.locationAccountId === row.accountId`. Anything
 * else is another account's building and is discarded rather than resolved by
 * precedence.
 */
export function bindMissionsToLocations(
  rows: readonly MissionLocationRow[]
): BoundMission[] {
  const byMission = new Map<number, MissionLocationRow[]>();
  for (const row of rows) {
    if (row.accountId == null) continue;
    if (row.locationAccountId !== row.accountId) continue;
    if (!row.address) continue;
    const existing = byMission.get(row.missionId);
    if (existing) existing.push(row);
    else byMission.set(row.missionId, [row]);
  }

  const bound: BoundMission[] = [];
  for (const [missionId, candidates] of Array.from(byMission.entries())) {
    const chosen = [...candidates].sort(preferLocation)[0];
    if (!chosen || chosen.accountId == null) continue;
    bound.push({
      missionId,
      pipelineId: chosen.pipelineId,
      status: chosen.status,
      accountId: chosen.accountId,
      locationId: chosen.locationId,
      address: chosen.address!,
      latitude: chosen.latitude,
      longitude: chosen.longitude,
      approvedContractValueCents: chosen.approvedContractValueCents,
      pipelineStage: chosen.pipelineStage,
      realizedRevenueCents: chosen.realizedRevenueCents,
      lossReason: chosen.lossReason,
    });
  }
  return bound.sort((a, b) => a.missionId - b.missionId);
}

/** Ordering used only to pick the most-advanced mission per building. */
export function rankStatus(status: CommercialMissionStatus): number {
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

/**
 * Group bound missions onto canonical buildings by real address. The
 * most-advanced mission wins a building, so a won account is never hidden
 * behind an unrelated candidate at the same address.
 */
export function resolveMissionsToBuildings(bound: readonly BoundMission[]): {
  byCanonicalId: Map<string, BoundMission>;
  disagreements: RegistryDisagreement[];
} {
  const byCanonicalId = new Map<string, BoundMission>();
  const disagreements: RegistryDisagreement[] = [];
  for (const mission of bound) {
    const resolved = resolveCanonicalBuilding(mission.address);
    if (resolved.agreement === "none") continue;
    if (
      resolved.agreement === "conflict" ||
      resolved.agreement === "tower_only"
    ) {
      disagreements.push({
        address: mission.address,
        agreement: resolved.agreement,
        missionId: mission.missionId,
      });
    }
    const canonicalId =
      resolved.config?.id ?? resolved.tower?.propertyGroup ?? null;
    if (!canonicalId) continue;
    const existing = byCanonicalId.get(canonicalId);
    if (!existing || rankStatus(mission.status) > rankStatus(existing.status)) {
      byCanonicalId.set(canonicalId, mission);
    }
  }
  return { byCanonicalId, disagreements };
}

/**
 * The existing authority rule for a contract value, replicated exactly rather
 * than reinvented: a value is only "verified" when the mission is won AND the
 * pipeline record independently agrees it is won. See
 * driverGameWorldService.ts, which is the origin of this rule.
 *
 * `commercial_opportunities.estimatedAnnualValueCents` is deliberately NOT
 * used here — it is an estimate with its own confidence grade, and feeding it
 * into a field named "verified" would be exactly the effort-to-outcome
 * upgrade the impact ladder exists to prevent.
 */
export function verifiedAnnualValue(input: {
  missionStatus: CommercialMissionStatus;
  pipelineStage: string | null;
  approvedContractValueCents: number | null;
}): number | null {
  if (input.missionStatus !== "won") return null;
  if (input.pipelineStage !== "won") return null;
  return input.approvedContractValueCents ?? null;
}

/* ── Loading ────────────────────────────────────────────────────────────── */

/**
 * Dated restoration evidence per building slug.
 *
 * The date MUST be `actualEventTimestamp` — when the pickup actually happened.
 * The order row cannot supply it: `orders` retains no collection timestamp, and
 * `updatedAt` moves on every later write, so for an order now `delivered` it is
 * delivery time. Healing a scar from a delivery timestamp would place the
 * repair later than the real collection, which is the direction that wrongly
 * closes a wound.
 *
 * Only `eventStatus: "completed"` rows count. A corrected or voided audit row
 * is a retraction, and a retracted pickup is not evidence a building recovered.
 *
 * Orders proven collected but carrying no such event are simply absent here and
 * therefore earn no healing — see `datedCollectedOrders` for why regeneration
 * diverges from strongholdRestoration on that point.
 */
async function loadDatedPickupEvidence(
  tenantId: string
): Promise<Map<string, DatedPickupRow[]>> {
  const db = await getDb();
  if (!db) return new Map();
  try {
    const rows = await db
      .select({
        buildingSlug: operationsEvents.buildingSlug,
        orderId: operationsEvents.orderId,
        sourceEventType: operationsEvents.sourceEventType,
        actualEventTimestamp: operationsEvents.actualEventTimestamp,
        orderStatus: orders.status,
      })
      .from(operationsEvents)
      .innerJoin(orders, eq(orders.id, operationsEvents.orderId))
      .where(
        and(
          eq(operationsEvents.tenantId, tenantId),
          eq(operationsEvents.sourceEventType, "pickup_completed"),
          eq(operationsEvents.eventStatus, "completed")
        )
      );
    const bySlug = new Map<string, DatedPickupRow[]>();
    for (const row of rows) {
      if (!row.buildingSlug || row.orderId == null) continue;
      const list = bySlug.get(row.buildingSlug) ?? [];
      list.push({
        orderId: row.orderId,
        orderStatus: row.orderStatus,
        actualEventTimestamp: row.actualEventTimestamp.toISOString(),
      });
      bySlug.set(row.buildingSlug, list);
    }
    return bySlug;
  } catch {
    // A missing audit table means no dated evidence, which means no healing.
    // It must never mean "assume recovered".
    return new Map();
  }
}

async function loadMissionLocationRows(
  tenantId: string
): Promise<MissionLocationRow[]> {
  const db = await getDb();
  if (!db) return [];
  try {
    return (await db
      .select({
        missionId: commercialMissions.id,
        pipelineId: commercialPipelineRecords.id,
        status: commercialMissions.status,
        opportunityId: commercialMissions.opportunityId,
        accountId: commercialOpportunities.accountId,
        locationId: commercialAccountLocations.id,
        locationAccountId: commercialAccountLocations.accountId,
        address: commercialAccountLocations.address,
        latitude: commercialAccountLocations.latitude,
        longitude: commercialAccountLocations.longitude,
        isPrimary: commercialAccountLocations.isPrimary,
        approvedContractValueCents:
          commercialPipelineRecords.approvedContractValueCents,
        pipelineStage: commercialPipelineRecords.stage,
        realizedRevenueCents: commercialPipelineRecords.realizedRevenueCents,
        lossReason: commercialPipelineRecords.lossReason,
      })
      .from(commercialMissions)
      // Ownership, not tenancy: the mission's own opportunity names the account.
      .innerJoin(
        commercialOpportunities,
        and(
          eq(commercialOpportunities.id, commercialMissions.opportunityId),
          eq(commercialOpportunities.tenantId, commercialMissions.tenantId)
        )
      )
      // Only that account's locations. All of them — the deterministic primary
      // rule is applied in `bindMissionsToLocations`, where it is testable.
      .innerJoin(
        commercialAccountLocations,
        and(
          eq(
            commercialAccountLocations.accountId,
            commercialOpportunities.accountId
          ),
          eq(
            commercialAccountLocations.tenantId,
            commercialOpportunities.tenantId
          )
        )
      )
      .leftJoin(
        commercialPipelineRecords,
        and(
          eq(commercialPipelineRecords.missionId, commercialMissions.id),
          eq(commercialPipelineRecords.tenantId, commercialMissions.tenantId)
        )
      )
      .where(
        eq(commercialMissions.tenantId, tenantId)
      )) as unknown as MissionLocationRow[];
  } catch {
    // Missing-table tolerance, matching the level4 pattern: the seam degrades
    // to "no missions" rather than taking down the admin surface.
    return [];
  }
}

function coordinateFrom(
  mission: BoundMission | undefined
): BuildingCoordinate | null {
  if (!mission?.latitude || !mission?.longitude) return null;
  const latitude = Number(mission.latitude);
  const longitude = Number(mission.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude, source: "provider_sourced" };
}

/** One dated, completed pickup joined to its order's current status. */
export type DatedPickupRow = {
  orderId: number;
  orderStatus: string;
  /** ISO instant of the real pickup. */
  actualEventTimestamp: string;
};

export async function getCanonicalBuildingWorld(input: {
  tenantId: string;
  now?: Date;
}): Promise<CanonicalBuildingWorld> {
  const [offensive, war, settled, rows, pickupEvidence] = await Promise.all([
    getLevel4OffensiveState(input.tenantId),
    getTowerWarsToday({ tenantId: input.tenantId, now: input.now }),
    getTowerWarsSettlement({ tenantId: input.tenantId, now: input.now }),
    loadMissionLocationRows(input.tenantId),
    loadDatedPickupEvidence(input.tenantId),
  ]);

  const missions = resolveMissionsToBuildings(bindMissionsToLocations(rows));
  const penetrationBySlug = new Map(
    offensive.buildingPenetration.map(block => [block.buildingSlug, block])
  );

  const buildings: CanonicalBuildingView[] = [];
  for (const config of BUILDINGS) {
    const block = penetrationBySlug.get(config.slug);
    const mission = missions.byCanonicalId.get(config.id);
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
      coordinate: coordinateFrom(mission),
      siege: mission
        ? {
            missionId: mission.missionId,
            missionStatus: mission.status,
            worldState: visualStateForBusinessStatus({
              missionStatus: mission.status,
            }),
            lossReason: mission.lossReason ?? null,
            verifiedAnnualValueCents: verifiedAnnualValue({
              missionStatus: mission.status,
              pipelineStage: mission.pipelineStage,
              approvedContractValueCents: mission.approvedContractValueCents,
            }),
            // The pipeline record's own realized revenue — NOT the building's
            // Tower Wars revenue, which is a different fact about a different
            // population (residents, not this commercial account).
            realizedRevenueCents: mission.realizedRevenueCents ?? 0,
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
            // Today's match only — a fresh, legible fight rather than the old
            // monotonic count that pinned both buildings at "critical" forever.
            todayDamage:
              settled.settlement.buildings[towerState.buildingId].today.damage,
            // Real settled history: attacks absorbed on every prior day.
            settledScars:
              settled.settlement.buildings[towerState.buildingId].settledScars,
          }
        : null,
    });
    if (!composed) continue;

    buildings.push({
      building: composed,
      pipelineId: mission?.pipelineId ?? null,
      continuity: traceBuildingContinuity(composed),
      unbroken: hasUnbrokenContinuity(composed),
      firstBroken: firstBrokenLink(composed),
    });
  }

  return {
    tenantId: input.tenantId,
    evidenceSufficient:
      offensive.dbAvailable &&
      war.evidenceSufficient &&
      settled.evidenceSufficient,
    buildings,
    registryDisagreements: missions.disagreements,
    /**
     * Per-building strata, oldest first. Exposed so a consumer can render a
     * facade's permanent architectural record without recomputing it, and so
     * "how much has this building been through" is answerable without reaching
     * for the old monotonic counter.
     */
    settlement: settled.settlement,
    /**
     * Dated, completed pickups per building slug. Consumers pair these with
     * `settlement`'s strata to decide how far a facade has been REPAIRED —
     * which requires knowing when the collection happened, not merely that it
     * did. See client `facadeRegeneration.ts`.
     */
    restorationEvidence: Object.fromEntries(pickupEvidence),
  };
}
