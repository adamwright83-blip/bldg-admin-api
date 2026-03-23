import { and, asc, desc, eq, gte, inArray, like, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser, users,
  orders, InsertOrder, Order,
  vendors, InsertVendor, Vendor,
  vendorUsers, InsertVendorUser, VendorUser,
  vendorServiceCoverage, InsertVendorServiceCoverage, VendorServiceCoverage,
  serviceRequests, ServiceRequest,
  bldgUsers, BldgUser,
  leads, Lead, InsertLead,
} from "../drizzle/schema";
import { ENV } from './_core/env';
import { matchBuilding } from "@shared/buildings";

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

  const result = await db.insert(orders).values(order);
  return Number(result[0].insertId);
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

export type AdminCustomerAggregateDbRow = {
  phone: string;
  firstName: string;
  lastName: string;
  email: string | null;
  unit: string | null;
  address: string;
  buildingSlug: string | null;
  totalOrders: number;
  lifetimeSpend: number;
  paidOrderCount: number;
  firstOrderAt: Date;
  lastOrderAt: Date;
  lastOrderId: number;
  ordersLast30Days: number;
  ordersLast90Days: number;
};

/**
 * Admin customer aggregates by phone.
 * Uses set-based SQL with window functions; returns one latest-record row per phone
 * plus counts/sums across that phone's order history.
 */
export async function listAdminCustomerAggregates(): Promise<AdminCustomerAggregateDbRow[]> {
  const db = await getDb();
  if (!db) return [];

  const result = await db.execute(sql`
    WITH ranked AS (
      SELECT
        id,
        phone,
        firstName,
        lastName,
        email,
        unit,
        address,
        buildingSlug,
        createdAt,
        ROW_NUMBER() OVER (
          PARTITION BY phone
          ORDER BY createdAt DESC, id DESC
        ) AS rn,
        COUNT(*) OVER (PARTITION BY phone) AS totalOrders,
        MIN(createdAt) OVER (PARTITION BY phone) AS firstOrderAt,
        MAX(createdAt) OVER (PARTITION BY phone) AS lastOrderAt,
        SUM(CASE WHEN paid = 1 THEN CAST(COALESCE(total, 0) AS DECIMAL(10,2)) ELSE 0 END)
          OVER (PARTITION BY phone) AS lifetimeSpend,
        SUM(CASE WHEN paid = 1 THEN 1 ELSE 0 END) OVER (PARTITION BY phone) AS paidOrderCount,
        SUM(CASE WHEN createdAt >= UTC_TIMESTAMP() - INTERVAL 30 DAY THEN 1 ELSE 0 END)
          OVER (PARTITION BY phone) AS ordersLast30Days,
        SUM(CASE WHEN createdAt >= UTC_TIMESTAMP() - INTERVAL 90 DAY THEN 1 ELSE 0 END)
          OVER (PARTITION BY phone) AS ordersLast90Days
      FROM orders
    )
    SELECT
      phone,
      firstName,
      lastName,
      email,
      unit,
      address,
      buildingSlug,
      totalOrders,
      lifetimeSpend,
      paidOrderCount,
      firstOrderAt,
      lastOrderAt,
      id AS lastOrderId,
      ordersLast30Days,
      ordersLast90Days
    FROM ranked
    WHERE rn = 1
  `);

  return result as unknown as AdminCustomerAggregateDbRow[];
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
  status: Order["status"]
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(orders).set({ status }).where(eq(orders.id, orderId));
}

export async function updateOrderIntake(
  orderId: number,
  data: Partial<InsertOrder>
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(orders).set(data).where(eq(orders.id, orderId));
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

  const result = await db
    .select({
      stripeCustomerId: orders.stripeCustomerId,
      stripePaymentMethodId: orders.stripePaymentMethodId,
    })
    .from(orders)
    .where(
      and(
        eq(orders.phone, phone),
        sql`${orders.stripeCustomerId} IS NOT NULL`,
        sql`${orders.stripePaymentMethodId} IS NOT NULL`,
        sql`${orders.stripePaymentMethodId} != ''`
      )
    )
    .orderBy(desc(orders.createdAt))
    .limit(1);

  if (result.length > 0 && result[0].stripeCustomerId && result[0].stripePaymentMethodId) {
    return {
      stripeCustomerId: result[0].stripeCustomerId,
      stripePaymentMethodId: result[0].stripePaymentMethodId,
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

export type CoordinatedRequestWithResident = ServiceRequest & { resident: BldgUser | null };

export async function listCoordinatedRequests(): Promise<CoordinatedRequestWithResident[]> {
  const db = await getDb();
  if (!db) return [];

  try {
    const rows = await db
      .select({
        request: serviceRequests,
        resident: {
          id: bldgUsers.id,
          firstName: bldgUsers.firstName,
          lastName: bldgUsers.lastName,
          phoneE164: bldgUsers.phoneE164,
          phone: bldgUsers.phone,
          buildingSlug: bldgUsers.buildingSlug,
          unit: bldgUsers.unit,
        },
      })
      .from(serviceRequests)
      .leftJoin(bldgUsers, eq(serviceRequests.bldgUserId, bldgUsers.id))
      .where(inArray(serviceRequests.serviceType, [...COORDINATED_SERVICE_TYPES]))
      .orderBy(desc(serviceRequests.createdAt));

    return rows.map((r) => ({ ...r.request, resident: r.resident?.id != null ? r.resident : null }));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[Requests] bldg_users join failed, returning requests without resident:", msg);
    const requestsOnly = await db
      .select()
      .from(serviceRequests)
      .where(inArray(serviceRequests.serviceType, [...COORDINATED_SERVICE_TYPES]))
      .orderBy(desc(serviceRequests.createdAt));
    return requestsOnly.map((r) => ({ ...r, resident: null }));
  }
}

export async function getNewCoordinatedRequestsCount(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(serviceRequests)
    .where(
      and(
        inArray(serviceRequests.serviceType, [...COORDINATED_SERVICE_TYPES]),
        inArray(serviceRequests.status, ["new", "pending"])
      )
    );

  return Number(result[0]?.count ?? 0);
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
