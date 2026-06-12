import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, like, lt, max, ne, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser, users,
  orders, InsertOrder, Order, operationsEvents,
  vendors, InsertVendor, Vendor,
  vendorUsers, InsertVendorUser, VendorUser,
  vendorServiceCoverage, InsertVendorServiceCoverage, VendorServiceCoverage,
  serviceRequests,
  leads, Lead, InsertLead,
  catalogItems, CatalogItem,
  agentEvents, InsertAgentEvent, AgentEvent,
  residentAgentPlans, InsertResidentAgentPlan, ResidentAgentPlan,
  residentCoordinatedRequests, InsertResidentCoordinatedRequest, ResidentCoordinatedRequest,
  operatorTasks, InsertOperatorTask, OperatorTask,
  tenantAiUsage, TenantAiUsage,
  vendorProfiles, InsertVendorProfile, VendorProfile,
  vendorServices, InsertVendorService, VendorService,
  vendorAvailabilityWindows, InsertVendorAvailabilityWindow, VendorAvailabilityWindow,
  vendorAdminConfigs, InsertVendorAdminConfig, VendorAdminConfig,
  vendorPeerServiceRequests, InsertVendorPeerServiceRequest, VendorPeerServiceRequest,
  vendorPricingRecommendations, InsertVendorPricingRecommendation, VendorPricingRecommendation,
  vendorDataExports, InsertVendorDataExport, VendorDataExport,
  vendorGuestBookingSessions, InsertVendorGuestBookingSession, VendorGuestBookingSession,
  vendorOnboardingSessions, InsertVendorOnboardingSession, VendorOnboardingSession,
  vendorOnboardingMessages, InsertVendorOnboardingMessage, VendorOnboardingMessage,
} from "../drizzle/schema";
import { ENV } from './_core/env';
import { matchBuilding } from "@shared/buildings";
import { resolveOrderLocationForInsert } from "./orderLocation";
import {
  buildAdminCustomerAggregatesInMemory,
  normalizeOrderRowFromDb,
  type AdminCustomerAggregateDbRow,
} from "./adminCustomerAggregate";
import {
  getDashboardTimeZone,
  zonedDayStartUtc,
  zonedMonthRangeUtcContaining,
  zonedNextDayYmd,
  zonedWeekRangeUtcContaining,
  zonedYmd,
} from "./dashboardZoned";
import {
  buildOperationEventForOrderStatusChange,
  buildPickupCompletedOperationsEventForOrder,
  type OperationsEventActorContext,
} from "./operationsEvents";
import { normalizePhoneForStorage, phoneDigits, sameNormalizedPhone } from "./phone";

export type { AdminCustomerAggregateDbRow };

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

/* ===== ORDER HELPERS ===== */

export async function createOrder(order: InsertOrder): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const resolved = resolveOrderLocationForInsert({
    address: order.address ?? "",
    buildingSlug: order.buildingSlug ?? null,
  });
  const values: InsertOrder = {
    ...order,
    address: resolved.address,
    buildingSlug: resolved.buildingSlug,
  };

  const result = await db.insert(orders).values(values);
  const insertId = Number(result[0].insertId);
  if (!resolved.buildingSlug) {
    console.warn("[ORDER WITHOUT BUILDING]", {
      orderId: insertId,
      address: resolved.address,
    });
  }
  return insertId;
}

const OPEN_ORDER_STATUSES: Order["status"][] = ["intake-pending", "new", "collected", "processing", "ready"];

function normalizeDuplicateText(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function duplicateRequestSignal(order: Pick<InsertOrder, "heldCleanedRequestText" | "heldRawRequestText" | "specialInstructions">) {
  return normalizeDuplicateText(
    order.heldCleanedRequestText ||
      order.heldRawRequestText ||
      order.specialInstructions ||
      ""
  ).slice(0, 160);
}

function sameDuplicateResident(left: InsertOrder, right: Order) {
  if (left.bldgUserId != null && right.bldgUserId != null) return left.bldgUserId === right.bldgUserId;
  const leftPhone = phoneDigits(left.phone);
  const rightPhone = phoneDigits(right.phone);
  if (!leftPhone || !rightPhone) return false;
  const normalizedLeft = leftPhone.length === 11 && leftPhone.startsWith("1") ? leftPhone.slice(1) : leftPhone;
  const normalizedRight = rightPhone.length === 11 && rightPhone.startsWith("1") ? rightPhone.slice(1) : rightPhone;
  return normalizedLeft === normalizedRight;
}

export async function findLikelyDuplicateOpenResidentOrder(order: InsertOrder): Promise<Order | undefined> {
  const db = await getDb();
  if (!db) return undefined;

  const candidates = await db
    .select()
    .from(orders)
    .where(and(
      eq(orders.tenantId, order.tenantId ?? "default"),
      inArray(orders.status, OPEN_ORDER_STATUSES),
      eq(orders.serviceType, order.serviceType),
      eq(orders.pickupDate, order.pickupDate),
      order.deliveryDate == null ? isNull(orders.deliveryDate) : eq(orders.deliveryDate, order.deliveryDate)
    ))
    .orderBy(desc(orders.createdAt), desc(orders.id))
    .limit(25);

  const incomingSignal = duplicateRequestSignal(order);
  return candidates.find((candidate) => {
    if (!sameDuplicateResident(order, candidate)) return false;
    if (normalizeDuplicateText(order.unit) !== normalizeDuplicateText(candidate.unit)) return false;
    if (normalizeDuplicateText(order.buildingSlug || order.address) !== normalizeDuplicateText(candidate.buildingSlug || candidate.address)) return false;
    const candidateSignal = duplicateRequestSignal(candidate);
    return incomingSignal ? incomingSignal === candidateSignal : candidateSignal === "";
  });
}

/** True for a MySQL duplicate-key violation (ER_DUP_ENTRY / errno 1062). */
function isDuplicateKeyError(err: unknown): boolean {
  const e = err as { code?: string; errno?: number; message?: string } | null | undefined;
  if (!e) return false;
  return (
    e.code === "ER_DUP_ENTRY" ||
    e.errno === 1062 ||
    /duplicate entry/i.test(e.message ?? "")
  );
}

/**
 * Resident-laundry idempotency lookup, keyed on the physical, UNIQUE-indexed
 * orders.residentClientRequestId column (NOT the heldMetadataJson mirror). The
 * resident app stamps one clientRequestId per "set it in motion" tap; a retry
 * carries the same key, so we resolve it back to the order already created.
 * The key is globally unique by construction, so no tenant scoping is needed.
 */
export async function findResidentOrderByClientRequestId(
  clientRequestId: string | null | undefined
): Promise<Order | undefined> {
  const db = await getDb();
  if (!db || !clientRequestId) return undefined;

  const rows = await db
    .select()
    .from(orders)
    .where(eq(orders.residentClientRequestId, clientRequestId))
    .orderBy(asc(orders.id))
    .limit(1);

  return rows[0];
}

/**
 * The single canonical, idempotent entry point for creating a resident
 * laundry / dry-clean order. Exact-once is DB-enforced by the UNIQUE index on
 * orders.residentClientRequestId — safe even under simultaneous retries:
 *   1. fast path — if we've already stored this clientRequestId, return it.
 *   2. composite open-order guard — fallback for keyless paths / lost keys.
 *   3. atomic insert — stamp residentClientRequestId; if a concurrent insert wins
 *      the unique key, we catch ER_DUP_ENTRY and resolve back to that order.
 * Returns { orderId, reused } so callers can log without changing user copy.
 * Use this instead of createOrder() for every resident-originated booking.
 */
export async function createOrReuseResidentLaundryOrder(
  order: InsertOrder,
  opts?: { clientRequestId?: string | null }
): Promise<{ orderId: number; reused: boolean }> {
  // Debugging mirror only — the physical column / opts are authoritative.
  const metadataKey =
    order.heldMetadataJson && typeof order.heldMetadataJson === "object" && !Array.isArray(order.heldMetadataJson)
      ? ((order.heldMetadataJson as Record<string, unknown>).clientRequestId as string | undefined)
      : undefined;
  const clientRequestId = opts?.clientRequestId ?? order.residentClientRequestId ?? metadataKey ?? null;

  // 1) Fast path: this key already produced an order.
  if (clientRequestId) {
    const existing = await findResidentOrderByClientRequestId(clientRequestId);
    if (existing) return { orderId: existing.id, reused: true };
  }

  // 2) Fallback duplicate guard (keyless paths, or a re-send that lost the key).
  const dupe = await findLikelyDuplicateOpenResidentOrder(order);
  if (dupe) return { orderId: dupe.id, reused: true };

  // 3) Atomic insert. The UNIQUE index on residentClientRequestId is the real
  //    exact-once guarantee: two simultaneous inserts can both pass the reads
  //    above, but only one wins the key — the loser gets ER_DUP_ENTRY and we
  //    resolve it back to the winning order instead of creating a duplicate.
  try {
    const orderId = await createOrder({ ...order, residentClientRequestId: clientRequestId ?? null });
    return { orderId, reused: false };
  } catch (err) {
    if (clientRequestId && isDuplicateKeyError(err)) {
      const raced = await findResidentOrderByClientRequestId(clientRequestId);
      if (raced) return { orderId: raced.id, reused: true };
    }
    throw err;
  }
}

/** Rows with no usable building slug (null, empty, or whitespace only). */
const missingBuildingSlugWhere = sql`(${orders.buildingSlug} IS NULL OR TRIM(COALESCE(${orders.buildingSlug}, '')) = '')`;

export async function countOrdersMissingBuildingSlug(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db
    .select({ c: sql<number>`count(*)` })
    .from(orders)
    .where(missingBuildingSlugWhere);
  return Number(rows[0]?.c ?? 0);
}

export type OrderBuildingBackfillRow = {
  id: number;
  address: string | null;
  buildingSlug: string | null;
};

/**
 * Keyset pagination for backfill: orders missing buildingSlug, id &gt; afterId.
 */
export async function listOrdersMissingBuildingSlugBatch(
  afterId: number,
  limit: number
): Promise<OrderBuildingBackfillRow[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      id: orders.id,
      address: orders.address,
      buildingSlug: orders.buildingSlug,
    })
    .from(orders)
    .where(and(gt(orders.id, afterId), missingBuildingSlugWhere))
    .orderBy(asc(orders.id))
    .limit(limit);
}

export async function updateOrderBuildingSlug(
  orderId: number,
  buildingSlug: string
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(orders).set({ buildingSlug }).where(eq(orders.id, orderId));
}

export async function updateOrderBuildingSlugForCustomer(input: {
  phone: string;
  buildingSlug: string;
  scope: "latest" | "all";
  latestOrderId?: number;
}): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const where =
    input.scope === "latest"
      ? and(eq(orders.phone, input.phone), eq(orders.id, input.latestOrderId ?? 0))
      : eq(orders.phone, input.phone);

  const result = await db
    .update(orders)
    .set({ buildingSlug: input.buildingSlug })
    .where(where);

  return Number(result[0]?.affectedRows ?? 0);
}

export async function getOrderById(id: number): Promise<Order | undefined> {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function updateOrderStripe(
  orderId: number,
  stripeCustomerId: string,
  stripePaymentMethodId: string
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(orders)
    .set({ stripeCustomerId, stripePaymentMethodId })
    .where(eq(orders.id, orderId));
}

/** PII for resident backfill — excludes Stripe and payment fields */
export type CustomerIdentityExportRow = {
  phone: string;
  firstName: string;
  lastName: string;
  buildingSlug: string | null;
  lastOrderId: number;
};

/**
 * Latest order per phone (by createdAt desc, then id desc). Names/slug come from that row.
 * buildingSlug: trimmed orders.buildingSlug if set, else matchBuilding(address)?.slug.
 */
export async function listLatestCustomerIdentityForExport(options?: {
  since?: Date;
}): Promise<CustomerIdentityExportRow[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const baseQuery = db
    .select({
      id: orders.id,
      phone: orders.phone,
      firstName: orders.firstName,
      lastName: orders.lastName,
      buildingSlug: orders.buildingSlug,
      address: orders.address,
      createdAt: orders.createdAt,
    })
    .from(orders);

  const rows = await (options?.since
    ? baseQuery.where(gte(orders.createdAt, options.since))
    : baseQuery
  ).orderBy(desc(orders.createdAt), desc(orders.id));

  const byPhone = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (!byPhone.has(row.phone)) {
      byPhone.set(row.phone, row);
    }
  }

  const sorted = Array.from(byPhone.values()).sort((a, b) =>
    a.phone.localeCompare(b.phone)
  );

  return sorted.map((row) => {
    const slugFromOrder = row.buildingSlug?.trim() || null;
    const slugFromAddress = matchBuilding(row.address)?.slug ?? null;
    return {
      phone: row.phone,
      firstName: row.firstName,
      lastName: row.lastName,
      buildingSlug: slugFromOrder || slugFromAddress,
      lastOrderId: row.id,
    };
  });
}

/** All orders for one phone (exact match), newest first */
export async function getOrdersByPhoneExact(phone: string): Promise<Order[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(orders)
    .where(eq(orders.phone, phone))
    .orderBy(desc(orders.createdAt), desc(orders.id));
}

/**
 * Admin customer aggregates by stable composite customer key.
 * Metrics use full order history per key; display fields use the best row (see adminCustomerAggregate.ts).
 */
export async function listAdminCustomerAggregates(): Promise<AdminCustomerAggregateDbRow[]> {
  const db = await getDb();
  if (!db) return [];

  const rows = await db
    .select({
      id: orders.id,
      phone: orders.phone,
      firstName: orders.firstName,
      lastName: orders.lastName,
      email: orders.email,
      unit: orders.unit,
      address: orders.address,
      buildingSlug: orders.buildingSlug,
      createdAt: orders.createdAt,
      paid: orders.paid,
      total: orders.total,
    })
    .from(orders);

  return buildAdminCustomerAggregatesInMemory(rows.map(normalizeOrderRowFromDb));
}

export type BuildingRevenueOrderRow = {
  buildingSlug: string | null;
  address: string;
  unit: string | null;
  total: string | null;
};

/** Paid orders for per-order building revenue attribution */
export async function listPaidOrdersForBuildingRevenue(): Promise<BuildingRevenueOrderRow[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select({
      buildingSlug: orders.buildingSlug,
      address: orders.address,
      unit: orders.unit,
      total: orders.total,
    })
    .from(orders)
    .where(eq(orders.paid, true));
}

export type AdminDashboardSummary = {
  /** Paid orders counted when `paidAt` falls in the window; rows with null `paidAt` use `updatedAt` (legacy). */
  revenueTimestampBasis: "paidAt";
  dashboardTimeZone: string;
  revenueToday: number;
  revenueWeek: number;
  revenueMonth: number;
  paidOrderCountMonth: number;
  avgOrderValueMonth: number | null;
  distinctBuildingsWithSlug: number;
  distinctCustomerPhones: number;
  totalOrders: number;
};

/**
 * Revenue attributed to when payment was recorded: `paidAt` in [start, end), or legacy rows with null `paidAt` use `updatedAt`.
 */
async function paidRevenueAndCountInPaidAtWindow(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  start: Date,
  end: Date
): Promise<{ revenue: number; count: number }> {
  const [row] = await db
    .select({
      revenue: sql<string>`COALESCE(SUM(CAST(${orders.total} AS DECIMAL(14,4))), 0)`,
      count: sql<number>`COUNT(*)`,
    })
    .from(orders)
    .where(
      and(
        eq(orders.paid, true),
        or(
          and(isNotNull(orders.paidAt), gte(orders.paidAt, start), lt(orders.paidAt, end)),
          and(isNull(orders.paidAt), gte(orders.updatedAt, start), lt(orders.updatedAt, end))
        )
      )
    );

  return {
    revenue: Number(row?.revenue ?? 0),
    count: Number(row?.count ?? 0),
  };
}

/**
 * Home dashboard metrics. Paid orders only; windows use payment time (`paidAt`) aligned with "Collected today".
 */
export async function getAdminDashboardSummary(): Promise<AdminDashboardSummary | null> {
  const db = await getDb();
  if (!db) return null;

  const tz = getDashboardTimeZone();
  const now = new Date();
  const todayYmd = zonedYmd(now, tz);
  const todayStart = zonedDayStartUtc(todayYmd, tz);
  const tomorrowYmd = zonedNextDayYmd(todayYmd, tz);
  const todayEnd = zonedDayStartUtc(tomorrowYmd, tz);
  const { start: weekStart, end: weekEnd } = zonedWeekRangeUtcContaining(now, tz);
  const { start: monthStart, end: monthEnd } = zonedMonthRangeUtcContaining(now, tz);

  const [todayAgg, weekAgg, monthAgg, buildingsRow, phonesRow, totalRow] = await Promise.all([
    paidRevenueAndCountInPaidAtWindow(db, todayStart, todayEnd),
    paidRevenueAndCountInPaidAtWindow(db, weekStart, weekEnd),
    paidRevenueAndCountInPaidAtWindow(db, monthStart, monthEnd),
    db
      .select({
        n: sql<number>`COUNT(DISTINCT ${orders.buildingSlug})`,
      })
      .from(orders)
      .where(and(sql`${orders.buildingSlug} IS NOT NULL`, sql`${orders.buildingSlug} != ''`)),
    db
      .select({
        n: sql<number>`COUNT(DISTINCT ${orders.phone})`,
      })
      .from(orders),
    db.select({ n: sql<number>`COUNT(*)` }).from(orders),
  ]);

  const paidOrderCountMonth = monthAgg.count;
  const avgOrderValueMonth =
    paidOrderCountMonth > 0 ? monthAgg.revenue / paidOrderCountMonth : null;

  return {
    revenueTimestampBasis: "paidAt",
    dashboardTimeZone: tz,
    revenueToday: todayAgg.revenue,
    revenueWeek: weekAgg.revenue,
    revenueMonth: monthAgg.revenue,
    paidOrderCountMonth,
    avgOrderValueMonth,
    distinctBuildingsWithSlug: Number(buildingsRow[0]?.n ?? 0),
    distinctCustomerPhones: Number(phonesRow[0]?.n ?? 0),
    totalOrders: Number(totalRow[0]?.n ?? 0),
  };
}

/* ===== ADMIN / DRIVER HELPERS ===== */

export async function getOrdersByStatus(
  status: Order["status"],
  vendorId?: number
): Promise<Order[]> {
  const db = await getDb();
  if (!db) return [];

  const where = vendorId != null
    ? and(eq(orders.status, status), eq(orders.vendorId, vendorId))
    : eq(orders.status, status);
  return db
    .select()
    .from(orders)
    .where(where)
    .orderBy(desc(orders.createdAt));
}

export async function getOrdersByVendorId(
  vendorId: number,
  status?: Order["status"]
): Promise<Order[]> {
  const db = await getDb();
  if (!db) return [];

  const where = status != null
    ? and(eq(orders.vendorId, vendorId), eq(orders.status, status))
    : eq(orders.vendorId, vendorId);
  return db
    .select()
    .from(orders)
    .where(where)
    .orderBy(desc(orders.createdAt));
}

export async function getOrdersByDateAndStatus(
  date: string,
  status: Order["status"],
  dateField: "pickupDate" | "deliveryDate" = "pickupDate",
  vendorId?: number
): Promise<Order[]> {
  const db = await getDb();
  if (!db) return [];

  const col = dateField === "deliveryDate" ? orders.deliveryDate : orders.pickupDate;
  const conditions = [eq(col, date), eq(orders.status, status)];
  if (vendorId != null) conditions.push(eq(orders.vendorId, vendorId));
  return db
    .select()
    .from(orders)
    .where(and(...conditions))
    .orderBy(desc(orders.createdAt));
}

export async function updateOrderStatus(
  orderId: number,
  status: Order["status"],
  actor?: OperationsEventActorContext
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.transaction(async (tx) => {
    const existing = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    const previousOrder = existing[0];
    await tx.update(orders).set({ status }).where(eq(orders.id, orderId));
    if (!previousOrder) return;

    const event = buildOperationEventForOrderStatusChange({
      order: previousOrder,
      previousStatus: previousOrder.status,
      nextStatus: status,
      actor,
    });
    if (!event) return;

    const existingEvent = await tx
      .select({ id: operationsEvents.id })
      .from(operationsEvents)
      .where(and(eq(operationsEvents.orderId, orderId), eq(operationsEvents.sourceEventType, event.sourceEventType)))
      .limit(1);
    if (existingEvent.length > 0) return;

    await tx
      .insert(operationsEvents)
      .values(event)
      .onDuplicateKeyUpdate({
        set: {
          updatedAt: new Date(),
        },
      });
  });
}

export async function ensurePickupCompletedOperationsEventForOrder(
  orderId: number,
  input: {
    actorDisplayName?: string | null;
    actualEventTimestamp?: Date;
    reason?: string;
  } = {}
): Promise<{ created: boolean; eventId?: number | null }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.transaction(async (tx) => {
    const existingEvent = await tx
      .select({ id: operationsEvents.id })
      .from(operationsEvents)
      .where(and(eq(operationsEvents.orderId, orderId), eq(operationsEvents.sourceEventType, "pickup_completed")))
      .limit(1);
    if (existingEvent[0]) return { created: false, eventId: existingEvent[0].id };

    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    if (!order) throw new Error(`Order #${orderId} not found`);

    const event = buildPickupCompletedOperationsEventForOrder({
      order,
      actor: {
        source: "system_backfill",
        actorDisplayName: input.actorDisplayName ?? "Admin charge",
        actualEventTimestamp: input.actualEventTimestamp,
      },
      reason: input.reason,
    });
    await tx.insert(operationsEvents).values(event);
    return { created: true, eventId: null };
  });
}

export async function listRecentAgentEvents(
  tenantId = "default",
  limit = 100
): Promise<AgentEvent[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(agentEvents)
    .where(eq(agentEvents.tenantId, tenantId))
    .orderBy(desc(agentEvents.createdAt), desc(agentEvents.id))
    .limit(Math.min(Math.max(limit, 1), 500));
}

export async function createAgentEvent(event: InsertAgentEvent): Promise<number | null> {
  const db = await getDb();
  if (!db) {
    console.warn("[AgentEvents] Database not available; event not persisted", {
      toolName: event.toolName,
      status: event.status,
    });
    return null;
  }

  const result = await db.insert(agentEvents).values(event);
  return Number(result[0].insertId);
}

export type OperatorTaskLevel = OperatorTask["level"];
export type OperatorTaskStatus = OperatorTask["status"];

export async function createOperatorTask(task: InsertOperatorTask): Promise<OperatorTask | null> {
  const db = await getDb();
  if (!db) {
    console.warn("[OperatorTasks] Database not available; task not persisted", {
      level: task.level,
      title: task.title,
    });
    return null;
  }

  const result = await db.insert(operatorTasks).values(task);
  const insertId = Number(result[0].insertId);
  const rows = await db.select().from(operatorTasks).where(eq(operatorTasks.id, insertId)).limit(1);
  return rows[0] ?? null;
}

export async function listOperatorTasks(input: {
  tenantId?: string;
  status?: OperatorTaskStatus | "active";
  limit?: number;
} = {}): Promise<OperatorTask[]> {
  const db = await getDb();
  if (!db) return [];

  const tenantId = input.tenantId ?? "default";
  const limit = Math.min(Math.max(input.limit ?? 80, 1), 200);
  const status = input.status ?? "active";
  const statusWhere =
    status === "active"
      ? inArray(operatorTasks.status, ["open", "in_progress", "blocked"])
      : eq(operatorTasks.status, status);

  return db
    .select()
    .from(operatorTasks)
    .where(and(eq(operatorTasks.tenantId, tenantId), statusWhere))
    .orderBy(desc(operatorTasks.createdAt), desc(operatorTasks.id))
    .limit(limit);
}

export async function updateOperatorTaskStatus(input: {
  tenantId?: string;
  id: number;
  status: OperatorTaskStatus;
}): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(operatorTasks)
    .set({ status: input.status })
    .where(and(eq(operatorTasks.id, input.id), eq(operatorTasks.tenantId, input.tenantId ?? "default")));
}

export function currentAiUsageMonth(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function getTenantAiUsage(
  tenantId = "default",
  month = currentAiUsageMonth()
): Promise<TenantAiUsage | null> {
  const db = await getDb();
  if (!db) return null;

  const rows = await db
    .select()
    .from(tenantAiUsage)
    .where(and(eq(tenantAiUsage.tenantId, tenantId), eq(tenantAiUsage.month, month)))
    .limit(1);
  return rows[0] ?? null;
}

export async function incrementTenantAiUsage(input: {
  tenantId?: string;
  month?: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostCents: number;
  warningLimitCents?: number;
  hardLimitCents?: number;
}): Promise<TenantAiUsage | null> {
  const db = await getDb();
  if (!db) {
    console.warn("[AiUsage] Database not available; usage not persisted");
    return null;
  }

  const tenantId = input.tenantId ?? "default";
  const month = input.month ?? currentAiUsageMonth();
  await db
    .insert(tenantAiUsage)
    .values({
      tenantId,
      month,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      estimatedCostCents: input.estimatedCostCents,
      requestCount: 1,
      warningLimitCents: input.warningLimitCents ?? 5000,
      hardLimitCents: input.hardLimitCents ?? 10000,
    })
    .onDuplicateKeyUpdate({
      set: {
        inputTokens: sql`${tenantAiUsage.inputTokens} + ${input.inputTokens}`,
        outputTokens: sql`${tenantAiUsage.outputTokens} + ${input.outputTokens}`,
        estimatedCostCents: sql`${tenantAiUsage.estimatedCostCents} + ${input.estimatedCostCents}`,
        requestCount: sql`${tenantAiUsage.requestCount} + 1`,
        updatedAt: new Date(),
      },
    });

  return getTenantAiUsage(tenantId, month);
}

export async function updateOrderIntake(
  orderId: number,
  data: Partial<InsertOrder>
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  let patch: Partial<InsertOrder> = { ...data };
  if (data.paid === true && data.paidAt === undefined) {
    const [existing] = await db
      .select({ paid: orders.paid, paidAt: orders.paidAt })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);
    if (existing && !existing.paid) {
      patch = { ...patch, paidAt: new Date() };
    }
  }

  await db.update(orders).set(patch).where(eq(orders.id, orderId));
}

export async function searchCustomerByPhone(
  phone: string
): Promise<Order | undefined> {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db
    .select()
    .from(orders)
    .where(eq(orders.phone, phone))
    .orderBy(desc(orders.createdAt))
    .limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export type OrderSearchHit = {
  id: number;
  firstName: string;
  lastName: string;
  phone: string;
  createdAt: Date;
  status: Order["status"];
  serviceType: Order["serviceType"];
  total: string | null;
  paid: boolean;
};

export async function searchOrdersForReceipt(
  q: string
): Promise<OrderSearchHit[]> {
  const db = await getDb();
  if (!db) return [];

  const trimmed = q.trim().slice(0, 80);
  if (trimmed.length < 2) return [];

  const safe = trimmed.replace(/[%_\\]/g, "");
  const pattern = `%${safe}%`;
  const phoneDigits = trimmed.replace(/\D/g, "");

  const conditions = [
    like(orders.firstName, pattern),
    like(orders.lastName, pattern),
    sql`CONCAT(${orders.firstName}, ' ', ${orders.lastName}) LIKE ${pattern}`,
  ];
  if (phoneDigits.length >= 2) {
    conditions.push(like(orders.phone, `%${phoneDigits}%`));
  }

  const result = await db
    .select({
      id: orders.id,
      firstName: orders.firstName,
      lastName: orders.lastName,
      phone: orders.phone,
      createdAt: orders.createdAt,
      status: orders.status,
      serviceType: orders.serviceType,
      total: orders.total,
      paid: orders.paid,
    })
    .from(orders)
    .where(or(...conditions))
    .orderBy(desc(orders.createdAt))
    .limit(80);

  return result as OrderSearchHit[];
}

export async function findStripeCardByPhone(
  phone: string
): Promise<{ stripeCustomerId: string; stripePaymentMethodId: string } | null> {
  const db = await getDb();
  if (!db) return null;

  const normalizedPhone = normalizePhoneForStorage(phone);
  if (!normalizedPhone) return null;
  const digits = phoneDigits(normalizedPhone);
  const nationalDigits = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  const storedPhoneDigits = sql<string>`REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(${orders.phone}, '+', ''), '-', ''), ' ', ''), '(', ''), ')', ''), '.', '')`;

  const result = await db
    .select({
      phone: orders.phone,
      stripeCustomerId: orders.stripeCustomerId,
      stripePaymentMethodId: orders.stripePaymentMethodId,
    })
    .from(orders)
    .where(
      and(
        or(
          eq(orders.phone, normalizedPhone),
          eq(orders.phone, phone),
          sql`${storedPhoneDigits} = ${digits}`,
          sql`${storedPhoneDigits} = ${nationalDigits}`
        ),
        sql`${orders.stripeCustomerId} IS NOT NULL`,
        sql`${orders.stripePaymentMethodId} IS NOT NULL`,
        sql`${orders.stripePaymentMethodId} != ''`
      )
    )
    .orderBy(desc(orders.createdAt))
    .limit(25);

  const match = result.find((row) => sameNormalizedPhone(row.phone, normalizedPhone));
  if (match?.stripeCustomerId && match.stripePaymentMethodId) {
    return {
      stripeCustomerId: match.stripeCustomerId,
      stripePaymentMethodId: match.stripePaymentMethodId,
    };
  }
  return null;
}

export async function hasCustomerPaidBefore(
  stripeCustomerId: string
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(orders)
    .where(
      and(
        eq(orders.stripeCustomerId, stripeCustomerId),
        eq(orders.paid, true)
      )
    );

  return (result[0]?.count ?? 0) > 0;
}

export async function deleteOrder(orderId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.delete(orders).where(eq(orders.id, orderId));
}

export async function updateOrderVendor(orderId: number, vendorId: number | null): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(orders).set({ vendorId }).where(eq(orders.id, orderId));
}

/* ===== VENDOR HELPERS (Phase 1) ===== */

export async function createVendor(data: {
  name: string;
  email?: string | null;
  country?: string | null;
  platformFeePercent?: number | null;
}): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(vendors).values({
    name: data.name,
    email: data.email ?? null,
    country: data.country ?? "US",
    isActive: true,
    platformFeePercent: data.platformFeePercent != null
      ? data.platformFeePercent.toString()
      : null,
  });
  return Number(result[0].insertId);
}

export async function getVendorById(id: number): Promise<Vendor | undefined> {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db.select().from(vendors).where(eq(vendors.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getVendorBySlug(slug: string): Promise<Vendor | undefined> {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db.select().from(vendors).where(eq(vendors.slug, slug)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function isVendorPublicBookingSlugTaken(input: {
  tenantId: string;
  slug: string;
  excludeVendorId?: number | null;
}): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  const normalized = input.slug.trim().toLowerCase();
  const vendorConditions = [eq(vendors.slug, normalized)];
  if (input.excludeVendorId != null) {
    vendorConditions.push(ne(vendors.id, input.excludeVendorId));
  }
  const vendorRows = await db.select({ id: vendors.id }).from(vendors).where(and(...vendorConditions)).limit(1);
  if (vendorRows.length > 0) return true;

  const configConditions = [
    eq(vendorAdminConfigs.tenantId, input.tenantId),
    eq(vendorAdminConfigs.publicBookingSlug, normalized),
  ];
  if (input.excludeVendorId != null) {
    configConditions.push(ne(vendorAdminConfigs.vendorId, input.excludeVendorId));
  }
  const configRows = await db
    .select({ id: vendorAdminConfigs.id })
    .from(vendorAdminConfigs)
    .where(and(...configConditions))
    .limit(1);
  return configRows.length > 0;
}

export async function getVendorUserByVendorIdAndEmail(
  vendorId: number,
  email: string
): Promise<VendorUser | undefined> {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db
    .select()
    .from(vendorUsers)
    .where(and(eq(vendorUsers.vendorId, vendorId), eq(vendorUsers.email, email.toLowerCase().trim())))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function createVendorUser(data: {
  vendorId: number;
  email: string;
  passwordHash: string;
  role?: string;
}): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(vendorUsers).values({
    vendorId: data.vendorId,
    email: data.email.toLowerCase().trim(),
    passwordHash: data.passwordHash,
    role: data.role ?? "user",
  });
  return Number(result[0].insertId);
}

export async function updateVendorUserPassword(
  vendorId: number,
  email: string,
  passwordHash: string
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(vendorUsers)
    .set({ passwordHash })
    .where(and(eq(vendorUsers.vendorId, vendorId), eq(vendorUsers.email, email.toLowerCase().trim())));
}

export async function updateVendorBranding(
  vendorId: number,
  data: { brandName?: string | null; logoUrl?: string | null }
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(vendors).set(data).where(eq(vendors.id, vendorId));
}

export async function updateVendorSlug(vendorId: number, slug: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(vendors).set({ slug: slug.trim().toLowerCase() }).where(eq(vendors.id, vendorId));
}

export async function listVendors(): Promise<Vendor[]> {
  const db = await getDb();
  if (!db) return [];

  return db.select().from(vendors).orderBy(asc(vendors.name));
}

export async function updateVendorIsActive(id: number, isActive: boolean): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(vendors).set({ isActive }).where(eq(vendors.id, id));
}

export async function updateVendorConnectAccount(
  id: number,
  stripeConnectAccountId: string
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(vendors).set({ stripeConnectAccountId }).where(eq(vendors.id, id));
}

export async function updateVendorConnectStatus(
  id: number,
  status: {
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    detailsSubmitted: boolean;
    currentlyDue: string | null;
    pastDue: string | null;
    disabledReason: string | null;
  }
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(vendors).set({
    chargesEnabled: status.chargesEnabled,
    payoutsEnabled: status.payoutsEnabled,
    detailsSubmitted: status.detailsSubmitted,
    currentlyDue: status.currentlyDue,
    pastDue: status.pastDue,
    disabledReason: status.disabledReason,
  }).where(eq(vendors.id, id));
}

/* ===== UNIVERSAL VENDOR ONBOARDING HELPERS ===== */

export async function createVendorProfile(data: InsertVendorProfile): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(vendorProfiles).values(data);
  return Number(result[0].insertId);
}

export async function getVendorProfileByVendorId(
  tenantId: string,
  vendorId: number
): Promise<VendorProfile | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(vendorProfiles)
    .where(and(eq(vendorProfiles.tenantId, tenantId), eq(vendorProfiles.vendorId, vendorId)))
    .limit(1);
  return rows[0];
}

export async function updateVendorProfileByVendorId(
  tenantId: string,
  vendorId: number,
  data: Partial<InsertVendorProfile>
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(vendorProfiles)
    .set(data)
    .where(and(eq(vendorProfiles.tenantId, tenantId), eq(vendorProfiles.vendorId, vendorId)));
}

export async function createVendorServices(data: InsertVendorService[]): Promise<number[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (data.length === 0) return [];
  const ids: number[] = [];
  for (const item of data) {
    const result = await db.insert(vendorServices).values(item);
    ids.push(Number(result[0].insertId));
  }
  return ids;
}

export async function listVendorServices(
  tenantId: string,
  vendorId: number
): Promise<VendorService[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(vendorServices)
    .where(and(eq(vendorServices.tenantId, tenantId), eq(vendorServices.vendorId, vendorId)))
    .orderBy(asc(vendorServices.serviceName));
}

export async function createVendorAvailabilityWindows(
  data: InsertVendorAvailabilityWindow[]
): Promise<number[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const ids: number[] = [];
  for (const item of data) {
    const result = await db.insert(vendorAvailabilityWindows).values(item);
    ids.push(Number(result[0].insertId));
  }
  return ids;
}

export async function listVendorAvailabilityWindows(
  tenantId: string,
  vendorId: number
): Promise<VendorAvailabilityWindow[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(vendorAvailabilityWindows)
    .where(and(eq(vendorAvailabilityWindows.tenantId, tenantId), eq(vendorAvailabilityWindows.vendorId, vendorId)))
    .orderBy(asc(vendorAvailabilityWindows.dayOfWeek), asc(vendorAvailabilityWindows.startTime));
}

export async function createVendorAdminConfig(data: InsertVendorAdminConfig): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(vendorAdminConfigs).values(data);
  return Number(result[0].insertId);
}

export async function getVendorAdminConfig(
  tenantId: string,
  vendorId: number
): Promise<VendorAdminConfig | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(vendorAdminConfigs)
    .where(and(eq(vendorAdminConfigs.tenantId, tenantId), eq(vendorAdminConfigs.vendorId, vendorId)))
    .limit(1);
  return rows[0];
}

export async function getVendorAdminConfigBySlug(
  tenantId: string,
  publicBookingSlug: string
): Promise<VendorAdminConfig | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(vendorAdminConfigs)
    .where(and(
      eq(vendorAdminConfigs.tenantId, tenantId),
      eq(vendorAdminConfigs.publicBookingSlug, publicBookingSlug.trim().toLowerCase())
    ))
    .limit(1);
  return rows[0];
}

export async function updateVendorAdminConfig(
  tenantId: string,
  vendorId: number,
  data: Partial<InsertVendorAdminConfig>
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(vendorAdminConfigs)
    .set(data)
    .where(and(eq(vendorAdminConfigs.tenantId, tenantId), eq(vendorAdminConfigs.vendorId, vendorId)));
}

export async function createVendorPeerServiceRequest(
  data: InsertVendorPeerServiceRequest
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(vendorPeerServiceRequests).values(data);
  return Number(result[0].insertId);
}

export async function getVendorPeerServiceRequest(
  tenantId: string,
  id: number
): Promise<VendorPeerServiceRequest | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(vendorPeerServiceRequests)
    .where(and(eq(vendorPeerServiceRequests.tenantId, tenantId), eq(vendorPeerServiceRequests.id, id)))
    .limit(1);
  return rows[0];
}

export async function updateVendorPeerServiceRequest(
  tenantId: string,
  id: number,
  data: Partial<InsertVendorPeerServiceRequest>
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(vendorPeerServiceRequests)
    .set(data)
    .where(and(eq(vendorPeerServiceRequests.tenantId, tenantId), eq(vendorPeerServiceRequests.id, id)));
}

export async function createResidentAgentPlan(
  data: InsertResidentAgentPlan
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(residentAgentPlans).values(data);
  return Number(result[0].insertId);
}

export async function getResidentAgentPlan(
  tenantId: string,
  id: number
): Promise<ResidentAgentPlan | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(residentAgentPlans)
    .where(and(eq(residentAgentPlans.tenantId, tenantId), eq(residentAgentPlans.id, id)))
    .limit(1);
  return rows[0];
}

export async function updateResidentAgentPlan(
  tenantId: string,
  id: number,
  data: Partial<InsertResidentAgentPlan>
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(residentAgentPlans)
    .set(data)
    .where(and(eq(residentAgentPlans.tenantId, tenantId), eq(residentAgentPlans.id, id)));
}

export async function createResidentCoordinatedRequest(
  data: InsertResidentCoordinatedRequest
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(residentCoordinatedRequests).values(data);
  return Number(result[0].insertId);
}

export async function getResidentCoordinatedRequest(
  tenantId: string,
  id: number
): Promise<ResidentCoordinatedRequest | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(residentCoordinatedRequests)
    .where(and(eq(residentCoordinatedRequests.tenantId, tenantId), eq(residentCoordinatedRequests.id, id)))
    .limit(1);
  return rows[0];
}

export async function listVendorPeerServiceProviders(input: {
  tenantId: string;
  serviceCategory: string;
  excludeVendorId?: number | null;
  limit?: number;
}): Promise<Array<Vendor & { profile?: VendorProfile | null; adminConfig?: VendorAdminConfig | null }>> {
  const all = await listVendors();
  const providers = [];
  for (const vendor of all) {
    if (input.excludeVendorId != null && vendor.id === input.excludeVendorId) continue;
    const profile = await getVendorProfileByVendorId(input.tenantId, vendor.id);
    if (profile && profile.vendorCategory !== input.serviceCategory) continue;
    const adminConfig = await getVendorAdminConfig(input.tenantId, vendor.id);
    providers.push({ ...vendor, profile: profile ?? null, adminConfig: adminConfig ?? null });
    if (providers.length >= (input.limit ?? 3)) break;
  }
  return providers;
}

export async function createVendorPricingRecommendation(
  data: InsertVendorPricingRecommendation
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(vendorPricingRecommendations).values(data);
  return Number(result[0].insertId);
}

export async function listVendorPricingRecommendations(
  tenantId: string,
  vendorId: number
): Promise<VendorPricingRecommendation[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(vendorPricingRecommendations)
    .where(and(eq(vendorPricingRecommendations.tenantId, tenantId), eq(vendorPricingRecommendations.vendorId, vendorId)))
    .orderBy(desc(vendorPricingRecommendations.createdAt));
}

export async function createVendorDataExport(data: InsertVendorDataExport): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(vendorDataExports).values(data);
  return Number(result[0].insertId);
}

export async function getVendorDataExport(
  tenantId: string,
  id: number
): Promise<VendorDataExport | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(vendorDataExports)
    .where(and(eq(vendorDataExports.tenantId, tenantId), eq(vendorDataExports.id, id)))
    .limit(1);
  return rows[0];
}

export async function createVendorGuestBookingSession(
  data: InsertVendorGuestBookingSession
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(vendorGuestBookingSessions).values(data);
  return Number(result[0].insertId);
}

export async function getVendorGuestBookingSession(
  tenantId: string,
  id: number
): Promise<VendorGuestBookingSession | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(vendorGuestBookingSessions)
    .where(and(eq(vendorGuestBookingSessions.tenantId, tenantId), eq(vendorGuestBookingSessions.id, id)))
    .limit(1);
  return rows[0];
}

export async function createVendorOnboardingSession(
  data: InsertVendorOnboardingSession
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(vendorOnboardingSessions).values(data);
  return Number(result[0].insertId);
}

export async function getVendorOnboardingSessionByToken(
  tenantId: string,
  sessionToken: string
): Promise<VendorOnboardingSession | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(vendorOnboardingSessions)
    .where(and(eq(vendorOnboardingSessions.tenantId, tenantId), eq(vendorOnboardingSessions.sessionId, sessionToken)))
    .limit(1);
  return rows[0];
}

export async function updateVendorOnboardingSession(
  tenantId: string,
  id: number,
  data: Partial<InsertVendorOnboardingSession>
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(vendorOnboardingSessions)
    .set(data)
    .where(and(eq(vendorOnboardingSessions.tenantId, tenantId), eq(vendorOnboardingSessions.id, id)));
}

export async function createVendorOnboardingMessage(
  data: InsertVendorOnboardingMessage
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(vendorOnboardingMessages).values(data);
  return Number(result[0].insertId);
}

export async function listVendorOnboardingMessages(
  tenantId: string,
  sessionId: number,
  limit = 100
): Promise<VendorOnboardingMessage[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(vendorOnboardingMessages)
    .where(and(eq(vendorOnboardingMessages.tenantId, tenantId), eq(vendorOnboardingMessages.sessionId, sessionId)))
    .orderBy(asc(vendorOnboardingMessages.createdAt), asc(vendorOnboardingMessages.id))
    .limit(Math.min(Math.max(limit, 1), 500));
}

export async function listAbandonedVendorOnboardingCandidates(
  tenantId: string,
  now = new Date()
): Promise<VendorOnboardingSession[]> {
  const db = await getDb();
  if (!db) return [];
  const twoHours = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  return db
    .select()
    .from(vendorOnboardingSessions)
    .where(
      and(
        eq(vendorOnboardingSessions.tenantId, tenantId),
        inArray(vendorOnboardingSessions.status, ["started", "collecting_details", "pricing_setup", "availability_setup", "payment_setup", "admin_configured"]),
        lt(vendorOnboardingSessions.updatedAt, twoHours)
      )
    )
    .orderBy(asc(vendorOnboardingSessions.updatedAt))
    .limit(200);
}

/* ===== VENDOR SERVICE COVERAGE HELPERS (Phase 2) ===== */

export async function createVendorCoverage(data: {
  vendorId: number;
  buildingSlug: string;
  serviceType: "wash_fold" | "dry_cleaning";
  priority?: number;
  isActive?: boolean;
  isDefault?: boolean;
  notes?: string | null;
}): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(vendorServiceCoverage).values({
    vendorId: data.vendorId,
    buildingSlug: data.buildingSlug,
    serviceType: data.serviceType,
    priority: data.priority ?? 10,
    isActive: data.isActive ?? true,
    isDefault: data.isDefault ?? false,
    notes: data.notes ?? null,
  });
  return Number(result[0].insertId);
}

export async function updateVendorCoverage(
  id: number,
  data: {
    priority?: number;
    isActive?: boolean;
    isDefault?: boolean;
    notes?: string | null;
  }
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(vendorServiceCoverage).set(data).where(eq(vendorServiceCoverage.id, id));
}

export async function deleteVendorCoverage(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.delete(vendorServiceCoverage).where(eq(vendorServiceCoverage.id, id));
}

export async function listVendorCoverage(vendorId?: number): Promise<VendorServiceCoverage[]> {
  const db = await getDb();
  if (!db) return [];

  if (vendorId !== undefined) {
    return db
      .select()
      .from(vendorServiceCoverage)
      .where(eq(vendorServiceCoverage.vendorId, vendorId))
      .orderBy(asc(vendorServiceCoverage.priority));
  }
  return db.select().from(vendorServiceCoverage).orderBy(asc(vendorServiceCoverage.priority));
}

export async function getVendorCustomers(
  vendorId: number
): Promise<{ firstName: string; buildingSlug: string | null; unit: string | null; totalOrdersWithThisVendor: number; lastOrderDate: string }[]> {
  const db = await getDb();
  if (!db) return [];

  const rows = await db
    .select({
      firstName: orders.firstName,
      buildingSlug: orders.buildingSlug,
      unit: orders.unit,
      lastOrderDate: orders.updatedAt,
    })
    .from(orders)
    .where(eq(orders.vendorId, vendorId))
    .orderBy(desc(orders.updatedAt));

  const byKey = new Map<string, { firstName: string; buildingSlug: string | null; unit: string | null; count: number; lastDate: Date }>();
  for (const r of rows) {
    const key = `${r.firstName}|${r.buildingSlug ?? ""}|${r.unit ?? ""}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.count += 1;
      if (r.lastOrderDate && (!existing.lastDate || r.lastOrderDate > existing.lastDate)) {
        existing.lastDate = r.lastOrderDate;
      }
    } else {
      byKey.set(key, {
        firstName: r.firstName,
        buildingSlug: r.buildingSlug,
        unit: r.unit,
        count: 1,
        lastDate: r.lastOrderDate ?? new Date(0),
      });
    }
  }
  return Array.from(byKey.values()).map(v => ({
    firstName: v.firstName,
    buildingSlug: v.buildingSlug,
    unit: v.unit,
    totalOrdersWithThisVendor: v.count,
    lastOrderDate: v.lastDate.getTime() ? v.lastDate.toISOString().split("T")[0] : "",
  }));
}

export async function getVendorPayouts(
  vendorId: number
): Promise<Order[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(orders)
    .where(and(eq(orders.vendorId, vendorId), eq(orders.paid, true)))
    .orderBy(desc(orders.updatedAt));
}

export async function listVendorUsers(vendorId: number): Promise<VendorUser[]> {
  const db = await getDb();
  if (!db) return [];

  return db.select().from(vendorUsers).where(eq(vendorUsers.vendorId, vendorId));
}

export async function getVendorForOrder(
  buildingSlug: string,
  serviceType: "wash_fold" | "dry_cleaning"
): Promise<Vendor | null> {
  const db = await getDb();
  if (!db) return null;

  const rows = await db
    .select({ vendor: vendors, priority: vendorServiceCoverage.priority })
    .from(vendorServiceCoverage)
    .innerJoin(vendors, eq(vendorServiceCoverage.vendorId, vendors.id))
    .where(
      and(
        eq(vendorServiceCoverage.buildingSlug, buildingSlug),
        eq(vendorServiceCoverage.serviceType, serviceType),
        eq(vendorServiceCoverage.isActive, true),
        eq(vendors.isActive, true)
      )
    )
    .orderBy(asc(vendorServiceCoverage.priority))
    .limit(1);

  return rows.length > 0 ? rows[0].vendor : null;
}

/* ===== COORDINATED SERVICE REQUESTS (from resident app) ===== */

const COORDINATED_SERVICE_TYPES = ["car-wash", "grooming", "other"] as const;
const RESIDENT_COORDINATED_OPEN_STATUSES = ["pending_operator_review", "pending_provider_confirmation"] as const;

export type UnifiedCoordinatedRequest = {
  id: number;
  source: "service_requests" | "resident_coordinated_requests";
  serviceCategory: string | null;
  serviceLabel: string;
  status: string | null;
  residentName: string | null;
  residentPhone: string | null;
  residentEmail: string | null;
  buildingSlug: string | null;
  buildingName: string | null;
  unit: string | null;
  requestedDate: string | null;
  requestedWindow: string | null;
  deadlineDate: string | null;
  deadlineReason: string | null;
  origin: string | null;
  destination: string | null;
  serviceRequested: string | null;
  notes: string | null;
  parentPlanId: number | null;
  createdAt: Date | null;
  updatedAt: Date | null;
};

type LegacyRequestJson = {
  residentName?: unknown;
  residentPhone?: unknown;
  residentEmail?: unknown;
  buildingSlug?: unknown;
  buildingName?: unknown;
  unit?: unknown;
  requestedDate?: unknown;
  requestedWindow?: unknown;
  deadlineDate?: unknown;
  deadlineReason?: unknown;
  origin?: unknown;
  destination?: unknown;
  serviceRequested?: unknown;
  notes?: unknown;
};

function nullableString(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function legacyRequestJson(value: unknown): LegacyRequestJson {
  return value && typeof value === "object" && !Array.isArray(value) ? value as LegacyRequestJson : {};
}

export function coordinatedRequestServiceLabel(category: string | null): string {
  switch (category) {
    case "dog_grooming":
    case "grooming":
      return "Dog Grooming";
    case "car_detail":
    case "car-wash":
      return "Car Detail";
    case "airport_transport":
      return "LAX / Airport Pickup";
    case "apartment_cleaning":
      return "Apartment Cleaning";
    case "dry_cleaning":
      return "Dry Cleaning";
    case "other":
    default:
      return "Other";
  }
}

export function mapLegacyServiceRequestForRequestsPage(
  request: typeof serviceRequests.$inferSelect
): UnifiedCoordinatedRequest {
  const requestJson = legacyRequestJson(request.requestJson);
  return {
    id: request.id,
    source: "service_requests",
    serviceCategory: request.serviceType,
    serviceLabel: coordinatedRequestServiceLabel(request.serviceType),
    status: request.status,
    residentName: nullableString(requestJson.residentName),
    residentPhone: nullableString(requestJson.residentPhone),
    residentEmail: nullableString(requestJson.residentEmail),
    buildingSlug: nullableString(requestJson.buildingSlug),
    buildingName: nullableString(requestJson.buildingName),
    unit: nullableString(requestJson.unit),
    requestedDate: request.scheduledDate ?? nullableString(requestJson.requestedDate),
    requestedWindow: request.scheduledWindow ?? nullableString(requestJson.requestedWindow),
    deadlineDate: nullableString(requestJson.deadlineDate),
    deadlineReason: nullableString(requestJson.deadlineReason),
    origin: nullableString(requestJson.origin),
    destination: nullableString(requestJson.destination),
    serviceRequested: nullableString(requestJson.serviceRequested) ?? request.requestSummary,
    notes: nullableString(requestJson.notes),
    parentPlanId: null,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
}

export function mapResidentCoordinatedRequestForRequestsPage(
  request: ResidentCoordinatedRequest
): UnifiedCoordinatedRequest {
  return {
    id: request.id,
    source: "resident_coordinated_requests",
    serviceCategory: request.serviceCategory,
    serviceLabel: coordinatedRequestServiceLabel(request.serviceCategory),
    status: request.status,
    residentName: request.residentName,
    residentPhone: request.residentPhone,
    residentEmail: request.residentEmail,
    buildingSlug: request.buildingSlug,
    buildingName: request.buildingName,
    unit: request.unit,
    requestedDate: request.requestedDate,
    requestedWindow: request.requestedWindow,
    deadlineDate: request.deadlineDate,
    deadlineReason: request.deadlineReason,
    origin: request.origin,
    destination: request.destination,
    serviceRequested: request.serviceRequested,
    notes: request.notes,
    parentPlanId: request.parentPlanId,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
}

function sortRequestsNewestFirst<T extends { createdAt: Date | null }>(requests: T[]): T[] {
  return requests.sort((a, b) => {
    const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return bTime - aTime;
  });
}

export function mergeCoordinatedRequestsForRequestsPage(
  legacyRequests: Array<typeof serviceRequests.$inferSelect>,
  residentRequests: ResidentCoordinatedRequest[]
): UnifiedCoordinatedRequest[] {
  return sortRequestsNewestFirst([
    ...legacyRequests.map(mapLegacyServiceRequestForRequestsPage),
    ...residentRequests.map(mapResidentCoordinatedRequestForRequestsPage),
  ]);
}

export async function listCoordinatedRequests(): Promise<UnifiedCoordinatedRequest[]> {
  const db = await getDb();
  if (!db) return [];

  const [legacyRequests, residentRequests] = await Promise.all([
    db
      .select()
      .from(serviceRequests)
      .where(inArray(serviceRequests.serviceType, [...COORDINATED_SERVICE_TYPES]))
      .orderBy(desc(serviceRequests.createdAt)),
    db
      .select()
      .from(residentCoordinatedRequests)
      .orderBy(desc(residentCoordinatedRequests.createdAt)),
  ]);

  return mergeCoordinatedRequestsForRequestsPage(legacyRequests, residentRequests);
}

export async function getNewCoordinatedRequestsCount(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const [legacyResult, residentResult] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)` })
      .from(serviceRequests)
      .where(
        and(
          inArray(serviceRequests.serviceType, [...COORDINATED_SERVICE_TYPES]),
          inArray(serviceRequests.status, ["new", "pending"])
        )
      ),
    db
      .select({ count: sql<number>`count(*)` })
      .from(residentCoordinatedRequests)
      .where(inArray(residentCoordinatedRequests.status, [...RESIDENT_COORDINATED_OPEN_STATUSES])),
  ]);

  return Number(legacyResult[0]?.count ?? 0) + Number(residentResult[0]?.count ?? 0);
}

function residentRequestStatusFromAdminAction(status: string): {
  status: "pending_operator_review" | "pending_provider_confirmation" | "confirmed" | "cancelled" | "completed" | "failed";
  residentVisibleStatus: "pending_operator_review" | "pending_provider_confirmation" | "confirmed" | "cancelled" | "completed" | "failed";
  statusReason: string;
} {
  switch (status) {
    case "contacting-vendor":
      return {
        status: "pending_operator_review",
        residentVisibleStatus: "pending_operator_review",
        statusReason: "Operator is contacting a provider.",
      };
    case "awaiting-vendor":
      return {
        status: "pending_provider_confirmation",
        residentVisibleStatus: "pending_provider_confirmation",
        statusReason: "Provider confirmation is pending.",
      };
    case "scheduled":
      return {
        status: "confirmed",
        residentVisibleStatus: "confirmed",
        statusReason: "Operator marked the coordinated request as scheduled.",
      };
    case "closed":
      return {
        status: "cancelled",
        residentVisibleStatus: "cancelled",
        statusReason: "Operator closed the coordinated request.",
      };
    case "pending_operator_review":
    case "pending_provider_confirmation":
    case "confirmed":
    case "cancelled":
    case "completed":
    case "failed":
      return {
        status,
        residentVisibleStatus: status,
        statusReason: "Operator updated the coordinated request status.",
      };
    default:
      return {
        status: "pending_operator_review",
        residentVisibleStatus: "pending_operator_review",
        statusReason: `Unsupported status action ignored: ${status}`,
      };
  }
}

export async function updateCoordinatedRequestStatus(
  source: UnifiedCoordinatedRequest["source"],
  id: number,
  status: string
): Promise<void> {
  if (source === "resident_coordinated_requests") {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    await db
      .update(residentCoordinatedRequests)
      .set(residentRequestStatusFromAdminAction(status))
      .where(eq(residentCoordinatedRequests.id, id));
    return;
  }

  await updateServiceRequestStatus(id, status);
}

export async function updateServiceRequestStatus(
  id: number,
  status: string
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(serviceRequests)
    .set({ status })
    .where(eq(serviceRequests.id, id));
}

/* ===== LEADS HELPERS (Add Your Building form submissions) ===== */

export async function createLead(data: {
  name: string;
  buildingName: string;
  role?: string | null;
  email: string;
  numberOfUnits?: string | null;
  phone?: string | null;
  source?: string | null;
  sourceUrl?: string | null;
}): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(leads).values({
    name: data.name,
    buildingName: data.buildingName,
    role: data.role ?? null,
    email: data.email,
    numberOfUnits: data.numberOfUnits ?? null,
    phone: data.phone ?? null,
    source: data.source ?? "add_your_building_form",
    sourceUrl: data.sourceUrl ?? null,
    status: "New",
    isRead: false,
  });
  return Number(result[0].insertId);
}

export async function getLeadById(id: number): Promise<Lead | undefined> {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function listLeads(): Promise<Lead[]> {
  const db = await getDb();
  if (!db) return [];

  return db.select().from(leads).orderBy(desc(leads.submittedAt));
}

export async function getUnreadLeadsCount(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(leads)
    .where(eq(leads.isRead, false));

  return Number(result[0]?.count ?? 0);
}

export async function updateLeadStatus(
  id: number,
  status: Lead["status"]
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(leads).set({ status }).where(eq(leads.id, id));
}

export async function markLeadAsRead(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(leads).set({ isRead: true }).where(eq(leads.id, id));
}

export async function markLeadAsUnread(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(leads).set({ isRead: false }).where(eq(leads.id, id));
}

export async function updateLeadNotes(
  id: number,
  notes: string | null
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(leads).set({ notes }).where(eq(leads.id, id));
}

/* ===== CATALOG ITEMS (tenant-scoped SKUs) ===== */

export type PublicCatalogRow = {
  id: number;
  slug: string;
  name: string;
  category: string;
  serviceType: string;
  standardPriceCents: number;
  expressPriceCents: number | null;
  sortOrder: number;
  iconUrl: string | null;
};

export async function listCatalogItemsForAdmin(
  tenantId: string,
  opts?: { includeArchived?: boolean }
): Promise<CatalogItem[]> {
  const db = await getDb();
  if (!db) return [];
  const conds = [eq(catalogItems.tenantId, tenantId)];
  if (!opts?.includeArchived) {
    conds.push(eq(catalogItems.archived, false));
  }
  return db
    .select()
    .from(catalogItems)
    .where(and(...conds))
    .orderBy(asc(catalogItems.sortOrder), asc(catalogItems.id));
}

export async function listActiveCatalogForPublic(tenantId: string): Promise<PublicCatalogRow[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      id: catalogItems.id,
      slug: catalogItems.slug,
      name: catalogItems.name,
      category: catalogItems.category,
      serviceType: catalogItems.serviceType,
      standardPriceCents: catalogItems.standardPriceCents,
      expressPriceCents: catalogItems.expressPriceCents,
      sortOrder: catalogItems.sortOrder,
      iconUrl: catalogItems.iconUrl,
    })
    .from(catalogItems)
    .where(
      and(
        eq(catalogItems.tenantId, tenantId),
        eq(catalogItems.archived, false),
        eq(catalogItems.isActive, true),
        eq(catalogItems.isOnline, true)
      )
    )
    .orderBy(asc(catalogItems.sortOrder), asc(catalogItems.id));
}

export async function getCatalogItemByIdForTenant(
  id: number,
  tenantId: string
): Promise<CatalogItem | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(catalogItems)
    .where(and(eq(catalogItems.id, id), eq(catalogItems.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function createCatalogItemRow(data: {
  tenantId: string;
  slug: string;
  name: string;
  category: string;
  serviceType?: string;
  standardPriceCents: number;
  expressPriceCents?: number | null;
  costCents?: number | null;
  isActive?: boolean;
  isOnline?: boolean;
  iconUrl?: string | null;
}): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [agg] = await db
    .select({ m: max(catalogItems.sortOrder) })
    .from(catalogItems)
    .where(eq(catalogItems.tenantId, data.tenantId));
  const maxSort = agg?.m != null ? Number(agg.m) : -1;
  const nextOrder = maxSort + 1;

  const result = await db.insert(catalogItems).values({
    tenantId: data.tenantId,
    slug: data.slug,
    name: data.name,
    category: data.category,
    serviceType: data.serviceType ?? "dry_clean",
    standardPriceCents: data.standardPriceCents,
    expressPriceCents: data.expressPriceCents ?? null,
    costCents: data.costCents ?? null,
    isActive: data.isActive ?? true,
    isOnline: data.isOnline ?? false,
    archived: false,
    sortOrder: nextOrder,
    iconUrl: data.iconUrl ?? null,
  });
  return Number(result[0].insertId);
}

export async function updateCatalogItemRow(
  id: number,
  tenantId: string,
  patch: Partial<{
    slug: string;
    name: string;
    category: string;
    serviceType: string;
    standardPriceCents: number;
    expressPriceCents: number | null;
    costCents: number | null;
    isActive: boolean;
    isOnline: boolean;
    iconUrl: string | null;
  }>
): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await getCatalogItemByIdForTenant(id, tenantId);
  if (!existing) return false;
  await db
    .update(catalogItems)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(catalogItems.id, id), eq(catalogItems.tenantId, tenantId)));
  return true;
}

export async function archiveCatalogItemRow(id: number, tenantId: string): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await getCatalogItemByIdForTenant(id, tenantId);
  if (!existing || existing.archived) return false;
  await db
    .update(catalogItems)
    .set({ archived: true, isOnline: false, updatedAt: new Date() })
    .where(and(eq(catalogItems.id, id), eq(catalogItems.tenantId, tenantId)));
  return true;
}

export async function reorderCatalogItemsForTenant(
  tenantId: string,
  orderedIds: number[]
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db
    .select({ id: catalogItems.id })
    .from(catalogItems)
    .where(and(eq(catalogItems.tenantId, tenantId), eq(catalogItems.archived, false)));
  const allowed = new Set(rows.map((r) => r.id));
  for (let i = 0; i < orderedIds.length; i++) {
    const id = orderedIds[i];
    if (!allowed.has(id)) continue;
    await db
      .update(catalogItems)
      .set({ sortOrder: i, updatedAt: new Date() })
      .where(and(eq(catalogItems.id, id), eq(catalogItems.tenantId, tenantId)));
  }
}

export async function getCatalogItemBySlugForTenant(
  slug: string,
  tenantId: string
): Promise<CatalogItem | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(catalogItems)
    .where(
      and(
        eq(catalogItems.slug, slug),
        eq(catalogItems.tenantId, tenantId),
        eq(catalogItems.archived, false)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function archiveCatalogItemBySlug(slug: string, tenantId: string): Promise<boolean> {
  const row = await getCatalogItemBySlugForTenant(slug, tenantId);
  if (!row) return false;
  return archiveCatalogItemRow(row.id, tenantId);
}

/** Case-insensitive substring match on name (active rows only). */
export async function findActiveCatalogItemsForTenantSearch(
  tenantId: string,
  needle: string,
  limit = 8
): Promise<CatalogItem[]> {
  const db = await getDb();
  if (!db) return [];
  const q = needle.trim().slice(0, 80);
  if (q.length < 2) return [];
  const safe = q.replace(/[%_\\]/g, "");
  if (safe.length < 2) return [];
  const pattern = `%${safe}%`;
  return db
    .select()
    .from(catalogItems)
    .where(
      and(
        eq(catalogItems.tenantId, tenantId),
        eq(catalogItems.archived, false),
        like(catalogItems.name, pattern)
      )
    )
    .limit(limit);
}

export async function resolveActiveCatalogItemBySlugOrName(
  tenantId: string,
  slug: string | null | undefined,
  name: string | null | undefined
): Promise<CatalogItem | null> {
  const s = slug?.trim().toLowerCase();
  if (s) {
    const bySlug = await getCatalogItemBySlugForTenant(s, tenantId);
    if (bySlug) return bySlug;
  }
  const n = name?.trim();
  if (n && n.length >= 2) {
    const hits = await findActiveCatalogItemsForTenantSearch(tenantId, n, 8);
    const exact = hits.find((h) => h.name.trim().toLowerCase() === n.toLowerCase());
    if (exact) return exact;
    if (hits.length === 1) return hits[0] ?? null;
  }
  return null;
}

export type CatalogImportRowInput = {
  slug: string;
  name: string;
  category: string;
  serviceType: string;
  standardPriceCents: number;
  expressPriceCents: number | null;
  costCents: number | null;
  isActive: boolean;
  isOnline: boolean;
  duplicateAction: "skip" | "update_existing" | "create_new";
};

/** Apply reviewed import rows. Never runs without client-confirmed duplicateAction per slug collision. */
export async function bulkApplyCatalogImport(
  tenantId: string,
  rows: CatalogImportRowInput[]
): Promise<{ created: number; updated: number; skipped: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const database = db;

  let created = 0;
  let updated = 0;
  let skipped = 0;

  async function nextSortOrder(): Promise<number> {
    const [agg] = await database
      .select({ m: max(catalogItems.sortOrder) })
      .from(catalogItems)
      .where(eq(catalogItems.tenantId, tenantId));
    return (agg?.m != null ? Number(agg.m) : -1) + 1;
  }

  async function uniqueSlug(base: string): Promise<string> {
    let s = base;
    let n = 2;
    while (true) {
      const hit = await database
        .select({ id: catalogItems.id })
        .from(catalogItems)
        .where(and(eq(catalogItems.tenantId, tenantId), eq(catalogItems.slug, s)))
        .limit(1);
      if (hit.length === 0) return s;
      s = `${base}_${n}`;
      n += 1;
      if (n > 500) throw new Error("Could not allocate unique slug");
    }
  }

  let sortCursor = await nextSortOrder();

  for (const row of rows) {
    const existing = await database
      .select()
      .from(catalogItems)
      .where(and(eq(catalogItems.tenantId, tenantId), eq(catalogItems.slug, row.slug)))
      .limit(1);
    const ex = existing[0];

    if (ex && !ex.archived) {
      if (row.duplicateAction === "skip") {
        skipped += 1;
        continue;
      }
      if (row.duplicateAction === "update_existing") {
        await database
          .update(catalogItems)
          .set({
            name: row.name,
            category: row.category,
            serviceType: row.serviceType,
            standardPriceCents: row.standardPriceCents,
            expressPriceCents: row.expressPriceCents,
            costCents: row.costCents,
            isActive: row.isActive,
            isOnline: row.isOnline,
            updatedAt: new Date(),
          })
          .where(eq(catalogItems.id, ex.id));
        updated += 1;
        continue;
      }
      const newSlug = await uniqueSlug(row.slug);
      await database.insert(catalogItems).values({
        tenantId,
        slug: newSlug,
        name: row.name,
        category: row.category,
        serviceType: row.serviceType,
        standardPriceCents: row.standardPriceCents,
        expressPriceCents: row.expressPriceCents,
        costCents: row.costCents,
        isActive: row.isActive,
        isOnline: row.isOnline,
        archived: false,
        sortOrder: sortCursor++,
        iconUrl: null,
      });
      created += 1;
      continue;
    }

    if (ex?.archived) {
      await database
        .update(catalogItems)
        .set({
          name: row.name,
          category: row.category,
          serviceType: row.serviceType,
          standardPriceCents: row.standardPriceCents,
          expressPriceCents: row.expressPriceCents,
          costCents: row.costCents,
          isActive: row.isActive,
          isOnline: row.isOnline,
          archived: false,
          updatedAt: new Date(),
        })
        .where(eq(catalogItems.id, ex.id));
      updated += 1;
      continue;
    }

    await database.insert(catalogItems).values({
      tenantId,
      slug: row.slug,
      name: row.name,
      category: row.category,
      serviceType: row.serviceType,
      standardPriceCents: row.standardPriceCents,
      expressPriceCents: row.expressPriceCents,
      costCents: row.costCents,
      isActive: row.isActive,
      isOnline: row.isOnline,
      archived: false,
      sortOrder: sortCursor++,
      iconUrl: null,
    });
    created += 1;
  }

  return { created, updated, skipped };
}
