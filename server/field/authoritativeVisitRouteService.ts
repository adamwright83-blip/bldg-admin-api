import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, like } from "drizzle-orm";
import {
  commercialMissionEvents,
  commercialMissions,
  commercialVisitOutcomes,
  dayforgeSaasTenants,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { isMysqlDuplicateKeyError } from "../mysqlErrors";
import { activateCommercialMissionForField } from "../commercialMissions/commercialMissionActivationService";
import { getCommercialMission } from "../commercialMissions/commercialMissionStore";
import { getFieldMoves } from "./fieldOpportunityService";
import type {
  AuthoritativeVisitRouteProjection,
  AuthoritativeVisitRouteStop,
  FieldMoveCandidate,
} from "./types";

const START_EVENT = "goldline_visit_route_started";
const MEMBER_EVENT = "goldline_visit_route_member";
const DAILY_GUARD_EVENT = "goldline_visit_route_daily_guard";

type RouteStartMetadata = {
  occurrenceId: string;
  businessDate: string;
  missionIds: number[];
  stopCount: number;
  requestId: string;
};

type RouteMemberMetadata = {
  occurrenceId: string;
  businessDate: string;
  missionId: number;
  moveId: string;
  accountName: string;
  position: number;
  requiresDriving: boolean;
  moveType: "nearby_commercial_visit";
};

function businessDate(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function isStartMetadata(value: unknown): value is RouteStartMetadata {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<RouteStartMetadata>;
  return (
    typeof candidate.occurrenceId === "string" &&
    typeof candidate.businessDate === "string" &&
    Array.isArray(candidate.missionIds) &&
    candidate.missionIds.every(Number.isInteger) &&
    candidate.missionIds.length >= 2 &&
    candidate.stopCount === candidate.missionIds.length
  );
}

function isMemberMetadata(value: unknown): value is RouteMemberMetadata {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<RouteMemberMetadata>;
  return (
    typeof candidate.occurrenceId === "string" &&
    typeof candidate.businessDate === "string" &&
    Number.isInteger(candidate.missionId) &&
    typeof candidate.moveId === "string" &&
    typeof candidate.accountName === "string" &&
    Number.isInteger(candidate.position) &&
    typeof candidate.requiresDriving === "boolean" &&
    candidate.moveType === "nearby_commercial_visit"
  );
}

export function projectAuthoritativeVisitRoute(input: {
  occurrenceId: string;
  businessDate: string;
  startedAt: Date;
  members: RouteMemberMetadata[];
  outcomes: Array<{ id: number; missionId: number; recordedBy: string }>;
  actorId: string;
}): AuthoritativeVisitRouteProjection {
  const outcomeByMission = new Map(
    input.outcomes
      .filter(outcome => outcome.recordedBy === input.actorId)
      .map(outcome => [outcome.missionId, outcome.id])
  );
  const stops: AuthoritativeVisitRouteStop[] = input.members
    .filter(member => member.occurrenceId === input.occurrenceId)
    .sort((left, right) => left.position - right.position)
    .map(member => {
      const visitOutcomeId = outcomeByMission.get(member.missionId) ?? null;
      return {
        missionId: member.missionId,
        moveId: member.moveId,
        accountName: member.accountName,
        // Retained as a real, working route — no longer the primary way to
        // act on a NEUTRALIZE stop (see GoldlineGameHome.tsx's in-game
        // onSelectRouteStop), but still valid for any other legitimate
        // consumer of this projection.
        destinationPath: `/driver/sales-mission/${member.missionId}`,
        position: member.position,
        requiresDriving: member.requiresDriving,
        evidenced: visitOutcomeId !== null,
        visitOutcomeId,
        // Populated by `enrichStopsWithLocation` in the DB-backed callers
        // below; left null here so this pure projection function stays
        // testable with no database access.
        address: null,
        navigationUrl: null,
      };
    });
  return {
    occurrenceId: input.occurrenceId,
    businessDate: input.businessDate,
    startedAt: input.startedAt.toISOString(),
    totalStops: stops.length,
    coveredCount: stops.filter(stop => stop.evidenced).length,
    stops,
  };
}

export function selectEligibleVisitRouteStops(input: {
  missionIds: number[];
  recommendedMoves: FieldMoveCandidate[];
}): FieldMoveCandidate[] {
  const uniqueMissionIds = Array.from(new Set(input.missionIds));
  if (
    uniqueMissionIds.length < 2 ||
    uniqueMissionIds.length > 3 ||
    uniqueMissionIds.length !== input.missionIds.length
  ) {
    throw new Error("A visit route requires two or three distinct stops");
  }
  const byMissionId = new Map(
    input.recommendedMoves
      .filter(
        move =>
          move.moveType === "nearby_commercial_visit" && move.missionId !== null
      )
      .map(move => [move.missionId!, move])
  );
  const selected = uniqueMissionIds.map(missionId =>
    byMissionId.get(missionId)
  );
  if (selected.some(move => !move)) {
    throw new Error(
      "Every route stop must be a current eligible visit recommendation"
    );
  }
  return selected as FieldMoveCandidate[];
}

async function tenantBusinessDate(input: {
  tenantId: string;
  now: Date;
}): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [tenant] = await db
    .select({ timeZone: dayforgeSaasTenants.timeZone })
    .from(dayforgeSaasTenants)
    .where(eq(dayforgeSaasTenants.id, input.tenantId))
    .limit(1);
  return businessDate(input.now, tenant?.timeZone ?? "America/Los_Angeles");
}

async function routeProjectionForStart(input: {
  tenantId: string;
  actorId: string;
  start: { metadataJson: unknown; createdAt: Date };
}): Promise<AuthoritativeVisitRouteProjection | null> {
  if (!isStartMetadata(input.start.metadataJson)) return null;
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const metadata = input.start.metadataJson;
  const [memberRows, outcomeRows, missionRows] = await Promise.all([
    db
      .select({ metadataJson: commercialMissionEvents.metadataJson })
      .from(commercialMissionEvents)
      .where(
        and(
          eq(commercialMissionEvents.tenantId, input.tenantId),
          eq(commercialMissionEvents.actorId, input.actorId),
          eq(commercialMissionEvents.eventName, MEMBER_EVENT),
          like(
            commercialMissionEvents.idempotencyKey,
            `goldline-route-member:${metadata.occurrenceId}:%`
          )
        )
      ),
    db
      .select({
        id: commercialVisitOutcomes.id,
        missionId: commercialVisitOutcomes.missionId,
        recordedBy: commercialVisitOutcomes.recordedBy,
      })
      .from(commercialVisitOutcomes)
      .where(
        and(
          eq(commercialVisitOutcomes.tenantId, input.tenantId),
          inArray(commercialVisitOutcomes.missionId, metadata.missionIds)
        )
      ),
    db
      .select({ id: commercialMissions.id })
      .from(commercialMissions)
      .where(
        and(
          eq(commercialMissions.tenantId, input.tenantId),
          eq(commercialMissions.assignedTo, input.actorId),
          inArray(commercialMissions.id, metadata.missionIds)
        )
      ),
  ]);
  const ownedMissionIds = new Set(missionRows.map(row => row.id));
  const members = memberRows
    .map(row => row.metadataJson)
    .filter(isMemberMetadata)
    .filter(member => ownedMissionIds.has(member.missionId));
  // A later authoritative reassignment/removal shrinks the route. It never
  // allows a replacement recommendation to enter this occurrence.
  const projection = projectAuthoritativeVisitRoute({
    occurrenceId: metadata.occurrenceId,
    businessDate: metadata.businessDate,
    startedAt: input.start.createdAt,
    members,
    outcomes: outcomeRows,
    actorId: input.actorId,
  });
  return {
    ...projection,
    stops: await enrichStopsWithLocation(input.tenantId, projection.stops),
  };
}

/**
 * Attaches each stop's real account address/maps link, read fresh from the
 * same authoritative `commercialMissions`/`commercialAccounts` source every
 * other Goldline surface uses (`getCommercialMission`). This is
 * presentation enrichment of an already-authoritative projection, not a
 * second truth source — nothing here is written back, and a stop whose
 * account genuinely has no address on file stays truthfully `null` rather
 * than inventing one.
 */
export async function enrichStopsWithLocation<
  T extends { missionId: number; requiresDriving: boolean },
>(
  tenantId: string,
  stops: T[]
): Promise<Array<T & { address: string | null; navigationUrl: string | null }>> {
  return Promise.all(
    stops.map(async stop => {
      const mission = await getCommercialMission({
        tenantId,
        missionId: stop.missionId,
      });
      const address = mission?.account.address?.trim() || null;
      const navigationUrl = address
        ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`
        : null;
      return { ...stop, address, navigationUrl };
    })
  );
}

export async function getAuthoritativeVisitRoute(input: {
  tenantId: string;
  actorId: string;
  now?: Date;
}): Promise<AuthoritativeVisitRouteProjection | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const date = await tenantBusinessDate({
    tenantId: input.tenantId,
    now: input.now ?? new Date(),
  });
  const starts = await db
    .select({
      metadataJson: commercialMissionEvents.metadataJson,
      createdAt: commercialMissionEvents.createdAt,
    })
    .from(commercialMissionEvents)
    .where(
      and(
        eq(commercialMissionEvents.tenantId, input.tenantId),
        eq(commercialMissionEvents.actorId, input.actorId),
        eq(commercialMissionEvents.eventName, START_EVENT)
      )
    )
    .orderBy(desc(commercialMissionEvents.createdAt))
    .limit(30);
  const start = starts.find(row => {
    const metadata = row.metadataJson;
    return isStartMetadata(metadata) && metadata.businessDate === date;
  });
  return start ? routeProjectionForStart({ ...input, start }) : null;
}

export async function startAuthoritativeVisitRoute(input: {
  tenantId: string;
  actorId: string;
  requestId: string;
  missionIds: number[];
  currentLocation?: { latitude: number; longitude: number } | null;
  nextCommitmentAt?: Date | null;
  now?: Date;
}): Promise<AuthoritativeVisitRouteProjection> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const now = input.now ?? new Date();
  const date = await tenantBusinessDate({ tenantId: input.tenantId, now });
  const requestKey = `goldline-route-request:${input.requestId}`;
  const dailyStartKey = `goldline-route-day:${input.actorId}:${date}`;
  const existingRequest = await db
    .select({
      metadataJson: commercialMissionEvents.metadataJson,
      createdAt: commercialMissionEvents.createdAt,
    })
    .from(commercialMissionEvents)
    .where(
      and(
        eq(commercialMissionEvents.tenantId, input.tenantId),
        eq(commercialMissionEvents.idempotencyKey, requestKey)
      )
    )
    .limit(1);
  if (existingRequest[0]) {
    const replay = await routeProjectionForStart({
      tenantId: input.tenantId,
      actorId: input.actorId,
      start: existingRequest[0],
    });
    if (!replay) throw new Error("Visit route replay is invalid");
    const metadata = existingRequest[0].metadataJson;
    if (!isStartMetadata(metadata))
      throw new Error("Visit route replay is invalid");
    if (
      metadata.requestId === input.requestId &&
      metadata.missionIds.join(",") !== input.missionIds.join(",")
    ) {
      throw new Error("Route start request is bound to another stop set");
    }
    return replay;
  }
  const active = await getAuthoritativeVisitRoute(input);
  if (active) return active;

  const suggested = await getFieldMoves({
    tenantId: input.tenantId,
    userId: input.actorId,
    now: input.now,
    currentLocation: input.currentLocation,
    nextCommitmentAt: input.nextCommitmentAt,
  });
  const selected = selectEligibleVisitRouteStops({
    missionIds: input.missionIds,
    recommendedMoves: suggested.recommendedMoves,
  });
  const uniqueMissionIds = selected.map(move => move.missionId!);

  // Route start is the explicit real operator action that claims these
  // suggestions. Assignment is authoritative and idempotent; the fiction
  // panel itself never performs this mutation.
  for (const move of selected) {
    await activateCommercialMissionForField({
      tenantId: input.tenantId,
      missionId: move!.missionId!,
      expectedVersion: move!.missionVersion!,
      assignedTo: input.actorId,
      actorId: input.actorId,
      requestId: `${input.requestId}:mission:${move!.missionId}`,
    });
  }

  const occurrenceId = randomUUID();
  const startMetadata: RouteStartMetadata = {
    occurrenceId,
    businessDate: date,
    missionIds: uniqueMissionIds,
    stopCount: uniqueMissionIds.length,
    requestId: input.requestId,
  };
  let lostDailyStartRace = false;
  try {
    await db.transaction(async tx => {
      await tx.insert(commercialMissionEvents).values({
        tenantId: input.tenantId,
        missionId: uniqueMissionIds[0]!,
        eventName: DAILY_GUARD_EVENT,
        fromStatus: null,
        toStatus: null,
        actorType: "driver",
        actorId: input.actorId,
        idempotencyKey: dailyStartKey,
        metadataJson: startMetadata,
      });
      await tx.insert(commercialMissionEvents).values({
        tenantId: input.tenantId,
        missionId: uniqueMissionIds[0]!,
        eventName: START_EVENT,
        fromStatus: null,
        toStatus: null,
        actorType: "driver",
        actorId: input.actorId,
        idempotencyKey: requestKey,
        metadataJson: startMetadata,
      });
      await tx.insert(commercialMissionEvents).values(
        selected.map((move, position) => ({
          tenantId: input.tenantId,
          missionId: move!.missionId!,
          eventName: MEMBER_EVENT,
          fromStatus: null,
          toStatus: null,
          actorType: "driver" as const,
          actorId: input.actorId,
          idempotencyKey: `goldline-route-member:${occurrenceId}:${move!.missionId}`,
          metadataJson: {
            occurrenceId,
            businessDate: date,
            missionId: move!.missionId!,
            moveId: move!.id,
            accountName: move!.target.name,
            position,
            requiresDriving: true,
            moveType: "nearby_commercial_visit",
          } satisfies RouteMemberMetadata,
        }))
      );
    });
  } catch (error) {
    if (!isMysqlDuplicateKeyError(error)) throw error;
    lostDailyStartRace = true;
  }
  if (lostDailyStartRace) {
    const dailyGuard = await db
      .select({
        metadataJson: commercialMissionEvents.metadataJson,
        createdAt: commercialMissionEvents.createdAt,
      })
      .from(commercialMissionEvents)
      .where(
        and(
          eq(commercialMissionEvents.tenantId, input.tenantId),
          eq(commercialMissionEvents.idempotencyKey, dailyStartKey)
        )
      )
      .limit(1);
    if (dailyGuard[0]) {
      const replay = await routeProjectionForStart({
        tenantId: input.tenantId,
        actorId: input.actorId,
        start: dailyGuard[0],
      });
      if (replay) return replay;
    }
  }
  const projection = await getAuthoritativeVisitRoute(input);
  if (
    !projection ||
    (!lostDailyStartRace && projection.occurrenceId !== occurrenceId)
  ) {
    throw new Error("Authoritative visit route was not persisted");
  }
  return projection;
}
