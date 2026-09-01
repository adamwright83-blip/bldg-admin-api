import {
  boolean,
  customType,
  decimal,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

const longblob = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "longblob";
  },
});

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
  role: mysqlEnum("role", ["user", "admin", "driver"])
    .default("user")
    .notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/** Durable private-object fallback for deployments without a valid storage proxy. */
export const privateStorageObjects = mysqlTable("private_storage_objects", {
  storageKey: varchar("storageKey", { length: 512 }).primaryKey(),
  contentType: varchar("contentType", { length: 191 }).notNull(),
  data: longblob("data").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/**
 * Pickup orders table — shared between customer-facing site and admin/driver views.
 *
 * Status flow: new → collected → processing → ready → delivered
 */
export const orders = mysqlTable(
  "orders",
  {
    id: int("id").autoincrement().primaryKey(),

    /* Tenant */
    tenantId: varchar("tenantId", { length: 64 }).default("default"),

    /* Service info */
    serviceType: mysqlEnum("serviceType", [
      "wash_fold",
      "dry_cleaning",
    ]).notNull(),

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
    heldRequestedPickupWindow: varchar("heldRequestedPickupWindow", {
      length: 255,
    }),
    heldRequestedReturnBy: varchar("heldRequestedReturnBy", { length: 255 }),
    heldSource: varchar("heldSource", { length: 64 }),
    heldMetadataJson: json("heldMetadataJson"),

    /* Resident-app idempotency key (one per "set it in motion" tap). Nullable for
     * all pre-existing and non-resident rows. A UNIQUE index (below) makes this the
     * DB-enforced exact-once guarantee: the same key can create at most one order,
     * even under concurrent retries. heldMetadataJson.clientRequestId is kept as a
     * debugging mirror only — it is NOT the atomic guarantee. */
    residentClientRequestId: varchar("residentClientRequestId", {
      length: 191,
    }),

    /* Customer contact */
    firstName: varchar("firstName", { length: 100 }).notNull(),
    lastName: varchar("lastName", { length: 100 }).notNull(),
    phone: varchar("phone", { length: 30 }).notNull(),
    email: varchar("email", { length: 320 }),
    bldgUserId:
      int("bldgUserId") /* User ID from app.bldg.chat for chat notifications */,

    /* Stripe — card saved on file */
    stripeCustomerId: varchar("stripeCustomerId", { length: 255 }),
    stripePaymentMethodId: varchar("stripePaymentMethodId", { length: 255 }),
    stripePaymentIntentId: varchar("stripePaymentIntentId", { length: 255 }),

    /* Order status */
    status: mysqlEnum("status", [
      "new",
      "intake-pending",
      "collected",
      "processing",
      "ready",
      "delivered",
      "cancelled",
    ])
      .default("new")
      .notNull(),

    /* Intake: weights & counts */
    weightLbs: decimal("weightLbs", { precision: 8, scale: 2 }),
    bagCount: int("bagCount").default(1),
    garmentCount: int("garmentCount"),

    /* Pricing */
    subtotal: decimal("subtotal", { precision: 10, scale: 2 }).default("0"),
    discountPercent: decimal("discountPercent", {
      precision: 5,
      scale: 2,
    }).default("0"),
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
    stripeConnectedAccountIdSnapshot: varchar(
      "stripeConnectedAccountIdSnapshot",
      { length: 255 }
    ),

    /* Revenue intervention — manual at-risk override (see server/revenueIntervention.ts) */
    manualRiskFlag: boolean("manualRiskFlag").default(false).notNull(),

    /* Timestamps */
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    /* DB-enforced resident-laundry idempotency. MySQL allows multiple NULLs, so
     * old rows and non-resident (keyless) rows never collide; only real keys are
     * forced unique. This is the atomic exact-once guard for concurrent retries. */
    residentClientRequestIdUnq: uniqueIndex(
      "orders_resident_client_request_id_unq"
    ).on(table.residentClientRequestId),
  })
);

export type Order = typeof orders.$inferSelect;
export type InsertOrder = typeof orders.$inferInsert;

export const operationsEvents = mysqlTable(
  "operations_events",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull().default("default"),
    businessUnitLabel: varchar("businessUnitLabel", { length: 128 }).notNull(),
    source: mysqlEnum("source", [
      "driver_app_bldg",
      "cleancloud_csv",
      "cleancloud_playbook",
      "system_backfill",
    ]).notNull(),
    sourceEventType: mysqlEnum("sourceEventType", [
      "pickup_completed",
      "dropoff_completed",
    ]).notNull(),
    eventStatus: mysqlEnum("eventStatus", ["completed", "corrected", "voided"])
      .notNull()
      .default("completed"),
    orderId: int("orderId"),
    customerName: varchar("customerName", { length: 255 }).notNull(),
    customerPhone: varchar("customerPhone", { length: 30 }),
    customerEmail: varchar("customerEmail", { length: 320 }),
    serviceType: varchar("serviceType", { length: 64 }).notNull(),
    buildingName: varchar("buildingName", { length: 255 }),
    buildingSlug: varchar("buildingSlug", { length: 100 }),
    tower: varchar("tower", { length: 100 }),
    buildingResolutionStatus: mysqlEnum("buildingResolutionStatus", [
      "resolved",
      "unresolved_needs_mapping",
      "not_applicable",
    ]).notNull(),
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
  table => ({
    sourceEventOrderUnique: uniqueIndex(
      "uq_operations_events_source_type_order"
    ).on(table.source, table.sourceEventType, table.orderId),
    tenantTimeIdx: index("idx_operations_events_tenant_time").on(
      table.tenantId,
      table.actualEventTimestamp
    ),
    sourceEventTypeIdx: index("idx_operations_events_event_type").on(
      table.sourceEventType
    ),
    orderIdx: index("idx_operations_events_order").on(table.orderId),
    customerNameIdx: index("idx_operations_events_customer_name").on(
      table.customerName
    ),
    buildingIdx: index("idx_operations_events_building").on(
      table.buildingSlug,
      table.tower
    ),
    vendorIdx: index("idx_operations_events_vendor").on(table.vendorId),
    resolutionIdx: index("idx_operations_events_resolution").on(
      table.buildingResolutionStatus
    ),
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
    weeklyRevenueTargetCents: int("weeklyRevenueTargetCents")
      .notNull()
      .default(0),
    /** Added to pipeline sum for "Awaiting payment" — offline / not-yet-ordered exposure. Can be negative to trim display. */
    awaitingPaymentAdjustmentCents: int("awaitingPaymentAdjustmentCents")
      .notNull()
      .default(0),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
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
  entityType: mysqlEnum("entityType", [
    "order",
    "customer",
    "building",
  ]).notNull(),
  entityId: varchar("entityId", { length: 128 }).notNull(),
  dollarValueCents: int("dollarValueCents").notNull(),
  status: mysqlEnum("status", [
    "attempted",
    "delivered",
    "failed",
    "paid",
    "reversed",
  ]).notNull(),
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
export const vendorServiceCoverage = mysqlTable(
  "vendor_service_coverage",
  {
    id: int("id").autoincrement().primaryKey(),
    vendorId: int("vendorId").notNull(),
    buildingSlug: varchar("buildingSlug", { length: 100 }).notNull(),
    serviceType: mysqlEnum("serviceType", [
      "wash_fold",
      "dry_cleaning",
    ]).notNull(),
    priority: int("priority").default(10).notNull(),
    isActive: boolean("isActive").default(true).notNull(),
    isDefault: boolean("isDefault").default(false),
    notes: text("notes"),
    serviceArea: varchar("serviceArea", { length: 255 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    uniqueCoverage: uniqueIndex("uq_vendor_coverage").on(
      table.vendorId,
      table.buildingSlug,
      table.serviceType
    ),
  })
);

export type VendorServiceCoverage = typeof vendorServiceCoverage.$inferSelect;
export type InsertVendorServiceCoverage =
  typeof vendorServiceCoverage.$inferInsert;

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
  status: mysqlEnum("status", [
    "New",
    "Contacted",
    "Qualified",
    "Closed",
    "Spam",
  ])
    .default("New")
    .notNull(),
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
  table => ({
    repLegCallSidIdx: uniqueIndex(
      "sales_call_attempts_rep_leg_call_sid_idx"
    ).on(table.repLegCallSid),
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
    serviceType: varchar("serviceType", { length: 32 })
      .notNull()
      .default("dry_clean"),
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
  table => ({
    uqTenantSlug: uniqueIndex("uq_catalog_items_tenant_slug").on(
      table.tenantId,
      table.slug
    ),
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
  dryCleanerRetailTotalCents: int("dryCleanerRetailTotalCents")
    .notNull()
    .default(0),
  partnerDiscountPercent: int("partnerDiscountPercent").notNull().default(40),
  partnerCostCents: int("partnerCostCents").notNull().default(0),
  laundryButlerRetailSubtotalCents: int("laundryButlerRetailSubtotalCents")
    .notNull()
    .default(0),
  customerDiscountPercentAtDraft: int("customerDiscountPercentAtDraft")
    .notNull()
    .default(0),
  customerTotalCentsAtDraft: int("customerTotalCentsAtDraft")
    .notNull()
    .default(0),
  estimatedGrossMarginCents: int("estimatedGrossMarginCents")
    .notNull()
    .default(0),
  parseJson: json("parseJson"),
  matchJson: json("matchJson"),
  status: mysqlEnum("status", [
    "uploaded",
    "parsed",
    "reviewed",
    "order_created",
    "failed",
  ])
    .notNull()
    .default("uploaded"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DrycleanReceiptIntake = typeof drycleanReceiptIntakes.$inferSelect;
export type InsertDrycleanReceiptIntake =
  typeof drycleanReceiptIntakes.$inferInsert;

export const cleancloudImportBatches = mysqlTable("cleancloud_import_batches", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 64 }).notNull().default("default"),
  source: varchar("source", { length: 64 }).notNull().default("cleancloud"),
  sourceFileName: varchar("sourceFileName", { length: 255 }).notNull(),
  importedRowCount: int("importedRowCount").notNull().default(0),
  skippedRowCount: int("skippedRowCount").notNull().default(0),
  duplicateRowCount: int("duplicateRowCount").notNull().default(0),
  importStatus: mysqlEnum("importStatus", [
    "completed",
    "completed_with_errors",
    "failed",
  ])
    .notNull()
    .default("completed"),
  errorJson: json("errorJson"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type CleancloudImportBatch = typeof cleancloudImportBatches.$inferSelect;
export type InsertCleancloudImportBatch =
  typeof cleancloudImportBatches.$inferInsert;

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
  table => ({
    cleancloudOrderIdUnique: uniqueIndex("uq_cleancloud_legacy_order_id").on(
      table.cleancloudOrderId
    ),
    batchIdx: index("idx_cleancloud_legacy_orders_batch").on(
      table.importBatchId
    ),
    customerOrderIdx: index("idx_cleancloud_legacy_orders_customer_order").on(
      table.customerName,
      table.orderDateUtc,
      table.orderTotalCents
    ),
    buildingIdx: index("idx_cleancloud_legacy_orders_building").on(
      table.buildingName,
      table.tower
    ),
  })
);

export type CleancloudLegacyOrder = typeof cleancloudLegacyOrders.$inferSelect;
export type InsertCleancloudLegacyOrder =
  typeof cleancloudLegacyOrders.$inferInsert;

export const cleancloudPaidOrders = mysqlTable(
  "cleancloud_paid_orders",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull().default("default"),
    sourceReportType: mysqlEnum("sourceReportType", [
      "orders_sales",
      "orders_revenue",
    ]).notNull(),
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
    buildingResolutionStatus: mysqlEnum("buildingResolutionStatus", [
      "resolved",
      "unresolved_needs_mapping",
      "not_applicable",
    ]).notNull(),
    rawJson: json("rawJson"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    orderReportUnique: uniqueIndex("uq_cleancloud_paid_order_report").on(
      table.tenantId,
      table.cleancloudOrderId,
      table.sourceReportType
    ),
    batchIdx: index("idx_cleancloud_paid_orders_batch").on(table.importBatchId),
    paymentDateIdx: index("idx_cleancloud_paid_orders_payment_date").on(
      table.paymentDateUtc
    ),
    paidDateIdx: index("idx_cleancloud_paid_orders_paid_date").on(
      table.paidDateUtc
    ),
    customerIdx: index("idx_cleancloud_paid_orders_customer").on(
      table.cleancloudCustomerId,
      table.customerName
    ),
    buildingIdx: index("idx_cleancloud_paid_orders_building").on(
      table.buildingSlug,
      table.tower
    ),
  })
);

export type CleancloudPaidOrder = typeof cleancloudPaidOrders.$inferSelect;
export type InsertCleancloudPaidOrder =
  typeof cleancloudPaidOrders.$inferInsert;

export const clearentImportBatches = mysqlTable("clearent_import_batches", {
  id: int("id").autoincrement().primaryKey(),
  source: varchar("source", { length: 64 })
    .notNull()
    .default("clearent_xplorpay"),
  sourceFileName: varchar("sourceFileName", { length: 255 }).notNull(),
  sourceReportBasis: mysqlEnum("sourceReportBasis", [
    "settled_date",
    "entered_date",
    "unknown",
  ])
    .notNull()
    .default("unknown"),
  importedRowCount: int("importedRowCount").notNull().default(0),
  skippedRowCount: int("skippedRowCount").notNull().default(0),
  duplicateRowCount: int("duplicateRowCount").notNull().default(0),
  importStatus: mysqlEnum("importStatus", [
    "completed",
    "completed_with_errors",
    "failed",
  ])
    .notNull()
    .default("completed"),
  errorJson: json("errorJson"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ClearentImportBatch = typeof clearentImportBatches.$inferSelect;
export type InsertClearentImportBatch =
  typeof clearentImportBatches.$inferInsert;

export const clearentTransactions = mysqlTable(
  "clearent_transactions",
  {
    id: int("id").autoincrement().primaryKey(),
    clearentTransactionId: varchar("clearentTransactionId", { length: 128 }),
    sourceFileName: varchar("sourceFileName", { length: 255 }).notNull(),
    importBatchId: int("importBatchId").notNull(),
    sourceReportBasis: mysqlEnum("sourceReportBasis", [
      "settled_date",
      "entered_date",
      "unknown",
    ])
      .notNull()
      .default("unknown"),
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
    transactionStatus: varchar("transactionStatus", { length: 100 })
      .notNull()
      .default("unknown"),
    transactionType: varchar("transactionType", { length: 100 })
      .notNull()
      .default("unknown"),
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
  table => ({
    clearentTransactionIdUnique: uniqueIndex("uq_clearent_transaction_id").on(
      table.clearentTransactionId
    ),
    batchIdx: index("idx_clearent_transactions_batch").on(table.importBatchId),
    enteredDateIdx: index("idx_clearent_transactions_entered").on(
      table.enteredDateUtc
    ),
    settledDateIdx: index("idx_clearent_transactions_settled").on(
      table.settledDateUtc
    ),
    authMatchIdx: index("idx_clearent_transactions_auth_match").on(
      table.authCode,
      table.grossAmountCents,
      table.lastFour
    ),
    buildingIdx: index("idx_clearent_transactions_building").on(
      table.buildingName,
      table.tower
    ),
  })
);

export type ClearentTransaction = typeof clearentTransactions.$inferSelect;
export type InsertClearentTransaction =
  typeof clearentTransactions.$inferInsert;

export const clearentDailySummaries = mysqlTable(
  "clearent_daily_summaries",
  {
    id: int("id").autoincrement().primaryKey(),
    sourceFileName: varchar("sourceFileName", { length: 255 }).notNull(),
    importBatchId: int("importBatchId").notNull(),
    sourceReportBasis: mysqlEnum("sourceReportBasis", [
      "settled_date",
      "entered_date",
      "unknown",
    ])
      .notNull()
      .default("unknown"),
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
  table => ({
    basisDateUnique: uniqueIndex("uq_clearent_daily_summary_basis_date").on(
      table.sourceReportBasis,
      table.reportDateUtc
    ),
    batchIdx: index("idx_clearent_daily_summaries_batch").on(
      table.importBatchId
    ),
    reportDateIdx: index("idx_clearent_daily_summaries_report_date").on(
      table.reportDateUtc
    ),
  })
);

export type ClearentDailySummary = typeof clearentDailySummaries.$inferSelect;
export type InsertClearentDailySummary =
  typeof clearentDailySummaries.$inferInsert;

export const paymentReconciliationMatches = mysqlTable(
  "payment_reconciliation_matches",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull().default("default"),
    processor: mysqlEnum("processor", [
      "clearent",
      "stripe",
      "manual",
    ]).notNull(),
    processorSourceType: mysqlEnum("processorSourceType", [
      "clearent_daily_summary",
      "clearent_transaction",
      "stripe_payment",
    ]).notNull(),
    processorSourceId: varchar("processorSourceId", { length: 128 }),
    orderSource: mysqlEnum("orderSource", [
      "cleancloud_orders_sales",
      "cleancloud_orders_revenue",
      "bldg",
      "manual",
    ]).notNull(),
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
    matchConfidence: mysqlEnum("matchConfidence", [
      "high",
      "medium",
      "low",
    ]).notNull(),
    matchReason: text("matchReason").notNull(),
    localBusinessDate: varchar("localBusinessDate", { length: 20 }).notNull(),
    rawJson: json("rawJson"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    sourceDateIdx: index("idx_payment_reconciliation_source_date").on(
      table.processor,
      table.processorSourceType,
      table.processorSourceId,
      table.localBusinessDate
    ),
    statusIdx: index("idx_payment_reconciliation_status").on(table.matchStatus),
    customerIdx: index("idx_payment_reconciliation_customer").on(
      table.cleancloudCustomerId,
      table.customerName
    ),
    buildingIdx: index("idx_payment_reconciliation_building").on(
      table.buildingSlug,
      table.tower
    ),
  })
);

export type PaymentReconciliationMatch =
  typeof paymentReconciliationMatches.$inferSelect;
export type InsertPaymentReconciliationMatch =
  typeof paymentReconciliationMatches.$inferInsert;

export const operatorTasks = mysqlTable("operator_tasks", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 64 }).notNull().default("default"),
  source: mysqlEnum("source", [
    "emergency_composer",
    "operator_voice",
    "manual",
  ])
    .notNull()
    .default("emergency_composer"),
  level: mysqlEnum("level", [
    "level_1",
    "level_2",
    "level_3",
    "level_4",
  ]).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  details: text("details"),
  status: mysqlEnum("status", ["open", "in_progress", "done", "blocked"])
    .notNull()
    .default("open"),
  priority: mysqlEnum("priority", ["emergency", "high", "normal", "low"])
    .notNull()
    .default("high"),
  target: varchar("target", { length: 255 }),
  sourceNote: text("sourceNote"),
  createdByUserId: varchar("createdByUserId", { length: 128 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type OperatorTask = typeof operatorTasks.$inferSelect;
export type InsertOperatorTask = typeof operatorTasks.$inferInsert;

export const opsTasks = mysqlTable(
  "ops_tasks",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull().default("default"),
    lane: mysqlEnum("lane", [
      "lane_1",
      "lane_2",
      "lane_3",
      "level_4",
    ]).notNull(),
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
    source: mysqlEnum("source", [
      "manual",
      "agent_suggested",
      "system_detected",
      "level_4",
      "voice",
      "quick_input",
      "emergency_composer",
    ])
      .notNull()
      .default("manual"),
    createdBy: varchar("createdBy", { length: 128 }),
    assignedTo: varchar("assignedTo", { length: 128 }),
    status: mysqlEnum("status", [
      "open",
      "accepted",
      "in_progress",
      "completed",
      "dismissed",
      "expired",
    ])
      .notNull()
      .default("open"),
    priority: mysqlEnum("priority", ["low", "normal", "high", "emergency"])
      .notNull()
      .default("normal"),
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
  },
  table => ({
    tenantStatusIdx: index("idx_ops_tasks_tenant_status").on(
      table.tenantId,
      table.status
    ),
    tenantLaneIdx: index("idx_ops_tasks_tenant_lane").on(
      table.tenantId,
      table.lane
    ),
    tenantCompletedIdx: index("idx_ops_tasks_tenant_completed").on(
      table.tenantId,
      table.completedAt
    ),
    agentEventIdx: index("idx_ops_tasks_agent_event").on(table.agentEventId),
    orderIdx: index("idx_ops_tasks_order").on(table.orderId),
  })
);

export type OpsTask = typeof opsTasks.$inferSelect;
export type InsertOpsTask = typeof opsTasks.$inferInsert;

export const opsTaskEvents = mysqlTable(
  "ops_task_events",
  {
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
    actorType: mysqlEnum("actorType", [
      "human",
      "voice",
      "resident_chat",
      "driver",
      "vendor",
      "ai_agent",
      "system",
    ])
      .notNull()
      .default("human"),
    actorId: varchar("actorId", { length: 128 }),
    agentEventId: int("agentEventId"),
    beforeJson: json("beforeJson"),
    afterJson: json("afterJson"),
    note: text("note"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    tenantTaskIdx: index("idx_ops_task_events_tenant_task").on(
      table.tenantId,
      table.taskId
    ),
    tenantEventIdx: index("idx_ops_task_events_tenant_event").on(
      table.tenantId,
      table.eventType
    ),
    agentEventIdx: index("idx_ops_task_events_agent_event").on(
      table.agentEventId
    ),
  })
);

export type OpsTaskEvent = typeof opsTaskEvents.$inferSelect;
export type InsertOpsTaskEvent = typeof opsTaskEvents.$inferInsert;

export const commercialAccounts = mysqlTable(
  "commercial_accounts",
  {
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
  },
  table => ({
    tenantNameIdx: index("idx_commercial_accounts_tenant_name").on(
      table.tenantId,
      table.name
    ),
    tenantIdentityUnique: uniqueIndex(
      "uq_commercial_accounts_tenant_identity"
    ).on(table.tenantId, table.identityKey),
    tenantProviderUnique: uniqueIndex(
      "uq_commercial_accounts_tenant_provider"
    ).on(table.tenantId, table.providerName, table.providerAccountId),
  })
);

export const commercialAccountLocations = mysqlTable(
  "commercial_account_locations",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    accountId: int("accountId").notNull(),
    locationKey: varchar("locationKey", { length: 64 }),
    label: varchar("label", { length: 128 }),
    address: varchar("address", { length: 512 }).notNull(),
    latitude: decimal("latitude", { precision: 10, scale: 7 }),
    longitude: decimal("longitude", { precision: 10, scale: 7 }),
    isPrimary: boolean("isPrimary").notNull().default(false),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    tenantAccountIdx: index("idx_commercial_locations_tenant_account").on(
      table.tenantId,
      table.accountId
    ),
    tenantAccountLocationUnique: uniqueIndex(
      "uq_commercial_locations_tenant_account_key"
    ).on(table.tenantId, table.accountId, table.locationKey),
  })
);

export const commercialAccountContacts = mysqlTable(
  "commercial_account_contacts",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    accountId: int("accountId").notNull(),
    contactKey: varchar("contactKey", { length: 64 }),
    name: varchar("name", { length: 255 }),
    title: varchar("title", { length: 255 }),
    email: varchar("email", { length: 320 }),
    phone: varchar("phone", { length: 64 }),
    relationshipType: mysqlEnum("relationshipType", [
      "decision_maker",
      "gatekeeper",
      "champion",
      "concierge",
      "front_desk",
      "security",
      "operations",
      "other",
      "unknown",
    ])
      .notNull()
      .default("unknown"),
    preferredChannel: mysqlEnum("preferredChannel", [
      "email",
      "sms",
      "phone",
      "unknown",
    ])
      .notNull()
      .default("unknown"),
    source: varchar("source", { length: 96 }).notNull().default("unknown"),
    sourceUrl: varchar("sourceUrl", { length: 1024 }),
    sourcedAt: timestamp("sourcedAt"),
    notes: text("notes"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    tenantAccountIdx: index("idx_commercial_contacts_tenant_account").on(
      table.tenantId,
      table.accountId
    ),
    tenantAccountContactUnique: uniqueIndex(
      "uq_commercial_contacts_tenant_account_key"
    ).on(table.tenantId, table.accountId, table.contactKey),
  })
);

export const commercialOpportunities = mysqlTable(
  "commercial_opportunities",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    accountId: int("accountId").notNull(),
    score: int("score").notNull(),
    grade: mysqlEnum("grade", ["low", "medium", "high"]).notNull(),
    estimatedAnnualValueCents: int("estimatedAnnualValueCents"),
    estimateConfidence: mysqlEnum("estimateConfidence", [
      "low",
      "medium",
      "high",
    ]).notNull(),
    primarySignal: text("primarySignal").notNull(),
    reasonsJson: json("reasonsJson").notNull(),
    risksJson: json("risksJson").notNull(),
    evidenceJson: json("evidenceJson").notNull(),
    scoredAt: timestamp("scoredAt").defaultNow().notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    tenantAccountIdx: index("idx_commercial_opportunities_tenant_account").on(
      table.tenantId,
      table.accountId
    ),
    tenantScoreIdx: index("idx_commercial_opportunities_tenant_score").on(
      table.tenantId,
      table.score
    ),
  })
);

export const commercialMissions = mysqlTable(
  "commercial_missions",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    opportunityId: int("opportunityId"),
    opsTaskId: int("opsTaskId"),
    assignedTo: varchar("assignedTo", { length: 128 }),
    code: varchar("code", { length: 32 }).notNull(),
    status: mysqlEnum("status", [
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
      "won",
      "lost",
    ])
      .notNull()
      .default("candidate"),
    version: int("version").notNull().default(1),
    accountSnapshotJson: json("accountSnapshotJson").notNull(),
    opportunitySnapshotJson: json("opportunitySnapshotJson").notNull(),
    missionBriefJson: json("missionBriefJson").notNull(),
    expiresAt: timestamp("expiresAt"),
    createdBy: varchar("createdBy", { length: 128 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
    completedAt: timestamp("completedAt"),
  },
  table => ({
    tenantCodeUnique: uniqueIndex("uq_commercial_missions_tenant_code").on(
      table.tenantId,
      table.code
    ),
    tenantStatusIdx: index("idx_commercial_missions_tenant_status").on(
      table.tenantId,
      table.status
    ),
    tenantAssigneeIdx: index("idx_commercial_missions_tenant_assignee").on(
      table.tenantId,
      table.assignedTo
    ),
  })
);

export const commercialMissionEvents = mysqlTable(
  "commercial_mission_events",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    missionId: int("missionId").notNull(),
    eventName: varchar("eventName", { length: 64 }).notNull(),
    fromStatus: varchar("fromStatus", { length: 32 }),
    toStatus: varchar("toStatus", { length: 32 }),
    actorType: mysqlEnum("actorType", [
      "system",
      "operator",
      "driver",
      "game",
    ]).notNull(),
    actorId: varchar("actorId", { length: 128 }),
    idempotencyKey: varchar("idempotencyKey", { length: 191 }).notNull(),
    metadataJson: json("metadataJson"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    tenantMissionIdx: index("idx_commercial_mission_events_tenant_mission").on(
      table.tenantId,
      table.missionId
    ),
    tenantIdempotencyUnique: uniqueIndex(
      "uq_commercial_mission_events_tenant_idempotency"
    ).on(table.tenantId, table.idempotencyKey),
  })
);

export const commercialMissionSteps = mysqlTable(
  "commercial_mission_steps",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    missionId: int("missionId").notNull(),
    stepKey: varchar("stepKey", { length: 64 }).notNull(),
    label: varchar("label", { length: 255 }).notNull(),
    detail: text("detail").notNull(),
    status: mysqlEnum("status", [
      "locked",
      "ready",
      "active",
      "completed",
      "skipped",
    ]).notNull(),
    position: int("position").notNull(),
    completedAt: timestamp("completedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    tenantMissionStepUnique: uniqueIndex(
      "uq_commercial_mission_steps_tenant_mission_key"
    ).on(table.tenantId, table.missionId, table.stepKey),
  })
);

export const commercialMissionIrlStepDetails = mysqlTable(
  "commercial_mission_irl_step_details",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    missionId: int("missionId").notNull(),
    missionStepId: int("missionStepId").notNull(),
    stepType: mysqlEnum("stepType", [
      "generic",
      "wardrobe_review",
      "route_stop",
      "collateral_pickup",
      "purchase_stop",
      "sales_training",
      "field_visit",
      "debrief",
    ])
      .notNull()
      .default("generic"),
    status: mysqlEnum("status", [
      "locked",
      "ready",
      "active",
      "awaiting_review",
      "rejected",
      "completed",
      "skipped",
      "cancelled",
    ])
      .notNull()
      .default("locked"),
    instructionText: text("instructionText"),
    revealPolicy: mysqlEnum("revealPolicy", [
      "sequential",
      "immediate",
      "admin_only",
    ])
      .notNull()
      .default("sequential"),
    destinationName: varchar("destinationName", { length: 255 }),
    destinationAddress: varchar("destinationAddress", { length: 512 }),
    destinationLatitude: decimal("destinationLatitude", {
      precision: 10,
      scale: 7,
    }),
    destinationLongitude: decimal("destinationLongitude", {
      precision: 10,
      scale: 7,
    }),
    mapsUrl: varchar("mapsUrl", { length: 2048 }),
    countdownDurationSeconds: int("countdownDurationSeconds"),
    startedAt: timestamp("startedAt"),
    deadlineAt: timestamp("deadlineAt"),
    proofRequirement: mysqlEnum("proofRequirement", [
      "none",
      "confirmation",
      "photo",
      "photo_optional",
    ])
      .notNull()
      .default("none"),
    referenceImageUrl: varchar("referenceImageUrl", { length: 2048 }),
    instructionVideoUrl: varchar("instructionVideoUrl", { length: 2048 }),
    pinnedCoachingArtifactId: varchar("pinnedCoachingArtifactId", {
      length: 36,
    }),
    verificationState: mysqlEnum("verificationState", [
      "not_required",
      "pending",
      "approved",
      "rejected",
      "overridden",
    ])
      .notNull()
      .default("not_required"),
    proofAssetId: varchar("proofAssetId", { length: 36 }),
    reviewedBy: varchar("reviewedBy", { length: 128 }),
    reviewedAt: timestamp("reviewedAt"),
    rejectionReason: text("rejectionReason"),
    fulfillmentMode: mysqlEnum("fulfillmentMode", [
      "not_applicable",
      "live_provider",
      "staged_demo",
      "manual_fulfillment",
    ])
      .notNull()
      .default("not_applicable"),
    metadataJson: json("metadataJson"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    tenantStepUnique: uniqueIndex(
      "uq_commercial_irl_step_details_tenant_step"
    ).on(table.tenantId, table.missionStepId),
    tenantMissionIdx: index(
      "idx_commercial_irl_step_details_tenant_mission"
    ).on(table.tenantId, table.missionId, table.missionStepId),
  })
);

export const commercialMissionGameAttempts = mysqlTable(
  "commercial_mission_game_attempts",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    missionId: int("missionId").notNull(),
    missionVersion: int("missionVersion").notNull(),
    playerId: varchar("playerId", { length: 128 }).notNull(),
    status: mysqlEnum("status", ["active", "abandoned", "failed", "qualified"])
      .notNull()
      .default("active"),
    startedAt: timestamp("startedAt").defaultNow().notNull(),
    endedAt: timestamp("endedAt"),
    durationMs: int("durationMs"),
    telemetryJson: json("telemetryJson"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    tenantMissionIdx: index("idx_commercial_game_attempts_tenant_mission").on(
      table.tenantId,
      table.missionId,
      table.startedAt
    ),
    tenantPlayerIdx: index("idx_commercial_game_attempts_tenant_player").on(
      table.tenantId,
      table.playerId,
      table.startedAt
    ),
  })
);

export const commercialMissionGameResults = mysqlTable(
  "commercial_mission_game_results",
  {
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
  },
  table => ({
    tenantMissionUnique: uniqueIndex(
      "uq_commercial_game_results_tenant_mission"
    ).on(table.tenantId, table.missionId),
    tenantAttemptUnique: uniqueIndex(
      "uq_commercial_game_results_tenant_attempt"
    ).on(table.tenantId, table.gameAttemptId),
  })
);

export const commercialMissionGameRewards = mysqlTable(
  "commercial_mission_game_rewards",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    missionId: int("missionId").notNull(),
    gameResultId: int("gameResultId").notNull(),
    playerId: varchar("playerId", { length: 128 }).notNull(),
    xpAwarded: int("xpAwarded").notNull(),
    streakDays: int("streakDays").notNull(),
    awardedAt: timestamp("awardedAt").defaultNow().notNull(),
  },
  table => ({
    tenantMissionUnique: uniqueIndex(
      "uq_commercial_game_rewards_tenant_mission"
    ).on(table.tenantId, table.missionId),
    tenantResultUnique: uniqueIndex(
      "uq_commercial_game_rewards_tenant_result"
    ).on(table.tenantId, table.gameResultId),
  })
);

export const commercialVisitOutcomes = mysqlTable(
  "commercial_visit_outcomes",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    missionId: int("missionId").notNull(),
    outcome: mysqlEnum("outcome", ["follow_up", "won", "lost"]).notNull(),
    notes: text("notes"),
    followUpAt: timestamp("followUpAt"),
    estimatedContractValueCents: int("estimatedContractValueCents"),
    decisionMakerStatus: mysqlEnum("decisionMakerStatus", [
      "met",
      "unavailable",
      "not_recorded",
    ])
      .notNull()
      .default("not_recorded"),
    collateralDelivered: boolean("collateralDelivered")
      .notNull()
      .default(false),
    quoteRequested: boolean("quoteRequested").notNull().default(false),
    pilotRequested: boolean("pilotRequested").notNull().default(false),
    followUpRequested: boolean("followUpRequested").notNull().default(false),
    reason: varchar("reason", { length: 64 }),
    evidenceJson: json("evidenceJson").notNull(),
    recordedBy: varchar("recordedBy", { length: 128 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    tenantMissionIdx: index("idx_commercial_visit_outcomes_tenant_mission").on(
      table.tenantId,
      table.missionId
    ),
    tenantMissionUnique: uniqueIndex(
      "uq_commercial_visit_outcomes_tenant_mission"
    ).on(table.tenantId, table.missionId),
  })
);

export const tenantFieldChecklistTemplates = mysqlTable(
  "tenant_field_checklist_templates",
  {
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
  },
  table => ({
    tenantItemUnique: uniqueIndex("uq_tenant_field_checklist_item").on(
      table.tenantId,
      table.itemKey
    ),
    tenantPositionIdx: index("idx_tenant_field_checklist_position").on(
      table.tenantId,
      table.position
    ),
  })
);

export const commercialMissionFieldStates = mysqlTable(
  "commercial_mission_field_states",
  {
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
  },
  table => ({
    tenantMissionUnique: uniqueIndex(
      "uq_commercial_field_states_tenant_mission"
    ).on(table.tenantId, table.missionId),
  })
);

export const commercialMissionFieldChecklistItems = mysqlTable(
  "commercial_mission_field_checklist_items",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    missionId: int("missionId").notNull(),
    itemKey: varchar("itemKey", { length: 64 }).notNull(),
    label: varchar("label", { length: 255 }).notNull(),
    detail: text("detail").notNull(),
    required: boolean("required").notNull(),
    position: int("position").notNull(),
    status: mysqlEnum("status", ["pending", "completed", "skipped"])
      .notNull()
      .default("pending"),
    completedAt: timestamp("completedAt"),
    completedBy: varchar("completedBy", { length: 128 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    tenantMissionItemUnique: uniqueIndex(
      "uq_commercial_field_items_tenant_mission_item"
    ).on(table.tenantId, table.missionId, table.itemKey),
    tenantMissionPositionIdx: index(
      "idx_commercial_field_items_tenant_mission_position"
    ).on(table.tenantId, table.missionId, table.position),
  })
);

export const commercialMissionPhoneHandoffs = mysqlTable(
  "commercial_mission_phone_handoffs",
  {
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
  },
  table => ({
    tenantTokenUnique: uniqueIndex(
      "uq_commercial_phone_handoffs_tenant_token"
    ).on(table.tenantId, table.tokenHash),
    tenantMissionIdx: index("idx_commercial_phone_handoffs_tenant_mission").on(
      table.tenantId,
      table.missionId,
      table.createdAt
    ),
  })
);

export const commercialMissionDispatches = mysqlTable(
  "commercial_mission_dispatches",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    missionId: int("missionId").notNull(),
    assignedTo: varchar("assignedTo", { length: 128 }).notNull(),
    handoffId: varchar("handoffId", { length: 36 }),
    dispatchPolicy: mysqlEnum("dispatchPolicy", ["manual", "on_game_complete"])
      .notNull()
      .default("manual"),
    channel: mysqlEnum("channel", ["in_app", "sms"]).notNull(),
    status: mysqlEnum("status", [
      "queued",
      "sent",
      "failed",
      "opened",
      "not_configured",
      "cancelled",
    ])
      .notNull()
      .default("queued"),
    destinationPath: varchar("destinationPath", { length: 1024 }).notNull(),
    queuedAt: timestamp("queuedAt").defaultNow().notNull(),
    sentAt: timestamp("sentAt"),
    failedAt: timestamp("failedAt"),
    openedAt: timestamp("openedAt"),
    providerMessageId: varchar("providerMessageId", { length: 255 }),
    failureReason: text("failureReason"),
    requestId: varchar("requestId", { length: 36 }).notNull(),
    createdBy: varchar("createdBy", { length: 128 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    tenantRequestChannelUnique: uniqueIndex(
      "uq_commercial_dispatches_tenant_request_channel"
    ).on(table.tenantId, table.requestId, table.channel),
    tenantMissionIdx: index("idx_commercial_dispatches_tenant_mission").on(
      table.tenantId,
      table.missionId,
      table.createdAt
    ),
    tenantAssigneeStatusIdx: index(
      "idx_commercial_dispatches_tenant_assignee_status"
    ).on(table.tenantId, table.assignedTo, table.status, table.createdAt),
  })
);

export const dayforgeEvidenceUploads = mysqlTable(
  "dayforge_evidence_uploads",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    missionId: int("missionId").notNull(),
    missionStepId: int("missionStepId").notNull(),
    submitterId: varchar("submitterId", { length: 128 }).notNull(),
    storageKey: varchar("storageKey", { length: 1024 }).notNull(),
    contentHash: varchar("contentHash", { length: 64 }).notNull(),
    mimeType: varchar("mimeType", { length: 96 }).notNull(),
    sizeBytes: int("sizeBytes").notNull(),
    attemptNumber: int("attemptNumber").notNull().default(1),
    submittedAt: timestamp("submittedAt").defaultNow().notNull(),
    reviewStatus: mysqlEnum("reviewStatus", [
      "pending",
      "approved",
      "rejected",
      "overridden",
      "superseded",
    ])
      .notNull()
      .default("pending"),
    reviewerId: varchar("reviewerId", { length: 128 }),
    reviewedAt: timestamp("reviewedAt"),
    reviewNote: text("reviewNote"),
    rejectionReason: text("rejectionReason"),
    previousProofId: varchar("previousProofId", { length: 36 }),
    requestId: varchar("requestId", { length: 36 }).notNull(),
    purgeAfter: timestamp("purgeAfter").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    tenantRequestUnique: uniqueIndex("uq_commercial_proofs_tenant_request").on(
      table.tenantId,
      table.requestId
    ),
    tenantStepIdx: index("idx_dayforge_evidence_tenant_step").on(
      table.tenantId,
      table.missionId,
      table.missionStepId,
      table.reviewStatus,
      table.submittedAt
    ),
    purgeIdx: index("idx_dayforge_evidence_purge_after").on(table.purgeAfter),
  })
);

/**
 * Durable lifecycle record for each private evidence object. Upload guards
 * close the object-store/SQL commit gap; successful deletion clears the live
 * key but keeps its hash and outcome as an auditable tombstone.
 */
export const dayforgeEvidenceObjectDeletions = mysqlTable(
  "dayforge_evidence_object_deletions",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    evidenceUploadId: varchar("evidenceUploadId", { length: 36 }),
    storageKey: varchar("storageKey", { length: 1024 }),
    storageKeyHash: varchar("storageKeyHash", { length: 64 }).notNull(),
    reason: mysqlEnum("reason", [
      "upload_guard",
      "upload_orphan",
      "retention_expiry",
      "manual",
    ]).notNull(),
    status: mysqlEnum("status", [
      "guarded",
      "attached",
      "queued",
      "in_progress",
      "retry",
      "succeeded",
      "permanent_failure",
    ])
      .notNull()
      .default("guarded"),
    attemptCount: int("attemptCount").notNull().default(0),
    leaseId: varchar("leaseId", { length: 36 }),
    lastAttemptAt: timestamp("lastAttemptAt"),
    nextAttemptAt: timestamp("nextAttemptAt"),
    deletedAt: timestamp("deletedAt"),
    lastErrorCode: varchar("lastErrorCode", { length: 96 }),
    lastErrorMessage: text("lastErrorMessage"),
    requestId: varchar("requestId", { length: 191 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    tenantRequestUnique: uniqueIndex(
      "uq_dayforge_evidence_deletions_tenant_request"
    ).on(table.tenantId, table.requestId),
    tenantStorageKeyUnique: uniqueIndex(
      "uq_dayforge_evidence_deletions_tenant_storage_hash"
    ).on(table.tenantId, table.storageKeyHash),
    tenantEvidenceIdx: index(
      "idx_dayforge_evidence_deletions_tenant_evidence"
    ).on(table.tenantId, table.evidenceUploadId),
    retryIdx: index("idx_dayforge_evidence_deletions_retry").on(
      table.status,
      table.nextAttemptAt,
      table.createdAt
    ),
  })
);

export const commercialMissionCoachingArtifacts = mysqlTable(
  "commercial_mission_coaching_artifacts",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    missionId: int("missionId").notNull(),
    missionStepId: int("missionStepId"),
    scopeKey: varchar("scopeKey", { length: 64 }).notNull(),
    accountId: int("accountId").notNull(),
    generationStatus: mysqlEnum("generationStatus", [
      "pending",
      "generated",
      "fallback",
      "failed",
    ]).notNull(),
    provider: varchar("provider", { length: 64 }).notNull(),
    modelId: varchar("modelId", { length: 191 }),
    promptVersion: varchar("promptVersion", { length: 64 }).notNull(),
    contextHash: varchar("contextHash", { length: 64 }).notNull(),
    cacheKey: varchar("cacheKey", { length: 191 }),
    requestId: varchar("requestId", { length: 36 }).notNull(),
    version: int("version").notNull(),
    generatedAt: timestamp("generatedAt"),
    structuredOutputJson: json("structuredOutputJson"),
    evidenceReferencesJson: json("evidenceReferencesJson"),
    claimsJson: json("claimsJson"),
    failureCode: varchar("failureCode", { length: 96 }),
    fallbackCode: varchar("fallbackCode", { length: 96 }),
    requestedBy: varchar("requestedBy", { length: 128 }).notNull(),
    generationLeaseUntil: timestamp("generationLeaseUntil"),
    generationAttemptCount: int("generationAttemptCount").notNull().default(0),
    supersededAt: timestamp("supersededAt"),
    active: boolean("active").notNull().default(true),
    latencyMs: int("latencyMs"),
    inputTokens: int("inputTokens"),
    outputTokens: int("outputTokens"),
    estimatedCostMicros: int("estimatedCostMicros"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    tenantRequestUnique: uniqueIndex(
      "uq_commercial_coaching_tenant_request"
    ).on(table.tenantId, table.requestId),
    tenantCacheIdx: index("idx_commercial_coaching_tenant_cache_key").on(
      table.tenantId,
      table.cacheKey
    ),
    tenantContextIdx: index("idx_commercial_coaching_tenant_context").on(
      table.tenantId,
      table.missionId,
      table.contextHash,
      table.promptVersion
    ),
    tenantMissionActiveIdx: index(
      "idx_commercial_coaching_tenant_mission_active"
    ).on(table.tenantId, table.missionId, table.active, table.createdAt),
    tenantMissionVersionUnique: uniqueIndex(
      "uq_commercial_coaching_tenant_mission_scope_version"
    ).on(table.tenantId, table.missionId, table.scopeKey, table.version),
  })
);

export const driverSalesScoreEvents = mysqlTable(
  "driver_sales_score_events",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    driverId: varchar("driverId", { length: 128 }).notNull(),
    missionId: int("missionId"),
    eventType: varchar("eventType", { length: 64 }).notNull(),
    points: int("points").notNull(),
    dedupeKey: varchar("dedupeKey", { length: 191 }).notNull(),
    metadataJson: json("metadataJson"),
    occurredAt: timestamp("occurredAt").defaultNow().notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    tenantDedupeUnique: uniqueIndex("uq_driver_sales_score_tenant_dedupe").on(
      table.tenantId,
      table.dedupeKey
    ),
    tenantDriverOccurredIdx: index(
      "idx_driver_sales_score_tenant_driver_occurred"
    ).on(table.tenantId, table.driverId, table.occurredAt),
  })
);

export const driverSalesJournals = mysqlTable(
  "driver_sales_journals",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    driverId: varchar("driverId", { length: 128 }).notNull(),
    journalDate: varchar("journalDate", { length: 10 }).notNull(),
    clientRequestId: varchar("clientRequestId", { length: 36 }),
    audioStorageKey: varchar("audioStorageKey", { length: 512 }),
    audioMimeType: varchar("audioMimeType", { length: 96 }),
    rawTranscript: text("rawTranscript"),
    transcript: text("transcript").notNull(),
    insightsJson: json("insightsJson").notNull(),
    processingStatus: mysqlEnum("processingStatus", [
      "captured",
      "transcribing",
      "extracting",
      "processed",
      "fallback",
      "failed",
    ]).notNull(),
    journalPoints: int("journalPoints").notNull().default(0),
    captureLatitude: decimal("captureLatitude", { precision: 10, scale: 7 }),
    captureLongitude: decimal("captureLongitude", { precision: 10, scale: 7 }),
    captureAccuracyMeters: decimal("captureAccuracyMeters", {
      precision: 10,
      scale: 2,
    }),
    locationCapturedAt: timestamp("locationCapturedAt"),
    locationContemporaneous: boolean("locationContemporaneous")
      .notNull()
      .default(false),
    processingError: varchar("processingError", { length: 512 }),
    processingAttempts: int("processingAttempts").notNull().default(0),
    processedAt: timestamp("processedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    tenantRequestUnique: uniqueIndex(
      "uq_driver_sales_journal_tenant_request"
    ).on(table.tenantId, table.clientRequestId),
    tenantDriverDateIdx: index(
      "idx_driver_sales_journal_driver_date"
    ).on(table.tenantId, table.driverId, table.journalDate, table.createdAt),
    tenantProcessingIdx: index(
      "idx_driver_sales_journal_processing"
    ).on(table.tenantId, table.processingStatus, table.createdAt),
    tenantCreatedIdx: index("idx_driver_sales_journal_tenant_created").on(
      table.tenantId,
      table.createdAt
    ),
  })
);

export const driverSalesPlaybookSources = mysqlTable(
  "driver_sales_playbook_sources",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    name: varchar("name", { length: 191 }).notNull(),
    sourceType: mysqlEnum("sourceType", [
      "foundation",
      "instagram",
      "document",
      "video",
      "other",
    ]).notNull(),
    sourceUrl: varchar("sourceUrl", { length: 1024 }),
    attribution: varchar("attribution", { length: 512 }),
    content: text("content").notNull(),
    active: boolean("active").notNull().default(true),
    createdBy: varchar("createdBy", { length: 128 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    tenantActiveIdx: index("idx_driver_sales_playbook_tenant_active").on(
      table.tenantId,
      table.active
    ),
  })
);

export const tenantCommercialProposalProfiles = mysqlTable(
  "tenant_commercial_proposal_profiles",
  {
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
    pickupScheduleLabel: varchar("pickupScheduleLabel", {
      length: 255,
    }).notNull(),
    serviceAreaLabel: varchar("serviceAreaLabel", { length: 255 }).notNull(),
    insuranceLabel: varchar("insuranceLabel", { length: 255 }),
    servicesJson: json("servicesJson").notNull(),
    createdBy: varchar("createdBy", { length: 128 }).notNull(),
    updatedBy: varchar("updatedBy", { length: 128 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  }
);

export const commercialProposals = mysqlTable(
  "commercial_proposals",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    missionId: int("missionId").notNull(),
    version: int("version").notNull(),
    status: mysqlEnum("status", ["draft", "approved", "superseded", "void"])
      .notNull()
      .default("draft"),
    snapshotJson: json("snapshotJson").notNull(),
    contentHash: varchar("contentHash", { length: 64 }).notNull(),
    requestId: varchar("requestId", { length: 36 }).notNull(),
    validThrough: timestamp("validThrough").notNull(),
    createdBy: varchar("createdBy", { length: 128 }).notNull(),
    approvedBy: varchar("approvedBy", { length: 128 }),
    approvedAt: timestamp("approvedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    tenantMissionVersionUnique: uniqueIndex(
      "uq_commercial_proposals_tenant_mission_version"
    ).on(table.tenantId, table.missionId, table.version),
    tenantRequestUnique: uniqueIndex(
      "uq_commercial_proposals_tenant_request"
    ).on(table.tenantId, table.requestId),
    tenantMissionStatusIdx: index(
      "idx_commercial_proposals_tenant_mission_status"
    ).on(table.tenantId, table.missionId, table.status, table.createdAt),
  })
);

export const commercialProposalEvents = mysqlTable(
  "commercial_proposal_events",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    missionId: int("missionId").notNull(),
    proposalId: varchar("proposalId", { length: 36 }).notNull(),
    eventName: varchar("eventName", { length: 64 }).notNull(),
    actorId: varchar("actorId", { length: 128 }).notNull(),
    idempotencyKey: varchar("idempotencyKey", { length: 191 }).notNull(),
    metadataJson: json("metadataJson").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    tenantIdempotencyUnique: uniqueIndex(
      "uq_commercial_proposal_events_tenant_idempotency"
    ).on(table.tenantId, table.idempotencyKey),
    tenantProposalIdx: index(
      "idx_commercial_proposal_events_tenant_proposal"
    ).on(table.tenantId, table.proposalId, table.createdAt),
  })
);

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
    estimatedContractValueCents: int("estimatedContractValueCents"),
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
    capacityReservedPoundsPerWeek: int("capacityReservedPoundsPerWeek")
      .notNull()
      .default(0),
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
    capacityReservedPoundsPerWeek: int("capacityReservedPoundsPerWeek")
      .notNull()
      .default(0),
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
    acquisitionAttributionId: varchar("acquisitionAttributionId", {
      length: 36,
    }),
    attributionType: mysqlEnum("attributionType", [
      "first_order",
      "recurring",
    ]).notNull(),
    status: mysqlEnum("status", ["active", "reversed", "financial_review"])
      .notNull()
      .default("active"),
    currency: varchar("currency", { length: 3 }),
    capturedCents: int("capturedCents"),
    refundedCents: int("refundedCents"),
    netPaidCents: int("netPaidCents"),
    invoicedCents: int("invoicedCents").notNull().default(0),
    paidCents: int("paidCents").notNull().default(0),
    realizedCents: int("realizedCents").notNull().default(0),
    paidAt: timestamp("paidAt"),
    requestId: varchar("requestId", { length: 36 }).notNull(),
    createdBy: varchar("createdBy", { length: 128 }).notNull(),
    financialReviewReason: varchar("financialReviewReason", { length: 191 }),
    lastReconciledAt: timestamp("lastReconciledAt"),
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

export const orderPaymentProjections = mysqlTable(
  "order_payment_projections",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    orderId: int("orderId").notNull(),
    provider: varchar("provider", { length: 64 }).notNull(),
    providerPaymentId: varchar("providerPaymentId", { length: 255 }),
    currency: varchar("currency", { length: 3 }).notNull(),
    state: mysqlEnum("state", [
      "unpaid",
      "paid",
      "partially_refunded",
      "refunded",
      "cancelled",
      "review_required",
    ]).notNull(),
    capturedCents: int("capturedCents"),
    refundedCents: int("refundedCents"),
    netPaidCents: int("netPaidCents"),
    paidAt: timestamp("paidAt"),
    providerUpdatedAt: timestamp("providerUpdatedAt"),
    lastReconciledAt: timestamp("lastReconciledAt").notNull(),
    version: int("version").notNull().default(1),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    tenantOrderUnique: uniqueIndex(
      "uq_order_payment_projections_tenant_order"
    ).on(table.tenantId, table.orderId),
    providerPaymentIdx: index(
      "idx_order_payment_projections_provider_payment"
    ).on(table.provider, table.providerPaymentId),
  })
);

export const orderPaymentEvents = mysqlTable(
  "order_payment_events",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    orderId: int("orderId").notNull(),
    provider: varchar("provider", { length: 64 }).notNull(),
    providerEventId: varchar("providerEventId", { length: 255 }),
    eventType: varchar("eventType", { length: 96 }).notNull(),
    currency: varchar("currency", { length: 3 }),
    capturedCents: int("capturedCents"),
    refundedCents: int("refundedCents"),
    netPaidCents: int("netPaidCents"),
    payloadDigest: varchar("payloadDigest", { length: 64 }),
    occurredAt: timestamp("occurredAt").notNull(),
    requestId: varchar("requestId", { length: 191 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    providerEventUnique: uniqueIndex(
      "uq_order_payment_events_provider_event"
    ).on(table.provider, table.providerEventId),
    tenantRequestUnique: uniqueIndex(
      "uq_order_payment_events_tenant_request"
    ).on(table.tenantId, table.requestId),
    tenantOrderIdx: index("idx_order_payment_events_tenant_order").on(
      table.tenantId,
      table.orderId,
      table.occurredAt
    ),
  })
);

export const commercialCampaignLinks = mysqlTable(
  "commercial_campaign_links",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    accountId: int("accountId").notNull(),
    missionId: int("missionId").notNull(),
    pipelineId: int("pipelineId"),
    campaignName: varchar("campaignName", { length: 191 }).notNull(),
    placement: varchar("placement", { length: 191 }).notNull(),
    collateralVersion: varchar("collateralVersion", { length: 96 }).notNull(),
    salespersonId: varchar("salespersonId", { length: 128 }).notNull(),
    referringContactId: int("referringContactId"),
    buildingSlug: varchar("buildingSlug", { length: 100 }),
    offerKey: varchar("offerKey", { length: 128 }),
    tokenHash: varchar("tokenHash", { length: 64 }).notNull(),
    status: mysqlEnum("status", ["active", "expired", "revoked"])
      .notNull()
      .default("active"),
    expiresAt: timestamp("expiresAt"),
    revokedAt: timestamp("revokedAt"),
    requestId: varchar("requestId", { length: 36 }).notNull(),
    createdBy: varchar("createdBy", { length: 128 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    tokenUnique: uniqueIndex("uq_commercial_campaign_links_token").on(
      table.tokenHash
    ),
    tenantRequestUnique: uniqueIndex(
      "uq_commercial_campaign_links_tenant_request"
    ).on(table.tenantId, table.requestId),
    tenantMissionIdx: index("idx_commercial_campaign_links_tenant_mission").on(
      table.tenantId,
      table.missionId,
      table.createdAt
    ),
  })
);

export const commercialCustomerAcquisitionSources = mysqlTable(
  "commercial_customer_acquisition_sources",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    customerIdentityKey: varchar("customerIdentityKey", {
      length: 64,
    }).notNull(),
    serviceLocationKey: varchar("serviceLocationKey", { length: 64 }).notNull(),
    campaignLinkId: varchar("campaignLinkId", { length: 36 }),
    accountId: int("accountId").notNull(),
    missionId: int("missionId").notNull(),
    pipelineId: int("pipelineId"),
    referringContactId: int("referringContactId"),
    sourceType: mysqlEnum("sourceType", [
      "explicit_campaign",
      "trusted_property",
      "manual",
    ]).notNull(),
    firstTouchAt: timestamp("firstTouchAt").notNull(),
    status: mysqlEnum("status", ["active", "review_required", "removed"])
      .notNull()
      .default("active"),
    requestId: varchar("requestId", { length: 36 }).notNull(),
    createdBy: varchar("createdBy", { length: 128 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    tenantIdentityLocationUnique: uniqueIndex(
      "uq_commercial_acquisition_source_identity_location"
    ).on(table.tenantId, table.customerIdentityKey, table.serviceLocationKey),
    tenantRequestUnique: uniqueIndex(
      "uq_commercial_acquisition_source_request"
    ).on(table.tenantId, table.requestId),
    tenantCampaignIdx: index("idx_commercial_acquisition_source_campaign").on(
      table.tenantId,
      table.campaignLinkId,
      table.firstTouchAt
    ),
  })
);

export const commercialOrderAcquisitionAttributions = mysqlTable(
  "commercial_order_acquisition_attributions",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    orderId: int("orderId").notNull(),
    firstTouchSourceId: varchar("firstTouchSourceId", { length: 36 }),
    orderCampaignLinkId: varchar("orderCampaignLinkId", { length: 36 }),
    accountId: int("accountId").notNull(),
    missionId: int("missionId").notNull(),
    pipelineId: int("pipelineId"),
    commercialCustomerId: int("commercialCustomerId"),
    referringContactId: int("referringContactId"),
    customerIdentityKey: varchar("customerIdentityKey", {
      length: 64,
    }).notNull(),
    serviceLocationKey: varchar("serviceLocationKey", { length: 64 }).notNull(),
    sourceType: mysqlEnum("sourceType", [
      "explicit_campaign",
      "inherited_first_touch",
      "trusted_property",
      "manual",
    ]).notNull(),
    confidence: mysqlEnum("confidence", ["high", "medium", "low"]).notNull(),
    attributionReason: text("attributionReason").notNull(),
    firstTouchAt: timestamp("firstTouchAt"),
    conversionAt: timestamp("conversionAt").notNull(),
    reviewState: mysqlEnum("reviewState", [
      "pending",
      "attributed",
      "review_required",
      "excluded",
      "reversed",
    ]).notNull(),
    reviewedBy: varchar("reviewedBy", { length: 128 }),
    reviewedAt: timestamp("reviewedAt"),
    reviewReason: text("reviewReason"),
    requestId: varchar("requestId", { length: 36 }).notNull(),
    createdBy: varchar("createdBy", { length: 128 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    tenantOrderUnique: uniqueIndex(
      "uq_commercial_order_acquisition_tenant_order"
    ).on(table.tenantId, table.orderId),
    tenantRequestUnique: uniqueIndex(
      "uq_commercial_order_acquisition_tenant_request"
    ).on(table.tenantId, table.requestId),
    tenantReviewIdx: index("idx_commercial_order_acquisition_tenant_review").on(
      table.tenantId,
      table.reviewState,
      table.createdAt
    ),
    tenantCampaignIdx: index(
      "idx_commercial_order_acquisition_tenant_campaign"
    ).on(table.tenantId, table.orderCampaignLinkId, table.conversionAt),
  })
);

export const commercialAttributionCorrections = mysqlTable(
  "commercial_attribution_corrections",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    acquisitionAttributionId: varchar("acquisitionAttributionId", {
      length: 36,
    }).notNull(),
    orderId: int("orderId").notNull(),
    previousStateJson: json("previousStateJson").notNull(),
    correctedStateJson: json("correctedStateJson").notNull(),
    reason: text("reason").notNull(),
    correctedBy: varchar("correctedBy", { length: 128 }).notNull(),
    requestId: varchar("requestId", { length: 36 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    tenantRequestUnique: uniqueIndex(
      "uq_commercial_attribution_corrections_request"
    ).on(table.tenantId, table.requestId),
    tenantAttributionIdx: index(
      "idx_commercial_attribution_corrections_attribution"
    ).on(table.tenantId, table.acquisitionAttributionId, table.createdAt),
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

export const dayforgeSaasTenants = mysqlTable(
  "dayforge_saas_tenants",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    slug: varchar("slug", { length: 64 }).notNull(),
    businessName: varchar("businessName", { length: 255 }).notNull(),
    brandName: varchar("brandName", { length: 255 }).notNull(),
    logoUrl: varchar("logoUrl", { length: 1024 }),
    primaryColor: varchar("primaryColor", { length: 16 }).notNull(),
    contactName: varchar("contactName", { length: 255 }).notNull(),
    contactEmail: varchar("contactEmail", { length: 320 }).notNull(),
    contactPhone: varchar("contactPhone", { length: 64 }),
    website: varchar("website", { length: 512 }),
    timeZone: varchar("timeZone", { length: 64 }).notNull(),
    proposalTemplateKey: varchar("proposalTemplateKey", { length: 128 }),
    status: mysqlEnum("status", [
      "provisioning",
      "configuring",
      "active",
      "delinquent",
      "suspended",
      "canceled",
    ])
      .notNull()
      .default("provisioning"),
    onboardingStep: varchar("onboardingStep", { length: 64 })
      .notNull()
      .default("business"),
    onboardingCompletedAt: timestamp("onboardingCompletedAt"),
    billingStateUpdatedAt: timestamp("billingStateUpdatedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    slugUnique: uniqueIndex("uq_dayforge_saas_tenants_slug").on(table.slug),
  })
);

export const dayforgeSaasTenantLocations = mysqlTable(
  "dayforge_saas_tenant_locations",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    locationKey: varchar("locationKey", { length: 64 }).notNull(),
    label: varchar("label", { length: 128 }).notNull(),
    address: varchar("address", { length: 512 }).notNull(),
    latitude: decimal("latitude", { precision: 10, scale: 7 }),
    longitude: decimal("longitude", { precision: 10, scale: 7 }),
    serviceRadiusMiles: decimal("serviceRadiusMiles", {
      precision: 6,
      scale: 2,
    }).notNull(),
    maxPoundsPerDay: int("maxPoundsPerDay").notNull(),
    maxPoundsByWeekdayJson: json("maxPoundsByWeekdayJson").notNull(),
    openCapacityPoundsPerWeek: int("openCapacityPoundsPerWeek").notNull(),
    pickupDaysJson: json("pickupDaysJson").notNull(),
    routeWindowsJson: json("routeWindowsJson").notNull(),
    turnaroundHours: int("turnaroundHours").notNull(),
    deliveryEnabled: boolean("deliveryEnabled").notNull().default(true),
    isPrimary: boolean("isPrimary").notNull().default(false),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    tenantLocationUnique: uniqueIndex("uq_dayforge_saas_locations_key").on(
      table.tenantId,
      table.locationKey
    ),
    tenantPrimaryIdx: index("idx_dayforge_saas_locations_tenant").on(
      table.tenantId,
      table.isPrimary
    ),
  })
);

export const dayforgeSaasTenantDomains = mysqlTable(
  "dayforge_saas_tenant_domains",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    hostname: varchar("hostname", { length: 255 }).notNull(),
    verifiedAt: timestamp("verifiedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    hostnameUnique: uniqueIndex("uq_dayforge_saas_tenant_domain").on(
      table.hostname
    ),
    tenantIdx: index("idx_dayforge_saas_tenant_domains_tenant").on(
      table.tenantId
    ),
  })
);

export const dayforgeSaasTenantServices = mysqlTable(
  "dayforge_saas_tenant_services",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    locationId: int("locationId").notNull().default(0),
    serviceKey: varchar("serviceKey", { length: 96 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    enabled: boolean("enabled").notNull().default(true),
    commercialEnabled: boolean("commercialEnabled").notNull().default(false),
    pricePerPoundCents: int("pricePerPoundCents"),
    minimumOrderCents: int("minimumOrderCents"),
    terms: text("terms"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    tenantServiceUnique: uniqueIndex("uq_dayforge_saas_services_key").on(
      table.tenantId,
      table.locationId,
      table.serviceKey
    ),
  })
);

export const dayforgeSaasTenantInvites = mysqlTable(
  "dayforge_saas_tenant_invites",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    emailNormalized: varchar("emailNormalized", { length: 320 }).notNull(),
    role: mysqlEnum("role", ["owner", "admin", "operator", "field"]).notNull(),
    tokenHash: varchar("tokenHash", { length: 64 }).notNull(),
    status: mysqlEnum("status", ["pending", "accepted", "revoked", "expired"])
      .notNull()
      .default("pending"),
    invitedByOpenId: varchar("invitedByOpenId", { length: 64 }),
    expiresAt: timestamp("expiresAt").notNull(),
    acceptedAt: timestamp("acceptedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    tokenUnique: uniqueIndex("uq_dayforge_saas_invite_token").on(
      table.tokenHash
    ),
    tenantEmailIdx: index("idx_dayforge_saas_invites_tenant_email").on(
      table.tenantId,
      table.emailNormalized,
      table.status
    ),
  })
);

export const dayforgeSaasMemberships = mysqlTable(
  "dayforge_saas_memberships",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    userOpenId: varchar("userOpenId", { length: 64 }).notNull(),
    role: mysqlEnum("role", ["owner", "admin", "operator", "field"]).notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    tenantUserUnique: uniqueIndex("uq_dayforge_saas_membership_user").on(
      table.tenantId,
      table.userOpenId
    ),
    tenantRoleIdx: index("idx_dayforge_saas_memberships_tenant_role").on(
      table.tenantId,
      table.role,
      table.active
    ),
  })
);

export const dayforgeSaasUserCredentials = mysqlTable(
  "dayforge_saas_user_credentials",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    userOpenId: varchar("userOpenId", { length: 64 }).notNull(),
    emailNormalized: varchar("emailNormalized", { length: 320 }).notNull(),
    passwordHash: varchar("passwordHash", { length: 255 }).notNull(),
    failedLoginCount: int("failedLoginCount").notNull().default(0),
    lockedUntil: timestamp("lockedUntil"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    tenantEmailUnique: uniqueIndex(
      "uq_dayforge_saas_credentials_tenant_email"
    ).on(table.tenantId, table.emailNormalized),
    openIdUnique: uniqueIndex("uq_dayforge_saas_credentials_open_id").on(
      table.userOpenId
    ),
  })
);

export const dayforgeSaasOnboardingSessions = mysqlTable(
  "dayforge_saas_onboarding_sessions",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    resumeTokenHash: varchar("resumeTokenHash", { length: 64 }).notNull(),
    businessName: varchar("businessName", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 64 }).notNull(),
    ownerEmail: varchar("ownerEmail", { length: 320 }).notNull(),
    currentStep: varchar("currentStep", { length: 64 })
      .notNull()
      .default("business"),
    version: int("version").notNull().default(1),
    configurationJson: json("configurationJson"),
    status: mysqlEnum("status", [
      "draft",
      "checkout_pending",
      "provisioned",
      "configuring",
      "complete",
      "expired",
    ])
      .notNull()
      .default("draft"),
    tenantId: varchar("tenantId", { length: 64 }),
    planKey: varchar("planKey", { length: 96 }),
    stripeCheckoutSessionId: varchar("stripeCheckoutSessionId", {
      length: 255,
    }),
    stripeCustomerId: varchar("stripeCustomerId", { length: 255 }),
    stripeSubscriptionId: varchar("stripeSubscriptionId", { length: 255 }),
    authContinuationId: varchar("authContinuationId", { length: 36 }),
    startRequestId: varchar("startRequestId", { length: 36 }).notNull(),
    checkoutRequestId: varchar("checkoutRequestId", { length: 36 }),
    expiresAt: timestamp("expiresAt").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    tokenUnique: uniqueIndex("uq_dayforge_saas_onboarding_token").on(
      table.resumeTokenHash
    ),
    startRequestUnique: uniqueIndex(
      "uq_dayforge_saas_onboarding_start_request"
    ).on(table.startRequestId),
    checkoutUnique: uniqueIndex("uq_dayforge_saas_onboarding_checkout").on(
      table.stripeCheckoutSessionId
    ),
    subscriptionUnique: uniqueIndex(
      "uq_dayforge_saas_onboarding_subscription"
    ).on(table.stripeSubscriptionId),
    emailIdx: index("idx_dayforge_saas_onboarding_email").on(
      table.ownerEmail,
      table.createdAt
    ),
    continuationIdx: index("idx_dayforge_saas_onboarding_continuation").on(
      table.authContinuationId
    ),
  })
);

export const dayforgeAuthContinuations = mysqlTable(
  "dayforge_auth_continuations",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tokenHash: varchar("tokenHash", { length: 64 }).notNull(),
    tenantId: varchar("tenantId", { length: 64 }),
    userOpenId: varchar("userOpenId", { length: 64 }),
    previewSessionId: varchar("previewSessionId", { length: 64 }),
    previewCandidateKey: varchar("previewCandidateKey", { length: 191 }),
    phoneHandoffId: varchar("phoneHandoffId", { length: 36 }),
    returnTo: varchar("returnTo", { length: 2048 }),
    onboardingSessionId: varchar("onboardingSessionId", { length: 36 }),
    status: mysqlEnum("status", ["active", "consumed", "expired", "revoked"])
      .notNull()
      .default("active"),
    expiresAt: timestamp("expiresAt").notNull(),
    consumedAt: timestamp("consumedAt"),
    consumedBy: varchar("consumedBy", { length: 128 }),
    requestId: varchar("requestId", { length: 36 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    tokenUnique: uniqueIndex("uq_dayforge_auth_continuations_token").on(
      table.tokenHash
    ),
    requestUnique: uniqueIndex("uq_dayforge_auth_continuations_request").on(
      table.requestId
    ),
    previewIdx: index("idx_dayforge_auth_continuations_preview").on(
      table.previewSessionId,
      table.status,
      table.expiresAt
    ),
    handoffIdx: index("idx_dayforge_auth_continuations_handoff").on(
      table.phoneHandoffId,
      table.status,
      table.expiresAt
    ),
  })
);

export const dayforgeSaasBillingPlans = mysqlTable(
  "dayforge_saas_billing_plans",
  {
    planKey: varchar("planKey", { length: 96 }).primaryKey(),
    displayName: varchar("displayName", { length: 255 }).notNull(),
    stripePriceId: varchar("stripePriceId", { length: 255 }).notNull(),
    stripeProductId: varchar("stripeProductId", { length: 255 }),
    trialDays: int("trialDays").notNull().default(0),
    foundingPlan: boolean("foundingPlan").notNull().default(false),
    availabilityStartsAt: timestamp("availabilityStartsAt"),
    availabilityEndsAt: timestamp("availabilityEndsAt"),
    maxSubscriptions: int("maxSubscriptions"),
    claimedSubscriptions: int("claimedSubscriptions").notNull().default(0),
    rulesJson: json("rulesJson").notNull(),
    entitlementsJson: json("entitlementsJson").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    stripePriceUnique: uniqueIndex("uq_dayforge_saas_billing_price").on(
      table.stripePriceId
    ),
  })
);

export const dayforgeSaasCheckoutSessions = mysqlTable(
  "dayforge_saas_checkout_sessions",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    onboardingSessionId: varchar("onboardingSessionId", {
      length: 36,
    }).notNull(),
    planKey: varchar("planKey", { length: 96 }).notNull(),
    requestId: varchar("requestId", { length: 36 }).notNull(),
    stripeCheckoutSessionId: varchar("stripeCheckoutSessionId", {
      length: 255,
    }),
    status: mysqlEnum("status", ["reserved", "open", "completed", "expired"])
      .notNull()
      .default("reserved"),
    claimedSlot: boolean("claimedSlot").notNull().default(true),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    onboardingUnique: uniqueIndex("uq_dayforge_checkout_onboarding").on(
      table.onboardingSessionId
    ),
    requestUnique: uniqueIndex("uq_dayforge_checkout_request").on(
      table.requestId
    ),
    stripeUnique: uniqueIndex("uq_dayforge_checkout_stripe").on(
      table.stripeCheckoutSessionId
    ),
  })
);

export const dayforgeSaasSubscriptions = mysqlTable(
  "dayforge_saas_subscriptions",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    planKey: varchar("planKey", { length: 96 }).notNull(),
    stripeCustomerId: varchar("stripeCustomerId", { length: 255 }).notNull(),
    stripeSubscriptionId: varchar("stripeSubscriptionId", {
      length: 255,
    }).notNull(),
    status: mysqlEnum("status", [
      "none",
      "trialing",
      "active",
      "past_due",
      "unpaid",
      "paused",
      "incomplete",
      "incomplete_expired",
      "canceled",
    ]).notNull(),
    cancelAtPeriodEnd: boolean("cancelAtPeriodEnd").notNull().default(false),
    currentPeriodEnd: timestamp("currentPeriodEnd"),
    trialEnd: timestamp("trialEnd"),
    graceEndsAt: timestamp("graceEndsAt"),
    accessEndsAt: timestamp("accessEndsAt"),
    delinquentAt: timestamp("delinquentAt"),
    lastInvoicePaidAt: timestamp("lastInvoicePaidAt"),
    latestInvoiceId: varchar("latestInvoiceId", { length: 255 }),
    lastStripeEventId: varchar("lastStripeEventId", { length: 255 }).notNull(),
    lastStripeEventCreatedAt: timestamp("lastStripeEventCreatedAt").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    tenantUnique: uniqueIndex("uq_dayforge_saas_subscriptions_tenant").on(
      table.tenantId
    ),
    stripeUnique: uniqueIndex("uq_dayforge_saas_subscriptions_stripe").on(
      table.stripeSubscriptionId
    ),
    customerIdx: index("idx_dayforge_saas_subscriptions_customer").on(
      table.stripeCustomerId
    ),
  })
);

export const dayforgeSaasEntitlements = mysqlTable(
  "dayforge_saas_entitlements",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    entitlementKey: varchar("entitlementKey", { length: 96 }).notNull(),
    source: mysqlEnum("source", ["plan", "manual"]).notNull().default("plan"),
    enabled: boolean("enabled").notNull().default(false),
    expiresAt: timestamp("expiresAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    tenantEntitlementUnique: uniqueIndex("uq_dayforge_saas_entitlement").on(
      table.tenantId,
      table.entitlementKey,
      table.source
    ),
  })
);

export const dayforgeSaasBillingEvents = mysqlTable(
  "dayforge_saas_billing_events",
  {
    id: int("id").autoincrement().primaryKey(),
    stripeEventId: varchar("stripeEventId", { length: 255 }).notNull(),
    eventType: varchar("eventType", { length: 128 }).notNull(),
    livemode: boolean("livemode").notNull().default(false),
    stripeCreatedAt: timestamp("stripeCreatedAt").notNull(),
    payloadHash: varchar("payloadHash", { length: 64 }).notNull(),
    tenantId: varchar("tenantId", { length: 64 }),
    objectId: varchar("objectId", { length: 255 }),
    status: mysqlEnum("status", [
      "processing",
      "processed",
      "ignored",
      "failed",
    ])
      .notNull()
      .default("processing"),
    errorCode: varchar("errorCode", { length: 128 }),
    metadataJson: json("metadataJson"),
    processingStartedAt: timestamp("processingStartedAt")
      .defaultNow()
      .notNull(),
    attemptCount: int("attemptCount").notNull().default(1),
    processedAt: timestamp("processedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    stripeEventUnique: uniqueIndex("uq_dayforge_saas_billing_event").on(
      table.stripeEventId
    ),
  })
);

export const dayforgeAuditEvents = mysqlTable(
  "dayforge_audit_events",
  {
    id: int("id").autoincrement().primaryKey(),
    scopeKey: varchar("scopeKey", { length: 191 }).notNull(),
    tenantId: varchar("tenantId", { length: 64 }),
    actorType: mysqlEnum("actorType", [
      "public",
      "owner",
      "admin",
      "operator",
      "field",
      "game",
      "stripe",
      "system",
    ]).notNull(),
    actorId: varchar("actorId", { length: 128 }),
    entityType: varchar("entityType", { length: 96 }).notNull(),
    entityId: varchar("entityId", { length: 128 }).notNull(),
    eventName: varchar("eventName", { length: 96 }).notNull(),
    beforeJson: json("beforeJson"),
    afterJson: json("afterJson"),
    source: varchar("source", { length: 96 }).notNull(),
    correlationId: varchar("correlationId", { length: 191 }).notNull(),
    idempotencyKey: varchar("idempotencyKey", { length: 191 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    idempotencyUnique: uniqueIndex("uq_dayforge_audit_idempotency").on(
      table.scopeKey,
      table.idempotencyKey
    ),
    tenantEntityIdx: index("idx_dayforge_audit_tenant_entity").on(
      table.tenantId,
      table.entityType,
      table.entityId,
      table.createdAt
    ),
  })
);

/**
 * Privacy-safe, append-only product funnel events. Business truth remains in
 * the domain tables and dayforge_audit_events; this table is an analytics
 * projection containing only allowlisted aggregate properties.
 */
export const dayforgeProductEvents = mysqlTable(
  "dayforge_product_events",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    scopeKey: varchar("scopeKey", { length: 191 }).notNull(),
    tenantId: varchar("tenantId", { length: 64 }),
    anonymousSessionId: varchar("anonymousSessionId", { length: 64 }),
    actorType: mysqlEnum("actorType", [
      "public",
      "owner",
      "admin",
      "operator",
      "field",
      "game",
      "stripe",
      "system",
    ]).notNull(),
    actorId: varchar("actorId", { length: 128 }),
    entityType: varchar("entityType", { length: 96 }),
    entityId: varchar("entityId", { length: 128 }),
    missionId: int("missionId"),
    accountId: int("accountId"),
    opportunityId: int("opportunityId"),
    customerId: int("customerId"),
    eventName: varchar("eventName", { length: 96 }).notNull(),
    eventVersion: int("eventVersion").notNull().default(1),
    propertiesJson: json("propertiesJson").notNull(),
    source: varchar("source", { length: 96 }).notNull(),
    correlationId: varchar("correlationId", { length: 191 }).notNull(),
    idempotencyKey: varchar("idempotencyKey", { length: 191 }).notNull(),
    occurredAt: timestamp("occurredAt").defaultNow().notNull(),
    purgeAfter: timestamp("purgeAfter"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    idempotencyUnique: uniqueIndex("uq_dayforge_product_event_idempotency").on(
      table.scopeKey,
      table.idempotencyKey
    ),
    tenantEventIdx: index("idx_dayforge_product_event_tenant_name").on(
      table.tenantId,
      table.eventName,
      table.occurredAt
    ),
    missionTimelineIdx: index("idx_dayforge_product_event_mission").on(
      table.tenantId,
      table.missionId,
      table.occurredAt
    ),
    accountTimelineIdx: index("idx_dayforge_product_event_account").on(
      table.tenantId,
      table.accountId,
      table.occurredAt
    ),
    anonymousTimelineIdx: index("idx_dayforge_product_event_anonymous").on(
      table.anonymousSessionId,
      table.occurredAt
    ),
    purgeIdx: index("idx_dayforge_product_event_purge").on(table.purgeAfter),
  })
);

/**
 * Anonymous public preview state. Only a token hash is stored; raw bearer
 * tokens and raw client IP addresses never enter the database.
 */
export const dayforgePublicPreviewSessions = mysqlTable(
  "dayforge_public_preview_sessions",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    tokenHash: varchar("tokenHash", { length: 64 }).notNull(),
    ipHash: varchar("ipHash", { length: 64 }).notNull(),
    status: mysqlEnum("status", [
      "running",
      "completed",
      "failed",
      "converting",
      "converted",
      "expired",
    ])
      .notNull()
      .default("running"),
    addressQuery: varchar("addressQuery", { length: 512 }).notNull(),
    attributionJson: json("attributionJson"),
    providerName: varchar("providerName", { length: 64 }),
    resultCount: int("resultCount").notNull().default(0),
    executionStartedAt: timestamp("executionStartedAt"),
    executionLeaseUntil: timestamp("executionLeaseUntil"),
    executionAttemptCount: int("executionAttemptCount").notNull().default(0),
    scanSessionId: varchar("scanSessionId", { length: 64 }),
    selectedCandidateKey: varchar("selectedCandidateKey", { length: 191 }),
    sampleMissionCreatedAt: timestamp("sampleMissionCreatedAt"),
    convertedTenantId: varchar("convertedTenantId", { length: 64 }),
    convertedMissionId: int("convertedMissionId"),
    expiresAt: timestamp("expiresAt").notNull(),
    purgeAfter: timestamp("purgeAfter").notNull(),
    failureCode: varchar("failureCode", { length: 96 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    tokenHashUnique: uniqueIndex("uq_dayforge_public_preview_token").on(
      table.tokenHash
    ),
    scanSessionUnique: uniqueIndex("uq_dayforge_public_preview_scan").on(
      table.scanSessionId
    ),
    statusExpiresIdx: index("idx_dayforge_public_preview_status_expires").on(
      table.status,
      table.expiresAt
    ),
    ipCreatedIdx: index("idx_dayforge_public_preview_ip_created").on(
      table.ipHash,
      table.createdAt
    ),
    purgeIdx: index("idx_dayforge_public_preview_purge").on(table.purgeAfter),
  })
);

/** Durable fixed-window rate counters keyed only by server-generated hashes. */
export const dayforgeRateLimitBuckets = mysqlTable(
  "dayforge_rate_limit_buckets",
  {
    id: int("id").autoincrement().primaryKey(),
    scopeKey: varchar("scopeKey", { length: 191 }).notNull(),
    bucketKey: varchar("bucketKey", { length: 191 }).notNull(),
    action: varchar("action", { length: 96 }).notNull(),
    windowStart: timestamp("windowStart").notNull(),
    windowSeconds: int("windowSeconds").notNull(),
    requestCount: int("requestCount").notNull().default(0),
    expiresAt: timestamp("expiresAt").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    windowUnique: uniqueIndex("uq_dayforge_rate_limit_window").on(
      table.scopeKey,
      table.bucketKey,
      table.action,
      table.windowStart
    ),
    expiryIdx: index("idx_dayforge_rate_limit_expiry").on(table.expiresAt),
    scopeActionIdx: index("idx_dayforge_rate_limit_scope_action").on(
      table.scopeKey,
      table.action,
      table.windowStart
    ),
  })
);

/** Provider-wide daily usage and circuit-breaker state. */
export const dayforgeProviderBudgets = mysqlTable(
  "dayforge_provider_budgets",
  {
    id: int("id").autoincrement().primaryKey(),
    providerName: varchar("providerName", { length: 64 }).notNull(),
    operation: varchar("operation", { length: 96 }).notNull(),
    budgetDate: varchar("budgetDate", { length: 10 }).notNull(),
    requestCount: int("requestCount").notNull().default(0),
    estimatedCostMicros: int("estimatedCostMicros").notNull().default(0),
    failureCount: int("failureCount").notNull().default(0),
    consecutiveFailureCount: int("consecutiveFailureCount")
      .notNull()
      .default(0),
    circuitState: mysqlEnum("circuitState", ["closed", "open", "half_open"])
      .notNull()
      .default("closed"),
    circuitOpenedAt: timestamp("circuitOpenedAt"),
    lastFailureAt: timestamp("lastFailureAt"),
    lastSuccessAt: timestamp("lastSuccessAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    providerOperationDayUnique: uniqueIndex(
      "uq_dayforge_provider_budget_day"
    ).on(table.providerName, table.operation, table.budgetDate),
    circuitIdx: index("idx_dayforge_provider_budget_circuit").on(
      table.circuitState,
      table.updatedAt
    ),
  })
);

export const dayforgeSaasImportConnections = mysqlTable(
  "dayforge_saas_import_connections",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    providerKey: varchar("providerKey", { length: 96 }).notNull(),
    status: mysqlEnum("status", [
      "configured",
      "connected",
      "error",
      "disabled",
    ])
      .notNull()
      .default("configured"),
    credentialReference: varchar("credentialReference", { length: 255 }),
    configurationJson: json("configurationJson").notNull(),
    lastImportedAt: timestamp("lastImportedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    tenantProviderUnique: uniqueIndex("uq_dayforge_saas_import_connection").on(
      table.tenantId,
      table.providerKey
    ),
  })
);

export const dayforgeSaasImportRuns = mysqlTable(
  "dayforge_saas_import_runs",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    connectionId: int("connectionId").notNull(),
    status: mysqlEnum("status", [
      "started",
      "completed",
      "completed_with_errors",
      "failed",
    ]).notNull(),
    sourceCursor: varchar("sourceCursor", { length: 512 }),
    importedCustomers: int("importedCustomers").notNull().default(0),
    importedOrders: int("importedOrders").notNull().default(0),
    skippedRecords: int("skippedRecords").notNull().default(0),
    errorJson: json("errorJson"),
    startedAt: timestamp("startedAt").defaultNow().notNull(),
    completedAt: timestamp("completedAt"),
  },
  table => ({
    tenantStartedIdx: index("idx_dayforge_saas_import_runs_tenant").on(
      table.tenantId,
      table.startedAt
    ),
  })
);

export const dayforgeSaasExternalCustomers = mysqlTable(
  "dayforge_saas_external_customers",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    connectionId: int("connectionId").notNull(),
    providerKey: varchar("providerKey", { length: 96 }).notNull(),
    externalId: varchar("externalId", { length: 191 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    email: varchar("email", { length: 320 }),
    phone: varchar("phone", { length: 64 }),
    factsJson: json("factsJson").notNull(),
    sourceCapturedAt: timestamp("sourceCapturedAt").notNull(),
    importRunId: varchar("importRunId", { length: 36 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    externalUnique: uniqueIndex("uq_dayforge_external_customer").on(
      table.tenantId,
      table.connectionId,
      table.externalId
    ),
  })
);

export const dayforgeSaasExternalOrders = mysqlTable(
  "dayforge_saas_external_orders",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    connectionId: int("connectionId").notNull(),
    providerKey: varchar("providerKey", { length: 96 }).notNull(),
    externalId: varchar("externalId", { length: 191 }).notNull(),
    externalCustomerId: varchar("externalCustomerId", { length: 191 }),
    totalCents: int("totalCents").notNull(),
    paid: boolean("paid").notNull().default(false),
    occurredAt: timestamp("occurredAt"),
    factsJson: json("factsJson").notNull(),
    sourceCapturedAt: timestamp("sourceCapturedAt").notNull(),
    importRunId: varchar("importRunId", { length: 36 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    externalUnique: uniqueIndex("uq_dayforge_external_order").on(
      table.tenantId,
      table.connectionId,
      table.externalId
    ),
    tenantOccurredIdx: index("idx_dayforge_external_orders_tenant_occurred").on(
      table.tenantId,
      table.occurredAt
    ),
  })
);

export type CommercialAccount = typeof commercialAccounts.$inferSelect;
export type CommercialOpportunityRow =
  typeof commercialOpportunities.$inferSelect;
export type CommercialMissionRow = typeof commercialMissions.$inferSelect;
export type CommercialMissionEventRow =
  typeof commercialMissionEvents.$inferSelect;
export type CommercialMissionGameAttemptRow =
  typeof commercialMissionGameAttempts.$inferSelect;
export type CommercialMissionGameResultRow =
  typeof commercialMissionGameResults.$inferSelect;
export type CommercialMissionGameRewardRow =
  typeof commercialMissionGameRewards.$inferSelect;
export type CommercialMissionIrlStepDetailRow =
  typeof commercialMissionIrlStepDetails.$inferSelect;
export type CommercialMissionDispatchRow =
  typeof commercialMissionDispatches.$inferSelect;
export type DayforgeEvidenceUploadRow =
  typeof dayforgeEvidenceUploads.$inferSelect;
export type DayforgeEvidenceObjectDeletionRow =
  typeof dayforgeEvidenceObjectDeletions.$inferSelect;
export type CommercialMissionCoachingArtifactRow =
  typeof commercialMissionCoachingArtifacts.$inferSelect;
export type CommercialCampaignLinkRow =
  typeof commercialCampaignLinks.$inferSelect;
export type CommercialCustomerAcquisitionSourceRow =
  typeof commercialCustomerAcquisitionSources.$inferSelect;
export type CommercialOrderAcquisitionAttributionRow =
  typeof commercialOrderAcquisitionAttributions.$inferSelect;
export type CommercialAttributionCorrectionRow =
  typeof commercialAttributionCorrections.$inferSelect;
export type DayforgeAuthContinuationRow =
  typeof dayforgeAuthContinuations.$inferSelect;
export type OrderPaymentProjectionRow =
  typeof orderPaymentProjections.$inferSelect;
export type OrderPaymentEventRow = typeof orderPaymentEvents.$inferSelect;

export const territoryOperatorProfiles = mysqlTable(
  "territory_operator_profiles",
  {
    tenantId: varchar("tenantId", { length: 64 }).primaryKey(),
    storeName: varchar("storeName", { length: 255 }).notNull(),
    storeAddress: varchar("storeAddress", { length: 512 }).notNull(),
    latitude: decimal("latitude", { precision: 10, scale: 7 }),
    longitude: decimal("longitude", { precision: 10, scale: 7 }),
    serviceRadiusMiles: decimal("serviceRadiusMiles", {
      precision: 6,
      scale: 2,
    })
      .notNull()
      .default("3.00"),
    commercialWashFoldEnabled: boolean("commercialWashFoldEnabled")
      .notNull()
      .default(true),
    averagePricePerPoundCents: int("averagePricePerPoundCents").notNull(),
    availableWeeklyCapacityPounds: int(
      "availableWeeklyCapacityPounds"
    ).notNull(),
    routePointsJson: json("routePointsJson").notNull(),
    turnaroundCompatibleByDefault: boolean("turnaroundCompatibleByDefault")
      .notNull()
      .default(true),
    pickupDaysCompatibleByDefault: boolean("pickupDaysCompatibleByDefault")
      .notNull()
      .default(true),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  }
);

export const territoryScanSessions = mysqlTable(
  "territory_scan_sessions",
  {
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
  },
  table => ({
    tenantCreatedIdx: index("idx_territory_scan_sessions_tenant_created").on(
      table.tenantId,
      table.createdAt
    ),
    expiresIdx: index("idx_territory_scan_sessions_expires").on(
      table.expiresAt
    ),
  })
);

export const territoryScanResults = mysqlTable(
  "territory_scan_results",
  {
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
  },
  table => ({
    sessionCandidateUnique: uniqueIndex(
      "uq_territory_scan_results_session_candidate"
    ).on(table.scanSessionId, table.candidateKey),
    tenantSessionIdx: index("idx_territory_scan_results_tenant_session").on(
      table.tenantId,
      table.scanSessionId
    ),
  })
);

export const level4Missions = mysqlTable(
  "level4_missions",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull().default("default"),
    operatorId: varchar("operatorId", { length: 128 })
      .notNull()
      .default("tenant_proxy"),
    taskId: int("taskId").notNull(),
    status: mysqlEnum("status", ["locked", "unlocked", "completed", "expired"])
      .notNull()
      .default("locked"),
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
  },
  table => ({
    tenantOperatorStatusIdx: index(
      "idx_level4_missions_tenant_operator_status"
    ).on(table.tenantId, table.operatorId, table.status),
    tenantOperatorDateIdx: index("idx_level4_missions_tenant_operator_date").on(
      table.tenantId,
      table.operatorId,
      table.missionDate
    ),
    taskIdx: index("idx_level4_missions_task").on(table.taskId),
  })
);

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
  actorType: mysqlEnum("actorType", [
    "human",
    "voice",
    "resident_chat",
    "driver",
    "vendor",
    "ai_agent",
    "system",
  ]).notNull(),
  actorId: varchar("actorId", { length: 128 }),
  toolName: varchar("toolName", { length: 128 }).notNull(),
  entityType: varchar("entityType", { length: 64 }),
  entityId: varchar("entityId", { length: 128 }),
  inputJson: json("inputJson"),
  outputJson: json("outputJson"),
  status: mysqlEnum("status", [
    "success",
    "failed",
    "approval_required",
    "blocked",
  ]).notNull(),
  errorMessage: text("errorMessage"),
  latencyMs: int("latencyMs"),
  modelUsed: varchar("modelUsed", { length: 128 }),
  inputTokens: int("inputTokens").default(0).notNull(),
  outputTokens: int("outputTokens").default(0).notNull(),
  estimatedCostCents: int("estimatedCostCents").default(0).notNull(),
  requiresHumanApproval: boolean("requiresHumanApproval")
    .default(false)
    .notNull(),
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
    ])
      .notNull()
      .default("pending_confirmation"),
    planJson: json("planJson"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    tenantStatusIdx: index("idx_resident_agent_plans_tenant_status").on(
      table.tenantId,
      table.planStatus
    ),
    tenantUserIdx: index("idx_resident_agent_plans_tenant_user").on(
      table.tenantId,
      table.bldgUserId
    ),
    conversationIdx: index("idx_resident_agent_plans_conversation").on(
      table.conversationId
    ),
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
    ])
      .notNull()
      .default("pending_operator_review"),
    statusReason: text("statusReason"),
    residentVisibleStatus: mysqlEnum("residentVisibleStatus", [
      "confirmed",
      "pending_provider_confirmation",
      "pending_operator_review",
      "failed",
      "cancelled",
      "completed",
    ])
      .notNull()
      .default("pending_operator_review"),
    nextAction: text("nextAction"),
    requiresHumanApproval: boolean("requiresHumanApproval")
      .notNull()
      .default(true),
    customerCharged: boolean("customerCharged").notNull().default(false),
    providerVendorId: int("providerVendorId"),
    providerConfirmationStatus: varchar("providerConfirmationStatus", {
      length: 100,
    }),
    sourceConversationId: varchar("sourceConversationId", { length: 128 }),
    sourceSessionId: varchar("sourceSessionId", { length: 128 }),
    parentPlanId: int("parentPlanId"),
    rawJson: json("rawJson"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    tenantStatusIdx: index("idx_resident_coord_requests_tenant_status").on(
      table.tenantId,
      table.status
    ),
    tenantPlanIdx: index("idx_resident_coord_requests_tenant_plan").on(
      table.tenantId,
      table.parentPlanId
    ),
    tenantUserIdx: index("idx_resident_coord_requests_tenant_user").on(
      table.tenantId,
      table.bldgUserId
    ),
    categoryIdx: index("idx_resident_coord_requests_category").on(
      table.serviceCategory
    ),
  })
);

export type ResidentCoordinatedRequest =
  typeof residentCoordinatedRequests.$inferSelect;
export type InsertResidentCoordinatedRequest =
  typeof residentCoordinatedRequests.$inferInsert;

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
  table => ({
    uqTenantMonth: uniqueIndex("uq_tenant_ai_usage_tenant_month").on(
      table.tenantId,
      table.month
    ),
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
  serviceModel: mysqlEnum("serviceModel", ["mobile", "fixed_location", "both"])
    .notNull()
    .default("mobile"),
  buildingNativeServiceAvailable: boolean("buildingNativeServiceAvailable")
    .notNull()
    .default(true),
  serviceAreaJson: json("serviceAreaJson"),
  buildingsJson: json("buildingsJson"),
  trafficProtectionMode: mysqlEnum("trafficProtectionMode", [
    "back_to_back",
    "breathing_room",
    "geo_clustered",
  ])
    .notNull()
    .default("geo_clustered"),
  resetTimeMinutes: int("resetTimeMinutes").notNull().default(15),
  geoClusteringEnabled: boolean("geoClusteringEnabled").notNull().default(true),
  bookingLeadTimeHours: int("bookingLeadTimeHours").notNull().default(24),
  providerResponseTimeoutMinutes: int("providerResponseTimeoutMinutes")
    .notNull()
    .default(120),
  calendarConnectionStatus: varchar("calendarConnectionStatus", { length: 64 })
    .notNull()
    .default("not_connected"),
  payoutSetupStatus: varchar("payoutSetupStatus", { length: 64 })
    .notNull()
    .default("not_started"),
  onboardingStatus: mysqlEnum("onboardingStatus", [
    "started",
    "collecting_details",
    "pricing_setup",
    "availability_setup",
    "payment_setup",
    "admin_configured",
    "completed",
    "abandoned",
  ])
    .notNull()
    .default("started"),
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

export const vendorAvailabilityWindows = mysqlTable(
  "vendor_availability_windows",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull().default("default"),
    vendorId: int("vendorId").notNull(),
    dayOfWeek: int("dayOfWeek").notNull(),
    startTime: varchar("startTime", { length: 10 }).notNull(),
    endTime: varchar("endTime", { length: 10 }).notNull(),
    timezone: varchar("timezone", { length: 64 })
      .notNull()
      .default("America/Los_Angeles"),
    buildingScopeJson: json("buildingScopeJson"),
    neighborhoodScopeJson: json("neighborhoodScopeJson"),
    isActive: boolean("isActive").notNull().default(true),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  }
);

export type VendorAvailabilityWindow =
  typeof vendorAvailabilityWindows.$inferSelect;
export type InsertVendorAvailabilityWindow =
  typeof vendorAvailabilityWindows.$inferInsert;

export const vendorAdminConfigs = mysqlTable("vendor_admin_configs", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 64 }).notNull().default("default"),
  vendorId: int("vendorId").notNull(),
  categoryPresetKey: varchar("categoryPresetKey", { length: 100 }).notNull(),
  themeKey: mysqlEnum("themeKey", [
    "clinical_minimalist",
    "pixel_operations",
    "standard",
  ])
    .notNull()
    .default("standard"),
  enabledSurfacesJson: json("enabledSurfacesJson"),
  navConfigJson: json("navConfigJson"),
  brandConfigJson: json("brandConfigJson"),
  externalBookingBrandMode: varchar("externalBookingBrandMode", { length: 64 })
    .notNull()
    .default("vendor_primary"),
  publicBookingSlug: varchar("publicBookingSlug", { length: 128 }).notNull(),
  templateKey: varchar("templateKey", { length: 128 })
    .notNull()
    .default("vendor_booking_template_01"),
  publicBookingStatus: mysqlEnum("publicBookingStatus", [
    "draft",
    "published",
    "unpublished",
  ])
    .notNull()
    .default("draft"),
  templateContentJson: json("templateContentJson"),
  publishedAt: timestamp("publishedAt"),
  approvedByUserId: varchar("approvedByUserId", { length: 128 }),
  customDomain: varchar("customDomain", { length: 255 }),
  customDomainStatus: varchar("customDomainStatus", { length: 64 })
    .notNull()
    .default("not_configured"),
  brandName: varchar("brandName", { length: 255 }),
  brandLogoUrl: varchar("brandLogoUrl", { length: 512 }),
  brandAccentColor: varchar("brandAccentColor", { length: 32 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type VendorAdminConfig = typeof vendorAdminConfigs.$inferSelect;
export type InsertVendorAdminConfig = typeof vendorAdminConfigs.$inferInsert;

export const vendorPeerServiceRequests = mysqlTable(
  "vendor_peer_service_requests",
  {
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
    ])
      .notNull()
      .default("request_pending_provider_confirmation"),
    responseTimeoutMinutes: int("responseTimeoutMinutes")
      .notNull()
      .default(120),
    expiresAt: timestamp("expiresAt"),
    expiredAt: timestamp("expiredAt"),
    timeoutReason: varchar("timeoutReason", { length: 255 }),
    replacementOptionsJson: json("replacementOptionsJson"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  }
);

export type VendorPeerServiceRequest =
  typeof vendorPeerServiceRequests.$inferSelect;
export type InsertVendorPeerServiceRequest =
  typeof vendorPeerServiceRequests.$inferInsert;

export const vendorPricingRecommendations = mysqlTable(
  "vendor_pricing_recommendations",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull().default("default"),
    vendorId: int("vendorId").notNull(),
    serviceId: int("serviceId"),
    basePriceCents: int("basePriceCents").notNull(),
    recommendedPriceCents: int("recommendedPriceCents").notNull(),
    conveniencePremiumPercent: int("conveniencePremiumPercent")
      .notNull()
      .default(10),
    travelTimeMinutesAssumed: int("travelTimeMinutesAssumed")
      .notNull()
      .default(20),
    estimatedBookingsPerDay: int("estimatedBookingsPerDay")
      .notNull()
      .default(4),
    comparablePricingJson: json("comparablePricingJson"),
    reasoning: text("reasoning").notNull(),
    status: mysqlEnum("status", ["draft", "accepted", "rejected"])
      .notNull()
      .default("draft"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    acceptedAt: timestamp("acceptedAt"),
    rejectedAt: timestamp("rejectedAt"),
  }
);

export type VendorPricingRecommendation =
  typeof vendorPricingRecommendations.$inferSelect;
export type InsertVendorPricingRecommendation =
  typeof vendorPricingRecommendations.$inferInsert;

export const vendorDataExports = mysqlTable("vendor_data_exports", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 64 }).notNull().default("default"),
  vendorId: int("vendorId").notNull(),
  exportType: mysqlEnum("exportType", [
    "clients",
    "bookings",
    "services",
  ]).notNull(),
  exportUrl: text("exportUrl").notNull(),
  requestedByUserId: varchar("requestedByUserId", { length: 128 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type VendorDataExport = typeof vendorDataExports.$inferSelect;
export type InsertVendorDataExport = typeof vendorDataExports.$inferInsert;

export const vendorGuestBookingSessions = mysqlTable(
  "vendor_guest_booking_sessions",
  {
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
  }
);

export type VendorGuestBookingSession =
  typeof vendorGuestBookingSessions.$inferSelect;
export type InsertVendorGuestBookingSession =
  typeof vendorGuestBookingSessions.$inferInsert;

export const vendorOnboardingSessions = mysqlTable(
  "vendor_onboarding_sessions",
  {
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
    ])
      .notNull()
      .default("started"),
    lastCompletedStep: varchar("lastCompletedStep", { length: 128 }),
    missingFieldsJson: json("missingFieldsJson"),
    abandoned2hLoggedAt: timestamp("abandoned2hLoggedAt"),
    abandoned24hLoggedAt: timestamp("abandoned24hLoggedAt"),
    abandoned7dLoggedAt: timestamp("abandoned7dLoggedAt"),
    abandonedAt: timestamp("abandonedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    sessionTokenIdx: index("idx_vendor_onboarding_sessions_tenant_session").on(
      table.tenantId,
      table.sessionId
    ),
  })
);

export type VendorOnboardingSession =
  typeof vendorOnboardingSessions.$inferSelect;
export type InsertVendorOnboardingSession =
  typeof vendorOnboardingSessions.$inferInsert;

export const vendorOnboardingMessages = mysqlTable(
  "vendor_onboarding_messages",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull().default("default"),
    sessionId: int("sessionId").notNull(),
    conversationId: varchar("conversationId", { length: 128 }),
    role: mysqlEnum("role", ["vendor", "agent", "system"]).notNull(),
    content: text("content").notNull(),
    metadataJson: json("metadataJson"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    sessionIdx: index("idx_vendor_onboarding_messages_tenant_session").on(
      table.tenantId,
      table.sessionId
    ),
  })
);

export type VendorOnboardingMessage =
  typeof vendorOnboardingMessages.$inferSelect;
export type InsertVendorOnboardingMessage =
  typeof vendorOnboardingMessages.$inferInsert;

/**
 * Level 4 — War for the Bridge. Append-only action events; all daily war
 * state (front line, combo, reckoning) derives from a fold over these.
 * dedupeKey makes every recording idempotent (replays cannot double-shove).
 */
export const level4WarEvents = mysqlTable(
  "level4_war_events",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull().default("default"),
    kind: varchar("kind", { length: 48 }).notNull(),
    dedupeKey: varchar("dedupeKey", { length: 191 }).notNull(),
    pushHundredths: int("pushHundredths").notNull().default(0),
    metadata: json("metadata"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    tenantDedupeIdx: uniqueIndex("uq_level4_war_events_tenant_dedupe").on(
      table.tenantId,
      table.dedupeKey
    ),
    tenantCreatedIdx: index("idx_level4_war_events_tenant_created").on(
      table.tenantId,
      table.createdAt
    ),
  })
);

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
  campaignLabel: varchar("campaignLabel", { length: 120 })
    .notNull()
    .default("50 new customers"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type CommandSkySettingsRow = typeof commandSkySettings.$inferSelect;

/** Sky Covenant win events — verbal commitments and first orders (hope). */
export const commandSkyWins = mysqlTable(
  "command_sky_wins",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull().default("default"),
    kind: varchar("kind", { length: 32 }).notNull(),
    label: varchar("label", { length: 191 }).notNull(),
    dedupeKey: varchar("dedupeKey", { length: 191 }).notNull(),
    hopeExpiresAt: timestamp("hopeExpiresAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    tenantDedupeIdx: uniqueIndex("uq_command_sky_wins_tenant_dedupe").on(
      table.tenantId,
      table.dedupeKey
    ),
    tenantCreatedIdx: index("idx_command_sky_wins_tenant_created").on(
      table.tenantId,
      table.createdAt
    ),
  })
);

export type CommandSkyWin = typeof commandSkyWins.$inferSelect;

/** Cross-domain GROW decisions. Source entities remain authoritative. */
export const businessGameMoveDecisions = mysqlTable(
  "business_game_move_decisions",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    moveId: varchar("moveId", { length: 191 }).notNull(),
    sourceType: varchar("sourceType", { length: 64 }).notNull(),
    sourceId: varchar("sourceId", { length: 191 }).notNull(),
    decision: mysqlEnum("decision", [
      "accepted",
      "dismissed",
      "completed",
    ]).notNull(),
    actorId: varchar("actorId", { length: 128 }).notNull(),
    requestId: varchar("requestId", { length: 36 }).notNull(),
    metadataJson: json("metadataJson"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    tenantRequestUnique: uniqueIndex(
      "uq_business_move_decisions_tenant_request"
    ).on(table.tenantId, table.requestId),
    tenantMoveIdx: index("idx_business_move_decisions_tenant_move").on(
      table.tenantId,
      table.moveId,
      table.createdAt
    ),
  })
);

/**
 * Compact durable visual projection for the playable driver world. Business
 * tables remain authoritative for mission status, money, and follow-up dates.
 */
export const driverGameWorldNodes = mysqlTable(
  "driver_game_world_nodes",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    actorId: varchar("actorId", { length: 128 }).notNull(),
    missionId: int("missionId").notNull(),
    entityType: varchar("entityType", { length: 64 })
      .notNull()
      .default("commercial_mission"),
    entityId: varchar("entityId", { length: 191 }).notNull(),
    locationId: int("locationId"),
    visualState: mysqlEnum("visualState", [
      "available",
      "approaching",
      "active",
      "captured",
      "contested",
      "recovery_available",
      "recovery_active",
      "watching",
      "closed",
    ]).notNull(),
    worldAnchor: varchar("worldAnchor", { length: 64 })
      .notNull()
      .default("fortress_gate"),
    unlockedPath: varchar("unlockedPath", { length: 64 }),
    discoveryState: mysqlEnum("discoveryState", [
      "hidden",
      "discovered",
      "engaged",
    ])
      .notNull()
      .default("discovered"),
    lastResolvedAt: timestamp("lastResolvedAt"),
    metadataJson: json("metadataJson"),
    version: int("version").notNull().default(1),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    tenantActorMissionUnique: uniqueIndex(
      "uq_driver_game_world_actor_mission"
    ).on(table.tenantId, table.actorId, table.missionId),
    tenantActorStateIdx: index("idx_driver_game_world_tenant_actor_state").on(
      table.tenantId,
      table.actorId,
      table.visualState,
      table.updatedAt
    ),
  })
);

export const driverColdCallBatches = mysqlTable(
  "driver_cold_call_batches",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    actorId: varchar("actorId", { length: 128 }).notNull(),
    status: mysqlEnum("status", ["active", "completed"])
      .notNull()
      .default("active"),
    combo: int("combo").notNull().default(0),
    completedCount: int("completedCount").notNull().default(0),
    totalTargets: int("totalTargets").notNull(),
    requestId: varchar("requestId", { length: 36 }).notNull(),
    sourceReferencesJson: json("sourceReferencesJson").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    requestUnique: uniqueIndex("uq_driver_cold_call_batch_request").on(
      table.tenantId,
      table.actorId,
      table.requestId
    ),
    activeIdx: index("idx_driver_cold_call_batch_active").on(
      table.tenantId,
      table.actorId,
      table.status,
      table.updatedAt
    ),
  })
);

export const driverColdCallTargets = mysqlTable(
  "driver_cold_call_targets",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    batchId: varchar("batchId", { length: 36 }).notNull(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    actorId: varchar("actorId", { length: 128 }).notNull(),
    missionId: int("missionId").notNull(),
    accountId: int("accountId").notNull(),
    position: int("position").notNull(),
    status: mysqlEnum("status", ["pending", "selected", "live", "completed"])
      .notNull()
      .default("pending"),
    sourceReference: varchar("sourceReference", { length: 512 }).notNull(),
    callAttemptEventId: int("callAttemptEventId"),
    outcome: varchar("outcome", { length: 64 }),
    completedAt: timestamp("completedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    missionUnique: uniqueIndex("uq_driver_cold_call_batch_mission").on(
      table.batchId,
      table.missionId
    ),
    progressIdx: index("idx_driver_cold_call_target_progress").on(
      table.tenantId,
      table.actorId,
      table.batchId,
      table.status,
      table.position
    ),
  })
);

export const driverCapabilityUnlocks = mysqlTable(
  "driver_capability_unlocks",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    scopeId: varchar("scopeId", { length: 128 })
      .notNull()
      .default("tenant_business"),
    capabilityId: varchar("capabilityId", { length: 96 }).notNull(),
    unlockedByActorId: varchar("unlockedByActorId", { length: 128 }).notNull(),
    unlockedAt: timestamp("unlockedAt").defaultNow().notNull(),
    sourceReferencesJson: json("sourceReferencesJson").notNull(),
    evidenceSummaryJson: json("evidenceSummaryJson").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    scopeUnique: uniqueIndex("uq_driver_capability_scope").on(
      table.tenantId,
      table.scopeId,
      table.capabilityId
    ),
  })
);

export const driverScoutReports = mysqlTable(
  "driver_scout_reports",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    actorId: varchar("actorId", { length: 128 }).notNull(),
    requestId: varchar("requestId", { length: 36 }).notNull(),
    capabilityUnlockId: varchar("capabilityUnlockId", { length: 36 }).notNull(),
    sourceScanId: varchar("sourceScanId", { length: 64 }),
    criteriaJson: json("criteriaJson").notNull(),
    sourceReferencesJson: json("sourceReferencesJson").notNull(),
    discoveryCount: int("discoveryCount").notNull().default(0),
    generatedAt: timestamp("generatedAt").defaultNow().notNull(),
  },
  table => ({
    requestUnique: uniqueIndex("uq_driver_scout_report_request").on(
      table.tenantId,
      table.actorId,
      table.requestId
    ),
    actorIdx: index("idx_driver_scout_reports_actor").on(
      table.tenantId,
      table.actorId,
      table.generatedAt
    ),
  })
);

export const driverScoutDiscoveries = mysqlTable(
  "driver_scout_discoveries",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    reportId: varchar("reportId", { length: 36 }).notNull(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    actorId: varchar("actorId", { length: 128 }).notNull(),
    candidateKey: varchar("candidateKey", { length: 191 }).notNull(),
    providerName: varchar("providerName", { length: 64 }).notNull(),
    providerAccountId: varchar("providerAccountId", { length: 191 }).notNull(),
    sourceReference: varchar("sourceReference", { length: 512 }).notNull(),
    missionId: int("missionId").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    candidateUnique: uniqueIndex("uq_driver_scout_candidate").on(
      table.tenantId,
      table.candidateKey
    ),
    missionUnique: uniqueIndex("uq_driver_scout_mission").on(
      table.tenantId,
      table.missionId
    ),
    reportIdx: index("idx_driver_scout_report_discovery").on(
      table.reportId,
      table.createdAt
    ),
  })
);

/** Immutable, idempotent daily resolution snapshots. */
export const businessDayResolutions = mysqlTable(
  "business_day_resolutions",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    businessDate: varchar("businessDate", { length: 10 }).notNull(),
    actorId: varchar("actorId", { length: 128 }).notNull(),
    requestId: varchar("requestId", { length: 36 }).notNull(),
    sourceThrough: timestamp("sourceThrough").notNull(),
    contentHash: varchar("contentHash", { length: 64 }).notNull(),
    resolutionJson: json("resolutionJson").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    tenantDateActorUnique: uniqueIndex(
      "uq_business_day_resolutions_tenant_date_actor"
    ).on(table.tenantId, table.businessDate, table.actorId),
    tenantRequestUnique: uniqueIndex(
      "uq_business_day_resolutions_tenant_request"
    ).on(table.tenantId, table.requestId),
  })
);

/** Optional operating detail attached to a real active tenant membership. */
export const employeeOperatingProfiles = mysqlTable(
  "employee_operating_profiles",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    userOpenId: varchar("userOpenId", { length: 64 }).notNull(),
    displayName: varchar("displayName", { length: 255 }).notNull(),
    employmentStatus: mysqlEnum("employmentStatus", [
      "active",
      "leave",
      "ended",
    ])
      .notNull()
      .default("active"),
    skillsJson: json("skillsJson").notNull(),
    weeklyCapacityUnits: int("weeklyCapacityUnits"),
    createdBy: varchar("createdBy", { length: 128 }).notNull(),
    updatedBy: varchar("updatedBy", { length: 128 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    tenantUserUnique: uniqueIndex(
      "uq_employee_operating_profiles_tenant_user"
    ).on(table.tenantId, table.userOpenId),
    tenantStatusIdx: index("idx_employee_operating_profiles_tenant_status").on(
      table.tenantId,
      table.employmentStatus
    ),
  })
);

export const employeeOperatingProfileEvents = mysqlTable(
  "employee_operating_profile_events",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    profileId: varchar("profileId", { length: 36 }).notNull(),
    eventType: varchar("eventType", { length: 64 }).notNull(),
    actorId: varchar("actorId", { length: 128 }).notNull(),
    requestId: varchar("requestId", { length: 36 }).notNull(),
    metadataJson: json("metadataJson"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    tenantRequestUnique: uniqueIndex(
      "uq_employee_profile_events_tenant_request"
    ).on(table.tenantId, table.requestId),
    tenantProfileIdx: index("idx_employee_profile_events_tenant_profile").on(
      table.tenantId,
      table.profileId,
      table.createdAt
    ),
  })
);

/** Voice-first gap missions created from the Goldline Open Channel briefing. */
export const openChannelMissions = mysqlTable(
  "open_channel_missions",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    driverId: varchar("driverId", { length: 128 }).notNull(),
    businessDate: varchar("businessDate", { length: 10 }).notNull(),
    status: mysqlEnum("status", ["draft", "active", "completed", "cancelled"])
      .notNull()
      .default("draft"),
    title: varchar("title", { length: 191 }).notNull(),
    operatorBriefing: text("operatorBriefing").notNull(),
    transcript: text("transcript").notNull(),
    generationSource: mysqlEnum("generationSource", [
      "anthropic_structured",
      "deterministic_fallback",
    ]).notNull(),
    gapStartedAt: timestamp("gapStartedAt").notNull(),
    nextCommitmentAt: timestamp("nextCommitmentAt"),
    availableMinutes: int("availableMinutes"),
    currentLocationJson: json("currentLocationJson"),
    requestId: varchar("requestId", { length: 36 }).notNull(),
    approvedAt: timestamp("approvedAt"),
    completedAt: timestamp("completedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    tenantRequestUnique: uniqueIndex(
      "uq_open_channel_missions_tenant_request"
    ).on(table.tenantId, table.requestId),
    tenantDriverDateStatusIdx: index(
      "idx_open_channel_missions_tenant_driver_date_status"
    ).on(table.tenantId, table.driverId, table.businessDate, table.status),
  })
);

export const openChannelMissionTasks = mysqlTable(
  "open_channel_mission_tasks",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    missionId: varchar("missionId", { length: 36 }).notNull(),
    position: int("position").notNull(),
    title: varchar("title", { length: 191 }).notNull(),
    detail: text("detail").notNull(),
    estimatedMinutes: int("estimatedMinutes").notNull(),
    category: mysqlEnum("category", [
      "food",
      "sales",
      "operations",
      "personal",
      "finance",
      "travel",
      "other",
    ]).notNull(),
    navigationQuery: varchar("navigationQuery", { length: 512 }),
    status: mysqlEnum("status", ["pending", "completed"])
      .notNull()
      .default("pending"),
    completedAt: timestamp("completedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    missionPositionUnique: uniqueIndex(
      "uq_open_channel_tasks_mission_position"
    ).on(table.missionId, table.position),
    tenantMissionStatusIdx: index(
      "idx_open_channel_tasks_tenant_mission_status"
    ).on(table.tenantId, table.missionId, table.status),
  })
);

export const openChannelTaskEvents = mysqlTable(
  "open_channel_task_events",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    missionId: varchar("missionId", { length: 36 }).notNull(),
    taskId: varchar("taskId", { length: 36 }).notNull(),
    actorId: varchar("actorId", { length: 128 }).notNull(),
    requestId: varchar("requestId", { length: 36 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    tenantRequestUnique: uniqueIndex(
      "uq_open_channel_task_events_tenant_request"
    ).on(table.tenantId, table.requestId),
    tenantMissionIdx: index("idx_open_channel_task_events_tenant_mission").on(
      table.tenantId,
      table.missionId,
      table.createdAt
    ),
  })
);

/**
 * Slice 13 — Armory Evolution.
 *
 * `sales_intel_*` is global trainer intelligence, shared across tenants.
 * `armory_weapon_*` is personal evidence and is always tenant + actor scoped.
 * The two layers are never merged and never overwrite one another.
 */
const longtext = customType<{ data: string; driverData: string }>({
  dataType() {
    return "longtext";
  },
});

/** Immutable record of where sales intelligence came from. Never rewritten. */
export const salesIntelSourceArtifacts = mysqlTable(
  "sales_intel_source_artifacts",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    /** Nullable — only set when this artifact came from a registered/monitored source (Slice 37/38). */
    sourceRegistryId: varchar("sourceRegistryId", { length: 36 }),
    sourceType: mysqlEnum("sourceType", [
      "manual_url",
      "instagram",
      "youtube",
      "podcast",
      "uploaded_transcript",
      "test_fixture",
      "other",
    ]).notNull(),
    sourceUrl: varchar("sourceUrl", { length: 1024 }),
    canonicalUrl: varchar("canonicalUrl", { length: 1024 }),
    externalContentId: varchar("externalContentId", { length: 191 }),
    creatorName: varchar("creatorName", { length: 191 }),
    creatorHandle: varchar("creatorHandle", { length: 191 }),
    publishedAt: timestamp("publishedAt"),
    title: varchar("title", { length: 512 }),
    contentHash: varchar("contentHash", { length: 64 }).notNull(),
    status: mysqlEnum("status", [
      "received",
      "awaiting_content",
      "processing",
      "analyzed",
      "extracted",
      "failed",
    ])
      .notNull()
      .default("received"),
    failureCode: varchar("failureCode", { length: 96 }),
    failureMessage: varchar("failureMessage", { length: 512 }),
    failureRetryable: boolean("failureRetryable").notNull().default(false),
    attemptCount: int("attemptCount").notNull().default(0),
    lastAttemptAt: timestamp("lastAttemptAt"),
    metadataJson: json("metadataJson").notNull(),
    ingestedBy: varchar("ingestedBy", { length: 128 }).notNull(),
    ingestedAt: timestamp("ingestedAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    contentUnique: uniqueIndex("uq_sales_intel_source_content").on(
      table.contentHash
    ),
    statusIdx: index("idx_sales_intel_source_status").on(
      table.status,
      table.ingestedAt
    ),
    externalIdx: index("idx_sales_intel_source_external").on(
      table.sourceType,
      table.externalContentId
    ),
    registryIdx: index("idx_sales_intel_source_registry").on(
      table.sourceRegistryId
    ),
  })
);

/**
 * Curated, admin-managed watch list of creators/channels (Slice 37) —
 * distinct from `salesIntelSourceArtifacts`, which is one row per
 * individual piece of ingested content. Global, like the rest of
 * sales_intel_* — not tenant scoped.
 */
export const salesIntelSources = mysqlTable(
  "sales_intel_sources",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    creatorName: varchar("creatorName", { length: 191 }).notNull(),
    creatorHandle: varchar("creatorHandle", { length: 191 }),
    platform: mysqlEnum("platform", [
      "youtube",
      "instagram",
      "manual",
    ]).notNull(),
    sourceType: mysqlEnum("sourceType", [
      "youtube_channel",
      "youtube_playlist",
      "youtube_video",
      "instagram_profile_reference",
      "manual_source",
    ]).notNull(),
    canonicalSourceUrl: varchar("canonicalSourceUrl", {
      length: 1024,
    }).notNull(),
    canonicalSourceUrlHash: varchar("canonicalSourceUrlHash", {
      length: 64,
    }).notNull(),
    externalChannelId: varchar("externalChannelId", { length: 191 }),
    acquisitionMode: mysqlEnum("acquisitionMode", [
      "AUTO_YOUTUBE",
      "MANUAL_TRANSCRIPT",
      "MANUAL_MEDIA",
      "URL_REFERENCE_ONLY",
      "PROVIDER_ANALYSIS",
    ]).notNull(),
    status: mysqlEnum("status", ["active", "disabled"])
      .notNull()
      .default("active"),
    notes: varchar("notes", { length: 2048 }),
    lastCheckedAt: timestamp("lastCheckedAt"),
    createdBy: varchar("createdBy", { length: 128 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    canonicalUrlHashUnique: uniqueIndex(
      "uq_sales_intel_source_canonical_url_hash"
    ).on(table.canonicalSourceUrlHash),
    statusIdx: index("idx_sales_intel_source_registry_status").on(
      table.status,
      table.platform
    ),
  })
);

/** Transcript or model-derived video analysis, versioned per source. */
export const salesIntelTranscripts = mysqlTable(
  "sales_intel_transcripts",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    sourceArtifactId: varchar("sourceArtifactId", { length: 36 }).notNull(),
    contentKind: mysqlEnum("contentKind", [
      "supplied_transcript",
      "video_understanding",
      "audio_transcription",
      "caption_only",
    ])
      .notNull()
      .default("supplied_transcript"),
    text: longtext("text").notNull(),
    segmentsJson: json("segmentsJson").notNull(),
    provider: varchar("provider", { length: 96 }),
    model: varchar("model", { length: 96 }),
    analysisVersion: varchar("analysisVersion", { length: 96 }),
    version: int("version").notNull().default(1),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    versionUnique: uniqueIndex("uq_sales_intel_transcript_version").on(
      table.sourceArtifactId,
      table.version
    ),
    sourceIdx: index("idx_sales_intel_transcript_source").on(
      table.sourceArtifactId,
      table.createdAt
    ),
  })
);

/** Normalized trainer teaching. Contradictory trainers stay contradictory. */
export const salesIntelFrameworks = mysqlTable(
  "sales_intel_frameworks",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    sourceArtifactId: varchar("sourceArtifactId", { length: 36 }).notNull(),
    transcriptId: varchar("transcriptId", { length: 36 }),
    frameworkKey: varchar("frameworkKey", { length: 64 }).notNull(),
    creatorName: varchar("creatorName", { length: 191 }).notNull(),
    creatorHandle: varchar("creatorHandle", { length: 191 }),
    archetype: mysqlEnum("archetype", [
      "ANCHOR",
      "GATEKEEPER",
      "GHOST",
      "STALLER",
    ]).notNull(),
    channel: mysqlEnum("channel", [
      "phone",
      "in_person",
      "follow_up",
      "proposal",
    ]).notNull(),
    exactObjection: varchar("exactObjection", { length: 1000 }).notNull(),
    diagnosis: text("diagnosis"),
    frameworkName: varchar("frameworkName", { length: 191 }).notNull(),
    principle: text("principle").notNull(),
    responseFamily: varchar("responseFamily", { length: 191 }).notNull(),
    discoveryQuestionsJson: json("discoveryQuestionsJson").notNull(),
    exampleLanguageJson: json("exampleLanguageJson").notNull(),
    whenToUseJson: json("whenToUseJson").notNull(),
    whenNotToUseJson: json("whenNotToUseJson").notNull(),
    followUpMovesJson: json("followUpMovesJson").notNull(),
    badResponsesJson: json("badResponsesJson").notNull(),
    confidence: decimal("confidence", { precision: 4, scale: 3 }),
    extractionVersion: varchar("extractionVersion", { length: 96 }).notNull(),
    extractionProvider: varchar("extractionProvider", { length: 96 }),
    extractionModel: varchar("extractionModel", { length: 96 }),
    promptVersion: varchar("promptVersion", { length: 96 }),
    transcriptStartMs: int("transcriptStartMs"),
    transcriptEndMs: int("transcriptEndMs"),
    reviewState: mysqlEnum("reviewState", [
      "review_required",
      "accepted",
      "rejected",
    ])
      .notNull()
      .default("review_required"),
    reviewedBy: varchar("reviewedBy", { length: 128 }),
    reviewedAt: timestamp("reviewedAt"),
    version: int("version").notNull().default(1),
    active: boolean("active").notNull().default(true),
    supersededAt: timestamp("supersededAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    versionUnique: uniqueIndex("uq_sales_intel_framework_version").on(
      table.frameworkKey,
      table.version
    ),
    lookupIdx: index("idx_sales_intel_framework_lookup").on(
      table.archetype,
      table.channel,
      table.reviewState,
      table.active
    ),
    sourceIdx: index("idx_sales_intel_framework_source").on(
      table.sourceArtifactId,
      table.createdAt
    ),
  })
);

/**
 * General sales teaching — broader than `sales_intel_frameworks`, which
 * only represents objection-handling frameworks (mandatory archetype +
 * channel + exact objection). A teaching never requires those — category
 * and a source-faithful principle are the only mandatory content fields.
 * When a teaching's own source evidence genuinely supports an
 * objection-handling reading, that reading is persisted as its own,
 * independently-reviewed `sales_intel_frameworks` row through the existing
 * pipeline — never implied by this row's own acceptance.
 */
export const salesIntelTeachings = mysqlTable(
  "sales_intel_teachings",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    sourceArtifactId: varchar("sourceArtifactId", { length: 36 }).notNull(),
    transcriptId: varchar("transcriptId", { length: 36 }).notNull(),
    teachingKey: varchar("teachingKey", { length: 64 }).notNull(),
    creatorName: varchar("creatorName", { length: 191 }).notNull(),
    creatorHandle: varchar("creatorHandle", { length: 191 }),
    category: mysqlEnum("category", [
      "prospecting",
      "opening",
      "positioning",
      "rapport",
      "discovery",
      "qualification",
      "questioning",
      "value",
      "pricing",
      "objection_prevention",
      "objection_handling",
      "negotiation",
      "closing",
      "follow_up",
      "re_engagement",
      "sales_process",
      "sales_psychology",
      "other",
    ]).notNull(),
    title: varchar("title", { length: 191 }).notNull(),
    principle: text("principle").notNull(),
    whenToUseJson: json("whenToUseJson").notNull(),
    whenNotToUseJson: json("whenNotToUseJson").notNull(),
    exampleLanguageJson: json("exampleLanguageJson").notNull(),
    confidence: decimal("confidence", { precision: 4, scale: 3 }),
    extractionVersion: varchar("extractionVersion", { length: 96 }).notNull(),
    extractionProvider: varchar("extractionProvider", { length: 96 }),
    extractionModel: varchar("extractionModel", { length: 96 }),
    promptVersion: varchar("promptVersion", { length: 96 }),
    transcriptStartMs: int("transcriptStartMs"),
    transcriptEndMs: int("transcriptEndMs"),
    reviewState: mysqlEnum("reviewState", [
      "review_required",
      "accepted",
      "rejected",
    ])
      .notNull()
      .default("review_required"),
    reviewedBy: varchar("reviewedBy", { length: 128 }),
    reviewedAt: timestamp("reviewedAt"),
    version: int("version").notNull().default(1),
    active: boolean("active").notNull().default(true),
    supersededAt: timestamp("supersededAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    versionUnique: uniqueIndex("uq_sales_intel_teaching_version").on(
      table.teachingKey,
      table.version
    ),
    sourceIdx: index("idx_sales_intel_teaching_source").on(
      table.sourceArtifactId,
      table.createdAt
    ),
    transcriptIdx: index("idx_sales_intel_teaching_transcript").on(
      table.transcriptId
    ),
    lookupIdx: index("idx_sales_intel_teaching_lookup").on(
      table.category,
      table.reviewState,
      table.active
    ),
  })
);

/** Layer B: what happened when THIS player used a weapon. Tenant scoped. */
export const armoryWeaponUsages = mysqlTable(
  "armory_weapon_usages",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    actorId: varchar("actorId", { length: 128 }).notNull(),
    missionId: int("missionId").notNull(),
    weaponId: varchar("weaponId", { length: 191 }).notNull(),
    frameworkId: varchar("frameworkId", { length: 36 }),
    archetype: mysqlEnum("archetype", [
      "ANCHOR",
      "GATEKEEPER",
      "GHOST",
      "STALLER",
    ]).notNull(),
    channel: mysqlEnum("channel", [
      "phone",
      "in_person",
      "follow_up",
      "proposal",
    ]).notNull(),
    provenanceKind: mysqlEnum("provenanceKind", [
      "trainer_source",
      "personal_evidence",
      "foundation",
    ]).notNull(),
    requestId: varchar("requestId", { length: 36 }).notNull(),
    usedAt: timestamp("usedAt").defaultNow().notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    requestUnique: uniqueIndex("uq_armory_weapon_usage_request").on(
      table.tenantId,
      table.requestId
    ),
    weaponIdx: index("idx_armory_weapon_usage_weapon").on(
      table.tenantId,
      table.actorId,
      table.weaponId,
      table.usedAt
    ),
    missionIdx: index("idx_armory_weapon_usage_mission").on(
      table.tenantId,
      table.missionId,
      table.usedAt
    ),
  })
);

/**
 * Outcomes observed after a weapon was used. Append-only, and deliberately an
 * association rather than an attribution — a later win is evidence, not proof
 * that the weapon caused it.
 */
export const armoryWeaponOutcomes = mysqlTable(
  "armory_weapon_outcomes",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    usageId: varchar("usageId", { length: 36 }).notNull(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    actorId: varchar("actorId", { length: 128 }).notNull(),
    missionId: int("missionId").notNull(),
    weaponId: varchar("weaponId", { length: 191 }).notNull(),
    outcomeKind: mysqlEnum("outcomeKind", [
      "follow_up_created",
      "call_logged",
      "visit_completed",
      "account_won",
      "account_lost",
      "access_recorded",
      "no_change",
    ]).notNull(),
    outcomeReference: varchar("outcomeReference", { length: 191 }).notNull(),
    observedAt: timestamp("observedAt").defaultNow().notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    outcomeUnique: uniqueIndex("uq_armory_weapon_outcome").on(
      table.tenantId,
      table.usageId,
      table.outcomeKind,
      table.outcomeReference
    ),
    weaponIdx: index("idx_armory_weapon_outcome_weapon").on(
      table.tenantId,
      table.actorId,
      table.weaponId,
      table.observedAt
    ),
  })
);

/**
 * Slice 14 — Mission Mutation Library.
 *
 * Append-only audit trail of world interpretations derived from
 * authoritative business evidence. `triggerReference` always points back to
 * the real evidence; this table never itself declares a business fact.
 */
export const missionMutations = mysqlTable(
  "mission_mutations",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    actorId: varchar("actorId", { length: 128 }).notNull(),
    missionId: int("missionId").notNull(),
    sourceState: varchar("sourceState", { length: 64 }).notNull(),
    mutationType: mysqlEnum("mutationType", [
      "RECOVERY_PATH",
      "ALT_ROUTE",
      "WATCH_WINDOW",
      "NEW_CONTACT_ROUTE",
      "FOLLOW_UP_ROUTE",
      "ESCALATION_ROUTE",
      "SCOUT_BRANCH",
      "CLOSED_PATH",
      "CAPTURED_PATH",
    ]).notNull(),
    triggerType: mysqlEnum("triggerType", [
      "follow_up_commitment",
      "decision_maker_discovered",
      "pipeline_stage_change",
      "verified_win",
      "verified_loss",
      "scout_discovery",
      "contact_route_discovered",
    ]).notNull(),
    triggerReference: varchar("triggerReference", { length: 255 }).notNull(),
    worldEffectJson: json("worldEffectJson").notNull(),
    businessReferencesJson: json("businessReferencesJson").notNull(),
    metadataJson: json("metadataJson").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    triggerUnique: uniqueIndex("uq_mission_mutation_trigger").on(
      table.tenantId,
      table.actorId,
      table.missionId,
      table.triggerReference
    ),
    lookupIdx: index("idx_mission_mutation_lookup").on(
      table.tenantId,
      table.actorId,
      table.missionId,
      table.createdAt
    ),
  })
);

/**
 * Externally-managed operational work — real jobs that did not originate in
 * Laundry Butler.
 *
 * Kept out of `orders` on purpose. See 0057_external_operational_orders.sql
 * for the reasoning: `orders` carries Stripe, resident, vendor-routing and
 * revenue semantics that must never be inferred for a job this business does
 * not own the billing for.
 */
export const externalOperationalOrders = mysqlTable(
  "external_operational_orders",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull().default("default"),
    sourceSystem: mysqlEnum("sourceSystem", [
      "cleancloud",
      "manual_external",
    ]).notNull(),
    ingestionMethod: mysqlEnum("ingestionMethod", [
      "screenshot",
      "manual",
      "voice",
    ]).notNull(),
    externalOrderId: varchar("externalOrderId", { length: 191 }),
    jobKind: mysqlEnum("jobKind", ["pickup", "dropoff"]).notNull(),
    customerName: varchar("customerName", { length: 191 }).notNull(),
    address: varchar("address", { length: 512 }),
    scheduledDate: varchar("scheduledDate", { length: 10 }),
    windowStart: varchar("windowStart", { length: 5 }),
    windowEnd: varchar("windowEnd", { length: 5 }),
    notes: text("notes"),
    operationalStatus: mysqlEnum("operationalStatus", [
      "scheduled",
      "completed",
      "cancelled",
    ])
      .notNull()
      .default("scheduled"),
    completedAt: timestamp("completedAt"),
    reconciliationStatus: mysqlEnum("reconciliationStatus", [
      "update_required",
      "reconciled",
    ])
      .notNull()
      .default("update_required"),
    reconciledAt: timestamp("reconciledAt"),
    externalLastVerifiedAt: timestamp("externalLastVerifiedAt"),
    reviewState: mysqlEnum("reviewState", [
      "pending_review",
      "confirmed",
      "discarded",
    ])
      .notNull()
      .default("pending_review"),
    importBatchId: varchar("importBatchId", { length: 36 }),
    confirmedAt: timestamp("confirmedAt"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  },
  table => ({
    dayIdx: index("idx_external_order_day").on(
      table.tenantId,
      table.scheduledDate,
      table.reviewState
    ),
    batchIdx: index("idx_external_order_batch").on(table.importBatchId),
    reconciliationIdx: index("idx_external_order_reconciliation").on(
      table.tenantId,
      table.reconciliationStatus
    ),
  })
);

/** Field intel. See 0058_impact_signals.sql — stable schema, open vocabulary. */
export const impactSignals = mysqlTable(
  "impact_signals",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull().default("default"),
    campaignId: varchar("campaignId", { length: 64 }),
    businessDate: varchar("businessDate", { length: 10 }).notNull(),
    signalKey: varchar("signalKey", { length: 96 }).notNull(),
    label: varchar("label", { length: 191 }).notNull(),
    valueType: mysqlEnum("valueType", [
      "text",
      "number",
      "boolean",
      "enum",
      "date",
    ])
      .notNull()
      .default("text"),
    value: text("value").notNull(),
    unit: varchar("unit", { length: 32 }),
    impactClass: mysqlEnum("impactClass", [
      "observation",
      "field_activity",
      "response",
      "opportunity",
      "customer_outcome",
      "economic_outcome",
    ])
      .notNull()
      .default("observation"),
    provenance: mysqlEnum("provenance", [
      "system_verified",
      "operator_confirmed",
      "external_record",
    ])
      .notNull()
      .default("operator_confirmed"),
    entityType: varchar("entityType", { length: 64 }),
    entityId: varchar("entityId", { length: 64 }),
    entityLabel: varchar("entityLabel", { length: 191 }),
    location: varchar("location", { length: 512 }),
    notes: text("notes"),
    metadataJson: json("metadataJson"),
    capturedAt: timestamp("capturedAt").notNull().defaultNow(),
    confirmedAt: timestamp("confirmedAt"),
  },
  table => ({
    campaignIdx: index("idx_impact_signal_campaign").on(
      table.tenantId,
      table.campaignId,
      table.businessDate
    ),
    keyIdx: index("idx_impact_signal_key").on(
      table.tenantId,
      table.signalKey,
      table.businessDate
    ),
    entityIdx: index("idx_impact_signal_entity").on(
      table.entityType,
      table.entityId
    ),
  })
);

/** Reusable questions. Additive; promotion never rewrites captured signals. */
export const trackedSignalDefinitions = mysqlTable(
  "tracked_signal_definitions",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull().default("default"),
    signalKey: varchar("signalKey", { length: 96 }).notNull(),
    label: varchar("label", { length: 191 }).notNull(),
    valueType: mysqlEnum("valueType", [
      "text",
      "number",
      "boolean",
      "enum",
      "date",
    ])
      .notNull()
      .default("text"),
    impactClass: mysqlEnum("impactClass", [
      "observation",
      "field_activity",
      "response",
      "opportunity",
      "customer_outcome",
      "economic_outcome",
    ])
      .notNull()
      .default("observation"),
    appliesTo: varchar("appliesTo", { length: 64 }),
    unit: varchar("unit", { length: 32 }),
    optionsJson: json("optionsJson"),
    promoted: boolean("promoted").notNull().default(false),
    observedCount: int("observedCount").notNull().default(0),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  },
  table => ({
    keyUnique: uniqueIndex("uq_tracked_signal_key").on(
      table.tenantId,
      table.signalKey
    ),
  })
);

/** Tenant-scoped operational handoff destination used by Day Director. */
export const dayDirectorProcessingLocations = mysqlTable(
  "day_director_processing_locations",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull().default("default"),
    name: varchar("name", { length: 191 }).notNull(),
    locality: varchar("locality", { length: 191 }),
    address: varchar("address", { length: 512 }),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow().onUpdateNow(),
  },
  table => ({
    tenantUnique: uniqueIndex("uq_day_director_processing_tenant").on(
      table.tenantId
    ),
  })
);

/** Human-approved daily truth and per-day prompt lifecycle. */
export const dayDirectorCommitments = mysqlTable(
  "day_director_commitments",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull().default("default"),
    actorId: varchar("actorId", { length: 128 }).notNull(),
    businessDate: varchar("businessDate", { length: 10 }).notNull(),
    idempotencyKey: varchar("idempotencyKey", { length: 191 }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    kind: mysqlEnum("kind", ["growth", "prep", "operations"]).notNull(),
    quantity: int("quantity"),
    provenance: mysqlEnum("provenance", ["user_reported", "manual"]).notNull(),
    status: mysqlEnum("status", ["open", "completed"])
      .notNull()
      .default("open"),
    sourceText: text("sourceText"),
    metadataJson: json("metadataJson"),
    completedAt: timestamp("completedAt"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow().onUpdateNow(),
  },
  table => ({
    idempotencyUnique: uniqueIndex("uq_day_director_commitment_key").on(
      table.tenantId,
      table.actorId,
      table.businessDate,
      table.idempotencyKey
    ),
    todayIdx: index("idx_day_director_commitment_today").on(
      table.tenantId,
      table.actorId,
      table.businessDate
    ),
  })
);

export const dayDirectorPromptStates = mysqlTable(
  "day_director_prompt_states",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull().default("default"),
    actorId: varchar("actorId", { length: 128 }).notNull(),
    businessDate: varchar("businessDate", { length: 10 }).notNull(),
    promptKey: varchar("promptKey", { length: 191 }).notNull(),
    state: mysqlEnum("state", ["accepted", "dismissed"]).notNull(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow().onUpdateNow(),
  },
  table => ({
    promptUnique: uniqueIndex("uq_day_director_prompt_state").on(
      table.tenantId,
      table.actorId,
      table.businessDate,
      table.promptKey
    ),
  })
);

/** Canonical address/geocode truth for residential, building, and prospect entities. */
export const entityLocations = mysqlTable(
  "entity_locations",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    entityType: mysqlEnum("entityType", [
      "customer",
      "building",
      "commercial_prospect",
    ]).notNull(),
    entityKey: varchar("entityKey", { length: 191 }).notNull(),
    sourceAddress: varchar("sourceAddress", { length: 512 }).notNull(),
    normalizedSourceAddress: varchar("normalizedSourceAddress", {
      length: 512,
    }).notNull(),
    canonicalAddress: varchar("canonicalAddress", { length: 512 }),
    latitude: decimal("latitude", { precision: 10, scale: 7 }),
    longitude: decimal("longitude", { precision: 10, scale: 7 }),
    googlePlaceId: varchar("googlePlaceId", { length: 255 }),
    geocodeStatus: mysqlEnum("geocodeStatus", [
      "pending",
      "success",
      "missing_address",
      "ambiguous",
      "provider_failure",
      "transient_failure",
      "unconfigured",
    ])
      .notNull()
      .default("pending"),
    geocodeProvider: varchar("geocodeProvider", { length: 64 }),
    geocodedAt: timestamp("geocodedAt"),
    geocodeError: varchar("geocodeError", { length: 512 }),
    lastAttemptAt: timestamp("lastAttemptAt"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow().onUpdateNow(),
  },
  table => ({
    entityUnique: uniqueIndex("uq_entity_locations_tenant_entity").on(
      table.tenantId,
      table.entityType,
      table.entityKey
    ),
    statusIdx: index("idx_entity_locations_tenant_status").on(
      table.tenantId,
      table.geocodeStatus
    ),
    addressIdx: index("idx_entity_locations_tenant_address").on(
      table.tenantId,
      table.normalizedSourceAddress
    ),
  })
);

/** Role-neutral identity. Geography remains exclusively in entityLocations. */
export const physicalEntities = mysqlTable(
  "physical_entities",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    kind: mysqlEnum("kind", ["building", "property", "other_place"])
      .notNull()
      .default("building"),
    displayName: varchar("displayName", { length: 255 }).notNull(),
    identityStatus: mysqlEnum("identityStatus", [
      "confirmed",
      "provisional",
      "needs_review",
      "merged",
    ]).notNull().default("provisional"),
    canonicalEntityId: varchar("canonicalEntityId", { length: 36 }),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow().onUpdateNow(),
  },
  table => ({
    statusIdx: index("idx_physical_entities_tenant_status").on(
      table.tenantId,
      table.identityStatus,
      table.updatedAt
    ),
    canonicalIdx: index("idx_physical_entities_canonical").on(
      table.tenantId,
      table.canonicalEntityId
    ),
  })
);

export const physicalEntityBindings = mysqlTable(
  "physical_entity_bindings",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    physicalEntityId: varchar("physicalEntityId", { length: 36 }).notNull(),
    bindingType: mysqlEnum("bindingType", [
      "canonical_building",
      "customer_cluster",
      "commercial_account",
      "commercial_location",
      "commercial_prospect",
      "journal_entry",
      "tower_wars_building",
      "tower_asset",
      "provider_place",
    ]).notNull(),
    bindingKey: varchar("bindingKey", { length: 191 }).notNull(),
    evidenceReference: varchar("evidenceReference", { length: 512 }).notNull(),
    confidence: mysqlEnum("confidence", ["high", "medium", "low"]).notNull(),
    reviewState: mysqlEnum("reviewState", [
      "accepted",
      "review_required",
      "rejected",
    ]).notNull().default("accepted"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  table => ({
    sourceUnique: uniqueIndex("uq_physical_binding_source").on(
      table.tenantId,
      table.bindingType,
      table.bindingKey
    ),
    entityIdx: index("idx_physical_binding_entity").on(
      table.tenantId,
      table.physicalEntityId,
      table.createdAt
    ),
  })
);

export const physicalEntityAliases = mysqlTable(
  "physical_entity_aliases",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    physicalEntityId: varchar("physicalEntityId", { length: 36 }).notNull(),
    aliasType: mysqlEnum("aliasType", [
      "name",
      "normalized_address",
      "google_place_id",
      "operator_alias",
    ]).notNull(),
    aliasValue: varchar("aliasValue", { length: 512 }).notNull(),
    normalizedAliasValue: varchar("normalizedAliasValue", { length: 512 }).notNull(),
    evidenceReference: varchar("evidenceReference", { length: 512 }).notNull(),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  table => ({
    aliasUnique: uniqueIndex("uq_physical_alias").on(
      table.tenantId,
      table.aliasType,
      table.normalizedAliasValue
    ),
    entityIdx: index("idx_physical_alias_entity").on(
      table.tenantId,
      table.physicalEntityId
    ),
  })
);

export const goldlineWorldEvents = mysqlTable(
  "goldline_world_events",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    physicalEntityId: varchar("physicalEntityId", { length: 36 }),
    eventType: varchar("eventType", { length: 64 }).notNull(),
    classification: mysqlEnum("classification", [
      "evidence",
      "action",
      "outcome",
      "derived_signal",
      "game_projection",
    ]).notNull(),
    actorType: mysqlEnum("actorType", [
      "system",
      "operator",
      "field",
      "customer",
      "provider",
      "unknown",
    ]).notNull(),
    actorId: varchar("actorId", { length: 128 }),
    occurredAt: timestamp("occurredAt").notNull(),
    observedAt: timestamp("observedAt"),
    sourceType: varchar("sourceType", { length: 64 }).notNull(),
    sourceId: varchar("sourceId", { length: 191 }).notNull(),
    sourceEvidenceReference: varchar("sourceEvidenceReference", { length: 512 }).notNull(),
    provenanceClass: mysqlEnum("provenanceClass", [
      "operator_observed",
      "operator_reported",
      "device_location",
      "provider_verified",
      "official_property_source",
      "existing_business_record",
      "derived",
      "generated_game_fiction",
    ]).notNull(),
    verificationClass: mysqlEnum("verificationClass", [
      "VERIFIED",
      "ATTESTED",
      "CLAIMED",
    ]).notNull(),
    confidence: mysqlEnum("confidence", [
      "high",
      "medium",
      "low",
      "unknown",
    ]).notNull(),
    idempotencyKey: varchar("idempotencyKey", { length: 191 }).notNull(),
    correlationId: varchar("correlationId", { length: 191 }).notNull(),
    metadataJson: json("metadataJson").notNull(),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  table => ({
    idempotencyUnique: uniqueIndex("uq_goldline_world_event_idempotency").on(
      table.tenantId,
      table.idempotencyKey
    ),
    entityIdx: index("idx_goldline_world_event_entity").on(
      table.tenantId,
      table.physicalEntityId,
      table.occurredAt
    ),
    classIdx: index("idx_goldline_world_event_class").on(
      table.tenantId,
      table.classification,
      table.occurredAt
    ),
    sourceIdx: index("idx_goldline_world_event_source").on(
      table.tenantId,
      table.sourceType,
      table.sourceId
    ),
  })
);

export const goldlineEventReceipts = mysqlTable(
  "goldline_event_receipts",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    worldEventId: varchar("worldEventId", { length: 36 }).notNull(),
    viewerId: varchar("viewerId", { length: 128 }).notNull(),
    receiptType: mysqlEnum("receiptType", [
      "presented",
      "read",
      "acknowledged",
    ]).notNull(),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  table => ({
    receiptUnique: uniqueIndex("uq_goldline_event_receipt").on(
      table.tenantId,
      table.worldEventId,
      table.viewerId,
      table.receiptType
    ),
    viewerIdx: index("idx_goldline_event_receipt_viewer").on(
      table.tenantId,
      table.viewerId,
      table.createdAt
    ),
  })
);

export const fieldJournalExtractions = mysqlTable(
  "field_journal_extractions",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    journalEntryId: varchar("journalEntryId", { length: 36 }).notNull(),
    version: int("version").notNull().default(1),
    provider: varchar("provider", { length: 64 }),
    model: varchar("model", { length: 96 }),
    schemaVersion: varchar("schemaVersion", { length: 32 }).notNull(),
    status: mysqlEnum("status", [
      "pending",
      "processed",
      "fallback",
      "failed",
    ]).notNull().default("pending"),
    itemsJson: json("itemsJson").notNull(),
    error: varchar("error", { length: 512 }),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  table => ({
    versionUnique: uniqueIndex("uq_field_journal_extraction_version").on(
      table.tenantId,
      table.journalEntryId,
      table.version
    ),
    statusIdx: index("idx_field_journal_extraction_status").on(
      table.tenantId,
      table.status,
      table.createdAt
    ),
  })
);

export const towerForgeJobs = mysqlTable(
  "tower_forge_jobs",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    physicalEntityId: varchar("physicalEntityId", { length: 36 }),
    journalEntryId: varchar("journalEntryId", { length: 36 }),
    commercialAccountId: int("commercialAccountId"),
    state: mysqlEnum("state", [
      "captured",
      "extracting",
      "entity_resolving",
      "needs_review",
      "geography_verifying",
      "prospect_created",
      "researching",
      "research_partial",
      "concepting",
      "rendering",
      "generation_unconfigured",
      "generation_failed",
      "review_ready",
      "approved",
      "rejected",
      "published",
    ]).notNull().default("captured"),
    correlationId: varchar("correlationId", { length: 191 }).notNull(),
    idempotencyKey: varchar("idempotencyKey", { length: 191 }).notNull(),
    candidateJson: json("candidateJson").notNull(),
    retryCount: int("retryCount").notNull().default(0),
    lastError: varchar("lastError", { length: 512 }),
    leaseOwner: varchar("leaseOwner", { length: 128 }),
    leaseExpiresAt: timestamp("leaseExpiresAt"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow().onUpdateNow(),
    completedAt: timestamp("completedAt"),
  },
  table => ({
    idempotencyUnique: uniqueIndex("uq_tower_forge_job_idempotency").on(
      table.tenantId,
      table.idempotencyKey
    ),
    queueIdx: index("idx_tower_forge_job_queue").on(
      table.tenantId,
      table.state,
      table.leaseExpiresAt,
      table.updatedAt
    ),
    entityIdx: index("idx_tower_forge_job_entity").on(
      table.tenantId,
      table.physicalEntityId,
      table.updatedAt
    ),
  })
);

export const propertyEvidenceItems = mysqlTable(
  "property_evidence_items",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    physicalEntityId: varchar("physicalEntityId", { length: 36 }).notNull(),
    forgeJobId: varchar("forgeJobId", { length: 36 }),
    category: mysqlEnum("category", [
      "real_identity",
      "field_evidence",
      "official_property_intelligence",
    ]).notNull(),
    factType: varchar("factType", { length: 64 }).notNull(),
    valueJson: json("valueJson").notNull(),
    provenanceClass: mysqlEnum("provenanceClass", [
      "operator_observed",
      "operator_reported",
      "device_location",
      "provider_verified",
      "official_property_source",
      "existing_business_record",
      "derived",
      "generated_game_fiction",
    ]).notNull(),
    sourceUrl: varchar("sourceUrl", { length: 1024 }),
    sourceReference: varchar("sourceReference", { length: 512 }).notNull(),
    observedAt: timestamp("observedAt"),
    retrievedAt: timestamp("retrievedAt"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  table => ({
    entityIdx: index("idx_property_evidence_entity").on(
      table.tenantId,
      table.physicalEntityId,
      table.category,
      table.createdAt
    ),
    forgeIdx: index("idx_property_evidence_forge").on(
      table.tenantId,
      table.forgeJobId
    ),
  })
);

export const towerWeaponConcepts = mysqlTable(
  "tower_weapon_concepts",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    physicalEntityId: varchar("physicalEntityId", { length: 36 }).notNull(),
    forgeJobId: varchar("forgeJobId", { length: 36 }).notNull(),
    rank: int("rank").notNull(),
    title: varchar("title", { length: 191 }).notNull(),
    sourceCharacteristic: varchar("sourceCharacteristic", { length: 512 }).notNull(),
    sourceEvidenceIdsJson: json("sourceEvidenceIdsJson").notNull(),
    conceptJson: json("conceptJson").notNull(),
    similarityRisk: mysqlEnum("similarityRisk", [
      "low",
      "medium",
      "high",
    ]).notNull(),
    selected: boolean("selected").notNull().default(false),
    reviewState: mysqlEnum("reviewState", [
      "pending",
      "accepted",
      "rejected",
    ]).notNull().default("pending"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow().onUpdateNow(),
  },
  table => ({
    rankUnique: uniqueIndex("uq_tower_weapon_concept_rank").on(
      table.tenantId,
      table.forgeJobId,
      table.rank
    ),
    entityIdx: index("idx_tower_weapon_concept_entity").on(
      table.tenantId,
      table.physicalEntityId
    ),
  })
);

export const towerAssetVersions = mysqlTable(
  "tower_asset_versions",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    physicalEntityId: varchar("physicalEntityId", { length: 36 }).notNull(),
    forgeJobId: varchar("forgeJobId", { length: 36 }).notNull(),
    conceptId: varchar("conceptId", { length: 36 }).notNull(),
    provider: varchar("provider", { length: 64 }).notNull(),
    modelVersion: varchar("modelVersion", { length: 96 }),
    promptVersionHash: varchar("promptVersionHash", { length: 64 }).notNull(),
    sourceEvidenceIdsJson: json("sourceEvidenceIdsJson").notNull(),
    storageKey: varchar("storageKey", { length: 512 }).notNull(),
    assetUrl: varchar("assetUrl", { length: 2048 }),
    variantType: mysqlEnum("variantType", [
      "base",
      "weapon_layer",
      "thumbnail",
    ]).notNull(),
    approvalStatus: mysqlEnum("approvalStatus", [
      "draft",
      "approved",
      "rejected",
      "superseded",
    ]).notNull().default("draft"),
    supersededBy: varchar("supersededBy", { length: 36 }),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  table => ({
    entityIdx: index("idx_tower_asset_entity").on(
      table.tenantId,
      table.physicalEntityId,
      table.approvalStatus,
      table.createdAt
    ),
    forgeIdx: index("idx_tower_asset_forge").on(
      table.tenantId,
      table.forgeJobId
    ),
  })
);

export const goldlineCreativeExclusions = mysqlTable(
  "goldline_creative_exclusions",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    themeKey: varchar("themeKey", { length: 96 }).notNull(),
    reason: varchar("reason", { length: 512 }),
    active: boolean("active").notNull().default(true),
    createdBy: varchar("createdBy", { length: 128 }).notNull(),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow().onUpdateNow(),
  },
  table => ({
    exclusionUnique: uniqueIndex("uq_goldline_creative_exclusion").on(
      table.tenantId,
      table.themeKey
    ),
  })
);

/** Explicit permission/promise evidence. Tower Wars never infers these rows. */
export const towerWarsPromises = mysqlTable(
  "tower_wars_promises",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    buildingId: mysqlEnum("buildingId", [
      "opus_la",
      "century_park_east",
    ]).notNull(),
    customerIdentity: varchar("customerIdentity", { length: 191 }),
    promiseType: mysqlEnum("promiseType", [
      "offer_insert",
      "referral_card",
      "loyalty_reward",
      "thank_you_presentation",
      "other",
    ]).notNull(),
    sourceText: text("sourceText").notNull(),
    quantity: int("quantity"),
    permissionStatus: mysqlEnum("permissionStatus", [
      "not_required_physical_fulfillment",
      "recorded",
      "not_recorded",
      "revoked",
    ]).notNull(),
    permissionChannel: mysqlEnum("permissionChannel", [
      "physical_delivery",
      "sms",
      "email",
      "phone",
      "none",
    ]).notNull(),
    permissionEvidence: text("permissionEvidence"),
    sourceReference: varchar("sourceReference", { length: 512 }).notNull(),
    idempotencyKey: varchar("idempotencyKey", { length: 191 }).notNull(),
    fulfilledAt: timestamp("fulfilledAt"),
    fulfilledBy: varchar("fulfilledBy", { length: 128 }),
    fulfillmentEvidence: text("fulfillmentEvidence"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow().onUpdateNow(),
  },
  table => ({
    idempotencyUnique: uniqueIndex("uq_tower_wars_promises_tenant_key").on(
      table.tenantId,
      table.idempotencyKey
    ),
    buildingOpenIdx: index("idx_tower_wars_promises_building_open").on(
      table.tenantId,
      table.buildingId,
      table.fulfilledAt
    ),
  })
);
