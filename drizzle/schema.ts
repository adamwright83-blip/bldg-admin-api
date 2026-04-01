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

  /* Revenue intervention — manual at-risk override (see server/revenueIntervention.ts) */
  manualRiskFlag: boolean("manualRiskFlag").default(false).notNull(),

  /* Timestamps */
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Order = typeof orders.$inferSelect;
export type InsertOrder = typeof orders.$inferInsert;

/**
 * Single row per tenant: weekly revenue target for deficit / predator UI.
 */
export const adminSettings = mysqlTable(
  "admin_settings",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull().default("default"),
    weeklyRevenueTargetCents: int("weeklyRevenueTargetCents").notNull().default(0),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    uqTenant: uniqueIndex("uq_admin_settings_tenant").on(table.tenantId),
  })
);

export type AdminSettings = typeof adminSettings.$inferSelect;
export type InsertAdminSettings = typeof adminSettings.$inferInsert;

/**
 * Audit log for revenue interventions (send reminder, invoice, etc.).
 * entity_type: order | customer; entity_id per revenueIntervention canonical rules.
 */
export const adminActionLog = mysqlTable("admin_action_log", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 64 }).notNull().default("default"),
  actionType: varchar("actionType", { length: 64 }).notNull(),
  entityType: mysqlEnum("entityType", ["order", "customer"]).notNull(),
  entityId: varchar("entityId", { length: 128 }).notNull(),
  dollarValueCents: int("dollarValueCents").notNull(),
  status: mysqlEnum("status", ["success", "reversed", "failed"]).notNull(),
  source: mysqlEnum("source", ["manual_action", "auto_capture"]).notNull(),
  executionTimeMs: int("executionTimeMs"),
  metadata: json("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AdminActionLog = typeof adminActionLog.$inferSelect;
export type InsertAdminActionLog = typeof adminActionLog.$inferInsert;

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
  chargesEnabled: boolean("chargesEnabled").default(false),
  payoutsEnabled: boolean("payoutsEnabled").default(false),
  detailsSubmitted: boolean("detailsSubmitted").default(false),
  currentlyDue: text("currentlyDue"),
  pastDue: text("pastDue"),
  disabledReason: varchar("disabledReason", { length: 255 }),
  platformFeePercent: decimal("platformFeePercent", { precision: 5, scale: 2 }),
  slug: varchar("slug", { length: 50 }),
  brandName: varchar("brandName", { length: 100 }),
  logoUrl: varchar("logoUrl", { length: 512 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/**
 * Vendor users — login credentials for vendor portal (auth separate from vendors table).
 */
export const vendorUsers = mysqlTable("vendor_users", {
  id: int("id").autoincrement().primaryKey(),
  vendorId: int("vendorId").notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  passwordHash: varchar("passwordHash", { length: 255 }).notNull(),
  role: varchar("role", { length: 50 }).default("user"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type VendorUser = typeof vendorUsers.$inferSelect;
export type InsertVendorUser = typeof vendorUsers.$inferInsert;

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

/**
 * Coordinated service requests from resident app (bldg.chat).
 * Filter by serviceType IN ('car-wash','grooming','other'). Resident context via bldg_users (bldgUserId).
 */
export const serviceRequests = mysqlTable("service_requests", {
  id: int("id").autoincrement().primaryKey(),
  bldgUserId: int("bldgUserId"),
  serviceType: varchar("serviceType", { length: 64 }).notNull(),
  status: varchar("status", { length: 64 }).notNull().default("new"),
  requestSummary: text("requestSummary"),
  requestJson: json("requestJson"),
  scheduledDate: varchar("scheduledDate", { length: 20 }),
  scheduledWindow: varchar("scheduledWindow", { length: 100 }),
  scheduledStartUtc: timestamp("scheduledStartUtc"),
  scheduledEndUtc: timestamp("scheduledEndUtc"),
  scheduledStartLocal: varchar("scheduledStartLocal", { length: 50 }),
  scheduledEndLocal: varchar("scheduledEndLocal", { length: 50 }),
  timezone: varchar("timezone", { length: 64 }),
  upgradeCode: varchar("upgradeCode", { length: 64 }),
  upgradePriceCents: int("upgradePriceCents"),
  upgradeLabel: varchar("upgradeLabel", { length: 255 }),
  paymentAdjustmentDueCents: int("paymentAdjustmentDueCents"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  receiptUrl: text("receiptUrl"),
  orderId: int("orderId"),
});

export type ServiceRequest = typeof serviceRequests.$inferSelect;
export type InsertServiceRequest = typeof serviceRequests.$inferInsert;

/**
 * Resident/users from bldg.chat app. Joined via service_requests.bldgUserId.
 * DB column names use snake_case (first_name, last_name, etc.); verify with scripts/check-bldg-users-columns.mjs.
 */
export const bldgUsers = mysqlTable("bldg_users", {
  id: int("id").autoincrement().primaryKey(),
  firstName: varchar("first_name", { length: 100 }),
  lastName: varchar("last_name", { length: 100 }),
  phoneE164: varchar("phone_e164", { length: 30 }),
  phone: varchar("phone", { length: 30 }),
  buildingSlug: varchar("building_slug", { length: 100 }),
  unit: varchar("unit", { length: 100 }),
});

export type BldgUser = typeof bldgUsers.$inferSelect;
export type InsertBldgUser = typeof bldgUsers.$inferInsert;

/**
 * Leads — submissions from the public "Add your building" form on contact.bldg.chat.
 * Displayed in the admin Leads tab for sales/onboarding follow-up.
 */
export const leads = mysqlTable("leads", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  buildingName: varchar("building_name", { length: 255 }).notNull(),
  role: varchar("role", { length: 100 }),
  email: varchar("email", { length: 320 }).notNull(),
  numberOfUnits: varchar("number_of_units", { length: 50 }),
  phone: varchar("phone", { length: 30 }),
  source: varchar("source", { length: 100 }).default("add_your_building_form"),
  sourceUrl: varchar("source_url", { length: 512 }),
  status: mysqlEnum("status", ["New", "Contacted", "Qualified", "Closed", "Spam"]).default("New").notNull(),
  isRead: boolean("is_read").default(false).notNull(),
  notes: text("notes"),
  assignedTo: varchar("assigned_to", { length: 255 }),
  submittedAt: timestamp("submitted_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type Lead = typeof leads.$inferSelect;
export type InsertLead = typeof leads.$inferInsert;

/**
 * Tenant-scoped sellable SKUs for admin catalog + resident-facing price lists.
 */
export const catalogItems = mysqlTable(
  "catalog_items",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull().default("default"),
    slug: varchar("slug", { length: 128 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    category: varchar("category", { length: 100 }).notNull(),
    /** dry_clean | wash_fold | alteration | other */
    serviceType: varchar("serviceType", { length: 32 }).notNull().default("dry_clean"),
    standardPriceCents: int("standardPriceCents").notNull(),
    expressPriceCents: int("expressPriceCents"),
    costCents: int("costCents"),
    isActive: boolean("isActive").notNull().default(true),
    isOnline: boolean("isOnline").notNull().default(false),
    archived: boolean("archived").notNull().default(false),
    sortOrder: int("sortOrder").notNull().default(0),
    iconUrl: varchar("iconUrl", { length: 512 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    uqTenantSlug: uniqueIndex("uq_catalog_items_tenant_slug").on(table.tenantId, table.slug),
  })
);

export type CatalogItem = typeof catalogItems.$inferSelect;
export type InsertCatalogItem = typeof catalogItems.$inferInsert;
