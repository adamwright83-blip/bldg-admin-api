import {
  mysqlTable,
  varchar,
  timestamp,
  json,
  int,
  index,
  uniqueIndex,
} from "drizzle-orm/mysql-core";

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
