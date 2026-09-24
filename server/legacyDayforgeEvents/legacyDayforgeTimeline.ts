/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { and, desc, eq, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import {
  commercialMissions,
  commercialOpportunities,
  legacyLegacyDayforgeAuditEvents,
} from "../../drizzle/schema";
import { getDb } from "../db";

export type LegacyDayforgeTimelineCursor = {
  createdAt: Date;
  id: number;
};

export type LegacyDayforgeTimelineFilter = {
  missionId?: number;
  accountId?: number;
  correlationId?: string;
};

function cursorPredicate(cursor: LegacyDayforgeTimelineCursor): SQL {
  return or(
    lt(legacyLegacyDayforgeAuditEvents.createdAt, cursor.createdAt),
    and(
      eq(legacyLegacyDayforgeAuditEvents.createdAt, cursor.createdAt),
      lt(legacyLegacyDayforgeAuditEvents.id, cursor.id)
    )
  )!;
}

function relatedIdPredicate(
  key: "missionId" | "accountId",
  ids: number[]
): SQL {
  const stringIds = ids.map(String);
  const path = key === "missionId" ? "$.missionId" : "$.accountId";
  return or(
    inArray(
      sql<string>`JSON_UNQUOTE(JSON_EXTRACT(${legacyLegacyDayforgeAuditEvents.beforeJson}, ${path}))`,
      stringIds
    ),
    inArray(
      sql<string>`JSON_UNQUOTE(JSON_EXTRACT(${legacyLegacyDayforgeAuditEvents.afterJson}, ${path}))`,
      stringIds
    )
  )!;
}

async function missionIdsForAccount(input: {
  tenantId: string;
  accountId: number;
}): Promise<number[]> {
  const db = await getDb();
  if (!db) return [];
  const opportunities = await db
    .select({ id: commercialOpportunities.id })
    .from(commercialOpportunities)
    .where(
      and(
        eq(commercialOpportunities.tenantId, input.tenantId),
        eq(commercialOpportunities.accountId, input.accountId)
      )
    );
  if (opportunities.length === 0) return [];
  const missions = await db
    .select({ id: commercialMissions.id })
    .from(commercialMissions)
    .where(
      and(
        eq(commercialMissions.tenantId, input.tenantId),
        inArray(
          commercialMissions.opportunityId,
          opportunities.map(opportunity => opportunity.id)
        )
      )
    );
  return missions.map(mission => mission.id);
}

/**
 * Reads the immutable cross-domain projection. Domain event tables remain the
 * source of truth for their state machines; this is the tenant-scoped history
 * used to correlate a journey across those domains.
 */
export async function listLegacyDayforgeTimeline(input: {
  tenantId: string;
  filter?: LegacyDayforgeTimelineFilter;
  cursor?: LegacyDayforgeTimelineCursor;
  limit?: number;
}) {
  const db = await getDb();
  if (!db) return { items: [], nextCursor: null };

  const limit = Math.min(Math.max(input.limit ?? 100, 1), 250);
  const predicates: SQL[] = [eq(legacyLegacyDayforgeAuditEvents.tenantId, input.tenantId)];
  const filter = input.filter;

  if (filter?.missionId !== undefined) {
    predicates.push(
      or(
        and(
          eq(legacyLegacyDayforgeAuditEvents.entityType, "commercial_mission"),
          eq(legacyLegacyDayforgeAuditEvents.entityId, String(filter.missionId))
        ),
        relatedIdPredicate("missionId", [filter.missionId])
      )!
    );
  }

  if (filter?.accountId !== undefined) {
    const missionIds = await missionIdsForAccount({
      tenantId: input.tenantId,
      accountId: filter.accountId,
    });
    const accountPredicate = and(
      eq(legacyLegacyDayforgeAuditEvents.entityType, "commercial_account"),
      eq(legacyLegacyDayforgeAuditEvents.entityId, String(filter.accountId))
    )!;
    predicates.push(
      missionIds.length === 0
        ? or(
            accountPredicate,
            relatedIdPredicate("accountId", [filter.accountId])
          )!
        : or(
            accountPredicate,
            relatedIdPredicate("accountId", [filter.accountId]),
            and(
              eq(legacyLegacyDayforgeAuditEvents.entityType, "commercial_mission"),
              inArray(legacyLegacyDayforgeAuditEvents.entityId, missionIds.map(String))
            ),
            relatedIdPredicate("missionId", missionIds)
          )!
    );
  }

  if (filter?.correlationId) {
    predicates.push(
      eq(legacyLegacyDayforgeAuditEvents.correlationId, filter.correlationId)
    );
  }
  if (input.cursor) predicates.push(cursorPredicate(input.cursor));

  const rows = await db
    .select()
    .from(legacyLegacyDayforgeAuditEvents)
    .where(and(...predicates))
    .orderBy(desc(legacyLegacyDayforgeAuditEvents.createdAt), desc(legacyLegacyDayforgeAuditEvents.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const tail = items.at(-1);

  return {
    items: items.map(row => ({
      id: row.id,
      actorType: row.actorType,
      actorId: row.actorId,
      entityType: row.entityType,
      entityId: row.entityId,
      eventName: row.eventName,
      before: row.beforeJson,
      after: row.afterJson,
      source: row.source,
      correlationId: row.correlationId,
      createdAt: row.createdAt.toISOString(),
    })),
    nextCursor:
      hasMore && tail
        ? { createdAt: tail.createdAt.toISOString(), id: tail.id }
        : null,
  };
}
