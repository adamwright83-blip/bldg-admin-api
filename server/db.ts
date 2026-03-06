import { and, asc, desc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser, users,
  orders, InsertOrder, Order,
  vendors, InsertVendor, Vendor,
  vendorServiceCoverage, InsertVendorServiceCoverage, VendorServiceCoverage,
} from "../drizzle/schema";
import { ENV } from './_core/env';

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

/* ===== ADMIN / DRIVER HELPERS ===== */

export async function getOrdersByStatus(
  status: Order["status"]
): Promise<Order[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(orders)
    .where(eq(orders.status, status))
    .orderBy(desc(orders.createdAt));
}

export async function getOrdersByDateAndStatus(
  date: string,
  status: Order["status"],
  dateField: "pickupDate" | "deliveryDate" = "pickupDate"
): Promise<Order[]> {
  const db = await getDb();
  if (!db) return [];

  const col = dateField === "deliveryDate" ? orders.deliveryDate : orders.pickupDate;
  return db
    .select()
    .from(orders)
    .where(and(eq(col, date), eq(orders.status, status)))
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
