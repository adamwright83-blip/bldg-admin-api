import { boolean, decimal, index, int, json, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

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
  role: mysqlEnum("role", ["user", "admin", "driver"]).default("user").notNull(),
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

  /* HELD resident request metadata */
  heldRawRequestText: text("heldRawRequestText"),
  heldCleanedRequestText: text("heldCleanedRequestText"),
  heldServiceSummary: text("heldServiceSummary"),
  heldRequestedPickupWindow: varchar("heldRequestedPickupWindow", { length: 255 }),
  heldRequestedReturnBy: varchar("heldRequestedReturnBy", { length: 255 }),
  heldSource: varchar("heldSource", { length: 64 }),
  heldMetadataJson: json("heldMetadataJson"),

  /* Resident-app idempotency key (one per "set it in motion" tap). Nullable for
   * all pre-existing and non-resident rows. A UNIQUE index (below) makes this the
   * DB-enforced exact-once guarantee: the same key can create at most one order,
   * even under concurrent retries. heldMetadataJson.clientRequestId is kept as a
   * debugging mirror only — it is NOT the atomic guarantee. */
  residentClientRequestId: varchar("residentClientRequestId", { length: 191 }),

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
  status: mysqlEnum("status", ["new", "intake-pending", "collected", "processing", "ready", "delivered", "cancelled"])
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
  /** Set when payment succeeds (Stripe PI time on charge); used for "Collected today" — not `updatedAt`. */
  paidAt: timestamp("paidAt"),

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
}, (table) => ({
  /* DB-enforced resident-laundry idempotency. MySQL allows multiple NULLs, so
   * old rows and non-resident (keyless) rows never collide; only real keys are
   * forced unique. This is the atomic exact-once guard for concurrent retries. */
  residentClientRequestIdUnq: uniqueIndex("orders_resident_client_request_id_unq").on(
    table.residentClientRequestId,
  ),
}));

export type Order = typeof orders.$inferSelect;
export type InsertOrder = typeof orders.$inferInsert;

export const operationsEvents = mysqlTable(
  "operations_events",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull().default("default"),
    businessUnitLabel: varchar("businessUnitLabel", { length: 128 }).notNull(),
    source: mysqlEnum("source", ["driver_app_bldg", "cleancloud_csv", "cleancloud_playbook", "system_backfill"]).notNull(),
    sourceEventType: mysqlEnum("sourceEventType", ["pickup_completed", "dropoff_completed"]).notNull(),
    eventStatus: mysqlEnum("eventStatus", ["completed", "corrected", "voided"]).notNull().default("completed"),
    orderId: int("orderId"),
    customerName: varchar("customerName", { length: 255 }).notNull(),
    customerPhone: varchar("customerPhone", { length: 30 }),
    customerEmail: varchar("customerEmail", { length: 320 }),
    serviceType: varchar("serviceType", { length: 64 }).notNull(),
    buildingName: varchar("buildingName", { length: 255 }),
    buildingSlug: varchar("buildingSlug", { length: 100 }),
    tower: varchar("tower", { length: 100 }),
    buildingResolutionStatus: mysqlEnum("buildingResolutionStatus", ["resolved", "unresolved_needs_mapping", "not_applicable"]).notNull(),
    unit: varchar("unit", { length: 50 }),
    scheduledDate: varchar("scheduledDate", { length: 20 }),
    scheduledWindow: varchar("scheduledWindow", { length: 50 }),
    actualEventTimestamp: timestamp("actualEventTimestamp").notNull(),
    actorUserId: varchar("actorUserId", { length: 128 }),
    actorDisplayName: varchar("actorDisplayName", { length: 255 }),
    vendorId: int("vendorId"),
    bagCount: int("bagCount"),
    garmentCount: int("garmentCount"),
    weightLbs: decimal("weightLbs", { precision: 8, scale: 2 }),
    rawJson: json("rawJson"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    sourceEventOrderUnique: uniqueIndex("uq_operations_events_source_type_order").on(table.source, table.sourceEventType, table.orderId),
    tenantTimeIdx: index("idx_operations_events_tenant_time").on(table.tenantId, table.actualEventTimestamp),
    sourceEventTypeIdx: index("idx_operations_events_event_type").on(table.sourceEventType),
    orderIdx: index("idx_operations_events_order").on(table.orderId),
    customerNameIdx: index("idx_operations_events_customer_name").on(table.customerName),
    buildingIdx: index("idx_operations_events_building").on(table.buildingSlug, table.tower),
    vendorIdx: index("idx_operations_events_vendor").on(table.vendorId),
    resolutionIdx: index("idx_operations_events_resolution").on(table.buildingResolutionStatus),
  })
);

export type OperationsEvent = typeof operationsEvents.$inferSelect;
export type InsertOperationsEvent = typeof operationsEvents.$inferInsert;

/**
 * Single row per tenant: weekly revenue target for deficit / predator UI.
 */
export const adminSettings = mysqlTable(
  "admin_settings",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull().default("default"),
    weeklyRevenueTargetCents: int("weeklyRevenueTargetCents").notNull().default(0),
    /** Added to pipeline sum for "Awaiting payment" — offline / not-yet-ordered exposure. Can be negative to trim display. */
    awaitingPaymentAdjustmentCents: int("awaitingPaymentAdjustmentCents").notNull().default(0),
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
  entityType: mysqlEnum("entityType", ["order", "customer", "building"]).notNull(),
  entityId: varchar("entityId", { length: 128 }).notNull(),
  dollarValueCents: int("dollarValueCents").notNull(),
  status: mysqlEnum("status", ["attempted", "delivered", "failed", "paid", "reversed"]).notNull(),
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
 * DB columns are camelCase (matches app.bldg.chat origin); verify with scripts/check-bldg-users-columns.mjs.
 */
export const bldgUsers = mysqlTable("bldg_users", {
  id: int("id").autoincrement().primaryKey(),
  firstName: varchar("firstName", { length: 100 }),
  lastName: varchar("lastName", { length: 100 }),
  phoneE164: varchar("phoneE164", { length: 30 }),
  phone: varchar("phone", { length: 30 }),
  buildingSlug: varchar("buildingSlug", { length: 100 }),
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
 * Sales call attempts — durable record of every Bold Pitch outbound call
 * (Saleslay's "call" weapon). Bridge-through-cellphone architecture: Twilio
 * dials the rep's own cellphone first (repLegCallSid), and only once that
 * leg is answered does it dial the lead/customer (customerLegCallSid). The
 * reward-eligible event is the CUSTOMER leg reaching >=20s connected
 * duration, mirroring the existing Level 4 war call-strike rule in
 * server/level4Twilio.ts. One row per attempt; idempotent on
 * repLegCallSid so a duplicate Twilio status callback can never double-count.
 */
export const salesCallAttempts = mysqlTable(
  "sales_call_attempts",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: varchar("tenant_id", { length: 64 }).default("default").notNull(),
    leadId: int("lead_id"),
    orderId: int("order_id"),
    repPhone: varchar("rep_phone", { length: 30 }).notNull(),
    customerPhone: varchar("customer_phone", { length: 30 }).notNull(),
    callerId: varchar("caller_id", { length: 30 }).notNull(),
    repLegCallSid: varchar("rep_leg_call_sid", { length: 64 }),
    customerLegCallSid: varchar("customer_leg_call_sid", { length: 64 }),
    status: mysqlEnum("status", [
      "dialing_rep",
      "rep_connected",
      "dialing_customer",
      "customer_connected",
      "completed_success",
      "completed_no_connect",
      "failed",
    ])
      .default("dialing_rep")
      .notNull(),
    customerLegDurationSec: int("customer_leg_duration_sec"),
    recordingEnabled: boolean("recording_enabled").default(false).notNull(),
    rewardGranted: boolean("reward_granted").default(false).notNull(),
    failureReason: varchar("failure_reason", { length: 255 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    repLegCallSidIdx: uniqueIndex("sales_call_attempts_rep_leg_call_sid_idx").on(table.repLegCallSid),
  })
);

export type SalesCallAttempt = typeof salesCallAttempts.$inferSelect;
export type InsertSalesCallAttempt = typeof salesCallAttempts.$inferInsert;

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

export const drycleanReceiptIntakes = mysqlTable("dryclean_receipt_intakes", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 64 }).notNull().default("default"),
  orderId: int("orderId"),
  receiptImageKey: varchar("receiptImageKey", { length: 512 }).notNull(),
  receiptImageUrl: text("receiptImageUrl"),
  assignedCustomerPhone: varchar("assignedCustomerPhone", { length: 30 }),
  assignedCustomerName: varchar("assignedCustomerName", { length: 255 }),
  assignedCustomerUnit: varchar("assignedCustomerUnit", { length: 50 }),
  assignedBuildingSlug: varchar("assignedBuildingSlug", { length: 100 }),
  dryCleanerRetailTotalCents: int("dryCleanerRetailTotalCents").notNull().default(0),
  partnerDiscountPercent: int("partnerDiscountPercent").notNull().default(40),
  partnerCostCents: int("partnerCostCents").notNull().default(0),
  laundryButlerRetailSubtotalCents: int("laundryButlerRetailSubtotalCents").notNull().default(0),
  customerDiscountPercentAtDraft: int("customerDiscountPercentAtDraft").notNull().default(0),
  customerTotalCentsAtDraft: int("customerTotalCentsAtDraft").notNull().default(0),
  estimatedGrossMarginCents: int("estimatedGrossMarginCents").notNull().default(0),
  parseJson: json("parseJson"),
  matchJson: json("matchJson"),
  status: mysqlEnum("status", ["uploaded", "parsed", "reviewed", "order_created", "failed"]).notNull().default("uploaded"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DrycleanReceiptIntake = typeof drycleanReceiptIntakes.$inferSelect;
export type InsertDrycleanReceiptIntake = typeof drycleanReceiptIntakes.$inferInsert;

export const cleancloudImportBatches = mysqlTable("cleancloud_import_batches", {
  id: int("id").autoincrement().primaryKey(),
  source: varchar("source", { length: 64 }).notNull().default("cleancloud"),
  sourceFileName: varchar("sourceFileName", { length: 255 }).notNull(),
  importedRowCount: int("importedRowCount").notNull().default(0),
  skippedRowCount: int("skippedRowCount").notNull().default(0),
  duplicateRowCount: int("duplicateRowCount").notNull().default(0),
  importStatus: mysqlEnum("importStatus", ["completed", "completed_with_errors", "failed"]).notNull().default("completed"),
  errorJson: json("errorJson"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type CleancloudImportBatch = typeof cleancloudImportBatches.$inferSelect;
export type InsertCleancloudImportBatch = typeof cleancloudImportBatches.$inferInsert;

export const cleancloudLegacyOrders = mysqlTable(
  "cleancloud_legacy_orders",
  {
    id: int("id").autoincrement().primaryKey(),
    cleancloudOrderId: varchar("cleancloudOrderId", { length: 128 }),
    sourceFileName: varchar("sourceFileName", { length: 255 }).notNull(),
    importBatchId: int("importBatchId").notNull(),
    customerName: varchar("customerName", { length: 255 }).notNull(),
    customerEmail: varchar("customerEmail", { length: 320 }),
    customerPhone: varchar("customerPhone", { length: 30 }),
    orderDateUtc: timestamp("orderDateUtc").notNull(),
    completedDateUtc: timestamp("completedDateUtc"),
    orderStatus: varchar("orderStatus", { length: 100 }).notNull(),
    orderTotalCents: int("orderTotalCents").notNull().default(0),
    paymentStatus: varchar("paymentStatus", { length: 100 }).notNull(),
    serviceType: varchar("serviceType", { length: 100 }).notNull(),
    buildingName: varchar("buildingName", { length: 255 }),
    tower: varchar("tower", { length: 100 }),
    unit: varchar("unit", { length: 50 }),
    rawJson: json("rawJson"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    cleancloudOrderIdUnique: uniqueIndex("uq_cleancloud_legacy_order_id").on(table.cleancloudOrderId),
    batchIdx: index("idx_cleancloud_legacy_orders_batch").on(table.importBatchId),
    customerOrderIdx: index("idx_cleancloud_legacy_orders_customer_order").on(
      table.customerName,
      table.orderDateUtc,
      table.orderTotalCents
    ),
    buildingIdx: index("idx_cleancloud_legacy_orders_building").on(table.buildingName, table.tower),
  })
);

export type CleancloudLegacyOrder = typeof cleancloudLegacyOrders.$inferSelect;
export type InsertCleancloudLegacyOrder = typeof cleancloudLegacyOrders.$inferInsert;

export const cleancloudPaidOrders = mysqlTable(
  "cleancloud_paid_orders",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull().default("default"),
    sourceReportType: mysqlEnum("sourceReportType", ["orders_sales", "orders_revenue"]).notNull(),
    sourceFileName: varchar("sourceFileName", { length: 255 }).notNull(),
    importBatchId: int("importBatchId").notNull(),
    cleancloudOrderId: varchar("cleancloudOrderId", { length: 128 }).notNull(),
    cleancloudCustomerId: varchar("cleancloudCustomerId", { length: 128 }),
    customerName: varchar("customerName", { length: 255 }).notNull(),
    customerEmail: varchar("customerEmail", { length: 320 }),
    customerPhone: varchar("customerPhone", { length: 30 }),
    address: text("address"),
    placedAtUtc: timestamp("placedAtUtc"),
    paymentDateUtc: timestamp("paymentDateUtc"),
    paidDateUtc: timestamp("paidDateUtc"),
    readyByDateUtc: timestamp("readyByDateUtc"),
    collectedAtUtc: timestamp("collectedAtUtc"),
    cleanedAtUtc: timestamp("cleanedAtUtc"),
    orderStatus: varchar("orderStatus", { length: 100 }),
    paid: boolean("paid").notNull().default(false),
    paymentType: varchar("paymentType", { length: 100 }),
    cardPaymentType: varchar("cardPaymentType", { length: 100 }),
    totalCents: int("totalCents").notNull().default(0),
    subtotalCents: int("subtotalCents"),
    discountCents: int("discountCents"),
    creditCents: int("creditCents"),
    totalWeightLbs: decimal("totalWeightLbs", { precision: 8, scale: 2 }),
    summaryText: text("summaryText"),
    buildingName: varchar("buildingName", { length: 255 }),
    buildingSlug: varchar("buildingSlug", { length: 100 }),
    tower: varchar("tower", { length: 100 }),
    unit: varchar("unit", { length: 50 }),
    buildingResolutionStatus: mysqlEnum("buildingResolutionStatus", ["resolved", "unresolved_needs_mapping", "not_applicable"]).notNull(),
    rawJson: json("rawJson"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    orderReportUnique: uniqueIndex("uq_cleancloud_paid_order_report").on(table.cleancloudOrderId, table.sourceReportType),
    batchIdx: index("idx_cleancloud_paid_orders_batch").on(table.importBatchId),
    paymentDateIdx: index("idx_cleancloud_paid_orders_payment_date").on(table.paymentDateUtc),
    paidDateIdx: index("idx_cleancloud_paid_orders_paid_date").on(table.paidDateUtc),
    customerIdx: index("idx_cleancloud_paid_orders_customer").on(table.cleancloudCustomerId, table.customerName),
    buildingIdx: index("idx_cleancloud_paid_orders_building").on(table.buildingSlug, table.tower),
  })
);

export type CleancloudPaidOrder = typeof cleancloudPaidOrders.$inferSelect;
export type InsertCleancloudPaidOrder = typeof cleancloudPaidOrders.$inferInsert;

export const clearentImportBatches = mysqlTable("clearent_import_batches", {
  id: int("id").autoincrement().primaryKey(),
  source: varchar("source", { length: 64 }).notNull().default("clearent_xplorpay"),
  sourceFileName: varchar("sourceFileName", { length: 255 }).notNull(),
  sourceReportBasis: mysqlEnum("sourceReportBasis", ["settled_date", "entered_date", "unknown"]).notNull().default("unknown"),
  importedRowCount: int("importedRowCount").notNull().default(0),
  skippedRowCount: int("skippedRowCount").notNull().default(0),
  duplicateRowCount: int("duplicateRowCount").notNull().default(0),
  importStatus: mysqlEnum("importStatus", ["completed", "completed_with_errors", "failed"]).notNull().default("completed"),
  errorJson: json("errorJson"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ClearentImportBatch = typeof clearentImportBatches.$inferSelect;
export type InsertClearentImportBatch = typeof clearentImportBatches.$inferInsert;

export const clearentTransactions = mysqlTable(
  "clearent_transactions",
  {
    id: int("id").autoincrement().primaryKey(),
    clearentTransactionId: varchar("clearentTransactionId", { length: 128 }),
    sourceFileName: varchar("sourceFileName", { length: 255 }).notNull(),
    importBatchId: int("importBatchId").notNull(),
    sourceReportBasis: mysqlEnum("sourceReportBasis", ["settled_date", "entered_date", "unknown"]).notNull().default("unknown"),
    merchantId: varchar("merchantId", { length: 128 }),
    merchantName: varchar("merchantName", { length: 255 }),
    transactionDateUtc: timestamp("transactionDateUtc"),
    enteredDateUtc: timestamp("enteredDateUtc"),
    settledDateUtc: timestamp("settledDateUtc"),
    depositDateUtc: timestamp("depositDateUtc"),
    cardType: varchar("cardType", { length: 64 }),
    lastFour: varchar("lastFour", { length: 4 }),
    customerName: varchar("customerName", { length: 255 }),
    customerEmail: varchar("customerEmail", { length: 320 }),
    customerPhone: varchar("customerPhone", { length: 30 }),
    grossAmountCents: int("grossAmountCents").notNull().default(0),
    netAmountCents: int("netAmountCents"),
    feeAmountCents: int("feeAmountCents"),
    depositAmountCents: int("depositAmountCents"),
    transactionStatus: varchar("transactionStatus", { length: 100 }).notNull().default("unknown"),
    transactionType: varchar("transactionType", { length: 100 }).notNull().default("unknown"),
    authCode: varchar("authCode", { length: 128 }),
    batchId: varchar("batchId", { length: 128 }),
    buildingName: varchar("buildingName", { length: 255 }),
    tower: varchar("tower", { length: 100 }),
    unit: varchar("unit", { length: 50 }),
    matchedOrderId: int("matchedOrderId"),
    matchedCustomerId: int("matchedCustomerId"),
    rawJson: json("rawJson"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    clearentTransactionIdUnique: uniqueIndex("uq_clearent_transaction_id").on(table.clearentTransactionId),
    batchIdx: index("idx_clearent_transactions_batch").on(table.importBatchId),
    enteredDateIdx: index("idx_clearent_transactions_entered").on(table.enteredDateUtc),
    settledDateIdx: index("idx_clearent_transactions_settled").on(table.settledDateUtc),
    authMatchIdx: index("idx_clearent_transactions_auth_match").on(table.authCode, table.grossAmountCents, table.lastFour),
    buildingIdx: index("idx_clearent_transactions_building").on(table.buildingName, table.tower),
  })
);

export type ClearentTransaction = typeof clearentTransactions.$inferSelect;
export type InsertClearentTransaction = typeof clearentTransactions.$inferInsert;

export const clearentDailySummaries = mysqlTable(
  "clearent_daily_summaries",
  {
    id: int("id").autoincrement().primaryKey(),
    sourceFileName: varchar("sourceFileName", { length: 255 }).notNull(),
    importBatchId: int("importBatchId").notNull(),
    sourceReportBasis: mysqlEnum("sourceReportBasis", ["settled_date", "entered_date", "unknown"]).notNull().default("unknown"),
    reportDateUtc: timestamp("reportDateUtc").notNull(),
    totalSalesCents: int("totalSalesCents").notNull().default(0),
    netSalesCents: int("netSalesCents"),
    totalTransactions: int("totalTransactions"),
    interchangeCents: int("interchangeCents"),
    discountCents: int("discountCents"),
    depositAmountCents: int("depositAmountCents"),
    rawJson: json("rawJson"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    basisDateUnique: uniqueIndex("uq_clearent_daily_summary_basis_date").on(table.sourceReportBasis, table.reportDateUtc),
    batchIdx: index("idx_clearent_daily_summaries_batch").on(table.importBatchId),
    reportDateIdx: index("idx_clearent_daily_summaries_report_date").on(table.reportDateUtc),
  })
);

export type ClearentDailySummary = typeof clearentDailySummaries.$inferSelect;
export type InsertClearentDailySummary = typeof clearentDailySummaries.$inferInsert;

export const paymentReconciliationMatches = mysqlTable(
  "payment_reconciliation_matches",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull().default("default"),
    processor: mysqlEnum("processor", ["clearent", "stripe", "manual"]).notNull(),
    processorSourceType: mysqlEnum("processorSourceType", ["clearent_daily_summary", "clearent_transaction", "stripe_payment"]).notNull(),
    processorSourceId: varchar("processorSourceId", { length: 128 }),
    orderSource: mysqlEnum("orderSource", ["cleancloud_orders_sales", "cleancloud_orders_revenue", "bldg", "manual"]).notNull(),
    orderId: int("orderId"),
    cleancloudOrderId: varchar("cleancloudOrderId", { length: 128 }),
    cleancloudCustomerId: varchar("cleancloudCustomerId", { length: 128 }),
    customerName: varchar("customerName", { length: 255 }),
    customerEmail: varchar("customerEmail", { length: 320 }),
    customerPhone: varchar("customerPhone", { length: 30 }),
    buildingName: varchar("buildingName", { length: 255 }),
    buildingSlug: varchar("buildingSlug", { length: 100 }),
    tower: varchar("tower", { length: 100 }),
    unit: varchar("unit", { length: 50 }),
    matchedAmountCents: int("matchedAmountCents").notNull().default(0),
    matchStatus: mysqlEnum("matchStatus", [
      "customer_match",
      "date_total_match",
      "manual_match",
      "possible_duplicate",
      "unmatched",
      "needs_review",
      "ignored",
    ]).notNull(),
    matchConfidence: mysqlEnum("matchConfidence", ["high", "medium", "low"]).notNull(),
    matchReason: text("matchReason").notNull(),
    localBusinessDate: varchar("localBusinessDate", { length: 20 }).notNull(),
    rawJson: json("rawJson"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    sourceDateIdx: index("idx_payment_reconciliation_source_date").on(
      table.processor,
      table.processorSourceType,
      table.processorSourceId,
      table.localBusinessDate
    ),
    statusIdx: index("idx_payment_reconciliation_status").on(table.matchStatus),
    customerIdx: index("idx_payment_reconciliation_customer").on(table.cleancloudCustomerId, table.customerName),
    buildingIdx: index("idx_payment_reconciliation_building").on(table.buildingSlug, table.tower),
  })
);

export type PaymentReconciliationMatch = typeof paymentReconciliationMatches.$inferSelect;
export type InsertPaymentReconciliationMatch = typeof paymentReconciliationMatches.$inferInsert;

export const operatorTasks = mysqlTable("operator_tasks", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 64 }).notNull().default("default"),
  source: mysqlEnum("source", ["emergency_composer", "operator_voice", "manual"]).notNull().default("emergency_composer"),
  level: mysqlEnum("level", ["level_1", "level_2", "level_3", "level_4"]).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  details: text("details"),
  status: mysqlEnum("status", ["open", "in_progress", "done", "blocked"]).notNull().default("open"),
  priority: mysqlEnum("priority", ["emergency", "high", "normal", "low"]).notNull().default("high"),
  target: varchar("target", { length: 255 }),
  sourceNote: text("sourceNote"),
  createdByUserId: varchar("createdByUserId", { length: 128 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type OperatorTask = typeof operatorTasks.$inferSelect;
export type InsertOperatorTask = typeof operatorTasks.$inferInsert;

export const opsTasks = mysqlTable("ops_tasks", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 64 }).notNull().default("default"),
  lane: mysqlEnum("lane", ["lane_1", "lane_2", "lane_3", "level_4"]).notNull(),
  level: mysqlEnum("level", ["1", "2", "3", "4"]).notNull(),
  taskType: mysqlEnum("taskType", [
    "intake_missing_price",
    "unpaid_order",
    "vague_intake",
    "missed_pickup",
    "stale_customer",
    "revenue_leak",
    "referral_ask",
    "vendor_followup",
    "gm_followup",
    "manual_operator_task",
    "dry_clean_receipt_intake",
    "emergency_task",
  ]).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  source: mysqlEnum("source", ["manual", "agent_suggested", "system_detected", "level_4", "voice", "quick_input", "emergency_composer"]).notNull().default("manual"),
  createdBy: varchar("createdBy", { length: 128 }),
  assignedTo: varchar("assignedTo", { length: 128 }),
  status: mysqlEnum("status", ["open", "accepted", "in_progress", "completed", "dismissed", "expired"]).notNull().default("open"),
  priority: mysqlEnum("priority", ["low", "normal", "high", "emergency"]).notNull().default("normal"),
  revenueAtRiskCents: int("revenueAtRiskCents").notNull().default(0),
  revenueRecoveredCents: int("revenueRecoveredCents").notNull().default(0),
  customerId: int("customerId"),
  orderId: int("orderId"),
  agentEventId: int("agentEventId"),
  metadataJson: json("metadataJson"),
  outcome: text("outcome"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  completedAt: timestamp("completedAt"),
  completedBy: varchar("completedBy", { length: 128 }),
}, (table) => ({
  tenantStatusIdx: index("idx_ops_tasks_tenant_status").on(table.tenantId, table.status),
  tenantLaneIdx: index("idx_ops_tasks_tenant_lane").on(table.tenantId, table.lane),
  tenantCompletedIdx: index("idx_ops_tasks_tenant_completed").on(table.tenantId, table.completedAt),
  agentEventIdx: index("idx_ops_tasks_agent_event").on(table.agentEventId),
  orderIdx: index("idx_ops_tasks_order").on(table.orderId),
}));

export type OpsTask = typeof opsTasks.$inferSelect;
export type InsertOpsTask = typeof opsTasks.$inferInsert;

export const opsTaskEvents = mysqlTable("ops_task_events", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 64 }).notNull().default("default"),
  taskId: int("taskId").notNull(),
  eventType: mysqlEnum("eventType", [
    "created",
    "viewed",
    "accepted",
    "completed",
    "dismissed",
    "expired",
    "agent_suggested",
    "human_approved",
    "revenue_recovered",
    "outcome_recorded",
  ]).notNull(),
  actorType: mysqlEnum("actorType", ["human", "voice", "resident_chat", "driver", "vendor", "ai_agent", "system"]).notNull().default("human"),
  actorId: varchar("actorId", { length: 128 }),
  agentEventId: int("agentEventId"),
  beforeJson: json("beforeJson"),
  afterJson: json("afterJson"),
  note: text("note"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  tenantTaskIdx: index("idx_ops_task_events_tenant_task").on(table.tenantId, table.taskId),
  tenantEventIdx: index("idx_ops_task_events_tenant_event").on(table.tenantId, table.eventType),
  agentEventIdx: index("idx_ops_task_events_agent_event").on(table.agentEventId),
}));

export type OpsTaskEvent = typeof opsTaskEvents.$inferSelect;
export type InsertOpsTaskEvent = typeof opsTaskEvents.$inferInsert;

export const commercialAccounts = mysqlTable("commercial_accounts", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 64 }).notNull(),
  identityKey: varchar("identityKey", { length: 64 }),
  name: varchar("name", { length: 255 }).notNull(),
  accountType: varchar("accountType", { length: 96 }).notNull(),
  providerName: varchar("providerName", { length: 64 }),
  providerAccountId: varchar("providerAccountId", { length: 191 }),
  website: varchar("website", { length: 512 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  tenantNameIdx: index("idx_commercial_accounts_tenant_name").on(table.tenantId, table.name),
  tenantIdentityUnique: uniqueIndex("uq_commercial_accounts_tenant_identity").on(table.tenantId, table.identityKey),
  tenantProviderUnique: uniqueIndex("uq_commercial_accounts_tenant_provider").on(
    table.tenantId,
    table.providerName,
    table.providerAccountId,
  ),
}));

export const commercialAccountLocations = mysqlTable("commercial_account_locations", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 64 }).notNull(),
  accountId: int("accountId").notNull(),
  locationKey: varchar("locationKey", { length: 64 }),
  label: varchar("label", { length: 128 }),
  address: varchar("address", { length: 512 }).notNull(),
  latitude: decimal("latitude", { precision: 10, scale: 7 }).notNull(),
  longitude: decimal("longitude", { precision: 10, scale: 7 }).notNull(),
  isPrimary: boolean("isPrimary").notNull().default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  tenantAccountIdx: index("idx_commercial_locations_tenant_account").on(table.tenantId, table.accountId),
  tenantAccountLocationUnique: uniqueIndex("uq_commercial_locations_tenant_account_key").on(table.tenantId, table.accountId, table.locationKey),
}));

export const commercialAccountContacts = mysqlTable("commercial_account_contacts", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 64 }).notNull(),
  accountId: int("accountId").notNull(),
  contactKey: varchar("contactKey", { length: 64 }),
  name: varchar("name", { length: 255 }),
  title: varchar("title", { length: 255 }),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 64 }),
  sourceUrl: varchar("sourceUrl", { length: 1024 }),
  sourcedAt: timestamp("sourcedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  tenantAccountIdx: index("idx_commercial_contacts_tenant_account").on(table.tenantId, table.accountId),
  tenantAccountContactUnique: uniqueIndex("uq_commercial_contacts_tenant_account_key").on(table.tenantId, table.accountId, table.contactKey),
}));

export const commercialOpportunities = mysqlTable("commercial_opportunities", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 64 }).notNull(),
  accountId: int("accountId").notNull(),
  score: int("score").notNull(),
  grade: mysqlEnum("grade", ["low", "medium", "high"]).notNull(),
  estimatedAnnualValueCents: int("estimatedAnnualValueCents").notNull(),
  estimateConfidence: mysqlEnum("estimateConfidence", ["low", "medium", "high"]).notNull(),
  primarySignal: text("primarySignal").notNull(),
  reasonsJson: json("reasonsJson").notNull(),
  risksJson: json("risksJson").notNull(),
  evidenceJson: json("evidenceJson").notNull(),
  scoredAt: timestamp("scoredAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  tenantAccountIdx: index("idx_commercial_opportunities_tenant_account").on(table.tenantId, table.accountId),
  tenantScoreIdx: index("idx_commercial_opportunities_tenant_score").on(table.tenantId, table.score),
}));

export const commercialMissions = mysqlTable("commercial_missions", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 64 }).notNull(),
  opportunityId: int("opportunityId"),
  opsTaskId: int("opsTaskId"),
  assignedTo: varchar("assignedTo", { length: 128 }),
  code: varchar("code", { length: 32 }).notNull(),
  status: mysqlEnum("status", [
    "candidate", "selected", "game_ready", "game_active", "game_completed",
    "phone_ready", "preparing", "en_route", "arrived", "visit_completed",
    "follow_up", "won", "lost",
  ]).notNull().default("candidate"),
  version: int("version").notNull().default(1),
  accountSnapshotJson: json("accountSnapshotJson").notNull(),
  opportunitySnapshotJson: json("opportunitySnapshotJson").notNull(),
  missionBriefJson: json("missionBriefJson").notNull(),
  expiresAt: timestamp("expiresAt"),
  createdBy: varchar("createdBy", { length: 128 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  completedAt: timestamp("completedAt"),
}, (table) => ({
  tenantCodeUnique: uniqueIndex("uq_commercial_missions_tenant_code").on(table.tenantId, table.code),
  tenantStatusIdx: index("idx_commercial_missions_tenant_status").on(table.tenantId, table.status),
  tenantAssigneeIdx: index("idx_commercial_missions_tenant_assignee").on(table.tenantId, table.assignedTo),
}));

export const commercialMissionEvents = mysqlTable("commercial_mission_events", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 64 }).notNull(),
  missionId: int("missionId").notNull(),
  eventName: varchar("eventName", { length: 64 }).notNull(),
  fromStatus: varchar("fromStatus", { length: 32 }),
  toStatus: varchar("toStatus", { length: 32 }),
  actorType: mysqlEnum("actorType", ["system", "operator", "driver", "game"]).notNull(),
  actorId: varchar("actorId", { length: 128 }),
  idempotencyKey: varchar("idempotencyKey", { length: 191 }).notNull(),
  metadataJson: json("metadataJson"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  tenantMissionIdx: index("idx_commercial_mission_events_tenant_mission").on(table.tenantId, table.missionId),
  tenantIdempotencyUnique: uniqueIndex("uq_commercial_mission_events_tenant_idempotency").on(table.tenantId, table.idempotencyKey),
}));

export const commercialMissionSteps = mysqlTable("commercial_mission_steps", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 64 }).notNull(),
  missionId: int("missionId").notNull(),
  stepKey: varchar("stepKey", { length: 64 }).notNull(),
  label: varchar("label", { length: 255 }).notNull(),
  detail: text("detail").notNull(),
  status: mysqlEnum("status", ["locked", "ready", "active", "completed", "skipped"]).notNull(),
  position: int("position").notNull(),
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  tenantMissionStepUnique: uniqueIndex("uq_commercial_mission_steps_tenant_mission_key").on(table.tenantId, table.missionId, table.stepKey),
}));

export const commercialMissionGameAttempts = mysqlTable("commercial_mission_game_attempts", {
  id: varchar("id", { length: 36 }).primaryKey(),
  tenantId: varchar("tenantId", { length: 64 }).notNull(),
  missionId: int("missionId").notNull(),
  missionVersion: int("missionVersion").notNull(),
  playerId: varchar("playerId", { length: 128 }).notNull(),
  status: mysqlEnum("status", ["active", "abandoned", "failed", "qualified"]).notNull().default("active"),
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  endedAt: timestamp("endedAt"),
  durationMs: int("durationMs"),
  telemetryJson: json("telemetryJson"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  tenantMissionIdx: index("idx_commercial_game_attempts_tenant_mission").on(table.tenantId, table.missionId, table.startedAt),
  tenantPlayerIdx: index("idx_commercial_game_attempts_tenant_player").on(table.tenantId, table.playerId, table.startedAt),
}));

export const commercialMissionGameResults = mysqlTable("commercial_mission_game_results", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 64 }).notNull(),
  missionId: int("missionId").notNull(),
  missionVersion: int("missionVersion").notNull(),
  gameAttemptId: varchar("gameAttemptId", { length: 36 }).notNull(),
  playerId: varchar("playerId", { length: 128 }).notNull(),
  sparkScore: int("sparkScore").notNull(),
  clockheadScore: int("clockheadScore").notNull(),
  durationMs: int("durationMs").notNull(),
  replayJson: json("replayJson").notNull(),
  qualifiedAt: timestamp("qualifiedAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  tenantMissionUnique: uniqueIndex("uq_commercial_game_results_tenant_mission").on(table.tenantId, table.missionId),
  tenantAttemptUnique: uniqueIndex("uq_commercial_game_results_tenant_attempt").on(table.tenantId, table.gameAttemptId),
}));

export const commercialMissionGameRewards = mysqlTable("commercial_mission_game_rewards", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 64 }).notNull(),
  missionId: int("missionId").notNull(),
  gameResultId: int("gameResultId").notNull(),
  playerId: varchar("playerId", { length: 128 }).notNull(),
  xpAwarded: int("xpAwarded").notNull(),
  streakDays: int("streakDays").notNull(),
  awardedAt: timestamp("awardedAt").defaultNow().notNull(),
}, (table) => ({
  tenantMissionUnique: uniqueIndex("uq_commercial_game_rewards_tenant_mission").on(table.tenantId, table.missionId),
  tenantResultUnique: uniqueIndex("uq_commercial_game_rewards_tenant_result").on(table.tenantId, table.gameResultId),
}));

export const commercialVisitOutcomes = mysqlTable("commercial_visit_outcomes", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 64 }).notNull(),
  missionId: int("missionId").notNull(),
  outcome: mysqlEnum("outcome", ["follow_up", "won", "lost"]).notNull(),
  notes: text("notes"),
  followUpAt: timestamp("followUpAt"),
  estimatedContractValueCents: int("estimatedContractValueCents"),
  decisionMakerStatus: mysqlEnum("decisionMakerStatus", ["met", "unavailable", "not_recorded"]).notNull().default("not_recorded"),
  collateralDelivered: boolean("collateralDelivered").notNull().default(false),
  quoteRequested: boolean("quoteRequested").notNull().default(false),
  pilotRequested: boolean("pilotRequested").notNull().default(false),
  followUpRequested: boolean("followUpRequested").notNull().default(false),
  reason: varchar("reason", { length: 64 }),
  evidenceJson: json("evidenceJson").notNull(),
  recordedBy: varchar("recordedBy", { length: 128 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  tenantMissionIdx: index("idx_commercial_visit_outcomes_tenant_mission").on(table.tenantId, table.missionId),
  tenantMissionUnique: uniqueIndex("uq_commercial_visit_outcomes_tenant_mission").on(table.tenantId, table.missionId),
}));

export const tenantFieldChecklistTemplates = mysqlTable("tenant_field_checklist_templates", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 64 }).notNull(),
  itemKey: varchar("itemKey", { length: 64 }).notNull(),
  label: varchar("label", { length: 255 }).notNull(),
  detail: text("detail").notNull(),
  required: boolean("required").notNull().default(true),
  position: int("position").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  tenantItemUnique: uniqueIndex("uq_tenant_field_checklist_item").on(table.tenantId, table.itemKey),
  tenantPositionIdx: index("idx_tenant_field_checklist_position").on(table.tenantId, table.position),
}));

export const commercialMissionFieldStates = mysqlTable("commercial_mission_field_states", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 64 }).notNull(),
  missionId: int("missionId").notNull(),
  version: int("version").notNull().default(1),
  notes: text("notes").notNull(),
  preparationStartedAt: timestamp("preparationStartedAt"),
  departedAt: timestamp("departedAt"),
  arrivedAt: timestamp("arrivedAt"),
  checkInMethod: mysqlEnum("checkInMethod", ["manual", "location"]),
  latitude: decimal("latitude", { precision: 10, scale: 7 }),
  longitude: decimal("longitude", { precision: 10, scale: 7 }),
  locationAccuracyMeters: int("locationAccuracyMeters"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  tenantMissionUnique: uniqueIndex("uq_commercial_field_states_tenant_mission").on(table.tenantId, table.missionId),
}));

export const commercialMissionFieldChecklistItems = mysqlTable("commercial_mission_field_checklist_items", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 64 }).notNull(),
  missionId: int("missionId").notNull(),
  itemKey: varchar("itemKey", { length: 64 }).notNull(),
  label: varchar("label", { length: 255 }).notNull(),
  detail: text("detail").notNull(),
  required: boolean("required").notNull(),
  position: int("position").notNull(),
  status: mysqlEnum("status", ["pending", "completed", "skipped"]).notNull().default("pending"),
  completedAt: timestamp("completedAt"),
  completedBy: varchar("completedBy", { length: 128 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  tenantMissionItemUnique: uniqueIndex("uq_commercial_field_items_tenant_mission_item").on(table.tenantId, table.missionId, table.itemKey),
  tenantMissionPositionIdx: index("idx_commercial_field_items_tenant_mission_position").on(table.tenantId, table.missionId, table.position),
}));

export const commercialMissionPhoneHandoffs = mysqlTable("commercial_mission_phone_handoffs", {
  id: varchar("id", { length: 36 }).primaryKey(),
  tenantId: varchar("tenantId", { length: 64 }).notNull(),
  missionId: int("missionId").notNull(),
  assignedTo: varchar("assignedTo", { length: 128 }).notNull(),
  channel: mysqlEnum("channel", ["secure_link", "sms", "email"]).notNull(),
  tokenHash: varchar("tokenHash", { length: 64 }).notNull(),
  targetMasked: varchar("targetMasked", { length: 320 }),
  expiresAt: timestamp("expiresAt").notNull(),
  consumedAt: timestamp("consumedAt"),
  consumedBy: varchar("consumedBy", { length: 128 }),
  createdBy: varchar("createdBy", { length: 128 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  tenantTokenUnique: uniqueIndex("uq_commercial_phone_handoffs_tenant_token").on(table.tenantId, table.tokenHash),
  tenantMissionIdx: index("idx_commercial_phone_handoffs_tenant_mission").on(table.tenantId, table.missionId, table.createdAt),
}));

export const tenantCommercialProposalProfiles = mysqlTable("tenant_commercial_proposal_profiles", {
  tenantId: varchar("tenantId", { length: 64 }).primaryKey(),
  storeName: varchar("storeName", { length: 255 }).notNull(),
  operatorName: varchar("operatorName", { length: 255 }).notNull(),
  phone: varchar("phone", { length: 64 }).notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  website: varchar("website", { length: 512 }).notNull(),
  address: varchar("address", { length: 512 }).notNull(),
  logoUrl: varchar("logoUrl", { length: 1024 }),
  commercialPricePerPoundCents: int("commercialPricePerPoundCents").notNull(),
  minimumOrderCents: int("minimumOrderCents"),
  turnaroundLabel: varchar("turnaroundLabel", { length: 255 }).notNull(),
  pickupScheduleLabel: varchar("pickupScheduleLabel", { length: 255 }).notNull(),
  serviceAreaLabel: varchar("serviceAreaLabel", { length: 255 }).notNull(),
  insuranceLabel: varchar("insuranceLabel", { length: 255 }),
  servicesJson: json("servicesJson").notNull(),
  createdBy: varchar("createdBy", { length: 128 }).notNull(),
  updatedBy: varchar("updatedBy", { length: 128 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const commercialProposals = mysqlTable("commercial_proposals", {
  id: varchar("id", { length: 36 }).primaryKey(),
  tenantId: varchar("tenantId", { length: 64 }).notNull(),
  missionId: int("missionId").notNull(),
  version: int("version").notNull(),
  status: mysqlEnum("status", ["draft", "approved", "superseded", "void"]).notNull().default("draft"),
  snapshotJson: json("snapshotJson").notNull(),
  contentHash: varchar("contentHash", { length: 64 }).notNull(),
  requestId: varchar("requestId", { length: 36 }).notNull(),
  validThrough: timestamp("validThrough").notNull(),
  createdBy: varchar("createdBy", { length: 128 }).notNull(),
  approvedBy: varchar("approvedBy", { length: 128 }),
  approvedAt: timestamp("approvedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  tenantMissionVersionUnique: uniqueIndex("uq_commercial_proposals_tenant_mission_version").on(table.tenantId, table.missionId, table.version),
  tenantRequestUnique: uniqueIndex("uq_commercial_proposals_tenant_request").on(table.tenantId, table.requestId),
  tenantMissionStatusIdx: index("idx_commercial_proposals_tenant_mission_status").on(table.tenantId, table.missionId, table.status, table.createdAt),
}));

export const commercialProposalEvents = mysqlTable("commercial_proposal_events", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 64 }).notNull(),
  missionId: int("missionId").notNull(),
  proposalId: varchar("proposalId", { length: 36 }).notNull(),
  eventName: varchar("eventName", { length: 64 }).notNull(),
  actorId: varchar("actorId", { length: 128 }).notNull(),
  idempotencyKey: varchar("idempotencyKey", { length: 191 }).notNull(),
  metadataJson: json("metadataJson").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  tenantIdempotencyUnique: uniqueIndex("uq_commercial_proposal_events_tenant_idempotency").on(table.tenantId, table.idempotencyKey),
  tenantProposalIdx: index("idx_commercial_proposal_events_tenant_proposal").on(table.tenantId, table.proposalId, table.createdAt),
}));

export const tenantCustomerRecoveryProfiles = mysqlTable(
  "tenant_customer_recovery_profiles",
  {
    tenantId: varchar("tenantId", { length: 64 }).primaryKey(),
    storeName: varchar("storeName", { length: 255 }).notNull(),
    senderName: varchar("senderName", { length: 255 }).notNull(),
    schedulingUrl: varchar("schedulingUrl", { length: 1024 }),
    createdBy: varchar("createdBy", { length: 128 }).notNull(),
    updatedBy: varchar("updatedBy", { length: 128 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  }
);

export const customerChurnScans = mysqlTable(
  "customer_churn_scans",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    requestId: varchar("requestId", { length: 36 }).notNull(),
    status: mysqlEnum("status", ["running", "completed", "failed"])
      .notNull()
      .default("running"),
    sourceOrderCount: int("sourceOrderCount").notNull().default(0),
    customerCount: int("customerCount").notNull().default(0),
    atRiskCount: int("atRiskCount").notNull().default(0),
    errorMessage: text("errorMessage"),
    computedAt: timestamp("computedAt"),
    createdBy: varchar("createdBy", { length: 128 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    tenantRequestUnique: uniqueIndex(
      "uq_customer_churn_scans_tenant_request"
    ).on(table.tenantId, table.requestId),
    tenantCreatedIdx: index("idx_customer_churn_scans_tenant_created").on(
      table.tenantId,
      table.createdAt
    ),
  })
);

export const customerChurnSnapshots = mysqlTable(
  "customer_churn_snapshots",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    scanId: varchar("scanId", { length: 36 }).notNull(),
    customerKeyHash: varchar("customerKeyHash", { length: 64 }).notNull(),
    customerName: varchar("customerName", { length: 255 }).notNull(),
    customerPhone: varchar("customerPhone", { length: 30 }).notNull(),
    lastOrderId: int("lastOrderId").notNull(),
    score: int("score").notNull(),
    grade: mysqlEnum("grade", ["low", "medium", "high"]).notNull(),
    confidence: mysqlEnum("confidence", ["low", "medium", "high"]).notNull(),
    historyOrderCount: int("historyOrderCount").notNull(),
    expectedCadenceDays: int("expectedCadenceDays").notNull(),
    lastServiceAt: timestamp("lastServiceAt").notNull(),
    daysSinceLastOrder: int("daysSinceLastOrder").notNull(),
    daysLate: int("daysLate").notNull(),
    averageOrderValueCents: int("averageOrderValueCents").notNull(),
    estimatedMonthlyImpactCents: int("estimatedMonthlyImpactCents").notNull(),
    recentVolumeChangePct: int("recentVolumeChangePct"),
    activeOrderCount: int("activeOrderCount").notNull().default(0),
    recommendedAction: mysqlEnum("recommendedAction", [
      "watch",
      "prepare_win_back",
      "contact_now",
    ]).notNull(),
    lastServiceLabel: varchar("lastServiceLabel", { length: 64 }).notNull(),
    reasonsJson: json("reasonsJson").notNull(),
    evidenceJson: json("evidenceJson").notNull(),
    sourceOrderIdsJson: json("sourceOrderIdsJson").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    scanCustomerUnique: uniqueIndex(
      "uq_customer_churn_snapshots_scan_customer"
    ).on(table.scanId, table.customerKeyHash),
    tenantScoreIdx: index("idx_customer_churn_snapshots_tenant_score").on(
      table.tenantId,
      table.score,
      table.createdAt
    ),
    tenantCustomerIdx: index("idx_customer_churn_snapshots_tenant_customer").on(
      table.tenantId,
      table.customerKeyHash,
      table.createdAt
    ),
  })
);

export const customerContactPermissions = mysqlTable(
  "customer_contact_permissions",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    customerKeyHash: varchar("customerKeyHash", { length: 64 }).notNull(),
    channel: mysqlEnum("channel", ["sms"]).notNull().default("sms"),
    purpose: mysqlEnum("purpose", ["win_back_marketing"])
      .notNull()
      .default("win_back_marketing"),
    status: mysqlEnum("status", ["opted_in", "opted_out"]).notNull(),
    sourceReference: varchar("sourceReference", { length: 512 }).notNull(),
    capturedAt: timestamp("capturedAt").notNull(),
    expiresAt: timestamp("expiresAt"),
    recordedBy: varchar("recordedBy", { length: 128 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    permissionScopeUnique: uniqueIndex(
      "uq_customer_contact_permissions_scope"
    ).on(table.tenantId, table.customerKeyHash, table.channel, table.purpose),
    tenantStatusIdx: index("idx_customer_contact_permissions_tenant_status").on(
      table.tenantId,
      table.status
    ),
  })
);

export const customerRecoveryInterventions = mysqlTable(
  "customer_recovery_interventions",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    churnSnapshotId: varchar("churnSnapshotId", { length: 36 }).notNull(),
    customerKeyHash: varchar("customerKeyHash", { length: 64 }).notNull(),
    activeCustomerKeyHash: varchar("activeCustomerKeyHash", { length: 64 }),
    opsTaskId: int("opsTaskId").notNull(),
    requestId: varchar("requestId", { length: 36 }).notNull(),
    status: mysqlEnum("status", [
      "draft_pending_review",
      "approved",
      "contacted",
      "dismissed",
      "recovered",
      "unsuccessful",
    ])
      .notNull()
      .default("draft_pending_review"),
    assignedTo: varchar("assignedTo", { length: 128 }),
    approvedBy: varchar("approvedBy", { length: 128 }),
    approvedAt: timestamp("approvedAt"),
    contactedAt: timestamp("contactedAt"),
    recoveredAt: timestamp("recoveredAt"),
    recoveredOrderId: int("recoveredOrderId"),
    recoveredRevenueCents: int("recoveredRevenueCents").notNull().default(0),
    createdBy: varchar("createdBy", { length: 128 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    tenantRequestUnique: uniqueIndex(
      "uq_customer_recovery_interventions_tenant_request"
    ).on(table.tenantId, table.requestId),
    tenantActiveCustomerUnique: uniqueIndex(
      "uq_customer_recovery_interventions_tenant_active_customer"
    ).on(table.tenantId, table.activeCustomerKeyHash),
    tenantStatusIdx: index(
      "idx_customer_recovery_interventions_tenant_status"
    ).on(table.tenantId, table.status, table.updatedAt),
    tenantCustomerIdx: index(
      "idx_customer_recovery_interventions_tenant_customer"
    ).on(table.tenantId, table.customerKeyHash, table.updatedAt),
  })
);

export const customerRecoveryDrafts = mysqlTable(
  "customer_recovery_drafts",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    interventionId: varchar("interventionId", { length: 36 }).notNull(),
    version: int("version").notNull(),
    channel: mysqlEnum("channel", ["sms"]).notNull().default("sms"),
    status: mysqlEnum("status", ["draft", "approved", "superseded", "void"])
      .notNull()
      .default("draft"),
    message: text("message").notNull(),
    factsUsedJson: json("factsUsedJson").notNull(),
    contentHash: varchar("contentHash", { length: 64 }).notNull(),
    requestId: varchar("requestId", { length: 36 }).notNull(),
    createdBy: varchar("createdBy", { length: 128 }).notNull(),
    approvedBy: varchar("approvedBy", { length: 128 }),
    approvedAt: timestamp("approvedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    interventionVersionUnique: uniqueIndex(
      "uq_customer_recovery_drafts_intervention_version"
    ).on(table.tenantId, table.interventionId, table.version),
    tenantRequestUnique: uniqueIndex(
      "uq_customer_recovery_drafts_tenant_request"
    ).on(table.tenantId, table.requestId),
    tenantInterventionIdx: index(
      "idx_customer_recovery_drafts_tenant_intervention"
    ).on(table.tenantId, table.interventionId, table.createdAt),
  })
);

export const customerRecoveryEvents = mysqlTable(
  "customer_recovery_events",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    interventionId: varchar("interventionId", { length: 36 }).notNull(),
    eventName: varchar("eventName", { length: 64 }).notNull(),
    actorId: varchar("actorId", { length: 128 }).notNull(),
    idempotencyKey: varchar("idempotencyKey", { length: 191 }).notNull(),
    metadataJson: json("metadataJson").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    tenantIdempotencyUnique: uniqueIndex(
      "uq_customer_recovery_events_tenant_idempotency"
    ).on(table.tenantId, table.idempotencyKey),
    tenantInterventionIdx: index(
      "idx_customer_recovery_events_tenant_intervention"
    ).on(table.tenantId, table.interventionId, table.createdAt),
  })
);

export const commercialPipelineRecords = mysqlTable(
  "commercial_pipeline_records",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    accountId: int("accountId").notNull(),
    opportunityId: int("opportunityId").notNull(),
    missionId: int("missionId").notNull(),
    stage: mysqlEnum("stage", [
      "discovered",
      "qualified",
      "mission_created",
      "game_ready",
      "field_ready",
      "visit_planned",
      "visited",
      "follow_up",
      "proposal_sent",
      "pilot_requested",
      "verbal_yes",
      "won",
      "lost",
    ]).notNull(),
    version: int("version").notNull().default(1),
    estimatedContractValueCents: int("estimatedContractValueCents").notNull(),
    approvedContractValueCents: int("approvedContractValueCents"),
    invoicedRevenueCents: int("invoicedRevenueCents").notNull().default(0),
    paidRevenueCents: int("paidRevenueCents").notNull().default(0),
    realizedRevenueCents: int("realizedRevenueCents").notNull().default(0),
    commercialCustomerId: int("commercialCustomerId"),
    firstOrderId: int("firstOrderId"),
    nextFollowUpAt: timestamp("nextFollowUpAt"),
    lossReason: varchar("lossReason", { length: 128 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    tenantOpportunityUnique: uniqueIndex(
      "uq_commercial_pipeline_tenant_opportunity"
    ).on(table.tenantId, table.opportunityId),
    tenantMissionUnique: uniqueIndex(
      "uq_commercial_pipeline_tenant_mission"
    ).on(table.tenantId, table.missionId),
    tenantStageIdx: index("idx_commercial_pipeline_tenant_stage").on(
      table.tenantId,
      table.stage,
      table.updatedAt
    ),
  })
);

export const commercialPipelineEvents = mysqlTable(
  "commercial_pipeline_events",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    pipelineId: int("pipelineId").notNull(),
    missionId: int("missionId").notNull(),
    fromStage: varchar("fromStage", { length: 32 }),
    toStage: varchar("toStage", { length: 32 }).notNull(),
    actorType: mysqlEnum("actorType", [
      "system",
      "operator",
      "driver",
      "game",
    ]).notNull(),
    actorId: varchar("actorId", { length: 128 }),
    idempotencyKey: varchar("idempotencyKey", { length: 191 }).notNull(),
    correlationId: varchar("correlationId", { length: 191 }).notNull(),
    metadataJson: json("metadataJson"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    tenantIdempotencyUnique: uniqueIndex(
      "uq_commercial_pipeline_events_tenant_idempotency"
    ).on(table.tenantId, table.idempotencyKey),
    tenantPipelineIdx: index(
      "idx_commercial_pipeline_events_tenant_pipeline"
    ).on(table.tenantId, table.pipelineId, table.createdAt),
  })
);

export const commercialCustomers = mysqlTable(
  "commercial_customers",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    accountId: int("accountId").notNull(),
    sourceMissionId: int("sourceMissionId").notNull(),
    status: mysqlEnum("status", ["active", "paused", "churned", "closed"])
      .notNull()
      .default("active"),
    approvedAnnualValueCents: int("approvedAnnualValueCents"),
    firstOrderId: int("firstOrderId"),
    convertedAt: timestamp("convertedAt").defaultNow().notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    tenantAccountUnique: uniqueIndex(
      "uq_commercial_customers_tenant_account"
    ).on(table.tenantId, table.accountId),
    tenantMissionUnique: uniqueIndex(
      "uq_commercial_customers_tenant_source_mission"
    ).on(table.tenantId, table.sourceMissionId),
  })
);

export const commercialCustomerLocations = mysqlTable(
  "commercial_customer_locations",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    commercialCustomerId: int("commercialCustomerId").notNull(),
    locationId: int("locationId").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    tenantCustomerLocationUnique: uniqueIndex(
      "uq_commercial_customer_locations_scope"
    ).on(table.tenantId, table.commercialCustomerId, table.locationId),
  })
);

export const commercialCustomerContacts = mysqlTable(
  "commercial_customer_contacts",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    commercialCustomerId: int("commercialCustomerId").notNull(),
    contactId: int("contactId").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    tenantCustomerContactUnique: uniqueIndex(
      "uq_commercial_customer_contacts_scope"
    ).on(table.tenantId, table.commercialCustomerId, table.contactId),
  })
);

export const commercialServiceExpectations = mysqlTable(
  "commercial_service_expectations",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    commercialCustomerId: int("commercialCustomerId").notNull(),
    sourceMissionId: int("sourceMissionId").notNull(),
    sourceProposalId: varchar("sourceProposalId", { length: 36 }),
    sourceProposalVersion: int("sourceProposalVersion"),
    status: mysqlEnum("status", ["proposed", "approved", "active", "paused"])
      .notNull()
      .default("approved"),
    pricePerPoundCents: int("pricePerPoundCents"),
    minimumOrderCents: int("minimumOrderCents"),
    expectedWeeklyPounds: int("expectedWeeklyPounds"),
    capacityReservedPoundsPerWeek: int("capacityReservedPoundsPerWeek").notNull().default(0),
    pickupScheduleLabel: varchar("pickupScheduleLabel", { length: 255 }),
    turnaroundLabel: varchar("turnaroundLabel", { length: 255 }),
    serviceAreaLabel: varchar("serviceAreaLabel", { length: 255 }),
    approvedAt: timestamp("approvedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    tenantCustomerMissionUnique: uniqueIndex(
      "uq_commercial_service_expectations_scope"
    ).on(table.tenantId, table.commercialCustomerId, table.sourceMissionId),
  })
);

export const commercialAgreements = mysqlTable(
  "commercial_agreements",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    commercialCustomerId: int("commercialCustomerId").notNull(),
    missionId: int("missionId").notNull(),
    proposalId: varchar("proposalId", { length: 36 }),
    proposalVersion: int("proposalVersion"),
    status: mysqlEnum("status", [
      "verbal_yes",
      "pending_signature",
      "approved",
      "declined",
    ])
      .notNull()
      .default("verbal_yes"),
    approvedAnnualValueCents: int("approvedAnnualValueCents"),
    evidenceReference: varchar("evidenceReference", { length: 1024 }),
    recordedBy: varchar("recordedBy", { length: 128 }).notNull(),
    approvedAt: timestamp("approvedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    tenantMissionUnique: uniqueIndex(
      "uq_commercial_agreements_tenant_mission"
    ).on(table.tenantId, table.missionId),
    tenantCustomerIdx: index("idx_commercial_agreements_tenant_customer").on(
      table.tenantId,
      table.commercialCustomerId
    ),
  })
);

export const commercialRouteAssignments = mysqlTable(
  "commercial_route_assignments",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    commercialCustomerId: int("commercialCustomerId").notNull(),
    locationId: int("locationId").notNull(),
    serviceExpectationId: int("serviceExpectationId").notNull(),
    status: mysqlEnum("status", ["planned", "active", "paused", "ended"])
      .notNull()
      .default("planned"),
    routeLabel: varchar("routeLabel", { length: 255 }).notNull(),
    routeWindowLabel: varchar("routeWindowLabel", { length: 255 }),
    capacityReservedPoundsPerWeek: int("capacityReservedPoundsPerWeek").notNull().default(0),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    tenantCustomerLocationUnique: uniqueIndex(
      "uq_commercial_route_assignments_scope"
    ).on(table.tenantId, table.commercialCustomerId, table.locationId),
  })
);

export const commercialFollowUps = mysqlTable(
  "commercial_follow_ups",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    pipelineId: int("pipelineId").notNull(),
    missionId: int("missionId").notNull(),
    status: mysqlEnum("status", ["open", "completed", "cancelled"])
      .notNull()
      .default("open"),
    dueAt: timestamp("dueAt").notNull(),
    note: text("note").notNull(),
    assignedTo: varchar("assignedTo", { length: 128 }),
    requestId: varchar("requestId", { length: 36 }).notNull(),
    createdBy: varchar("createdBy", { length: 128 }).notNull(),
    completedAt: timestamp("completedAt"),
    completedBy: varchar("completedBy", { length: 128 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    tenantRequestUnique: uniqueIndex(
      "uq_commercial_follow_ups_tenant_request"
    ).on(table.tenantId, table.requestId),
    tenantStatusDueIdx: index("idx_commercial_follow_ups_tenant_due").on(
      table.tenantId,
      table.status,
      table.dueAt
    ),
  })
);

export const commercialOrderAttributions = mysqlTable(
  "commercial_order_attributions",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    commercialCustomerId: int("commercialCustomerId").notNull(),
    missionId: int("missionId").notNull(),
    orderId: int("orderId").notNull(),
    attributionType: mysqlEnum("attributionType", ["first_order", "recurring"])
      .notNull(),
    invoicedCents: int("invoicedCents").notNull().default(0),
    paidCents: int("paidCents").notNull().default(0),
    realizedCents: int("realizedCents").notNull().default(0),
    paidAt: timestamp("paidAt"),
    requestId: varchar("requestId", { length: 36 }).notNull(),
    createdBy: varchar("createdBy", { length: 128 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    tenantOrderUnique: uniqueIndex(
      "uq_commercial_order_attributions_tenant_order"
    ).on(table.tenantId, table.orderId),
    tenantRequestUnique: uniqueIndex(
      "uq_commercial_order_attributions_tenant_request"
    ).on(table.tenantId, table.requestId),
    tenantCustomerIdx: index(
      "idx_commercial_order_attributions_tenant_customer"
    ).on(table.tenantId, table.commercialCustomerId, table.createdAt),
  })
);

export const commercialMissionFinalRewards = mysqlTable(
  "commercial_mission_final_rewards",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    missionId: int("missionId").notNull(),
    commercialCustomerId: int("commercialCustomerId").notNull(),
    playerId: varchar("playerId", { length: 128 }).notNull(),
    xpAwarded: int("xpAwarded").notNull(),
    idempotencyKey: varchar("idempotencyKey", { length: 191 }).notNull(),
    awardedAt: timestamp("awardedAt").defaultNow().notNull(),
  },
  table => ({
    tenantMissionUnique: uniqueIndex(
      "uq_commercial_final_rewards_tenant_mission"
    ).on(table.tenantId, table.missionId),
    tenantIdempotencyUnique: uniqueIndex(
      "uq_commercial_final_rewards_tenant_idempotency"
    ).on(table.tenantId, table.idempotencyKey),
  })
);

export type CommercialAccount = typeof commercialAccounts.$inferSelect;
export type CommercialOpportunityRow = typeof commercialOpportunities.$inferSelect;
export type CommercialMissionRow = typeof commercialMissions.$inferSelect;
export type CommercialMissionEventRow = typeof commercialMissionEvents.$inferSelect;
export type CommercialMissionGameAttemptRow = typeof commercialMissionGameAttempts.$inferSelect;
export type CommercialMissionGameResultRow = typeof commercialMissionGameResults.$inferSelect;
export type CommercialMissionGameRewardRow = typeof commercialMissionGameRewards.$inferSelect;

export const territoryOperatorProfiles = mysqlTable("territory_operator_profiles", {
  tenantId: varchar("tenantId", { length: 64 }).primaryKey(),
  storeName: varchar("storeName", { length: 255 }).notNull(),
  storeAddress: varchar("storeAddress", { length: 512 }).notNull(),
  latitude: decimal("latitude", { precision: 10, scale: 7 }),
  longitude: decimal("longitude", { precision: 10, scale: 7 }),
  serviceRadiusMiles: decimal("serviceRadiusMiles", { precision: 6, scale: 2 }).notNull().default("3.00"),
  commercialWashFoldEnabled: boolean("commercialWashFoldEnabled").notNull().default(true),
  averagePricePerPoundCents: int("averagePricePerPoundCents").notNull(),
  availableWeeklyCapacityPounds: int("availableWeeklyCapacityPounds").notNull(),
  routePointsJson: json("routePointsJson").notNull(),
  turnaroundCompatibleByDefault: boolean("turnaroundCompatibleByDefault").notNull().default(true),
  pickupDaysCompatibleByDefault: boolean("pickupDaysCompatibleByDefault").notNull().default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const territoryScanSessions = mysqlTable("territory_scan_sessions", {
  id: varchar("id", { length: 64 }).primaryKey(),
  tenantId: varchar("tenantId", { length: 64 }),
  mode: mysqlEnum("mode", ["public_preview", "tenant"]).notNull(),
  addressQuery: varchar("addressQuery", { length: 512 }).notNull(),
  centerJson: json("centerJson").notNull(),
  providerName: varchar("providerName", { length: 64 }).notNull(),
  resultCount: int("resultCount").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdBy: varchar("createdBy", { length: 128 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  tenantCreatedIdx: index("idx_territory_scan_sessions_tenant_created").on(table.tenantId, table.createdAt),
  expiresIdx: index("idx_territory_scan_sessions_expires").on(table.expiresAt),
}));

export const territoryScanResults = mysqlTable("territory_scan_results", {
  id: int("id").autoincrement().primaryKey(),
  scanSessionId: varchar("scanSessionId", { length: 64 }).notNull(),
  tenantId: varchar("tenantId", { length: 64 }),
  candidateKey: varchar("candidateKey", { length: 191 }).notNull(),
  providerName: varchar("providerName", { length: 64 }).notNull(),
  providerAccountId: varchar("providerAccountId", { length: 191 }).notNull(),
  accountSnapshotJson: json("accountSnapshotJson").notNull(),
  scoreSnapshotJson: json("scoreSnapshotJson").notNull(),
  evidenceJson: json("evidenceJson").notNull(),
  sourceCapturedAt: timestamp("sourceCapturedAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  sessionCandidateUnique: uniqueIndex("uq_territory_scan_results_session_candidate").on(table.scanSessionId, table.candidateKey),
  tenantSessionIdx: index("idx_territory_scan_results_tenant_session").on(table.tenantId, table.scanSessionId),
}));

export const level4Missions = mysqlTable("level4_missions", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 64 }).notNull().default("default"),
  operatorId: varchar("operatorId", { length: 128 }).notNull().default("tenant_proxy"),
  taskId: int("taskId").notNull(),
  status: mysqlEnum("status", ["locked", "unlocked", "completed", "expired"]).notNull().default("locked"),
  missionDate: varchar("missionDate", { length: 10 }).notNull(),
  activatedAt: timestamp("activatedAt").defaultNow().notNull(),
  unlockedAt: timestamp("unlockedAt"),
  startedAt: timestamp("startedAt"),
  completedAt: timestamp("completedAt"),
  expiredAt: timestamp("expiredAt"),
  visibleUntil: timestamp("visibleUntil"),
  xpAwarded: int("xpAwarded").notNull().default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  tenantOperatorStatusIdx: index("idx_level4_missions_tenant_operator_status").on(table.tenantId, table.operatorId, table.status),
  tenantOperatorDateIdx: index("idx_level4_missions_tenant_operator_date").on(table.tenantId, table.operatorId, table.missionDate),
  taskIdx: index("idx_level4_missions_task").on(table.taskId),
}));

export type Level4Mission = typeof level4Missions.$inferSelect;
export type InsertLevel4Mission = typeof level4Missions.$inferInsert;

export const agentEvents = mysqlTable("agent_events", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 64 }).notNull().default("default"),
  sessionId: varchar("sessionId", { length: 128 }),
  conversationId: varchar("conversationId", { length: 128 }),
  agentType: mysqlEnum("agentType", [
    "resident_agent",
    "operator_voice_agent",
    "vendor_agent",
    "driver_agent",
    "gm_agent",
    "building_agent",
    "collections_agent",
    "operator_task_agent",
    "system_agent",
  ]).notNull(),
  actorType: mysqlEnum("actorType", ["human", "voice", "resident_chat", "driver", "vendor", "ai_agent", "system"]).notNull(),
  actorId: varchar("actorId", { length: 128 }),
  toolName: varchar("toolName", { length: 128 }).notNull(),
  entityType: varchar("entityType", { length: 64 }),
  entityId: varchar("entityId", { length: 128 }),
  inputJson: json("inputJson"),
  outputJson: json("outputJson"),
  status: mysqlEnum("status", ["success", "failed", "approval_required", "blocked"]).notNull(),
  errorMessage: text("errorMessage"),
  latencyMs: int("latencyMs"),
  modelUsed: varchar("modelUsed", { length: 128 }),
  inputTokens: int("inputTokens").default(0).notNull(),
  outputTokens: int("outputTokens").default(0).notNull(),
  estimatedCostCents: int("estimatedCostCents").default(0).notNull(),
  requiresHumanApproval: boolean("requiresHumanApproval").default(false).notNull(),
  approvedByUserId: varchar("approvedByUserId", { length: 128 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AgentEvent = typeof agentEvents.$inferSelect;
export type InsertAgentEvent = typeof agentEvents.$inferInsert;

export const residentAgentPlans = mysqlTable(
  "resident_agent_plans",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull().default("default"),
    bldgUserId: int("bldgUserId"),
    residentName: varchar("residentName", { length: 255 }),
    buildingSlug: varchar("buildingSlug", { length: 100 }),
    buildingName: varchar("buildingName", { length: 255 }),
    unit: varchar("unit", { length: 50 }),
    conversationId: varchar("conversationId", { length: 128 }),
    sessionId: varchar("sessionId", { length: 128 }),
    originalMessage: text("originalMessage").notNull(),
    planStatus: mysqlEnum("planStatus", [
      "partially_confirmed",
      "pending_confirmation",
      "completed",
      "failed",
      "cancelled",
    ]).notNull().default("pending_confirmation"),
    planJson: json("planJson"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    tenantStatusIdx: index("idx_resident_agent_plans_tenant_status").on(table.tenantId, table.planStatus),
    tenantUserIdx: index("idx_resident_agent_plans_tenant_user").on(table.tenantId, table.bldgUserId),
    conversationIdx: index("idx_resident_agent_plans_conversation").on(table.conversationId),
  })
);

export type ResidentAgentPlan = typeof residentAgentPlans.$inferSelect;
export type InsertResidentAgentPlan = typeof residentAgentPlans.$inferInsert;

export const residentCoordinatedRequests = mysqlTable(
  "resident_coordinated_requests",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull().default("default"),
    bldgUserId: int("bldgUserId"),
    residentName: varchar("residentName", { length: 255 }),
    residentPhone: varchar("residentPhone", { length: 30 }),
    residentEmail: varchar("residentEmail", { length: 320 }),
    buildingSlug: varchar("buildingSlug", { length: 100 }),
    buildingName: varchar("buildingName", { length: 255 }),
    unit: varchar("unit", { length: 50 }),
    serviceCategory: mysqlEnum("serviceCategory", [
      "dog_grooming",
      "car_detail",
      "airport_transport",
      "apartment_cleaning",
      "dry_cleaning",
      "other",
    ]).notNull(),
    serviceRequested: text("serviceRequested").notNull(),
    requestedDate: varchar("requestedDate", { length: 20 }),
    requestedWindow: varchar("requestedWindow", { length: 100 }),
    deadlineDate: varchar("deadlineDate", { length: 20 }),
    deadlineReason: text("deadlineReason"),
    origin: varchar("origin", { length: 255 }),
    destination: varchar("destination", { length: 255 }),
    notes: text("notes"),
    status: mysqlEnum("status", [
      "pending_operator_review",
      "pending_provider_confirmation",
      "confirmed",
      "declined",
      "cancelled",
      "completed",
      "failed",
    ]).notNull().default("pending_operator_review"),
    statusReason: text("statusReason"),
    residentVisibleStatus: mysqlEnum("residentVisibleStatus", [
      "confirmed",
      "pending_provider_confirmation",
      "pending_operator_review",
      "failed",
      "cancelled",
      "completed",
    ]).notNull().default("pending_operator_review"),
    nextAction: text("nextAction"),
    requiresHumanApproval: boolean("requiresHumanApproval").notNull().default(true),
    customerCharged: boolean("customerCharged").notNull().default(false),
    providerVendorId: int("providerVendorId"),
    providerConfirmationStatus: varchar("providerConfirmationStatus", { length: 100 }),
    sourceConversationId: varchar("sourceConversationId", { length: 128 }),
    sourceSessionId: varchar("sourceSessionId", { length: 128 }),
    parentPlanId: int("parentPlanId"),
    rawJson: json("rawJson"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    tenantStatusIdx: index("idx_resident_coord_requests_tenant_status").on(table.tenantId, table.status),
    tenantPlanIdx: index("idx_resident_coord_requests_tenant_plan").on(table.tenantId, table.parentPlanId),
    tenantUserIdx: index("idx_resident_coord_requests_tenant_user").on(table.tenantId, table.bldgUserId),
    categoryIdx: index("idx_resident_coord_requests_category").on(table.serviceCategory),
  })
);

export type ResidentCoordinatedRequest = typeof residentCoordinatedRequests.$inferSelect;
export type InsertResidentCoordinatedRequest = typeof residentCoordinatedRequests.$inferInsert;

export const tenantAiUsage = mysqlTable(
  "tenant_ai_usage",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull().default("default"),
    month: varchar("month", { length: 7 }).notNull(),
    inputTokens: int("inputTokens").default(0).notNull(),
    outputTokens: int("outputTokens").default(0).notNull(),
    estimatedCostCents: int("estimatedCostCents").default(0).notNull(),
    requestCount: int("requestCount").default(0).notNull(),
    warningLimitCents: int("warningLimitCents").default(5000).notNull(),
    hardLimitCents: int("hardLimitCents").default(10000).notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    uqTenantMonth: uniqueIndex("uq_tenant_ai_usage_tenant_month").on(table.tenantId, table.month),
  })
);

export type TenantAiUsage = typeof tenantAiUsage.$inferSelect;
export type InsertTenantAiUsage = typeof tenantAiUsage.$inferInsert;

export const vendorProfiles = mysqlTable("vendor_profiles", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 64 }).notNull().default("default"),
  vendorId: int("vendorId").notNull(),
  businessName: varchar("businessName", { length: 255 }).notNull(),
  vendorCategory: varchar("vendorCategory", { length: 100 }).notNull(),
  contactName: varchar("contactName", { length: 255 }),
  phone: varchar("phone", { length: 30 }),
  email: varchar("email", { length: 320 }),
  serviceModel: mysqlEnum("serviceModel", ["mobile", "fixed_location", "both"]).notNull().default("mobile"),
  buildingNativeServiceAvailable: boolean("buildingNativeServiceAvailable").notNull().default(true),
  serviceAreaJson: json("serviceAreaJson"),
  buildingsJson: json("buildingsJson"),
  trafficProtectionMode: mysqlEnum("trafficProtectionMode", ["back_to_back", "breathing_room", "geo_clustered"]).notNull().default("geo_clustered"),
  resetTimeMinutes: int("resetTimeMinutes").notNull().default(15),
  geoClusteringEnabled: boolean("geoClusteringEnabled").notNull().default(true),
  bookingLeadTimeHours: int("bookingLeadTimeHours").notNull().default(24),
  providerResponseTimeoutMinutes: int("providerResponseTimeoutMinutes").notNull().default(120),
  calendarConnectionStatus: varchar("calendarConnectionStatus", { length: 64 }).notNull().default("not_connected"),
  payoutSetupStatus: varchar("payoutSetupStatus", { length: 64 }).notNull().default("not_started"),
  onboardingStatus: mysqlEnum("onboardingStatus", [
    "started",
    "collecting_details",
    "pricing_setup",
    "availability_setup",
    "payment_setup",
    "admin_configured",
    "completed",
    "abandoned",
  ]).notNull().default("started"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type VendorProfile = typeof vendorProfiles.$inferSelect;
export type InsertVendorProfile = typeof vendorProfiles.$inferInsert;

export const vendorServices = mysqlTable("vendor_services", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 64 }).notNull().default("default"),
  vendorId: int("vendorId").notNull(),
  serviceName: varchar("serviceName", { length: 255 }).notNull(),
  serviceCategory: varchar("serviceCategory", { length: 100 }).notNull(),
  description: text("description"),
  basePriceCents: int("basePriceCents").notNull(),
  recommendedPriceCents: int("recommendedPriceCents"),
  durationMinutes: int("durationMinutes").notNull(),
  isMobile: boolean("isMobile").notNull().default(true),
  isBuildingNative: boolean("isBuildingNative").notNull().default(true),
  isActive: boolean("isActive").notNull().default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type VendorService = typeof vendorServices.$inferSelect;
export type InsertVendorService = typeof vendorServices.$inferInsert;

export const vendorAvailabilityWindows = mysqlTable("vendor_availability_windows", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 64 }).notNull().default("default"),
  vendorId: int("vendorId").notNull(),
  dayOfWeek: int("dayOfWeek").notNull(),
  startTime: varchar("startTime", { length: 10 }).notNull(),
  endTime: varchar("endTime", { length: 10 }).notNull(),
  timezone: varchar("timezone", { length: 64 }).notNull().default("America/Los_Angeles"),
  buildingScopeJson: json("buildingScopeJson"),
  neighborhoodScopeJson: json("neighborhoodScopeJson"),
  isActive: boolean("isActive").notNull().default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type VendorAvailabilityWindow = typeof vendorAvailabilityWindows.$inferSelect;
export type InsertVendorAvailabilityWindow = typeof vendorAvailabilityWindows.$inferInsert;

export const vendorAdminConfigs = mysqlTable("vendor_admin_configs", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 64 }).notNull().default("default"),
  vendorId: int("vendorId").notNull(),
  categoryPresetKey: varchar("categoryPresetKey", { length: 100 }).notNull(),
  themeKey: mysqlEnum("themeKey", ["clinical_minimalist", "pixel_operations", "standard"]).notNull().default("standard"),
  enabledSurfacesJson: json("enabledSurfacesJson"),
  navConfigJson: json("navConfigJson"),
  brandConfigJson: json("brandConfigJson"),
  externalBookingBrandMode: varchar("externalBookingBrandMode", { length: 64 }).notNull().default("vendor_primary"),
  publicBookingSlug: varchar("publicBookingSlug", { length: 128 }).notNull(),
  templateKey: varchar("templateKey", { length: 128 }).notNull().default("vendor_booking_template_01"),
  publicBookingStatus: mysqlEnum("publicBookingStatus", ["draft", "published", "unpublished"]).notNull().default("draft"),
  templateContentJson: json("templateContentJson"),
  publishedAt: timestamp("publishedAt"),
  approvedByUserId: varchar("approvedByUserId", { length: 128 }),
  customDomain: varchar("customDomain", { length: 255 }),
  customDomainStatus: varchar("customDomainStatus", { length: 64 }).notNull().default("not_configured"),
  brandName: varchar("brandName", { length: 255 }),
  brandLogoUrl: varchar("brandLogoUrl", { length: 512 }),
  brandAccentColor: varchar("brandAccentColor", { length: 32 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type VendorAdminConfig = typeof vendorAdminConfigs.$inferSelect;
export type InsertVendorAdminConfig = typeof vendorAdminConfigs.$inferInsert;

export const vendorPeerServiceRequests = mysqlTable("vendor_peer_service_requests", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 64 }).notNull().default("default"),
  requestingVendorId: int("requestingVendorId").notNull(),
  providerVendorId: int("providerVendorId"),
  serviceCategory: varchar("serviceCategory", { length: 100 }).notNull(),
  serviceRequested: text("serviceRequested").notNull(),
  buildingName: varchar("buildingName", { length: 255 }),
  locationDetailsJson: json("locationDetailsJson"),
  preferredWindowStart: timestamp("preferredWindowStart"),
  preferredWindowEnd: timestamp("preferredWindowEnd"),
  recommendedPriceCents: int("recommendedPriceCents"),
  status: mysqlEnum("status", [
    "request_pending_provider_confirmation",
    "accepted",
    "declined",
    "expired",
    "cancelled",
    "completed",
  ]).notNull().default("request_pending_provider_confirmation"),
  responseTimeoutMinutes: int("responseTimeoutMinutes").notNull().default(120),
  expiresAt: timestamp("expiresAt"),
  expiredAt: timestamp("expiredAt"),
  timeoutReason: varchar("timeoutReason", { length: 255 }),
  replacementOptionsJson: json("replacementOptionsJson"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type VendorPeerServiceRequest = typeof vendorPeerServiceRequests.$inferSelect;
export type InsertVendorPeerServiceRequest = typeof vendorPeerServiceRequests.$inferInsert;

export const vendorPricingRecommendations = mysqlTable("vendor_pricing_recommendations", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 64 }).notNull().default("default"),
  vendorId: int("vendorId").notNull(),
  serviceId: int("serviceId"),
  basePriceCents: int("basePriceCents").notNull(),
  recommendedPriceCents: int("recommendedPriceCents").notNull(),
  conveniencePremiumPercent: int("conveniencePremiumPercent").notNull().default(10),
  travelTimeMinutesAssumed: int("travelTimeMinutesAssumed").notNull().default(20),
  estimatedBookingsPerDay: int("estimatedBookingsPerDay").notNull().default(4),
  comparablePricingJson: json("comparablePricingJson"),
  reasoning: text("reasoning").notNull(),
  status: mysqlEnum("status", ["draft", "accepted", "rejected"]).notNull().default("draft"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  acceptedAt: timestamp("acceptedAt"),
  rejectedAt: timestamp("rejectedAt"),
});

export type VendorPricingRecommendation = typeof vendorPricingRecommendations.$inferSelect;
export type InsertVendorPricingRecommendation = typeof vendorPricingRecommendations.$inferInsert;

export const vendorDataExports = mysqlTable("vendor_data_exports", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 64 }).notNull().default("default"),
  vendorId: int("vendorId").notNull(),
  exportType: mysqlEnum("exportType", ["clients", "bookings", "services"]).notNull(),
  exportUrl: text("exportUrl").notNull(),
  requestedByUserId: varchar("requestedByUserId", { length: 128 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type VendorDataExport = typeof vendorDataExports.$inferSelect;
export type InsertVendorDataExport = typeof vendorDataExports.$inferInsert;

export const vendorGuestBookingSessions = mysqlTable("vendor_guest_booking_sessions", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 64 }).notNull().default("default"),
  vendorId: int("vendorId").notNull(),
  phone: varchar("phone", { length: 30 }),
  otpVerified: boolean("otpVerified").notNull().default(false),
  trustedDeviceHash: varchar("trustedDeviceHash", { length: 255 }),
  serviceId: int("serviceId"),
  requestedWindowJson: json("requestedWindowJson"),
  status: varchar("status", { length: 64 }).notNull().default("started"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type VendorGuestBookingSession = typeof vendorGuestBookingSessions.$inferSelect;
export type InsertVendorGuestBookingSession = typeof vendorGuestBookingSessions.$inferInsert;

export const vendorOnboardingSessions = mysqlTable("vendor_onboarding_sessions", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 64 }).notNull().default("default"),
  vendorId: int("vendorId"),
  sessionId: varchar("sessionId", { length: 128 }).notNull(),
  conversationId: varchar("conversationId", { length: 128 }),
  publicSourceUrl: varchar("publicSourceUrl", { length: 512 }),
  vendorCategory: varchar("vendorCategory", { length: 100 }),
  status: mysqlEnum("status", [
    "started",
    "collecting_details",
    "pricing_setup",
    "availability_setup",
    "payment_setup",
    "admin_configured",
    "completed",
    "abandoned",
  ]).notNull().default("started"),
  lastCompletedStep: varchar("lastCompletedStep", { length: 128 }),
  missingFieldsJson: json("missingFieldsJson"),
  abandoned2hLoggedAt: timestamp("abandoned2hLoggedAt"),
  abandoned24hLoggedAt: timestamp("abandoned24hLoggedAt"),
  abandoned7dLoggedAt: timestamp("abandoned7dLoggedAt"),
  abandonedAt: timestamp("abandonedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  sessionTokenIdx: index("idx_vendor_onboarding_sessions_tenant_session").on(table.tenantId, table.sessionId),
}));

export type VendorOnboardingSession = typeof vendorOnboardingSessions.$inferSelect;
export type InsertVendorOnboardingSession = typeof vendorOnboardingSessions.$inferInsert;

export const vendorOnboardingMessages = mysqlTable("vendor_onboarding_messages", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 64 }).notNull().default("default"),
  sessionId: int("sessionId").notNull(),
  conversationId: varchar("conversationId", { length: 128 }),
  role: mysqlEnum("role", ["vendor", "agent", "system"]).notNull(),
  content: text("content").notNull(),
  metadataJson: json("metadataJson"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  sessionIdx: index("idx_vendor_onboarding_messages_tenant_session").on(table.tenantId, table.sessionId),
}));

export type VendorOnboardingMessage = typeof vendorOnboardingMessages.$inferSelect;
export type InsertVendorOnboardingMessage = typeof vendorOnboardingMessages.$inferInsert;

/**
 * Level 4 — War for the Bridge. Append-only action events; all daily war
 * state (front line, combo, reckoning) derives from a fold over these.
 * dedupeKey makes every recording idempotent (replays cannot double-shove).
 */
export const level4WarEvents = mysqlTable("level4_war_events", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 64 }).notNull().default("default"),
  kind: varchar("kind", { length: 48 }).notNull(),
  dedupeKey: varchar("dedupeKey", { length: 191 }).notNull(),
  pushHundredths: int("pushHundredths").notNull().default(0),
  metadata: json("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  tenantDedupeIdx: uniqueIndex("uq_level4_war_events_tenant_dedupe").on(table.tenantId, table.dedupeKey),
  tenantCreatedIdx: index("idx_level4_war_events_tenant_created").on(table.tenantId, table.createdAt),
}));

export type Level4WarEvent = typeof level4WarEvents.$inferSelect;
export type InsertLevel4WarEvent = typeof level4WarEvents.$inferInsert;

/** Command screen Sky Covenant — operator-tunable weather settings. */
export const commandSkySettings = mysqlTable("command_sky_settings", {
  tenantId: varchar("tenantId", { length: 64 }).notNull().primaryKey(),
  mode: varchar("mode", { length: 16 }).notNull().default("campaign"),
  period: varchar("period", { length: 16 }).notNull().default("today"),
  redBelowCents: int("redBelowCents").notNull().default(0),
  blueAboveCents: int("blueAboveCents").notNull().default(20000),
  campaignTarget: int("campaignTarget").notNull().default(50),
  campaignLabel: varchar("campaignLabel", { length: 120 }).notNull().default("50 new customers"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type CommandSkySettingsRow = typeof commandSkySettings.$inferSelect;

/** Sky Covenant win events — verbal commitments and first orders (hope). */
export const commandSkyWins = mysqlTable("command_sky_wins", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 64 }).notNull().default("default"),
  kind: varchar("kind", { length: 32 }).notNull(),
  label: varchar("label", { length: 191 }).notNull(),
  dedupeKey: varchar("dedupeKey", { length: 191 }).notNull(),
  hopeExpiresAt: timestamp("hopeExpiresAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  tenantDedupeIdx: uniqueIndex("uq_command_sky_wins_tenant_dedupe").on(table.tenantId, table.dedupeKey),
  tenantCreatedIdx: index("idx_command_sky_wins_tenant_created").on(table.tenantId, table.createdAt),
}));

export type CommandSkyWin = typeof commandSkyWins.$inferSelect;
