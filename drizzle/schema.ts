import { boolean, decimal, int, json, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 64 }).default("default"),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Pickup orders table — shared between customer-facing site and admin/driver views.
 *
 * Status flow: new → collected → processing → ready → delivered
 */
export const orders = mysqlTable("orders", {
  id: int("id").autoincrement().primaryKey(),

  /* Tenant */
  tenantId: varchar("tenantId", { length: 64 }).default("default"),

  /* Service info */
  serviceType: mysqlEnum("serviceType", ["wash_fold", "dry_cleaning"]).notNull(),

  /* Pickup schedule */
  pickupDate: varchar("pickupDate", { length: 20 }).notNull(),
  pickupTimeWindow: varchar("pickupTimeWindow", { length: 50 }).notNull(),

  /* Delivery schedule */
  deliveryDate: varchar("deliveryDate", { length: 20 }),
  deliveryTimeWindow: varchar("deliveryTimeWindow", { length: 50 }),

  /* Address */
  address: text("address").notNull(),
  unit: varchar("unit", { length: 50 }),
  specialInstructions: text("specialInstructions"),

  /* Customer contact */
  firstName: varchar("firstName", { length: 100 }).notNull(),
  lastName: varchar("lastName", { length: 100 }).notNull(),
  phone: varchar("phone", { length: 30 }).notNull(),
  email: varchar("email", { length: 320 }),
  bldgUserId: int("bldgUserId"), /* User ID from app.bldg.chat for chat notifications */

  /* Stripe — card saved on file */
  stripeCustomerId: varchar("stripeCustomerId", { length: 255 }),
  stripePaymentMethodId: varchar("stripePaymentMethodId", { length: 255 }),
  stripePaymentIntentId: varchar("stripePaymentIntentId", { length: 255 }),

  /* Order status */
  status: mysqlEnum("status", ["new", "collected", "processing", "ready", "delivered"])
    .default("new")
    .notNull(),

  /* Intake: weights & counts */
  weightLbs: decimal("weightLbs", { precision: 8, scale: 2 }),
  bagCount: int("bagCount").default(1),
  garmentCount: int("garmentCount"),

  /* Pricing */
  subtotal: decimal("subtotal", { precision: 10, scale: 2 }).default("0"),
  discountPercent: decimal("discountPercent", { precision: 5, scale: 2 }).default("0"),
  total: decimal("total", { precision: 10, scale: 2 }).default("0"),

  /* Line-item detail (JSON) */
  upchargesJson: json("upchargesJson"),
  drycleanItemsJson: json("drycleanItemsJson"),

  /* Payment */
  paid: boolean("paid").default(false).notNull(),

  /* First-paid portal enrollment */
  isFirstPaidOrder: boolean("isFirstPaidOrder").default(false).notNull(),
  portalJwt: text("portalJwt"),

  /* Vendor routing — snapshotted at order creation */
  buildingSlug: varchar("buildingSlug", { length: 100 }),
  vendorId: int("vendorId"),

  /* Payout audit — frozen at charge time */
  vendorNameSnapshot: varchar("vendorNameSnapshot", { length: 255 }),
  routingPrioritySnapshot: int("routingPrioritySnapshot"),
  platformFeeCents: int("platformFeeCents"),
  vendorPayoutCents: int("vendorPayoutCents"),
  stripeConnectedAccountIdSnapshot: varchar("stripeConnectedAccountIdSnapshot", { length: 255 }),

  /* Timestamps */
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Order = typeof orders.$inferSelect;
export type InsertOrder = typeof orders.$inferInsert;

/**
 * Vendors — service providers who fulfill orders (e.g. Laundry Butler).
 * Stripe Connect Express accounts are linked here.
 */
export const vendors = mysqlTable("vendors", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }),
  country: varchar("country", { length: 2 }).default("US"),
  isActive: boolean("isActive").default(true).notNull(),
  stripeConnectAccountId: varchar("stripeConnectAccountId", { length: 255 }),
  /* Stripe Connect status — persisted after every getConnectAccountStatus call */
  chargesEnabled: boolean("chargesEnabled").default(false),
  payoutsEnabled: boolean("payoutsEnabled").default(false),
  detailsSubmitted: boolean("detailsSubmitted").default(false),
  currentlyDue: text("currentlyDue"),
  pastDue: text("pastDue"),
  disabledReason: varchar("disabledReason", { length: 255 }),
  platformFeePercent: decimal("platformFeePercent", { precision: 5, scale: 2 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Vendor = typeof vendors.$inferSelect;
export type InsertVendor = typeof vendors.$inferInsert;

/**
 * Vendor service coverage — routing table for building+serviceType → vendor.
 * Phase 2: populated to enable automatic vendor assignment at order creation.
 */
export const vendorServiceCoverage = mysqlTable("vendor_service_coverage", {
  id: int("id").autoincrement().primaryKey(),
  vendorId: int("vendorId").notNull(),
  buildingSlug: varchar("buildingSlug", { length: 100 }).notNull(),
  serviceType: mysqlEnum("serviceType", ["wash_fold", "dry_cleaning"]).notNull(),
  priority: int("priority").default(10).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  isDefault: boolean("isDefault").default(false),
  notes: text("notes"),
  serviceArea: varchar("serviceArea", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  uniqueCoverage: uniqueIndex("uq_vendor_coverage").on(
    table.vendorId, table.buildingSlug, table.serviceType
  ),
}));

export type VendorServiceCoverage = typeof vendorServiceCoverage.$inferSelect;
export type InsertVendorServiceCoverage = typeof vendorServiceCoverage.$inferInsert;
