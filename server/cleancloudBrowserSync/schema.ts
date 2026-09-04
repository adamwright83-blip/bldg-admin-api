import {
  mysqlTable,
  varchar,
  timestamp,
  json,
  int,
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
