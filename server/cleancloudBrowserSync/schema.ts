import {
  mysqlTable,
  varchar,
  timestamp,
  json,
  int,
  index,
  uniqueIndex,
  customType,
} from "drizzle-orm/mysql-core";

const mediumtext = customType<{ data: string; driverData: string }>({
  dataType() {
    return "mediumtext";
  },
});

// Separate schema module: no concurrent edits to drizzle/schema.ts.
export const browserSyncBindings = mysqlTable(
  "cleancloud_browser_sync_bindings",
  {
    tenantId: varchar("tenantId", { length: 64 }).primaryKey(),
    id: varchar("id", { length: 36 }).notNull(),
    storeId: varchar("storeId", { length: 32 }).notNull(),
    storeLabel: varchar("storeLabel", { length: 255 }).notNull(),
    createdBy: varchar("createdBy", { length: 128 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    lastSuccessAt: timestamp("lastSuccessAt"),
  }
);
export const browserSyncReceipts = mysqlTable(
  "cleancloud_browser_sync_receipts",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    requestId: varchar("requestId", { length: 36 }).notNull(),
    digest: varchar("digest", { length: 64 }).notNull(),
    storeId: varchar("storeId", { length: 32 }).notNull(),
    importBatchId: int("importBatchId").notNull(),
    receiptJson: json("receiptJson").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    requestUnique: uniqueIndex("uq_cc_browser_sync_request").on(
      table.tenantId,
      table.requestId
    ),
  })
);
/**
 * Every GUMBALL import attempt that reached Goldline — successes, rejected
 * payloads, conflicts, and failures the extension reports — so "did GUMBALL
 * run today?" is answered from evidence rather than inferred from order dates.
 */
export const browserSyncAttempts = mysqlTable(
  "cleancloud_browser_sync_attempts",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    requestId: varchar("requestId", { length: 36 }),
    outcome: varchar("outcome", { length: 32 }).notNull(),
    message: varchar("message", { length: 512 }),
    rangeFrom: varchar("rangeFrom", { length: 10 }),
    rangeTo: varchar("rangeTo", { length: 10 }),
    rowCount: int("rowCount"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    tenantTimeIdx: index("idx_cc_browser_sync_attempts_tenant").on(
      table.tenantId,
      table.createdAt
    ),
  })
);

/** Control totals read from Metrics → Overview. Screenshot bytes live in a second table. */
export const dashboardWitnesses = mysqlTable(
  "cleancloud_dashboard_witnesses",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    storeId: varchar("storeId", { length: 32 }).notNull(),
    storeLabel: varchar("storeLabel", { length: 255 }).notNull(),
    rangeFrom: varchar("rangeFrom", { length: 10 }).notNull(),
    rangeTo: varchar("rangeTo", { length: 10 }).notNull(),
    comparisonFrom: varchar("comparisonFrom", { length: 10 }),
    comparisonTo: varchar("comparisonTo", { length: 10 }),
    salesCents: int("salesCents").notNull(),
    comparisonSalesCents: int("comparisonSalesCents"),
    revenueCents: int("revenueCents").notNull(),
    comparisonRevenueCents: int("comparisonRevenueCents"),
    orders: int("orders").notNull(),
    comparisonOrders: int("comparisonOrders"),
    newCustomers: int("newCustomers"),
    observedAt: timestamp("observedAt").notNull(),
    screenshotSha256: varchar("screenshotSha256", { length: 64 }).notNull(),
    extractionVersion: varchar("extractionVersion", { length: 64 }).notNull(),
    source: varchar("source", { length: 64 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    observationUnique: uniqueIndex("uq_cc_dashboard_witness_observation").on(
      table.tenantId,
      table.storeId,
      table.rangeFrom,
      table.rangeTo,
      table.screenshotSha256
    ),
    periodIdx: index("idx_cc_dashboard_witness_period").on(
      table.tenantId,
      table.rangeFrom,
      table.rangeTo,
      table.observedAt
    ),
  })
);

/** Private PNG for the witness. Never selected by the operator summary. */
export const dashboardWitnessScreenshots = mysqlTable(
  "cleancloud_dashboard_witness_screenshots",
  {
    witnessId: varchar("witnessId", { length: 36 }).primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    pngBase64: mediumtext("pngBase64").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    tenantIdx: index("idx_cc_dashboard_witness_screenshot_tenant").on(table.tenantId),
  })
);

