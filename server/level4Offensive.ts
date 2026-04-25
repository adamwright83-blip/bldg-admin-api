import { and, desc, eq, gte, isNotNull, lt, sql } from "drizzle-orm";
import { adminActionLog, bldgUsers, orders } from "../drizzle/schema";
import { getDb } from "./db";
import { BUILDINGS } from "@shared/buildings";
import { getDashboardBusinessDayBoundsUtc } from "./revenueIntervention";

export type BuildingPenetrationBlock = {
  block: "building_penetration";
  buildingSlug: string;
  buildingName: string;
  /** Distinct bldg_users rows whose buildingSlug is in this building's slugAliases (signups). */
  convertedUsers: number;
  /** Distinct bldg_users with at least one paid order, where the user's buildingSlug is in this building's slugAliases. */
  convertedPaidUsers: number;
  total: number;
  unconverted: number;
  /** Penetration based on signups (`convertedUsers` / `total`). */
  penetrationPct: number;
  /** Penetration based on paid users (`convertedPaidUsers` / `total`). */
  paidPenetrationPct: number;
  provisional: boolean;
  /** Slug aliases that contributed to convertedUsers / convertedPaidUsers — useful for UI debug. */
  slugAliases: string[];
  lastTouchAt: Date | null;
  daysSinceLastTouch: number | null;
};

export type ReferralRequestBlock = {
  block: "referral_request";
  userId: number;
  firstName: string;
  lastInitial: string;
  orderCount: number;
  ltvCents: number;
} | {
  block: "referral_request";
  candidate: null;
};

export type MarketHoleBlock = {
  block: "market_hole";
  status: "stubbed_for_v1";
};

export type Level4OffensiveState = {
  dbAvailable: boolean;
  buildingPenetration: BuildingPenetrationBlock[];
  referralRequest: ReferralRequestBlock;
  marketHole: MarketHoleBlock;
};

const REFERRAL_REQUEST_ACTION = "referral_request" as const;
const REFERRAL_THRESHOLD_ORDERS = 3;

export async function getLevel4OffensiveState(
  tenantId: string
): Promise<Level4OffensiveState> {
  const db = await getDb();
  if (!db) {
    return {
      dbAvailable: false,
      buildingPenetration: [],
      referralRequest: { block: "referral_request", candidate: null },
      marketHole: { block: "market_hole", status: "stubbed_for_v1" },
    };
  }

  const buildingPenetration = await loadBuildingPenetration(db, tenantId);
  const referralRequest = await loadReferralRequest(db, tenantId);

  return {
    dbAvailable: true,
    buildingPenetration,
    referralRequest,
    marketHole: { block: "market_hole", status: "stubbed_for_v1" },
  };
}

async function loadBuildingPenetration(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  tenantId: string
): Promise<BuildingPenetrationBlock[]> {
  const signupRows = await db
    .select({
      buildingSlug: bldgUsers.buildingSlug,
      converted: sql<number>`COUNT(*)`,
    })
    .from(bldgUsers)
    .where(isNotNull(bldgUsers.buildingSlug))
    .groupBy(bldgUsers.buildingSlug);

  const signupCountsByAlias = new Map<string, number>();
  for (const r of signupRows) {
    if (!r.buildingSlug) continue;
    signupCountsByAlias.set(r.buildingSlug, Number(r.converted ?? 0));
  }

  // Paid users grouped by the *user's* home building slug (bldg_users.buildingSlug).
  // Admin-created orders typically have bldgUserId=NULL, and resident-linked orders
  // typically have orders.buildingSlug=NULL, so the only reliable join key is
  // bldgUserId → bldg_users.buildingSlug.
  const paidRows = await db
    .select({
      buildingSlug: bldgUsers.buildingSlug,
      paidUsers: sql<number>`COUNT(DISTINCT ${orders.bldgUserId})`,
    })
    .from(orders)
    .innerJoin(bldgUsers, eq(orders.bldgUserId, bldgUsers.id))
    .where(
      and(
        eq(orders.tenantId, tenantId),
        eq(orders.paid, true),
        isNotNull(bldgUsers.buildingSlug)
      )
    )
    .groupBy(bldgUsers.buildingSlug);

  const paidUserCountsByAlias = new Map<string, number>();
  for (const r of paidRows) {
    if (!r.buildingSlug) continue;
    paidUserCountsByAlias.set(r.buildingSlug, Number(r.paidUsers ?? 0));
  }

  const touchRows = await db
    .select({
      entityId: adminActionLog.entityId,
      lastTouchAt: sql<Date>`MAX(${adminActionLog.createdAt})`,
    })
    .from(adminActionLog)
    .where(
      and(
        eq(adminActionLog.tenantId, tenantId),
        eq(adminActionLog.actionType, "building_penetration"),
        eq(adminActionLog.entityType, "building")
      )
    )
    .groupBy(adminActionLog.entityId);
  const lastTouchBySlug = new Map<string, Date>();
  for (const r of touchRows) {
    if (r.entityId && r.lastTouchAt) lastTouchBySlug.set(r.entityId, new Date(r.lastTouchAt));
  }
  const bounds = getDashboardBusinessDayBoundsUtc();
  const touchedToday = await db
    .select({ entityId: adminActionLog.entityId })
    .from(adminActionLog)
    .where(
      and(
        eq(adminActionLog.tenantId, tenantId),
        eq(adminActionLog.actionType, "building_penetration"),
        eq(adminActionLog.entityType, "building"),
        gte(adminActionLog.createdAt, bounds.startUtc),
        lt(adminActionLog.createdAt, bounds.endUtc)
      )
    );
  const touchedTodaySlugs = new Set(touchedToday.map((r) => r.entityId));

  return BUILDINGS.map((b) => {
    let convertedUsers = 0;
    let convertedPaidUsers = 0;
    for (const alias of b.slugAliases) {
      convertedUsers += signupCountsByAlias.get(alias) ?? 0;
      convertedPaidUsers += paidUserCountsByAlias.get(alias) ?? 0;
    }
    const total = b.total_units;
    const unconverted = Math.max(0, total - convertedUsers);
    const penetrationPct =
      total > 0 ? Math.round((convertedUsers / total) * 1000) / 10 : 0;
    const paidPenetrationPct =
      total > 0 ? Math.round((convertedPaidUsers / total) * 1000) / 10 : 0;
    const lastTouchAt = lastTouchBySlug.get(b.slug) ?? null;
    const daysSinceLastTouch = lastTouchAt
      ? Math.max(0, Math.floor((Date.now() - lastTouchAt.getTime()) / 86_400_000))
      : null;
    return {
      block: "building_penetration" as const,
      buildingSlug: b.slug,
      buildingName: b.name,
      convertedUsers,
      convertedPaidUsers,
      total,
      unconverted,
      penetrationPct,
      paidPenetrationPct,
      provisional: b.needsVerification === true,
      slugAliases: b.slugAliases,
      lastTouchAt,
      daysSinceLastTouch,
    };
  })
    .filter((b) => !touchedTodaySlugs.has(b.buildingSlug))
    .sort((a, b) => {
      // Future: add relationship warmth / promised intro metadata for Christopher-style targets.
      const aDays = a.daysSinceLastTouch ?? -1;
      const bDays = b.daysSinceLastTouch ?? -1;
      return (
        bDays - aDays ||
        b.unconverted - a.unconverted ||
        a.paidPenetrationPct - b.paidPenetrationPct ||
        b.total - a.total
      );
    });
}

async function loadReferralRequest(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  tenantId: string
): Promise<ReferralRequestBlock> {
  // Aggregate paid orders per bldgUserId for this tenant.
  const aggregateRows = await db
    .select({
      bldgUserId: orders.bldgUserId,
      orderCount: sql<number>`COUNT(*)`,
      ltvCents: sql<number>`COALESCE(SUM(ROUND(${orders.total} * 100)), 0)`,
    })
    .from(orders)
    .where(
      and(
        eq(orders.tenantId, tenantId),
        eq(orders.paid, true),
        isNotNull(orders.bldgUserId)
      )
    )
    .groupBy(orders.bldgUserId)
    .having(sql`COUNT(*) >= ${REFERRAL_THRESHOLD_ORDERS}`)
    .orderBy(desc(sql`COALESCE(SUM(ROUND(${orders.total} * 100)), 0)`));

  if (aggregateRows.length === 0) {
    return { block: "referral_request", candidate: null };
  }

  // Pull existing referral_request entityIds for this tenant once, then walk down list.
  const existingRows = await db
    .select({ entityId: adminActionLog.entityId })
    .from(adminActionLog)
    .where(
      and(
        eq(adminActionLog.tenantId, tenantId),
        eq(adminActionLog.actionType, REFERRAL_REQUEST_ACTION),
        eq(adminActionLog.entityType, "customer")
      )
    );
  const referralRequested = new Set(existingRows.map((r) => r.entityId));

  for (const row of aggregateRows) {
    if (row.bldgUserId == null) continue;
    if (referralRequested.has(String(row.bldgUserId))) continue;

    const [user] = await db
      .select({
        id: bldgUsers.id,
        firstName: bldgUsers.firstName,
        lastName: bldgUsers.lastName,
      })
      .from(bldgUsers)
      .where(eq(bldgUsers.id, row.bldgUserId))
      .limit(1);
    if (!user) continue;

    const firstName = user.firstName ?? "";
    const lastInitial = (user.lastName ?? "").trim().charAt(0).toUpperCase();
    return {
      block: "referral_request",
      userId: user.id,
      firstName,
      lastInitial,
      orderCount: Number(row.orderCount ?? 0),
      ltvCents: Number(row.ltvCents ?? 0),
    };
  }

  return { block: "referral_request", candidate: null };
}
